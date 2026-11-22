// The showcase: a public list of ready quizzes, a visitor's game (one at a time, host secret, cancel, per-address limit),
// and no answers in the public list. Run: npm run build && node tests/e2e/web-showcase.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8813, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ } await sleep(1000); }

let bad = 0;
const check = (name, cond, extra = "") => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name} ${cond ? "" : extra}`); if (!cond) bad++; };
const PW = "Correct-Horse-Battery-9";
try {
  let cookie = null;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, { method, headers: { "x-gart-csrf": "1", ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const c = res.headers.getSetCookie?.()[0]; if (c) cookie = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  const o = (text, isCorrect = false) => ({ text, isCorrect });
  const mk = async (title, extra = {}, activate = true) => {
    const q = (await call("POST", "/api/quizzes", { title })).json.quiz;
    await call("PATCH", `/api/quizzes/${q.id}`, { category: "Безпека", tags: ["безпека", "онбординг"], difficulty: "easy", description: `Опис: ${title}`, ...extra });
    await call("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text: "Q1", options: [o("A", true), o("B")] });
    await call("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text: "Q2", options: [o("A", true), o("B")] });
    if (activate) await call("PATCH", `/api/quizzes/${q.id}`, { status: "active" });
    return (await call("GET", `/api/quizzes/${q.id}`)).json.quiz;
  };
  const live = await mk("Вітальний квіз");
  const draft = await mk("Чернетка", {}, false);

  // Anyone can read the list, without signing in and without any answer.
  const listRes = await fetch(`${BASE}/api/showcase`);
  const list = await listRes.json();
  const card = list.quizzes?.find((q) => q.id === live.id);
  check("the public list answers without signing in", listRes.status === 200);
  check("an active quiz is listed with its description, category, tags, difficulty and question count",
    !!card && card.description === "Опис: Вітальний квіз" && card.category === "Безпека" && card.tags.includes("онбординг") && card.difficulty === "easy" && card.questionCount === 2, JSON.stringify(card));
  check("a draft is not listed", !list.quizzes.some((q) => q.id === draft.id));
  check("the list carries no questions or answers", !JSON.stringify(list).includes('"isCorrect"') && !JSON.stringify(list).includes('"options"'));
  check("the list tells the visitor the player limit", list.guestMaxPlayers === 10);

  // A visitor starts a game. One visitor game at a time; its secret is the only key to it.
  const s1 = await fetch(`${BASE}/api/showcase/${live.id}/start`, { method: "POST", headers: { "x-gart-csrf": "1" } });
  const j1 = await s1.json();
  check("a visitor starts a game without an account", s1.status === 201 && j1.game?.pin?.length === 6 && typeof j1.hostToken === "string" && j1.hostToken.length >= 30, `${s1.status} ${JSON.stringify(j1)}`);
  check("the reply says the visitor's limit is 10", j1.maxPlayers === 10);
  const s2 = await fetch(`${BASE}/api/showcase/${live.id}/start`, { method: "POST", headers: { "x-gart-csrf": "1" } });
  check("a visitor can run a second game next to the first", s2.status === 201);
  const s2b = await fetch(`${BASE}/api/showcase/${live.id}/start`, { method: "POST", headers: { "x-gart-csrf": "1" } });
  check("the visitor games share their places: a third waits", s2b.status === 409 && (await s2b.json()).error === "guest_busy");

  const tk = (token) => fetch(`${BASE}/api/showcase/games/${j1.game.id}/ticket`, { method: "POST", headers: { "x-gart-csrf": "1", "x-host-token": token, "content-type": "application/json" }, body: JSON.stringify({ role: "host" }) });
  const wrong = await tk("x".repeat(30));
  check("a wrong secret gets no ticket", wrong.status === 403);
  const right = await tk(j1.hostToken);
  const jr = await right.json();
  check("the right secret gets a ticket for the host screen", right.status === 200 && typeof jr.ticket === "string" && jr.pin === j1.game.pin);

  const cancelNo = await fetch(`${BASE}/api/showcase/games/${j1.game.id}/cancel`, { method: "POST", headers: { "x-gart-csrf": "1", "x-host-token": "y".repeat(30) } });
  check("a wrong secret cannot cancel the game", cancelNo.status === 403);
  const cancel = await fetch(`${BASE}/api/showcase/games/${j1.game.id}/cancel`, { method: "POST", headers: { "x-gart-csrf": "1", "x-host-token": j1.hostToken } });
  check("the visitor cancels their game", cancel.status === 200);

  const s3 = await fetch(`${BASE}/api/showcase/${live.id}/start`, { method: "POST", headers: { "x-gart-csrf": "1" } });
  check("after the cancel the next visitor game starts", s3.status === 201, String(s3.status));
  // The third visitor game of this round is refused by the rate limit once the address has used its hourly share.
  const burst = [];
  for (let i = 0; i < 8; i++) burst.push((await fetch(`${BASE}/api/showcase/${live.id}/start`, { method: "POST", headers: { "x-gart-csrf": "1" } })).status);
  check("an address that keeps starting games is refused at the hourly limit", burst.includes(429), JSON.stringify(burst));

  // A signed-in editor's launch is the normal admin route (no visitor limit): it still works from the same page.
  const owner = await call("POST", "/api/games", { quizId: live.id });
  check("a signed-in editor starts a game as before", owner.status === 201 && owner.json.game?.pin?.length === 6, JSON.stringify(owner.json));
  check("no visitor secret opens an editor's game", (await fetch(`${BASE}/api/showcase/games/${owner.json.game.id}/ticket`, { method: "POST", headers: { "x-gart-csrf": "1", "x-host-token": j1.hostToken, "content-type": "application/json" }, body: JSON.stringify({ role: "host" }) })).status === 403);

  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
} catch (e) { bad++; console.log("  FAIL (exception)", e instanceof Error ? e.message : e); }
finally {
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
}
process.exit(bad ? 1 : 0);
