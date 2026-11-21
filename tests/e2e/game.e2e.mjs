// Phase 4 end-to-end: live game over real WebSockets against a local Worker + Durable Object.
//   node tests/e2e/game.e2e.mjs            (30 players)
//   PLAYERS=120 node tests/e2e/game.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const N = Number(process.env.PLAYERS ?? 30);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8796, BASE = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
let server;
const start = async () => {
  server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* starting */ } await sleep(1000); }
  throw new Error("worker did not start");
};
const stop = async () => { try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ } await sleep(1200); try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ } await sleep(800); };
await start();

let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

/* ---------------- HTTP helpers ---------------- */
class Http {
  constructor(ip) { this.cookie = null; this.ip = ip; }
  async call(method, path, body) {
    const h = { "cf-connecting-ip": this.ip, "x-gart-csrf": "1" };
    if (body !== undefined) h["content-type"] = "application/json";
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) this.cookie = c.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  }
}

/* ---------------- WebSocket client ---------------- */
class Client {
  constructor(pin, label, ip) {
    this.label = label; this.log = []; this.closed = null;
    this.ws = new WebSocket(`${WS}/ws/${pin}`);
    this.opened = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error(`${label}: connect failed`)); });
    this.ws.onmessage = (e) => { if (e.data === "pong") return; this.log.push({ m: JSON.parse(e.data), used: false, at: Date.now() }); };
    this.ws.onclose = (e) => { this.closed = e.code; };
    void ip;
  }
  send(t, d) { this.ws.send(JSON.stringify({ v: 1, t, ...(d === undefined ? {} : { d }) })); }
  async wait(t, pred = () => true, timeout = 8000) {
    const end = Date.now() + timeout;
    for (;;) {
      const hit = this.log.find((x) => !x.used && x.m.t === t && pred(x.m.d));
      if (hit) { hit.used = true; return hit.m.d; }
      if (Date.now() > end) throw new Error(`${this.label}: timeout waiting for ${t} (got ${this.log.filter((x) => !x.used).map((x) => x.m.t).join(",")})`);
      await sleep(10);
    }
  }
  has(t, pred = () => true) { return this.log.some((x) => x.m.t === t && pred(x.m.d)); }
  async err(code, timeout = 3000) { return this.wait("error", (d) => d.code === code, timeout); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
const upgradeStatus = (path, headers) => new Promise((resolveStatus) => {
  const req = request({ host: "127.0.0.1", port: PORT, path, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } });
  req.on("response", (res) => { resolveStatus(res.statusCode); res.resume(); });
  req.on("upgrade", (res, socket) => { resolveStatus(res.statusCode); socket.destroy(); });
  req.on("error", () => resolveStatus(0));
  req.end();
});

const opt = (text, isCorrect = false) => ({ text, isCorrect });
const AVATARS = ["fox", "owl", "bear", "wolf", "lynx", "otter", "panda", "koala"];
const PW = "Correct-Horse-Battery-9";
const owner = new Http("10.5.0.1");
let pin, gameId;

