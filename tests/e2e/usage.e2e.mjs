// Phase 6 end-to-end: measured counters, official figures, thresholds, pre-game warning and safe mode.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8798, BASE = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ } await sleep(1000); }

let passed = 0, failed = 0;
const check = (n, c, x = "") => { if (c) { passed++; console.log(`  ok   ${n}`); } else { failed++; console.log(`  FAIL ${n} ${x}`); } };

class Http {
  constructor(ip) { this.ip = ip; this.cookie = null; }
  async call(method, path, body, raw = false) {
    const h = { "cf-connecting-ip": this.ip, "x-gart-csrf": "1" };
    if (body !== undefined) h["content-type"] = raw ? "image/png" : "application/json";
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) this.cookie = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  }
}
class Client {
  constructor(pin, label) { this.label = label; this.log = []; this.ws = new WebSocket(`${WS}/ws/${pin}`); this.opened = new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = () => j(new Error(`${label} connect`)); }); this.ws.onmessage = (e) => { if (e.data !== "pong") this.log.push({ m: JSON.parse(e.data), used: false }); }; }
  send(t, d) { this.ws.send(JSON.stringify({ v: 1, t, ...(d === undefined ? {} : { d }) })); }
  async wait(t, pred = () => true, timeout = 10000) { const end = Date.now() + timeout; for (;;) { const h = this.log.find((x) => !x.used && x.m.t === t && pred(x.m.d)); if (h) { h.used = true; return h.m.d; } if (Date.now() > end) throw new Error(`${this.label}: timeout ${t}`); await sleep(10); } }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
const PW = "Correct-Horse-Battery-9";
const owner = new Http("10.6.0.1"), editor = new Http("10.6.0.2"), anon = new Http("10.6.0.3");
const o = (text, isCorrect = false) => ({ text, isCorrect });

async function playGame(quizId, nPlayers, extra = {}) {
  const r = await owner.call("POST", "/api/games", { quizId, ...extra });
  if (r.status !== 201) return { r };
  const { id, pin } = r.json.game;
  const t = (await owner.call("POST", `/api/games/${id}/ticket`, { role: "host" })).json.ticket;
  const host = new Client(pin, "host"); await host.opened; host.send("host.auth", { ticket: t }); await host.wait("snapshot");
  const ps = [];
  for (let i = 0; i < nPlayers; i++) { const c = new Client(pin, `p${i}`); await c.opened; c.send("player.join", { nickname: `P${i}`, avatar: "fox" }); await c.wait("joined"); ps.push(c); }
  return { r, id, pin, host, ps };
}
async function finish({ host, ps }, optionIds) {
  host.send("host.start");
  for (let q = 0; q < optionIds.length; q++) {
    await Promise.all(ps.map((p) => p.wait("question.start", (d) => d.index === q)));
    for (const p of ps) p.send("answer.submit", { questionIdx: q, optionId: optionIds[q] });
    await Promise.all(ps.map((p) => p.wait("results", (d) => d.questionIdx === q)));
    host.send(q === optionIds.length - 1 ? "host.next" : "host.next");
  }
  await host.wait("game.finished");
  for (const c of [host, ...ps]) c.close();
}

