// Browser test of the quiz file import (gart.json): template download, several files at once, error reporting.
//   npm run build -w @gart/web && node tests/e2e/web-import.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8806, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const { chromium } = createRequire((process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim()) + "/")("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ } await sleep(1000); }

let bad = 0;
const check = (name, cond, extra = "") => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name} ${cond ? "" : extra}`); if (!cond) bad++; };
const PW = "Correct-Horse-Battery-9";
const text = (p) => p.locator("main").innerText();
const until = async (p, pred, label, ms = 10000) => { const end = Date.now() + ms; for (;;) { const t = await text(p).catch(() => ""); if (pred(t)) return t; if (Date.now() > end) throw new Error(`timeout: ${label}. Page says: ${t.slice(0, 200)}`); await sleep(100); } };


const browser = await chromium.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/setup`);
  const call = async (method, path, body, cookie) => { const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-gart-csrf": "1", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, json: await res.json().catch(() => null), cookie: res.headers.getSetCookie?.()[0]?.split(";")[0] }; };
  await call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  const login = await call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "owner@example.com"); await page.fill("#password", PW); await page.click("button[type=submit]");
  await page.waitForSelector("[role=tablist]");

  // Template: shown, downloadable, and itself importable.
  await page.getByText("Показати шаблон з коментарями для ШІ").click();
  const shown = await page.getByTestId("import-template").innerText();
  check("the template is shown with comments for the AI", shown.includes("_instructions_for_ai") && shown.includes("EXACTLY ONE"));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Скачати шаблон" }).click()]);
  const tplPath = join(root, "tests", ".tmp-template.json");
  await dl.saveAs(tplPath);
  const tpl = JSON.parse(readFileSync(tplPath, "utf8"));
  check("the downloaded template is a gart.quiz file", tpl.format === "gart.quiz" && tpl.version === 1 && tpl.questions.length >= 2);

  // Several files at once: two good ones (one with the AI comments left in), one broken, one not JSON.
  const dir = join(root, "tests", ".tmp-import"); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const mk = (name, doc) => { const p = join(dir, name); writeFileSync(p, typeof doc === "string" ? doc : JSON.stringify(doc)); return p; };
  const q = (text, correctIdx = 0, n = 3) => ({ type: "single", text, options: Array.from({ length: n }, (_, i) => ({ text: `Варіант ${i + 1}`, isCorrect: i === correctIdx })) });
  const good1 = mk("a.json", tpl);
  const good2 = mk("b.json", { format: "gart.quiz", version: 1, quiz: { title: "Друга вікторина", language: "uk", difficulty: "hard", tags: ["тест"] }, settings: { defaultTimeLimitSec: 30, randomizeAnswers: true }, questions: [q("Питання А?"), q("Питання Б?", 2), { type: "truefalse", text: "Так?", options: [{ text: "Так", isCorrect: false }, { text: "Ні", isCorrect: true }] }] });
  const broken = mk("c.json", { format: "gart.quiz", version: 1, quiz: { title: "Зіпсована" }, questions: [q("Нормальне"), { ...q("Дві правильні"), options: [{ text: "А", isCorrect: true }, { text: "Б", isCorrect: true }] }] });
  const notJson = mk("d.json", "Ось ваша вікторина: {...");
  await page.getByTestId("import-input").setInputFiles([good1, good2, broken, notJson]);
  await page.getByTestId("import-results").locator("li").nth(3).waitFor();
  const res = await page.getByTestId("import-results").innerText();
  check("both good files are imported as drafts", res.includes("Example: Ukrainian geography") && res.includes("Друга вікторина") && (res.match(/збережено як чернетку/g) ?? []).length === 2, res);
  check("the broken file is refused and says where and why", res.includes("questions[2].options") && res.includes("рівно одна правильна"), res);
  check("a file that is not JSON is refused with a hint", res.includes("не коректний JSON"), res);

  const list = (await call("GET", "/api/quizzes", undefined, login.cookie)).json.quizzes;
  check("exactly the two good quizzes were created, as drafts", list.length === 2 && list.every((x) => x.status === "draft"), JSON.stringify(list.map((x) => x.title)));
  const second = list.find((x) => x.title === "Друга вікторина");
  const full = (await call("GET", `/api/quizzes/${second.id}`, undefined, login.cookie)).json.quiz;
  check("questions, answers, correct flags and order survive", full.questions.length === 3 && full.questions[1].options[2].isCorrect && full.questions[2].type === "truefalse" && full.questions[2].options[1].isCorrect);
  check("settings, language, difficulty and tags survive", full.settings.defaultTimeLimitSec === 30 && full.settings.randomizeAnswers === true && full.language === "uk" && full.difficulty === "hard" && full.tags[0] === "тест");
  check("an imported quiz can be activated", (await call("PATCH", `/api/quizzes/${second.id}`, { status: "active" }, login.cookie)).status === 200);

  // At most five files at once.
  const six = Array.from({ length: 6 }, (_, i) => mk(`s${i}.json`, { ...tpl, quiz: { ...tpl.quiz, title: `Пакет ${i + 1}` } }));
  await page.getByTestId("import-input").setInputFiles(six);
  await page.getByTestId("import-results").locator("li").nth(4).waitFor();
  await sleep(500);
  check("only the first five of six files are imported", (await page.getByTestId("import-results").locator("li").count()) === 5 && (await page.getByText("Вибрано забагато файлів").count()) === 1);
  check("the list shows the imported quizzes", (await page.getByText("Пакет 5").count()) >= 1);

  // A question with its own time shows it in the editor, and each setting has an explanation.
  const own = { ...tpl, quiz: { ...tpl.quiz, title: "Власний час" }, questions: [{ ...tpl.questions[0], timeLimitSec: 25, points: 2000 }] /* an older file with a time per question */ };
  check("the template has no time per question and no own points", tpl.questions.every((x) => x.timeLimitSec === undefined && x.points === null));
  check("the import report warns about own time and points", await (async () => { await page.getByTestId("import-input").setInputFiles([mk("own.json", own)]); await page.getByTestId("import-results").getByText("власними балами").waitFor(); return true; })());
  await page.getByRole("button", { name: /Власний час/ }).first().click();
  await page.getByText("власні бали: 2000").waitFor();
  check("a time per question from an older file is dropped, the points are kept", (await page.getByText("власний час").count()) === 0);
  check("the question form has no time field", (await page.locator("#qtime").count()) === 0);
  await page.getByRole("button", { name: "Пояснення" }).first().hover();
  const tip = await page.getByRole("tooltip").first().innerText();
  check("a setting's explanation appears on hover", tip.length > 40, tip);
  const timerBox = page.locator('[id="h-timerEnabled"]');
  await page.locator('[aria-describedby="h-timerEnabled"]').focus();
  check("the time-limit explanation says where the time comes from and shows the real default", (await timerBox.innerText()).includes("Час на питання") && /\d+ с/.test(await timerBox.innerText()), await timerBox.innerText());
  check("music is no longer a quiz setting", (await page.getByText("Музика й звукові ефекти").count()) === 0);
  await page.getByRole("button", { name: "До списку" }).click();

  // The server checks too, whatever the browser did.
  check("the server refuses a bad file by itself", (await call("POST", "/api/quizzes/import", { format: "gart.quiz", version: 1, quiz: { title: "x" }, questions: [] }, login.cookie)).status === 400);
  check("import needs a signed-in user", (await call("POST", "/api/quizzes/import", tpl)).status === 401);
  rmSync(dir, { recursive: true, force: true }); rmSync(tplPath, { force: true });
  check("no uncaught page errors", errors.length === 0, errors.join("; "));
} catch (e) {
  bad++; console.log("  FAIL (exception)", e instanceof Error ? e.message : e);
} finally {
  await browser.close().catch(() => undefined);
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1000);
  try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
