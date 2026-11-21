// End-to-end test of in-app updates. The real Worker (wrangler dev) runs the Updater Durable Object; a fake Cloudflare API and
// a fake GitHub (release list + signed packages) stand in for the outside world; a real browser drives the Updates tab.
//   node tests/e2e/web-updates.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CloudflareClient, deploy, generateSigningKeyPair, sha256Hex, signManifestText, verifyPackage, bytesToBase64 } from "../../packages/deploy-engine/src/index.mjs";
import { startFakeCloudflare } from "../fakes/fake-cloudflare.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const PORT = 8804, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const { chromium } = createRequire(process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim() + "/")("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (name, cond, extra = "") => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name} ${cond ? "" : extra}`); if (!cond) bad++; };
const tmp = mkdtempSync(join(tmpdir(), "gart-updates-e2e-"));

// ---- packages: the real build, plus variants re-signed with the test key
const { privateJwk, publicJwk } = await generateSigningKeyPair();
console.log("building a signed package");
execFileSync(process.execPath, [join(root, "scripts/build-package.mjs"), "--out", tmp], { cwd: root, env: { ...process.env, GART_SIGNING_KEY: JSON.stringify(privateJwk) }, stdio: "ignore" });
const base = JSON.parse(readFileSync(join(tmp, `gart-package-${version}.json`), "utf8"));
async function variant(newVersion, edit = (m, blobs) => {}) {
  const m = JSON.parse(base.manifestText); m.version = newVersion; const blobs = { ...base.blobs };
  await edit(m, blobs);
  const manifestText = JSON.stringify(m);
  return { format: 1, manifestText, signature: await signManifestText(privateJwk, manifestText), blobs };
}
const packages = {
  "0.8.3": await variant("0.8.3"),
  "0.8.4": await variant("0.8.4", (m, blobs) => { const k = Object.keys(blobs).find((h) => h === m.worker.sha256); blobs[k] = bytesToBase64(new TextEncoder().encode("// changed after signing")); }),
  "0.8.5": await variant("0.8.5", async (m, blobs) => { const sql = "SELECT 1;"; const h = await sha256Hex(sql); blobs[h] = bytesToBase64(new TextEncoder().encode(sql)); m.migrations.push({ name: "9999_drop_example.sql", sha256: h, destructive: true }); }),
};
const releaseList = ["0.8.5", "0.8.4", "0.8.3", "0.8.2"].map((v) => ({ tag_name: `v${v}`, name: `Gart ${v}`, body: `Notes for ${v}\n- something new`, draft: false, prerelease: false, published_at: "2026-11-21T10:00:00Z", assets: [{ name: "gart-package.json" }] }));
const github = createServer((req, res) => {
  const url = req.url ?? "";
  if (url.startsWith("/repos/crzn/gart/releases")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(releaseList)); }
  const m = url.match(/^\/crzn\/gart\/releases\/download\/v([\d.]+)\/gart-package\.json$/);
  const pkg = m && (packages[m[1]] ?? (m[1] === version ? base : null));
  if (!pkg) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(pkg));
});
await new Promise((r) => github.listen(0, "127.0.0.1", r));
const ghUrl = `http://127.0.0.1:${github.address().port}`;

// ---- fake Cloudflare with an installed copy (installed with the same engine the installer uses)
const fake = await startFakeCloudflare();
const manifest = await verifyPackage(base, publicJwk);
await deploy({ client: new CloudflareClient({ base: fake.url, token: fake.token }), accountId: "acc1", pkg: base, manifest, workerName: "gart", databaseName: "gart-db", mode: "install" });
const installedWorkersDev = fake.state.workers.get("gart").workersDev;

