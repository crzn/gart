// Browser test of the first-time setup page used by the web installer: /setup#token=...&email=...
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8802, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const { chromium } = createRequire((process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim() + "/"))("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
let bad = 0;
const check = (name, cond) => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`); if (!cond) bad++; };
const TOKEN = "local-dev-setup-token-0123456789";
const browser = await chromium.launch();
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await sleep(1000); }
  const h = await fetch(`${BASE}/api/health`, { headers: { Origin: "https://installer.example" } });
  check("the health check can be read from another address (CORS)", h.headers.get("access-control-allow-origin") === "*");

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/setup`);
  await page.waitForSelector("#password");
  check("without the installer link the form is disabled and explains why", (await page.isDisabled("button[type=submit]")) && (await page.textContent("main, body")).includes("посиланням"));

  await page.goto("about:blank");
  await page.goto(`${BASE}/setup#token=${TOKEN}&email=boss%40example.com&name=Olena`);
  await page.waitForFunction(() => document.querySelector("#email")?.value === "boss@example.com");
  check("e-mail and name come from the link", (await page.inputValue("#name")) === "Olena");
  check("the token is removed from the address bar", !page.url().includes("token"));

  await page.fill("#password", "short");
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=alert]");
  check("a weak password is explained", (await page.textContent("[role=alert]")).includes("не відповідає"));

  await page.fill("#password", "Correct-Horse-Battery-9");
  await page.click("button[type=submit]");
  await page.waitForURL("**/login");
  check("the owner is created and the browser moves to sign-in", true);
  await page.fill("#email", "boss@example.com");
  await page.fill("#password", "Correct-Horse-Battery-9");
  await page.click("button[type=submit]");
  await page.waitForURL("**/admin");
  check("the new owner can sign in", true);

  await page.goto("about:blank");
  await page.goto(`${BASE}/setup#token=${TOKEN}&email=x%40example.com`);
  await page.waitForSelector("a[href='/login']");
  check("setup is closed once an owner exists", true);
  check("no uncaught page errors", errors.length === 0);
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1200); try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
}
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
