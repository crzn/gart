// Browser end-to-end of the Usage tab and the pre-game quota dialog.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS ?? null;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const { chromium } = createRequire((process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim()) + "/")("playwright");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ } await sleep(1000); }

let bad = 0;
const check = (n, c, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${n} ${c ? "" : x}`); if (!c) bad++; };
const PW = "Correct-Horse-Battery-9";
const browser = await chromium.launch();
const errors = [];
const text = (p) => p.locator("main").innerText();
const until = async (p, pred, label, ms = 8000) => { const end = Date.now() + ms; for (;;) { const t = await text(p).catch(() => ""); if (pred(t)) return t; if (Date.now() > end) throw new Error(`timeout: ${label}. Page: ${t.slice(0, 300)}`); await sleep(100); } };
try {
  const cookie = { v: null };
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-gart-csrf": "1", ...(cookie.v ? { cookie: cookie.v } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const c = res.headers.getSetCookie?.()[0]; if (c) cookie.v = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  await call("POST", "/api/admins", { email: "ed@example.com", displayName: "Ed", password: "Tulip-Window-Lantern-42", role: "editor" });
  const quiz = (await call("POST", "/api/quizzes", { title: "Квота" })).json.quiz;
  const o = (text, isCorrect = false) => ({ text, isCorrect });
  await call("POST", `/api/quizzes/${quiz.id}/questions`, { type: "truefalse", text: "Так?", options: [o("Так", true), o("Ні")] });
  await call("PATCH", `/api/quizzes/${quiz.id}`, { status: "active" });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/login`);
  await p.fill("#email", "owner@example.com"); await p.fill("#password", PW);
  await p.click("button[type=submit]");
  await p.waitForSelector("[role=tablist]");

  await p.getByRole("tab", { name: "Налаштування" }).click(); await p.getByRole("tab", { name: "Використання" }).click();
  await until(p, (t) => t.includes("Використання безкоштовного плану Cloudflare") && t.includes("Жоден ресурс сьогодні не досяг порогу"), "usage tab loads");
  const t0 = await text(p);
  check("the three kinds of numbers are explained", t0.includes("Розрахунок") && t0.includes("Виміряно застосунком") && t0.includes("Офіційно"));
  check("every resource the spec names is listed in the calculator", ["Workers: запити", "Durable Objects: рядків записано", "D1: сховище", "R2: сховище", "R2: операції класу A"].every((s) => t0.includes(s)));
  check("unused resources are marked as such", t0.includes("(не використовується)"));
  check("the CPU limit is flagged as unmeasured", t0.includes("не вимірює"));
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "usage-top.png"), fullPage: true });

  // Calculator reacts to input.
  const before = await p.locator("tr", { hasText: "Durable Objects: рядків записано" }).last().innerText();
  await p.getByLabel("Питань у грі").fill("50");
  await sleep(200);
  const after = await p.locator("tr", { hasText: "Durable Objects: рядків записано" }).last().innerText();
  check("changing the scenario changes the estimate", before !== after);
  check("the bottleneck is named", (await text(p)).includes("Перший вичерпається ресурс"));

  // Official figure -> alert.
  await p.getByLabel("Значення").fill("80000");
  await p.getByRole("button", { name: "Зберегти" }).first().click();
  await until(p, (t) => t.includes("Збережено.") && /увага/.test(t), "warning after entering 80 %");
  check("an official figure above 75 % raises a warning alert", (await p.locator("section, div").filter({ hasText: "Сповіщення" }).first().innerText()).includes("увага"));
  await p.getByLabel("Значення").fill("abc");
  await p.getByRole("button", { name: "Зберегти" }).first().click();
  await until(p, (t) => t.includes("Введіть число"), "bad number message");
  check("a non-number is explained, not sent", true);

  // The pre-game dialog.
  await p.getByRole("tab", { name: "Вікторини" }).click();
  await p.getByRole("button", { name: "Запустити гру" }).first().click();
  await p.getByRole("dialog").waitFor();
  const d = await p.getByRole("dialog").innerText();
  check("the dialog names the resource and what the game adds", d.includes("Durable Objects: рядків записано") && d.includes("Сьогодні:"), d.slice(0, 200));
  check("it says nothing paid is switched on", d.includes("Платні функції Cloudflare не вмикаються"));
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "usage-dialog.png") });
  await p.getByRole("button", { name: "Скасувати" }).click();
  check("cancelling starts nothing", (await p.getByRole("dialog").count()) === 0 && p.url().endsWith("/admin"));
  await p.getByRole("button", { name: "Запустити гру" }).first().click();
  await p.getByRole("dialog").waitFor();
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Усе одно почати гру" }).click();
  await p.waitForURL(/\/host\//);
  check("confirming (safe mode) opens the host screen", true);

  // Editors do not get the tab.
  const ed = await (await browser.newContext()).newPage();
  await ed.goto(`${BASE}/login`);
  await ed.fill("#email", "ed@example.com"); await ed.fill("#password", "Tulip-Window-Lantern-42");
  await ed.click("button[type=submit]");
  await ed.waitForSelector("[role=tablist]");
  check("an editor does not see the Usage tab", (await ed.getByRole("tab", { name: "Використання" }).count()) === 0);
  check("an editor has no Settings menu", (await ed.getByRole("tab", { name: "Налаштування" }).count()) === 0);
  check("an editor still sees My account", (await ed.getByRole("tab", { name: "Мій акаунт" }).count()) === 1);
  await ed.getByTestId("user-menu").click();
  const ind = ed.getByTestId("gart-sound");
  check("an editor sees whether Gart sound is on (icon and menu)", (await ind.innerText()).includes("увімкнено") && (await ed.getByTestId("user-menu").locator("svg").first().getAttribute("aria-label"))?.includes("увімкнено"));
  await ind.click();
  await ed.waitForFunction(() => document.querySelector("[data-testid=gart-sound]")?.textContent?.includes("вимкнено"));
  check("an editor can switch Gart sound off", true);
  await ind.click();
  await ed.waitForFunction(() => document.querySelector("[data-testid=gart-sound]")?.textContent?.includes("увімкнено"));
  check("and on again", true);
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
} catch (e) { bad++; console.log("  FAIL (exception)", e instanceof Error ? e.message : e); }
finally {
  await browser.close().catch(() => undefined);
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1000);
  try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