// ---- the Worker under test
copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const vars = [`RELEASE_API_BASE:${ghUrl}`, `RELEASE_DL_BASE:${ghUrl}`, `CF_API_BASE:${fake.url}`, `RELEASE_PUBLIC_KEY:${JSON.stringify(publicJwk)}`].flatMap((v) => ["--var", v]);
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT), ...vars], { cwd: workerDir, env, stdio: "ignore", detached: true });
const browser = await chromium.launch();
const TOKEN = "local-dev-setup-token-0123456789";
const SECRET_TOKEN = "fake-cloudflare-token-" + "x".repeat(18);
fake.state.token = SECRET_TOKEN;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await sleep(1000); }
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = (path, method = "GET", body) => page.evaluate(async ([p, m, b]) => {
    const r = await fetch(p, { method: m, headers: { "x-gart-csrf": "1", Accept: "application/json", ...(b ? { "Content-Type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [path, method, body]);

  // owner
  await page.goto(`${BASE}/setup#token=${TOKEN}&email=boss%40example.com&name=Olena`);
  await page.waitForFunction(() => document.querySelector("#email")?.value === "boss@example.com");
  await page.fill("#password", "Correct-Horse-Battery-9"); await page.click("button[type=submit]"); await page.waitForURL("**/login");
  const anon = await fetch(`${BASE}/api/updates`);
  check("updates API needs a signed-in user", anon.status === 401);
  await page.fill("#email", "boss@example.com"); await page.fill("#password", "Correct-Horse-Battery-9"); await page.click("button[type=submit]"); await page.waitForURL("**/admin");

  await page.click("[role=tab]:has-text('Оновлення')");
  await page.waitForSelector("#upd-token");
  check("without a token the tab asks to connect", (await page.textContent("main, body")).includes("Підключення до Cloudflare"));

  await page.fill("#upd-worker", "gart"); await page.fill("#upd-token", "wrong-token-wrong-token-1234"); await page.click("button[type=submit]");
  await page.waitForSelector("[role=alert]");
  check("a wrong token is explained", (await page.textContent("[role=alert]")).includes("не прийняв токен"));
  await page.fill("#upd-worker", "no-such-worker"); await page.fill("#upd-token", SECRET_TOKEN); await page.click("button[type=submit]");
  await page.waitForFunction(() => document.querySelector("[role=alert]")?.textContent.includes("не бачить Worker"));
  check("an unknown Worker name is explained", true);
  await page.fill("#upd-worker", "gart"); await page.fill("#upd-token", SECRET_TOKEN); await page.click("button[type=submit]");
  await page.waitForSelector("text=Підключено: акаунт Test account");
  check("connecting finds the account and the database", (await page.textContent("body")).includes("база gart-db"));
  const view = await call("/api/updates");
  check("the API never returns the token", !JSON.stringify(view.body).includes(SECRET_TOKEN));

  await page.click("button:has-text('Перевірити оновлення')");
  await page.waitForSelector("text=Доступна версія 0.8.5");
  check("the latest release and its notes are shown", (await page.textContent("body")).includes("Notes for 0.8.5"));

  // tampered package
  let r = await call("/api/updates/start", "POST", { version: "0.8.4" });
  check("starting an update answers at once", r.status === 200 && r.body.run?.phase === "running");
  for (let i = 0; i < 60 && (await call("/api/updates")).body.run?.phase === "running"; i++) await sleep(500);
  let st = (await call("/api/updates")).body;
  check("a package changed after signing is refused", st.run.error.code === "package_invalid" && /changed after signing/.test(st.run.error.message), JSON.stringify(st.run.error));
  const putsBefore = fake.state.log.filter((l) => l.startsWith("PUT /accounts/acc1/workers/scripts/gart")).length;

  r = await call("/api/updates/start", "POST", { version: version });
  check("the installed version cannot be 'updated' to", r.status === 400 && r.body.error === "same_version");
  r = await call("/api/updates/start", "POST", { version: "9.9.9" });
  check("an unknown version is refused", r.status === 404);

  // destructive migration through the UI
  await page.reload(); await page.click("[role=tab]:has-text('Оновлення')");
  await page.waitForSelector("button:has-text('Оновити до 0.8.5')");
  await page.click("button:has-text('Оновити до 0.8.5')");
  await page.waitForSelector("text=змінює або видаляє дані", { timeout: 30000 });
  check("a migration that removes data needs confirmation", (await page.textContent("body")).includes("9999_drop_example.sql"));
  check("nothing was deployed before the confirmation", fake.state.log.filter((l) => l.startsWith("PUT /accounts/acc1/workers/scripts/gart")).length === putsBefore);
  await page.click("button:has-text('Розумію, оновити')");
  await page.waitForSelector("text=Готово: встановлено версію 0.8.5", { timeout: 40000 });
  check("the update finished and the recovery point is shown", (await page.textContent("body")).includes("D1 Time Travel"));
  const w = fake.state.workers.get("gart");
  check("the Worker was re-uploaded keeping secrets", fake.state.log.filter((l) => l.startsWith("PUT /accounts/acc1/workers/scripts/gart")).length === putsBefore + 1 && w.secretNames.includes("SESSION_SECRET") && w.metadata.keep_bindings.includes("secret_text"));
  check("the address setting was not touched", w.workersDev === installedWorkersDev && fake.state.log.filter((l) => l.endsWith("/subdomain") && l.startsWith("POST")).length === 1);
  check("the new Durable Object class needs no new migration step", !w.metadata.migrations);

  // the token must not sit in storage as plain text
  const hits = []; let sawEmail = false;
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else { const b = readFileSync(p); if (b.includes(SECRET_TOKEN)) hits.push(p); if (b.includes("boss@example.com")) sawEmail = true; } } };
  walk(join(workerDir, ".wrangler", "state"));
  check("(the scan does cover the stored data)", sawEmail);
  check("the token is not stored as plain text", hits.length === 0, hits.join(", "));

  r = await call("/api/updates/connection", "DELETE");
  check("the token can be deleted", r.status === 200 && r.body.connection === null);
  r = await call("/api/updates/start", "POST", { version: "0.8.3" });
  check("without a token nothing can be started", r.status === 409);
  check("no uncaught page errors", errors.length === 0, errors.join("; "));
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1200); try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
  github.close(); await fake.close(); rmSync(tmp, { recursive: true, force: true });
}
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
