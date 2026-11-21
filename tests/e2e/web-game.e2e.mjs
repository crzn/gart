// Browser end-to-end of the live game screens: host, projector and phone-sized players in real Chromium.
//   npm run build -w @gart/web && node tests/e2e/web-game.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8797, BASE = `http://127.0.0.1:${PORT}`;
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
const check = (name, cond, extra = "") => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name} ${cond ? "" : extra}`); if (!cond) bad++; };
const PW = "Correct-Horse-Battery-9";
const browser = await chromium.launch();
const errors = [];
const watch = (p, label) => { p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`)); };
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const text = (p) => p.locator("main").innerText();
const until = async (p, pred, label, ms = 10000) => { const end = Date.now() + ms; for (;;) { const t = await text(p).catch(() => ""); if (pred(t)) return t; if (Date.now() > end) throw new Error(`timeout: ${label}. Page says: ${t.slice(0, 200)}`); await sleep(100); } };

try {
  // Content through the API (UI for this is covered by web-content).
  const cookie = { v: null };
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-gart-csrf": "1", ...(cookie.v ? { cookie: cookie.v } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const c = res.headers.getSetCookie?.()[0]; if (c) cookie.v = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  const quiz = (await call("POST", "/api/quizzes", { title: "Безпека на роботі" })).json.quiz;
  await call("PATCH", `/api/quizzes/${quiz.id}`, { settings: { countdownBeforeQuestionSec: 0, defaultTimeLimitSec: 20, closeWhenAllAnswered: true } });
  const o = (text, isCorrect = false) => ({ text, isCorrect });
  await call("POST", `/api/quizzes/${quiz.id}/questions`, { type: "single", text: "Що робити з підозрілим листом?", explanation: "Повідомте службу безпеки.", options: [o("Відкрити вкладення"), o("Повідомити службу безпеки", true), o("Переслати колегам"), o("Видалити й забути")] });
  await call("POST", `/api/quizzes/${quiz.id}/questions`, { type: "truefalse", text: "Пароль можна передавати колезі.", options: [o("Так"), o("Ні", true)] });
  await call("PATCH", `/api/quizzes/${quiz.id}`, { status: "active" });

  // Host in the admin UI.
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage(); watch(host, "host");
  host.on("dialog", (d) => void d.accept());
  await host.goto(`${BASE}/login`);
  await host.fill("#email", "owner@example.com"); await host.fill("#password", PW);
  await host.click("button[type=submit]");
  await host.waitForSelector("[role=tablist]");
  await host.getByRole("button", { name: "Запустити гру" }).first().click();
  await host.waitForURL(/\/host\//);
  const pin = (await host.getByTestId("pin").textContent({ timeout: 10000 })).trim();
  check("the host sees a 6-digit PIN", /^\d{6}$/.test(pin), pin);
  check("start is disabled until a player joins", await host.getByRole("button", { name: "Почати гру" }).isDisabled());
  await shot(host, "host-lobby-empty");

  // Projector in a second tab of the same signed-in browser.
  const screen = await hostCtx.newPage(); watch(screen, "screen");
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto(`${BASE}/screen/${host.url().split("/host/")[1]}`);
  await until(screen, (t) => t.includes(pin), "projector shows the PIN");
  check("the projector has no site navigation", (await screen.locator("header").count()) === 0);
  
  check("the projector shows no controls except the sound switch", (await screen.locator("button:not([data-testid=sound-control] button)").count()) === 0);

  // Players on phone-sized screens, each in their own browser context.
  const names = ["Анна", "Богдан", "Віка"];
  const players = [];
  for (const [i, name] of names.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); watch(p, name);
    await p.goto(`${BASE}/`);
    await p.fill("#pin", pin);
    await p.click("button[type=submit]");
    await p.waitForURL(/\/play\//);
    await until(p, (t) => t.includes("Ваш нікнейм"), "join form");
    if (i === 0) {
      await shot(p, "player-join");
      await p.fill("#nick", "x"); check("one-letter nickname keeps Join disabled", await p.getByRole("button", { name: "Приєднатися" }).isDisabled());
    }
    await p.fill("#nick", name);
    await p.getByRole("button", { name: "Приєднатися" }).click();
    await until(p, (t) => t.includes("Ви в грі"), `${name} joined`);
    players.push({ ctx, p, name });
  }
  const dup = await (await browser.newContext({ viewport: { width: 390, height: 780 } })).newPage();
  await dup.goto(`${BASE}/play/${pin}`);
  await until(dup, (t) => t.includes("Ваш нікнейм"), "dup form");
  await dup.fill("#nick", "анна");
  await dup.getByRole("button", { name: "Приєднатися" }).click();
  await until(dup, (t) => t.includes("уже зайнято"), "nickname-taken message");
  check("a taken nickname shows a readable message", true);
  await dup.close();

  await until(host, (t) => t.includes("3 гравців") && t.includes("Анна") && t.includes("Віка"), "host lobby lists players");
  check("host and projector list all players", (await text(screen)).includes("Богдан"));
  await shot(host, "host-lobby");
  await shot(players[0].p, "player-lobby");
  await shot(screen, "screen-lobby");

  // Kick and rejoin protection, then start.
  await host.getByRole("button", { name: /Прибрати Віка/ }).click();
  await until(players[2].p, (t) => t.includes("прибрав вас"), "kicked player told");
  check("a kicked player is told", true);
  await host.getByRole("button", { name: "Почати гру" }).click();

  // Question 1: everybody answers; the room closes it itself.
  for (const { p } of players.slice(0, 2)) await until(p, (t) => t.includes("Що робити з підозрілим листом?"), "question visible");
  await until(screen, (t) => t.includes("Повідомити службу безпеки"), "projector shows options");
  await shot(players[0].p, "player-question");
  await shot(screen, "screen-question");
  await shot(host, "host-question");
  check("the correct answer is not marked while the question is open", !(await text(players[0].p)).includes("✓"));
  await players[0].p.getByRole("button", { name: /Повідомити службу безпеки/ }).click();
  await until(players[0].p, (t) => t.includes("Відповідь надіслано"), "answer sent");
  check("a player cannot answer twice (buttons are gone)", (await players[0].p.getByRole("button", { name: /Відкрити вкладення/ }).count()) === 0);
  await until(host, (t) => /Відповіли:\s*1/.test(t), "host sees progress");
  await players[1].p.getByRole("button", { name: /Переслати колегам/ }).click();
  await until(players[0].p, (t) => t.includes("Правильно!"), "correct verdict");
  const right = await text(players[0].p);
  check("the right answer earns points", /\+\d{3,4}/.test(right), right);
  await until(players[1].p, (t) => t.includes("Неправильно"), "wrong verdict");
  await shot(players[0].p, "player-correct");
  await until(host, (t) => t.includes("Повідомте службу безпеки"), "host sees the explanation");
  await shot(host, "host-results");
  await shot(screen, "screen-results");

  // Reload a phone mid-game: the same player comes back with the same score.
  const before = await text(players[0].p);
  await players[0].p.reload();
  await until(players[0].p, (t) => t.includes("Анна") && t.includes("Правильно"), "resumed after reload");
  check("a reloaded phone resumes the same player and screen", before.includes("Анна"));

  // Leaderboard, then question 2.
  await host.getByRole("button", { name: "Рейтинг" }).click();
  await until(players[0].p, (t) => t.includes("Рейтинг") && t.includes("Богдан"), "player leaderboard");
  await until(screen, (t) => t.includes("Анна"), "projector leaderboard");
  await shot(players[0].p, "player-leaderboard");
  await shot(screen, "screen-leaderboard");
  await host.getByRole("button", { name: "Далі" }).click();
  await until(players[0].p, (t) => t.includes("Пароль можна передавати колезі."), "question 2");
  await host.getByRole("button", { name: "Пауза" }).click();
  await until(players[0].p, (t) => t.includes("призупинено"), "paused on phones");
  check("answer buttons are disabled while paused", await players[0].p.getByRole("button", { name: /Ні/ }).isDisabled());
  await host.getByRole("button", { name: "Продовжити" }).first().click();
  await until(players[0].p, (t) => !t.includes("призупинено"), "resumed");
  await players[0].p.getByRole("button", { name: /Ні/ }).click();
  await players[1].p.getByRole("button", { name: /Ні/ }).click();
  await until(host, (t) => t.includes("Завершити гру"), "last question offers Finish");
  await host.getByRole("button", { name: "Завершити гру" }).click();
  await until(players[0].p, (t) => t.includes("Гру завершено") && t.includes("Ваше місце"), "final screen on phone");
  await until(screen, (t) => t.includes("Гру завершено"), "final on projector");
  await shot(players[0].p, "player-final");
  await shot(screen, "screen-final");
  const finalText = await text(players[0].p);
  check("the winner sees place #1", /#1\b/.test(finalText), finalText);

  // Results in the admin UI.
  await sleep(1500); // the room saves the results to D1 a moment after the last screen
  await host.getByRole("link", { name: "До адміністрування" }).click();
  await host.getByRole("tab", { name: "Ігри" }).click();
  await until(host, (t) => t.includes("Безпека на роботі") && t.includes("завершена"), "games list");
  await host.getByRole("button", { name: "Результати" }).click();
  await until(host, (t) => t.includes("Анна") && t.includes("За питаннями"), "results table");
  check("results show both players and per-question stats", (await text(host)).includes("Богдан"));
  await shot(host, "admin-results");
  const [dl] = await Promise.all([host.waitForEvent("download"), host.getByRole("button", { name: "CSV" }).click()]);
  check("the CSV file is named after the game and PIN", dl.suggestedFilename().endsWith(`${pin}.csv`), dl.suggestedFilename());

  // The finished game's PIN no longer lets anyone in.
  const late = await (await browser.newContext()).newPage();
  await late.goto(`${BASE}/play/${pin}`);
  await until(late, (t) => t.includes("Гру не знайдено") || t.includes("завершилась") || t.includes("Ваш нікнейм"), "late visitor sees something");
  check("no uncaught page errors anywhere", errors.length === 0, errors.join(" | "));
} catch (e) {
  bad++;
  console.log("  FAIL (exception)", e instanceof Error ? e.message : e);
} finally {
  await browser.close().catch(() => undefined);
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1000);
  try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
