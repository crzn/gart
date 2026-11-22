// Join-link preview tags, no countdown flash when the countdown is 0, and the 3-second pauses with automatic advance.
//   npm run build && node tests/e2e/web-share.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8812, BASE = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}`;
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
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const browser = await chromium.launch();
const errors = [];
try {
  let cookie = null;
  const call = async (method, path, body, raw) => {
    const res = await fetch(BASE + path, { method, headers: { "x-gart-csrf": "1", ...(raw ? { "content-type": "image/png" } : body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) }, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
    const c = res.headers.getSetCookie?.()[0]; if (c) cookie = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  const o = (text, isCorrect = false) => ({ text, isCorrect });
  const mk = async (title, settings, extra = {}) => {
    const q = (await call("POST", "/api/quizzes", { title })).json.quiz;
    await call("PATCH", `/api/quizzes/${q.id}`, { settings: { defaultTimeLimitSec: 5, closeWhenAllAnswered: true, ...settings }, ...extra });
    await call("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text: "Q1", options: [o("A", true), o("B")] });
    await call("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text: "Q2", options: [o("A", true), o("B")] });
    await call("PATCH", `/api/quizzes/${q.id}`, { status: "active" });
    return (await call("GET", `/api/quizzes/${q.id}`)).json.quiz;
  };

  // 1. Link preview.
  const cover = (await call("POST", "/api/media", png, true)).json.id;
  const quiz = await mk("Безпека <на> роботі", { countdownBeforeQuestionSec: 0 }, { description: "Короткий тест про \"безпеку\" на роботі", coverMediaId: cover });
  const game = (await call("POST", "/api/games", { quizId: quiz.id })).json.game;
  const wa = await fetch(`${BASE}/play/${game.pin}`, { headers: { "user-agent": "WhatsApp/2.23.20.0 A" } });
  const html = await wa.text();
  check("the join link answers with the join page", wa.status === 200 && html.includes('id="root"') && html.includes("/assets/"), html.slice(0, 200));
  check("the quiz title is in the preview tags, escaped", html.includes('property="og:title" content="Безпека &lt;на&gt; роботі"') && html.includes("<title>Безпека &lt;на&gt; роботі</title>"));
  check("the description is in the preview tags, escaped", html.includes('property="og:description" content="Короткий тест про &quot;безпеку&quot; на роботі"'));
  check("the cover is an absolute image address", html.includes(`property="og:image" content="${BASE}/api/media/${cover}"`));
  check("the preview carries the link and a large-image card", html.includes(`property="og:url" content="${BASE}/play/${game.pin}"`) && html.includes('content="summary_large_image"'));
  check("the cover itself can be read without signing in", (await fetch(`${BASE}/api/media/${cover}`)).headers.get("content-type") === "image/png");
  const unknown = await (await fetch(`${BASE}/play/123456`)).text();
  check("an unknown code gets the plain page, without a quiz in it", unknown.includes('id="root"') && !unknown.includes("og:title"));
  const other = await (await fetch(`${BASE}/play/abc`)).text();
  check("a malformed code gets the plain page", other.includes('id="root"') && !other.includes("og:title"));
  // 2 to 4. Phone and timings. Countdown 0: no number flashes; automatic advance: answer and ranking 3 s each.
  const q0 = await mk("Без відліку", { countdownBeforeQuestionSec: 0, autoAdvance: true });
  const g3 = (await call("POST", "/api/games", { quizId: q0.id })).json.game;
  const h2 = await (await fetch(`${BASE}/play/${g3.pin}`)).text();
  check("without a cover and description the PIN line and a small card are used", h2.includes("Приєднуйтесь до гри: PIN") && h2.includes('content="summary"') && !h2.includes("og:image"), h2.slice(h2.indexOf("og:type"), h2.indexOf("og:type") + 500));
  const ticket = (await call("POST", `/api/games/${g3.id}/ticket`, { role: "host" })).json.ticket;
  const log = [];
  const hostWs = new WebSocket(`${WS}/ws/${g3.pin}`);
  hostWs.onmessage = (e) => { if (e.data !== "pong") { const m = JSON.parse(e.data); log.push({ t: m.t, at: Date.now(), d: m.d }); } };
  await new Promise((r) => { hostWs.onopen = r; });
  hostWs.send(JSON.stringify({ v: 1, t: "host.auth", d: { ticket } }));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/play/${g3.pin}`);
  await page.fill("input[autocomplete=nickname], input[name=nickname], #nickname", "Гравець").catch(async () => { await page.locator("input").first().fill("Гравець"); });
  await page.getByRole("button", { name: /Приєднатися|Увійти|Join/ }).first().click();
  await page.getByText("Гравець").first().waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(500);
  await page.evaluate(() => {
    window.__flash = [];
    new MutationObserver(() => { for (const el of document.querySelectorAll("[aria-live=polite]")) if (/^\d+$/.test((el.textContent ?? "").trim())) window.__flash.push(el.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  hostWs.send(JSON.stringify({ v: 1, t: "host.start" }));
  await page.getByRole("button").first().waitFor({ timeout: 8000 });
  await sleep(1500);
  const flashed = await page.evaluate(() => window.__flash);
  check("with a countdown of 0 the phone never shows a countdown number", flashed.length === 0, JSON.stringify(flashed));
  await page.locator("button", { hasText: "A" }).first().click();
  const until = async (t, n = 1, ms = 12000) => { const end = Date.now() + ms; for (;;) { if (log.filter((x) => x.t === t).length >= n) return log.filter((x) => x.t === t)[n - 1]; if (Date.now() > end) throw new Error(`timeout waiting for ${t}`); await sleep(20); } };
  const results = await until("results");
  const board = await until("leaderboard");
  const second = await until("question.start", 2);
  const a = board.at - results.at, b = second.at - board.at;
  check(`the correct answer stays on screen for 3 s (${a} ms)`, a >= 2800 && a <= 4200);
  check(`the ranking stays on screen for 3 s (${b} ms)`, b >= 2800 && b <= 4200);
  hostWs.close();
  for (const id of [game.id, g3.id]) await call("POST", `/api/games/${id}/cancel`);

  // A countdown above 0 still shows.
  const q3 = await mk("З відліком", { countdownBeforeQuestionSec: 3 });
  const g4 = (await call("POST", "/api/games", { quizId: q3.id })).json.game;
  const t4 = (await call("POST", `/api/games/${g4.id}/ticket`, { role: "host" })).json.ticket;
  const hws = new WebSocket(`${WS}/ws/${g4.pin}`);
  await new Promise((r) => { hws.onopen = r; });
  hws.send(JSON.stringify({ v: 1, t: "host.auth", d: { ticket: t4 } }));
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/play/${g4.pin}`);
  await p2.locator("input").first().fill("Другий");
  await p2.getByRole("button", { name: /Приєднатися|Увійти|Join/ }).first().click();
  await sleep(900);
  hws.send(JSON.stringify({ v: 1, t: "host.start" }));
  const big = await p2.locator("[aria-live=polite]").filter({ hasText: /^[123]$/ }).first().waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
  check("with a countdown of 3 the phone still shows the number", big);
  hws.close();
  check("no page errors", errors.length === 0, errors.join("; "));
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
}
console.log(bad === 0 ? "share e2e passed" : `share e2e FAILED (${bad})`);
process.exit(bad === 0 ? 0 : 1);
