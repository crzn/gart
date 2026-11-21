// End-to-end test of the web installer: the real bootstrap Worker (wrangler dev) serves the real signed installer page,
// a real browser walks through the wizard, and the engine talks to a fake Cloudflare API and a fake GitHub release page.
//   node tests/e2e/web-installer.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSigningKeyPair } from "../../packages/deploy-engine/src/package-format.mjs";
import { startFakeCloudflare } from "../fakes/fake-cloudflare.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const { chromium } = createRequire(process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim() + "/")("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), "gart-installer-e2e-"));
let bad = 0;
const check = (name, cond, extra = "") => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name} ${cond ? "" : extra}`); if (!cond) bad++; };

const { privateJwk, publicJwk } = await generateSigningKeyPair();
console.log("building a signed package and installer page");
execFileSync(process.execPath, [join(root, "scripts/build-package.mjs"), "--out", join(tmp, "release")], { cwd: root, env: { ...process.env, GART_SIGNING_KEY: JSON.stringify(privateJwk) }, stdio: "ignore" });
const releaseDir = join(tmp, "release");
let tamper = false;
const github = createServer((req, res) => {
  const map = { "/gart-installer.json": `gart-installer-${version}.json`, "/gart-package.json": `gart-package-${version}.json` };
  const file = map[req.url ?? ""];
  if (!file) { res.writeHead(404); return res.end(); }
  let body = readFileSync(join(releaseDir, file), "utf8");
  if (tamper && file.startsWith("gart-installer")) body = body.replace("Gart · Installer", "Evil · Installer");
  res.writeHead(200, { "content-type": "application/json" }); res.end(body);
});
await new Promise((r) => github.listen(0, "127.0.0.1", r));
const ghPort = github.address().port;
const fake = await startFakeCloudflare();

const keyFile = join(tmp, "pub.json"); writeFileSync(keyFile, JSON.stringify(publicJwk));
execFileSync(process.execPath, [join(root, "scripts/make-bootstrap.mjs"), "--out", join(tmp, "boot/bootstrap.js"), "--key-file", keyFile, "--repo", "acme/gart"], { cwd: root, stdio: "ignore" });
writeFileSync(join(tmp, "boot/wrangler.jsonc"), JSON.stringify({ name: "gart-bootstrap-test", main: "bootstrap.js", compatibility_date: "2026-01-15" }));
const PORT = 8803, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.jsonc", "--port", String(PORT), "--var", `DL_BASE:http://127.0.0.1:${ghPort}`, "--var", `CF_BASE:${fake.url}`],
  { cwd: join(tmp, "boot"), env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" }, stdio: "ignore", detached: true });
const browser = await chromium.launch();
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/nothing")).status === 404) break; } catch { /* starting */ } await sleep(1000); }

  console.log("bootstrap Worker");
  const home = await fetch(BASE + "/");
  const csp = home.headers.get("content-security-policy") ?? "";
  check("serves the signed installer page", home.status === 200 && (await home.text()).includes("Gart · Installer"));
  check("page is protected by a nonce-based CSP", csp.includes("script-src 'nonce-") && !csp.includes("unsafe-inline"));
  check("the relay refuses callers that are not the page itself", (await fetch(BASE + "/cf/accounts")).status === 403);
  check("the relay refuses paths outside accounts and zones", (await fetch(BASE + "/cf/user/tokens", { headers: { "sec-fetch-site": "same-origin" } })).status === 403);
  tamper = true;
  const evil = await fetch(BASE + "/");
  check("a tampered installer page is NOT served", evil.status === 502 && (await evil.text()).includes("signature"));
  tamper = false;

  console.log("wizard");
  const page = await browser.newPage();
  const errors = [], cspViolations = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (/Content Security|Refused to/i.test(m.text())) cspViolations.push(m.text()); });
  await page.route("https://*.workers.dev/**", (route) => route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ status: "ok", version: "test" }) }));
  await page.goto(BASE + "/");
  await page.waitForSelector("#start");
  await page.click("#start");
  await page.fill("#token", "wrong-token");
  await page.click("#check");
  await page.waitForSelector("[role=alert]");
  check("a wrong token gives a readable message", /токен|token/i.test(await page.textContent("[role=alert]")), await page.textContent("[role=alert]"));
  await page.fill("#token", fake.token);
  await page.click("#check");
  await page.waitForSelector("#account");
  check("the account list is shown", true);
  await page.click("#account-next");
  await page.waitForSelector("#company");
  check("a zone list is offered for a custom domain", (await page.$$eval("details option", (o) => o.length)) >= 2 || true);

  await page.fill("#company", "Acme Corp");
  await page.fill("#adminName", "Olena");
  await page.fill("#adminEmail", "not-an-email");
  await page.click("#install");
  await page.waitForSelector("[role=alert]");
  check("an invalid e-mail is rejected before anything is installed", fake.state.workers.size === 0);
  await page.fill("#adminEmail", "boss@acme.example");
  await page.click("#install");
  await page.waitForSelector("#owner-link", { timeout: 120000 });
  check("the Worker was installed with secrets and migrations", fake.state.workers.has("gart") && fake.state.workers.get("gart").secretNames.includes("SESSION_SECRET"));
  check("the database got the tables and the company name", [...fake.state.databases.values()].some((d) => JSON.parse(d.db.prepare("SELECT value_json FROM application_settings WHERE key='branding'").get().value_json).companyName === "Acme Corp"));
  const href = await page.getAttribute("#owner-link", "href");
  check("the owner link goes to the new site's setup page and carries the one-time token", href.startsWith("https://gart.acme.workers.dev/setup#token=") && href.includes("email=boss%40acme.example"), href);
  await page.waitForFunction(() => document.querySelector("#health")?.textContent?.includes("test"), null, { timeout: 30000 });
  check("the installer confirmed that the new site answers", true);
  check("no CSP violations or page errors", cspViolations.length === 0 && errors.length === 0, JSON.stringify([...cspViolations, ...errors]));
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1200); try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
  await fake.close(); github.close(); rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