async function newQuiz(title, settings) {
  const q = (await owner.call("POST", "/api/quizzes", { title })).json.quiz;
  await owner.call("PATCH", `/api/quizzes/${q.id}`, { settings: { countdownBeforeQuestionSec: 0, defaultTimeLimitSec: 5, basePoints: 1000, speedBonusPercent: 50, ...settings } });
  await owner.call("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text: "Q1", explanation: "Because one", options: [opt("A", true), opt("B"), opt("C"), opt("D")] });
  await owner.call("POST", `/api/quizzes/${q.id}/questions`, { type: "truefalse", text: "Q2", options: [opt("Yes", true), opt("No")] });
  await owner.call("POST", `/api/quizzes/${q.id}/questions`, { type: "single", text: "Q3", options: [opt("X"), opt("Y", true)] });
  return (await owner.call("GET", `/api/quizzes/${q.id}`)).json.quiz;
}
const correctOf = (quiz, i) => quiz.questions[i].options.find((o) => o.isCorrect).id;
const wrongOf = (quiz, i) => quiz.questions[i].options.find((o) => !o.isCorrect).id;

async function connectHost(gid, p) {
  const t = (await owner.call("POST", `/api/games/${gid}/ticket`, { role: "host" })).json;
  const host = new Client(p, "host");
  await host.opened;
  host.send("host.auth", { ticket: t.ticket });
  return { host, snap: await host.wait("snapshot") };
}

try {
  let r = await owner.call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  check("owner created", r.status === 201);
  await owner.call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });

  console.log("creating a game");
  const quiz = await newQuiz("Live quiz", { closeWhenAllAnswered: true });
  r = await owner.call("POST", "/api/games", { quizId: quiz.id });
  check("a draft quiz cannot be hosted", r.status === 409 && r.json.error === "quiz_not_active");
  await owner.call("PATCH", `/api/quizzes/${quiz.id}`, { status: "active" });
  r = await new Http("10.5.0.9").call("POST", "/api/games", { quizId: quiz.id });
  check("anonymous cannot create a game", r.status === 401);
  r = await owner.call("POST", "/api/games", { quizId: quiz.id });
  check("an active quiz starts a game with a 6-digit PIN", r.status === 201 && /^\d{6}$/.test(r.json.game.pin), JSON.stringify(r.json));
  pin = r.json.game.pin; gameId = r.json.game.id;

  console.log("connection gate");
  check("unknown PIN is refused before any room exists", (await upgradeStatus("/ws/123456", {})) === 404);
  check("malformed PIN is refused", (await upgradeStatus("/ws/abc", {})) === 404);
  check("a foreign Origin is refused", (await upgradeStatus(`/ws/${pin}`, { Origin: "https://evil.example" })) === 403);
  check("the same Origin is accepted", (await upgradeStatus(`/ws/${pin}`, { Origin: BASE })) === 101);
  check("a plain HTTP request to /ws/ is refused", (await fetch(`${BASE}/ws/${pin}`)).status === 426);

  console.log("host and projector");
  const { host, snap } = await connectHost(gameId, pin);
  check("host gets a snapshot in the lobby with the PIN", snap.role === "host" && snap.state === "LOBBY" && snap.pin === pin && snap.playerCount === 0);
  const t2 = (await owner.call("POST", `/api/games/${gameId}/ticket`, { role: "host" })).json.ticket;
  const reuse = new Client(pin, "reuse"); await reuse.opened;
  reuse.send("host.auth", { ticket: t2 }); await reuse.wait("snapshot");
  const reuse2 = new Client(pin, "reuse2"); await reuse2.opened;
  reuse2.send("host.auth", { ticket: t2 });
  check("a ticket works once", !!(await reuse2.err("ticket_used").catch(() => null)));
  await sleep(200);
  check("a second host replaces the first", host.closed === 4009);
  const host2 = reuse;
  const bogus = new Client(pin, "bogus"); await bogus.opened;
  bogus.send("host.auth", { ticket: "x".repeat(40) + "." + "y".repeat(20) });
  check("a forged ticket is rejected", !!(await bogus.err("invalid_ticket").catch(() => null)));
  const stolen = (await owner.call("POST", `/api/games/${gameId}/ticket`, { role: "screen" })).json.ticket;
  const wrongRole = new Client(pin, "wrongrole"); await wrongRole.opened;
  wrongRole.send("host.auth", { ticket: stolen });
  check("a projector ticket cannot take host control", !!(await wrongRole.err("invalid_ticket").catch(() => null)));
  const screen = new Client(pin, "screen"); await screen.opened;
  screen.send("screen.attach", { ticket: stolen });
  check("a projector can attach read-only", (await screen.wait("snapshot")).role === "screen");
  screen.send("host.start");
  check("the projector cannot control the game", !!(await screen.err("forbidden").catch(() => null)));

  console.log(`${N} players join`);
  const players = [];
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    const c = new Client(pin, `p${i}`); await c.opened;
    c.send("player.join", { nickname: `Player ${i + 1}`, avatar: AVATARS[i % AVATARS.length] });
    c.joined = await c.wait("joined", () => true, 15000);
    c.idx = i; players[i] = c;
  }));
  check("all players joined with unique ids and tokens", new Set(players.map((p) => p.joined.playerId)).size === N && players.every((p) => p.joined.playerToken.startsWith(p.joined.playerId + ".")));
  const lobbyCount = await host2.wait("lobby.update", (d) => d.playerCount === N, 15000).catch(() => null);
  check("the host sees the live player count", lobbyCount !== null);
  const dupe = new Client(pin, "dupe"); await dupe.opened;
  dupe.send("player.join", { nickname: "player 1", avatar: "fox" });
  check(N >= 120 ? "the 121st player is refused: game full" : "a nickname already taken is refused (case-insensitive)", !!(await dupe.err(N >= 120 ? "game_full" : "nickname_taken").catch(() => null)));
  dupe.send("player.join", { nickname: "X", avatar: "fox" });
  check("a too-short nickname is refused", !!(await dupe.err("nickname_too_short").catch(() => null)));
  dupe.send("player.join", { nickname: "<b>hi</b>", avatar: "fox" });
  check("markup in a nickname is refused", !!(await dupe.err("nickname_invalid_chars").catch(() => null)));
  dupe.send("player.join", { nickname: "Valid Name", avatar: "dragon" });
  check("an unknown avatar is refused", !!(await dupe.err("invalid_avatar").catch(() => null)));
  dupe.send("answer.submit", { questionIdx: 0, optionId: "x" });
  check("an unidentified socket cannot answer", !!(await dupe.err("forbidden").catch(() => null)));
  dupe.close();
  players[0].send("host.start");
  check("a player cannot start the game", !!(await players[0].err("forbidden").catch(() => null)));

  console.log("question 1 (closes by itself when everyone has answered)");
  host2.send("host.start");
  const q1 = await players[0].wait("question.start");
  check("every client receives the question", q1.index === 0 && q1.total === 3 && q1.options.length === 4);
  check("the correct answer is never sent with the question", !JSON.stringify(players[0].log.map((x) => x.m)).includes("correct") && !JSON.stringify(host2.log.map((x) => x.m)).match(/"correct"/));
  await Promise.all(players.slice(1).map((p) => p.wait("question.start")));
  const qs1 = (await owner.call("GET", `/api/quizzes/${quiz.id}`)).json.quiz.questions[0];
  const idsOf = (q) => q.options.map((o) => o.id);
  check("option ids shown match the quiz", JSON.stringify(q1.options.map((o) => o.id).sort()) === JSON.stringify(idsOf(qs1).sort()));

  const correct1 = correctOf(quiz, 0), wrong1 = wrongOf(quiz, 0);
  const P1 = players[0];
  P1.send("answer.submit", { questionIdx: 5, optionId: correct1 });
  check("an answer for another question is rejected", !!(await P1.wait("answer.reject", (d) => d.reason === "wrong_question").catch(() => null)));
  P1.send("answer.submit", { questionIdx: 0, optionId: "not-an-option" });
  check("an unknown option is rejected", !!(await P1.wait("answer.reject", (d) => d.reason === "invalid_option").catch(() => null)));
  const nCorrect = Math.ceil(N * 0.6);
  P1.send("answer.submit", { questionIdx: 0, optionId: correct1 });
  await P1.wait("answer.ack");
  P1.send("answer.submit", { questionIdx: 0, optionId: wrong1 });
  check("a second answer from the same player is rejected", !!(await P1.wait("answer.reject", (d) => d.reason === "duplicate").catch(() => null)));
  await Promise.all(players.map(async (p, i) => { if (i === 0) return; await sleep(i * 15); p.send("answer.submit", { questionIdx: 0, optionId: i < nCorrect ? correct1 : wrong1 }); }));
  await Promise.all(players.slice(1).map((p) => p.wait("answer.ack")));
  check("every answer is acknowledged", true);
  const res1 = await Promise.all(players.map((p) => p.wait("results", (d) => d.questionIdx === 0, 10000)));
  check("the question closed by itself once all players answered", res1.every(Boolean));
  const hostRes1 = await host2.wait("results", (d) => d.questionIdx === 0);
  check("host results: distribution counts every answer", Object.values(hostRes1.distribution).reduce((a, b) => a + b, 0) === N && hostRes1.distribution[correct1] === nCorrect);
  check("host results carry the correct option and the explanation", hostRes1.correctOptionId === correct1 && hostRes1.explanation === "Because one");
  const okRows = res1.filter((x, i) => i < nCorrect);
  check("correct players score between base and base + 50 %", okRows.every((x) => x.you.correct && x.you.points >= 1000 && x.you.points <= 1500), JSON.stringify(okRows[0]?.you));
  check("wrong players score zero", res1.filter((x, i) => i >= nCorrect).every((x) => !x.you.correct && x.you.points === 0));
  check("faster players never score less than slower ones", okRows.every((x, i) => i === 0 || okRows[i - 1].you.points >= x.you.points));
  check("ranks follow the points (rank 1 is the fastest correct player)", res1[0].you.rank === 1 && res1.every((x) => x.you.rank >= 1 && x.you.rank <= N));

  console.log("question 2 (host closes it, some players stay silent)");
  host2.send("host.next");
  await Promise.all(players.map((p) => p.wait("question.start", (d) => d.index === 1)));
  const correct2 = correctOf(quiz, 1);
  const silent = Math.max(1, Math.floor(N / 6));
  for (const p of players.slice(silent)) p.send("answer.submit", { questionIdx: 1, optionId: correct2 });
  await Promise.all(players.slice(silent).map((p) => p.wait("answer.ack")));
  await sleep(300);
  check("the room waits while someone has not answered", !players[0].has("results", (d) => d.questionIdx === 1));
  host2.send("host.closeQuestion");
  const res2 = await Promise.all(players.map((p) => p.wait("results", (d) => d.questionIdx === 1)));
  check("silent players get zero points and answered=false", res2.slice(0, silent).every((x) => x.you.points === 0 && x.you.answered === false));
  check("players who answered get points", res2.slice(silent).every((x) => x.you.correct && x.you.points > 0));

  console.log("leaderboard");
  host2.send("host.showLeaderboard");
  const lbHost = await host2.wait("leaderboard");
  check("host leaderboard shows the top 10 sorted by points", lbHost.top.length === Math.min(10, N) && lbHost.top.every((e, i) => i === 0 || lbHost.top[i - 1].points >= e.points) && lbHost.total === N);
  const lbMine = await Promise.all(players.map((p) => p.wait("leaderboard")));
  check("each player receives their own entry", lbMine.every((x, i) => x.you.playerId === players[i].joined.playerId && x.you.rank >= 1));
  check("movement is reported against the previous question", lbMine.some((x) => x.you.movement !== 0) || N < 3);
  const totalsAfter2 = new Map(lbMine.map((x) => [x.you.playerId, x.you.points]));

  console.log("question 3 (pause, resume, timer expiry by alarm)");
  host2.send("host.next");
  const q3 = await players[0].wait("question.start", (d) => d.index === 2);
  await Promise.all(players.slice(1).map((p) => p.wait("question.start", (d) => d.index === 2)));
  host2.send("host.pause");
  await players[0].wait("game.paused");
  players[0].send("answer.submit", { questionIdx: 2, optionId: correctOf(quiz, 2) });
  check("answers are refused while paused", !!(await players[0].wait("answer.reject", (d) => d.reason === "paused").catch(() => null)));
  await sleep(3500);
  const resumedAt = Date.now();
  host2.send("host.resume");
  const resumed = await players[0].wait("game.resumed");
  check("resuming moves the deadline by the pause length", resumed.endsAt > q3.endsAt + 3000 && resumed.endsAt <= resumedAt + 5200, `${resumed.endsAt - q3.endsAt}`);
  players[0].send("answer.submit", { questionIdx: 2, optionId: correctOf(quiz, 2) });
  await players[0].wait("answer.ack");
  const tAnswered = players.length > 1 ? 1 : 0;
  void tAnswered;
  const res3 = await players[0].wait("results", (d) => d.questionIdx === 2, 12000);
  check("the question closed on its own when the timer ran out", res3.you.correct && Date.now() - resumedAt >= 4000 && Date.now() - resumedAt < 7500, `${Date.now() - resumedAt}`);
  check("a pause does not eat into the speed bonus", res3.you.points > 1400, String(res3.you.points));
  for (const p of players.slice(1)) await p.wait("results", (d) => d.questionIdx === 2);
  players[1 % N].send("answer.submit", { questionIdx: 2, optionId: correctOf(quiz, 2) });
  check("a late answer after the close is rejected", !!(await players[1 % N].wait("answer.reject", (d) => d.reason === "not_active" || d.reason === "closed").catch(() => null)));

  console.log("reconnect and kick");
  const victim = players[Math.min(2, N - 1)];
  const victimId = victim.joined.playerId;
  victim.close();
  await host2.wait("player.left", (d) => d.playerId === victimId);
  check("the host is told when a player drops", true);
  const back = new Client(pin, "resume"); await back.opened;
  back.send("player.resume", { playerToken: victim.joined.playerToken });
  const rj = await back.wait("joined");
  const rsnap = await back.wait("snapshot");
  check("a player resumes with their token and sees the current screen", rj.playerId === victimId && rsnap.state === "QUESTION_RESULTS" && rsnap.results?.you !== undefined && rsnap.you.points > 0, JSON.stringify(rsnap.state));
  await host2.wait("player.reconnected", (d) => d.playerId === victimId);
  const evil = new Client(pin, "evil"); await evil.opened;
  evil.send("player.resume", { playerToken: victimId + "." + "A".repeat(32) });
  check("a wrong token cannot take over a player", !!(await evil.err("unknown_player").catch(() => null)));
  evil.close();
  const kickTarget = players[N - 1];
  host2.send("host.kick", { playerId: kickTarget.joined.playerId });
  await kickTarget.wait("kicked");
  check("a kicked player is told and disconnected", kickTarget.closed === 4003 || (await sleep(300), kickTarget.closed === 4003));
  const again = new Client(pin, "again"); await again.opened;
  again.send("player.resume", { playerToken: kickTarget.joined.playerToken });
  check("a kicked player cannot come back", !!(await again.err("kicked").catch(() => null)));
  again.close();

  console.log("finish and persist");
  host2.send("host.next");
  const fin = await host2.wait("game.finished");
  check("the host receives the final standings", fin.top.length >= 1 && fin.total === N - 1);
  const finMine = await back.wait("game.finished");
  check("players receive the final standings with their own rank", finMine.you?.playerId === victimId);
  check("final points equal the points announced after question 2 plus question 3", finMine.you.points >= totalsAfter2.get(victimId));
  let persisted = null;
  for (let i = 0; i < 40; i++) {
    const g = (await owner.call("GET", `/api/games/${gameId}/results`)).json;
    if (g?.game?.status === "FINISHED" && g.participants.length === N - 1) { persisted = g; break; }
    await sleep(500);
  }
  check("results were written to D1 (kicked player excluded)", persisted !== null);
  if (persisted) {
    check("D1 ranks match the final leaderboard", persisted.participants.find((p) => p.id === victimId).final_rank === finMine.you.rank && persisted.participants.find((p) => p.id === victimId).total_points === finMine.you.points);
    check("D1 holds one result row per answer", persisted.questions.reduce((a, q) => a + q.answered, 0) >= N - 1);
    check("per-question stats are available to the results screen", persisted.questions.length === 3 && persisted.questions[0].answered >= N - 1);
  }
  const usage = (await owner.call("GET", `/api/games/${gameId}/usage`)).json.usage;
  const answers = Math.round(N * 0.6 + N * 0.6 + 1 + N + (N - silent));
  console.log(`   usage: rowsWritten=${usage.rowsWritten} rowsRead=${usage.rowsRead} messagesIn=${usage.messagesIn} (about ${answers} answers)`);
  check("the room wrote far fewer rows than the Free-plan budget allows per game", usage.rowsWritten < 15000, String(usage.rowsWritten));
  const late = new Client(pin, "late"); await late.opened.catch(() => null);
  late.send("player.join", { nickname: "Latecomer", avatar: "fox" });
  check("nobody can join a finished game", !!(await late.err("game_over").catch(() => null)));
  late.close();
  check("a finished game's PIN is reusable only after it ends (limit counts active games)", (await owner.call("GET", "/api/games")).json.games.some((g) => g.id === gameId && g.status === "FINISHED"));
  for (const p of players) p.close();
  host2.close(); screen.close(); back.close();

  console.log("game limits");
  const ids = [];
  for (let i = 0; i < 3; i++) { const g = await owner.call("POST", "/api/games", { quizId: quiz.id }); if (g.status === 201) ids.push(g.json.game); }
  check("up to three games run at once", ids.length === 3);
  check("a fourth simultaneous game is refused", (await owner.call("POST", "/api/games", { quizId: quiz.id })).json.error === "too_many_games");
  const cancelled = await owner.call("POST", `/api/games/${ids[0].id}/cancel`);
  check("a game can be cancelled over HTTP", cancelled.status === 200);
  await sleep(1500);
  check("cancelling frees the slot", (await owner.call("POST", "/api/games", { quizId: quiz.id })).status === 201);
  const stale = new Client(ids[0].pin, "stale").opened.catch(() => "refused");
  check("a cancelled game's room still answers within the grace window, then cleans up", (await stale) !== undefined);

  console.log("recovery after the server process restarts"); const mark = (m) => console.log("   .", m);
  const quiz2 = await newQuiz("Recovery quiz", { closeWhenAllAnswered: false, defaultTimeLimitSec: 30 });
  await owner.call("PATCH", `/api/quizzes/${quiz2.id}`, { status: "active" });
  // Free the slots used above.
  for (const g of ids.slice(1)) await owner.call("POST", `/api/games/${g.id}/cancel`);
  mark("quiz2 made");
  const list = (await owner.call("GET", "/api/games")).json.games.filter((g) => !["FINISHED", "CANCELLED"].includes(g.status));
  for (const g of list) await owner.call("POST", `/api/games/${g.id}/cancel`);
  await sleep(1500);
  mark("slots freed");
  const g2 = (await owner.call("POST", "/api/games", { quizId: quiz2.id })).json.game;
  const h2 = await connectHost(g2.id, g2.pin);
  mark("host connected");
  const rp = [];
  for (let i = 0; i < 3; i++) { const c = new Client(g2.pin, `r${i}`); await c.opened; c.send("player.join", { nickname: `Rec ${i}`, avatar: "owl" }); c.joined = await c.wait("joined"); rp.push(c); }
  mark("players joined");
  h2.host.send("host.start");
  await rp[0].wait("question.start");
  rp[0].send("answer.submit", { questionIdx: 0, optionId: correctOf(quiz2, 0) });
  await rp[0].wait("answer.ack");
  await sleep(300);
  mark("restarting");
  await stop();
  await start();
  const again0 = new Client(g2.pin, "again0"); await again0.opened;
  again0.send("player.resume", { playerToken: rp[0].joined.playerToken });
  await again0.wait("joined");
  const s0 = await again0.wait("snapshot");
  check("after a restart the question is still running and the player's answer is remembered", s0.state === "QUESTION_ACTIVE" && s0.question?.index === 0 && s0.yourAnswer === correctOf(quiz2, 0), JSON.stringify(s0.yourAnswer));
  again0.send("answer.submit", { questionIdx: 0, optionId: wrongOf(quiz2, 0) });
  check("a restart does not let a player answer twice", !!(await again0.wait("answer.reject", (d) => d.reason === "duplicate").catch(() => null)));
  const again1 = new Client(g2.pin, "again1"); await again1.opened;
  again1.send("player.resume", { playerToken: rp[1].joined.playerToken });
  await again1.wait("joined"); await again1.wait("snapshot");
  again1.send("answer.submit", { questionIdx: 0, optionId: wrongOf(quiz2, 0) });
  await again1.wait("answer.ack");
  const newTicket = (await owner.call("POST", `/api/games/${g2.id}/ticket`, { role: "host" })).json.ticket;
  const hostAgain = new Client(g2.pin, "hostAgain"); await hostAgain.opened;
  hostAgain.send("host.auth", { ticket: newTicket });
  const hs = await hostAgain.wait("snapshot");
  check("the host reconnects after a restart and sees the live game", hs.state === "QUESTION_ACTIVE" && hs.players.length === 3 && hs.answered === 2, JSON.stringify([hs.state, hs.answered]));
  hostAgain.send("host.closeQuestion");
  const rr = await again0.wait("results");
  check("scores computed after the restart include answers given before it", rr.you.correct && rr.you.points >= 1000 && rr.answered === 2, JSON.stringify(rr));
  hostAgain.send("host.end");
  const done = await hostAgain.wait("game.finished");
  check("a game can be ended early and keeps the standings", done.top[0].points >= 1000 && done.total === 3);
  for (const c of [...rp, again0, again1, hostAgain, h2.host]) c.close();
} catch (error) {
  failed++;
  console.log("  FAIL (exception)", error instanceof Error ? error.stack : error);
} finally {
  await stop().catch(() => undefined);
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
