// Phase 8 abuse tests: hostile WebSocket clients must not hurt the game or the other players.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8801, BASE = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
let cookie = null;
async function api(method, path, body) {
  const h = { "x-gart-csrf": "1" }; if (body !== undefined) h["content-type"] = "application/json"; if (cookie) h.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie?.() ?? []) cookie = c.split(";")[0];
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, json };
}
const frame = (t, d) => JSON.stringify({ v: 1, t, ...(d === undefined ? {} : { d }) });
function sock(pin) {
  const s = { log: [], code: null };
  s.ws = new WebSocket(`${WS}/ws/${pin}`);
  s.ws.onmessage = (e) => { if (e.data !== "pong") s.log.push(JSON.parse(e.data)); };
  s.ws.onclose = (e) => { s.code = e.code; };
  s.opened = new Promise((res, rej) => { s.ws.onopen = res; s.ws.onerror = () => rej(new Error("connect failed")); });
  s.wait = async (t, timeout = 5000) => { const end = Date.now() + timeout; for (;;) { const m = s.log.find((x) => x.t === t); if (m) return m.d; if (Date.now() > end) return null; await sleep(20); } };
  return s;
}
let code = 1;
try {
  for (let i = 0; ; i++) { try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ } if (i > 60) throw new Error("worker did not start"); await sleep(1000); }
  const PW = "Correct-Horse-Battery-9";
  await api("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await api("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  const q = (await api("POST", "/api/quizzes", { title: "Abuse" })).json.quiz;
  await api("PATCH", `/api/quizzes/${q.id}`, { settings: { countdownBeforeQuestionSec: 0, defaultTimeLimitSec: 20 } });
  await api("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text: "Q1", options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
  await api("PATCH", `/api/quizzes/${q.id}`, { status: "active" });
  const game = (await api("POST", "/api/games", { quizId: q.id })).json.game;

  console.log("hostile sockets");
  const big = sock(game.pin); await big.opened;
  big.ws.send(frame("player.join", { nickname: "x".repeat(70000), avatar: "fox" }));
  await sleep(500);
  check("an oversized message closes the socket (1009)", big.code === 1009, String(big.code));

  const bin = sock(game.pin); await bin.opened;
  bin.ws.send(new Uint8Array([1, 2, 3]));
  await sleep(500);
  check("a binary message closes the socket (1003)", bin.code === 1003, String(bin.code));

  const junk = sock(game.pin); await junk.opened;
  junk.ws.send("{not json"); junk.ws.send(JSON.stringify({ v: 1, t: "player.join", d: 5 })); junk.ws.send(JSON.stringify({ v: 9, t: "nope" }));
  await sleep(500);
  check("malformed messages get an error answer, not a crash", junk.log.filter((m) => m.t === "error").length === 3 && junk.log.every((m) => m.t === "error" || m.t === "hello") && junk.code === null, JSON.stringify(junk.log));

  const flood = sock(game.pin); await flood.opened;
  for (let i = 0; i < 400; i++) flood.ws.send(frame("player.join", { nickname: "F", avatar: "fox" }));
  await sleep(1500);
  check("a flood is answered with rate_limited", flood.log.some((m) => m.t === "error" && m.d.code === "rate_limited"));
  check("a sustained flood gets the socket closed (1008)", flood.code === 1008, String(flood.code));

  const idle = sock(game.pin); await idle.opened;
  const ok = sock(game.pin); await ok.opened;
  ok.ws.send(frame("player.join", { nickname: "Honest", avatar: "owl" }));
  check("an honest player can still join during the abuse", !!(await ok.wait("joined")));
  check("the honest player was not disconnected", ok.code === null);
  const stats = await api("GET", "/api/games");
  check("the game is still listed and running", stats.status === 200);
  idle.ws.close(); ok.ws.close();
  code = failed === 0 ? 0 : 1;
  console.log(`\n${passed} passed, ${failed} failed`);
} finally {
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1200); try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
}
process.exit(code);
