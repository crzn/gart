// Browser end-to-end test of the admin UI (login, account, administrators, logout).
// Starts its own local Worker on a fresh database; needs the web app built (npm run build).
//   node tests/e2e/web-auth.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8792, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
let playwrightRoot = process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim() + "/";
const { chromium } = createRequire(playwrightRoot)("playwright");

copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 1000)); }

let bad = 0;
const check = (name, cond) => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`); if (!cond) bad++; };
const OWNER = { email: "owner@example.com", password: "Correct-Horse-Battery-9" };
const post = (path, body, ip) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", "x-gart-csrf": "1", "cf-connecting-ip": ip }, body: JSON.stringify(body) });

const browser = await chromium.launch();
try {
  const r = await post("/api/setup", { token: "local-dev-setup-token-0123456789", email: OWNER.email, displayName: "Olena", password: OWNER.password }, "10.9.0.1");
  check("first owner created through the API", r.status === 201);

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/admin`);
  await page.waitForURL("**/login");
  check("anonymous visitor is redirected to the login page", true);

  await page.fill("#email", OWNER.email);
  await page.fill("#password", "wrong-password-123");
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=alert]");
  check("wrong password shows a Ukrainian error", (await page.textContent("[role=alert]")).includes("Невірна"));

  await page.fill("#password", OWNER.password);
  await page.click("button[type=submit]");
  await page.waitForURL("**/admin");
  await page.waitForSelector("[role=tablist]");
  check("sign-in lands on the admin page", (await page.textContent("body")).includes("Olena"));

  await page.reload();
  await page.waitForSelector("[role=tablist]");
  check("session survives a reload", true);

  await page.getByRole("tab", { name: "Налаштування" }).click(); await page.getByRole("tab", { name: "Адміністратори" }).click();
  await page.waitForSelector("#n-email");
  let idleCalls = 0;
  const countCalls = (req) => { if (req.url().includes("/api/")) idleCalls++; };
  page.on("request", countCalls);
  await page.waitForTimeout(1500);
  page.off("request", countCalls);
  check("the Administrators tab does not poll or loop on the API", idleCalls === 0);
  await page.fill("#n-email", "editor1@example.com");
  await page.fill("#n-name", "Petro");
  await page.fill("#n-pass", "short");
  await page.selectOption("#n-role", "editor");
  await page.click("button:has-text('Створити')");
  await page.waitForSelector("[role=alert]");
  check("weak initial password is rejected with a reason", (await page.textContent("[role=alert]")).includes("закороткий"));
  await page.fill("#n-pass", "Tulip-Window-Lantern-42");
  await page.click("button:has-text('Створити')");
  await page.waitForSelector("td:has-text('Petro')");
  check("new editor appears in the list", true);

  await page.click("text=Мій акаунт");
  await page.fill("#cur", OWNER.password);
  await page.fill("#new", "Brand-New-Passphrase-77");
  await page.fill("#again", "Brand-New-Passphrase-77x");
  await page.click("button:has-text('Змінити пароль')");
  check("mismatching repeat is caught in the browser", (await page.textContent("[role=alert]")).includes("не збігаються"));
  await page.fill("#again", "Brand-New-Passphrase-77");
  await page.click("button:has-text('Змінити пароль')");
  await page.waitForSelector("[role=status]");
  check("password change succeeds", true);

  await page.getByTestId("user-menu").click(); await page.getByRole("button", { name: "en", exact: true }).click();
  check("language switch to English works", (await page.textContent("body")).includes("Change password"));
  await page.click("button:has-text('Sign out')");
  await page.waitForURL("**/login");
  check("sign-out returns to the login page", true);

  await page.fill("#email", OWNER.email);
  await page.fill("#password", OWNER.password);
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=alert]");
  check("old password no longer works", true);
  await page.fill("#password", "Brand-New-Passphrase-77");
  await page.click("button[type=submit]");
  await page.waitForURL("**/admin");
  check("new password works", true);

  // Editor: sees no Administrators tab.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/login`);
  await p2.fill("#email", "editor1@example.com");
  await p2.fill("#password", "Tulip-Window-Lantern-42");
  await p2.click("button[type=submit]");
  await p2.waitForSelector("[role=tablist]");
  check("editor sees no Administrators tab", !(await p2.textContent("[role=tablist]")).match(/Administrators|Адміністратори/));
  check("no uncaught page errors", errors.length === 0);
  await page.screenshot({ path: join(process.env.SHOT_DIR ?? "/tmp", "web-admin.png") });
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  try { execFileSync("pkill", ["-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
process.exit(bad ? 1 : 0);