try {
  await owner.call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await owner.call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  await owner.call("POST", "/api/admins", { email: "ed@example.com", displayName: "Ed", password: "Tulip-Window-Lantern-42", role: "editor" });
  await editor.call("POST", "/api/auth/login", { email: "ed@example.com", password: "Tulip-Window-Lantern-42" });

  console.log("access control");
  check("anonymous cannot read usage", (await anon.call("GET", "/api/usage")).status === 401);
  check("an editor cannot read usage", (await editor.call("GET", "/api/usage")).status === 403);
  check("an editor cannot enter official figures", (await editor.call("PUT", "/api/usage/official", { day: "2026-01-01", resource: "d1.rowsWritten", value: 1 })).status === 403);
  let r = await owner.call("GET", "/api/usage");
  check("an owner sees the dashboard data", r.status === 200 && r.json.resources.length === 13 && r.json.thresholds.warning === 75, JSON.stringify(r.json?.thresholds));
  check("nothing is measured before any game", r.json.history.length === 0);
  const today = r.json.day;
  check("the limits file's date is exposed", /^\d{4}-\d{2}-\d{2}$/.test(r.json.limitsVerifiedOn));

  console.log("two games are measured");
  const q = (await owner.call("POST", "/api/quizzes", { title: "Usage" })).json.quiz;
  await owner.call("PATCH", `/api/quizzes/${q.id}`, { settings: { countdownBeforeQuestionSec: 0, defaultTimeLimitSec: 8 } });
  for (const text of ["A?", "B?", "C?"]) await owner.call("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text, options: [o("yes", true), o("no")] });
  await owner.call("PATCH", `/api/quizzes/${q.id}`, { status: "active" });
  const full = (await owner.call("GET", `/api/quizzes/${q.id}`)).json.quiz;
  const correct = full.questions.map((x) => x.options.find((p) => p.isCorrect).id);
  const N = 6;
  for (let g = 0; g < 2; g++) { const game = await playGame(q.id, N); check(`game ${g + 1} starts without a warning on a quiet day`, game.r.status === 201); await finish(game, correct); }
  await sleep(2500);
  r = await owner.call("GET", "/api/usage");
  const m = r.json.history.find((h) => h.day === today)?.metrics ?? {};
  check("games started and finished are counted", m.games_started === 2 && m.games_finished === 2, JSON.stringify(m));
  check("players and answers are counted", m.players_joined === 2 * N && m.answers === 2 * N * 3, JSON.stringify(m));
  check("questions served are counted", m.questions_served === 6, JSON.stringify(m));
  check("WebSocket connections cover the host and every player", m.ws_connects >= 2 * (N + 1), JSON.stringify(m));
  check("room rows written and read were recorded", m.do_rows_written > 50 && m.do_rows_read > 50, JSON.stringify(m));
  check("D1 rows persisted were recorded", m.d1_rows_written >= 2 * (N * 2 + N * 3 * 2), JSON.stringify(m));
  const st = (id) => r.json.status.find((s) => s.resource === id);
  check("measured figures reach the status table, official is empty", st("durableObjects.sqlRowsWritten").measured === m.do_rows_written && st("durableObjects.sqlRowsWritten").official === null);
  check("storage is measured from stored data", st("d1.databaseStorageGb").measured > 0);
  check("a quiet day shows no alert", r.json.status.every((s) => s.level === "ok"), JSON.stringify(r.json.status.map((s) => [s.resource, s.pct])));

  console.log("uploads are counted");
  check("an image upload succeeds", (await owner.call("POST", "/api/media", PNG, true)).status === 201);
  r = await owner.call("GET", "/api/usage");
  const m2 = r.json.history.find((h) => h.day === today).metrics;
  check("upload count and bytes are recorded", m2.uploads === 1 && m2.upload_bytes === PNG.length, JSON.stringify(m2));

  console.log("official figures");
  check("a future day is refused", (await owner.call("PUT", "/api/usage/official", { day: "2999-01-01", resource: "d1.rowsWritten", value: 1 })).status === 400);
  check("an unknown resource is refused", (await owner.call("PUT", "/api/usage/official", { day: today, resource: "bogus", value: 1 })).status === 400);
  check("an unused resource is refused", (await owner.call("PUT", "/api/usage/official", { day: today, resource: "r2.storageGb", value: 1 })).status === 400);
  check("a negative value is refused", (await owner.call("PUT", "/api/usage/official", { day: today, resource: "d1.rowsWritten", value: -5 })).status === 400);
  check("a figure from the Cloudflare dashboard is saved", (await owner.call("PUT", "/api/usage/official", { day: today, resource: "durableObjects.sqlRowsWritten", value: 60000, note: "dashboard 21:00" })).status === 200);
  r = await owner.call("GET", "/api/usage");
  check("it is shown beside the measured figure, and alerts on the larger", st("durableObjects.sqlRowsWritten").official === 60000 && st("durableObjects.sqlRowsWritten").level === "info" && r.json.official.length === 1, st("durableObjects.sqlRowsWritten").level);
  await owner.call("PUT", "/api/usage/official", { day: today, resource: "durableObjects.sqlRowsWritten", value: 78000 });
  r = await owner.call("GET", "/api/usage");
  check("78 % of the quota is a warning", st("durableObjects.sqlRowsWritten").level === "warning" && r.json.official.length === 1);

  console.log("the pre-game warning");
  const fc = await owner.call("GET", "/api/usage/forecast?questions=20&players=120");
  check("the forecast names the resource that is close", fc.status === 200 && fc.json.projection.concerns.some((c) => c.resource === "durableObjects.sqlRowsWritten"), JSON.stringify(fc.json?.projection?.level));
  check("the forecast says how many more games fit today", fc.json.additional && typeof fc.json.additional.games === "number");
  check("a forecast with bad input is refused", (await owner.call("GET", "/api/usage/forecast?questions=0&players=999")).status === 400);
  r = await owner.call("POST", "/api/games", { quizId: q.id });
  check("starting a game near the limit is held back with the details", r.status === 409 && r.json.error === "quota_risk" && r.json.forecast.projection.concerns.length > 0, JSON.stringify(r.json?.error));
  check("it says what the game would add", r.json.forecast.perGame["durableObjects.sqlRowsWritten"] > 0 && r.json.forecast.safeMode.maxPlayers === 60);
  await owner.call("PUT", "/api/usage/official", { day: today, resource: "durableObjects.sqlRowsWritten", value: 100000 });
  r = await owner.call("GET", "/api/usage");
  check("100 % is reported as the quota reached", st("durableObjects.sqlRowsWritten").level === "full");
  r = await owner.call("POST", "/api/games", { quizId: q.id, acknowledgeQuota: true, safeMode: true });
  check("after the administrator confirms, the game starts (nothing is blocked for good)", r.status === 201, JSON.stringify(r.json));

  console.log("safe mode caps the room");
  const { id, pin } = r.json.game;
  const ps = [];
  for (let i = 0; i < 61; i++) { const c = new Client(pin, `s${i}`); await c.opened; c.send("player.join", { nickname: `S${i}`, avatar: "owl" }); ps.push(c); }
  const results = await Promise.all(ps.map((c) => Promise.race([c.wait("joined", () => true, 15000).then(() => "joined"), c.wait("error", (d) => d.code === "game_full", 15000).then(() => "full")]).catch(() => "none")));
  check("60 players fit in a safe-mode game", results.filter((x) => x === "joined").length === 60, JSON.stringify(results.reduce((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {})));
  check("the 61st is refused as full", results.filter((x) => x === "full").length === 1);
  for (const c of ps) c.close();
  await owner.call("POST", `/api/games/${id}/cancel`);

  console.log("thresholds");
  check("an editor cannot change thresholds", (await editor.call("PUT", "/api/usage/thresholds", { info: 40, warning: 60, critical: 80 })).status === 403);
  for (const bad of [{ info: 80, warning: 60, critical: 90 }, { info: 50, warning: 75, critical: 100 }, { info: 0, warning: 5, critical: 9 }]) check(`thresholds ${JSON.stringify(bad)} are refused`, (await owner.call("PUT", "/api/usage/thresholds", bad)).status === 400);
  check("valid thresholds are saved", (await owner.call("PUT", "/api/usage/thresholds", { info: 20, warning: 40, critical: 60 })).status === 200);
  await owner.call("PUT", "/api/usage/official", { day: today, resource: "durableObjects.sqlRowsWritten", value: 50000 });
  r = await owner.call("GET", "/api/usage");
  check("alerts follow the new thresholds (50 % is now between warning and critical)", r.json.thresholds.warning === 40 && st("durableObjects.sqlRowsWritten").level === "warning", st("durableObjects.sqlRowsWritten").level);
  check("a removed figure disappears", (await owner.call("DELETE", `/api/usage/official?day=${today}&resource=durableObjects.sqlRowsWritten`)).status === 200 && (await owner.call("GET", "/api/usage")).json.official.length === 0);
} catch (e) {
  failed++; console.log("  FAIL (exception)", e instanceof Error ? e.stack : e);
} finally {
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1000);
  try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
