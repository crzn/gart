// Gart load test: one real game with many simulated players against a running deployment.
//
//   GART_URL=https://your-site.workers.dev GART_EMAIL=you@company GART_PASSWORD=... \
//     node tests/load/load-test.mjs [--players 120] [--questions 5] [--spread 6] [--yes]
//
// WARNING: this runs a REAL game and spends REAL daily quota (see docs/ADMIN-GUIDE, "Load test").
// Without --yes the script only prints what it would do and the app's own quota forecast.
// The script creates a temporary quiz named "[load test] ..." and deletes it at the end.
// Output: a JSON report (load-report-<time>.json) and a short summary on screen.
import { writeFileSync } from "node:fs";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const BASE = (process.env.GART_URL ?? "").replace(/\/+$/, "");
const EMAIL = process.env.GART_EMAIL, PASSWORD = process.env.GART_PASSWORD;
const N = Number(arg("players", 120)), QUESTIONS = Number(arg("questions", 5)), SPREAD = Number(arg("spread", 6));
const YES = process.argv.includes("--yes");
if (!BASE || !EMAIL || !PASSWORD) { console.error("Set GART_URL, GART_EMAIL and GART_PASSWORD."); process.exit(2); }
if (!(N >= 1 && N <= 120) || !(QUESTIONS >= 1 && QUESTIONS <= 50)) { console.error("--players 1..120, --questions 1..50"); process.exit(2); }

const WS = BASE.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };
const AVATARS = ["fox", "owl", "bear", "wolf", "lynx", "otter", "panda", "koala"];

let cookie = null;
async function api(method, path, body) {
  const h = { "x-gart-csrf": "1" };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie?.() ?? []) cookie = c.split(";")[0];
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const m = { joinMs: [], ackMs: [], rejects: 0, errors: [], unexpectedCloses: 0, joined: 0, answers: 0 };
const frame = (t, d) => JSON.stringify({ v: 1, t, ...(d === undefined ? {} : { d }) });

let r = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
if (r.status !== 200) { console.error(`Login failed (${r.status}). Check GART_EMAIL / GART_PASSWORD.`); process.exit(1); }
r = await api("GET", `/api/usage/forecast?questions=${QUESTIONS}&players=${N}`);
console.log("Quota forecast reported by the app:", r.status === 200 ? JSON.stringify({ projection: r.json.projection, additional: r.json.additional }) : `unavailable (${r.status})`);
console.log(`Plan: ${N} players, ${QUESTIONS} questions, answers spread over ${SPREAD} s on ${BASE}`);
if (!YES) { console.log("Dry run. Add --yes to really run the game."); process.exit(0); }

const opt = (text, isCorrect = false) => ({ text, isCorrect });
const quiz = (await api("POST", "/api/quizzes", { title: `[load test] ${new Date().toISOString()}` })).json?.quiz;
if (!quiz) { console.error("Could not create the temporary quiz."); process.exit(1); }
let gameId = null, host = null;
const players = [];
const cleanup = async () => {
  for (const p of players) try { p.ws.close(); } catch { /* ignore */ }
  try { host?.close(); } catch { /* ignore */ }
  await sleep(500);
  const d = await api("DELETE", `/api/quizzes/${quiz.id}`);
  console.log(d.status === 200 || d.status === 204 ? "Temporary quiz deleted." : `Temporary quiz was not deleted (${d.status}); delete it in the Quizzes tab.`);
};

try {
  await api("PATCH", `/api/quizzes/${quiz.id}`, { settings: { countdownBeforeQuestionSec: 0, defaultTimeLimitSec: SPREAD + 6, basePoints: 1000, speedBonusPercent: 50, closeWhenAllAnswered: true } });
  for (let i = 0; i < QUESTIONS; i++) await api("POST", `/api/quizzes/${quiz.id}/questions`, { type: "single", text: `Load question ${i + 1}`, options: [opt("A", true), opt("B"), opt("C"), opt("D")] });
  await api("PATCH", `/api/quizzes/${quiz.id}`, { status: "active" });
  r = await api("POST", "/api/games", { quizId: quiz.id, acknowledgeQuota: true });
  if (r.status !== 201) throw new Error(`Game was not created: ${r.status} ${JSON.stringify(r.json)}`);
  const pin = r.json.game.pin; gameId = r.json.game.id;
  console.log(`Game ${pin} created.`);

  // host
  const ticket = (await api("POST", `/api/games/${gameId}/ticket`, { role: "host" })).json.ticket;
  host = new WebSocket(`${WS}/ws/${pin}`);
  let finished = null, resultsSeen = 0;
  host.onmessage = (e) => {
    if (e.data === "pong") return;
    const msg = JSON.parse(e.data);
    if (msg.t === "results") { resultsSeen++; setTimeout(() => host.send(frame("host.next")), 1500); }
    if (msg.t === "game.finished") finished = msg.d;
  };
  await new Promise((res, rej) => { host.onopen = res; host.onerror = () => rej(new Error("host socket failed")); });
  host.send(frame("host.auth", { ticket }));

  // players join with a gentle ramp (10 per 200 ms) like people scanning a code
  const t0 = Date.now();
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    await sleep(Math.floor(i / 10) * 200);
    const ws = new WebSocket(`${WS}/ws/${pin}`);
    const p = { ws, i, sentAt: 0, closed: false };
    players[i] = p;
    ws.onclose = () => { p.closed = true; if (!finished) m.unexpectedCloses++; };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const msg = JSON.parse(e.data);
      if (msg.t === "joined") { m.joinMs.push(Date.now() - p.joinAt); m.joined++; }
      else if (msg.t === "question.start") {
        const d = msg.d; const choice = d.options[Math.floor(Math.random() * d.options.length)].id;
        setTimeout(() => { p.sentAt = Date.now(); ws.send(frame("answer.submit", { questionIdx: d.index, optionId: choice })); }, Math.random() * SPREAD * 1000);
      } else if (msg.t === "answer.ack") { m.ackMs.push(Date.now() - p.sentAt); m.answers++; }
      else if (msg.t === "answer.reject") m.rejects++;
      else if (msg.t === "error") m.errors.push(msg.d?.code ?? "unknown");
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`player ${i} connect failed`)); }).catch((e) => { m.errors.push(e.message); });
    p.joinAt = Date.now();
    ws.send(frame("player.join", { nickname: `Load ${String(i + 1).padStart(3, "0")}`, avatar: AVATARS[i % AVATARS.length] }));
  }));
  await sleep(2000);
  console.log(`${m.joined}/${N} players joined in ${((Date.now() - t0) / 1000).toFixed(1)} s. Starting.`);
  host.send(frame("host.start"));

  const deadline = Date.now() + QUESTIONS * (SPREAD + 12) * 1000 + 30_000;
  while (!finished && Date.now() < deadline) await sleep(500);
  if (!finished) { host.send(frame("host.end")); await sleep(3000); }

  const report = {
    base: BASE, at: new Date().toISOString(), players: N, questions: QUESTIONS, spreadSec: SPREAD,
    joined: m.joined, answersAcked: m.answers, expectedAnswers: N * QUESTIONS, rejected: m.rejects,
    unexpectedDisconnects: m.unexpectedCloses, errors: m.errors.slice(0, 20), errorCount: m.errors.length,
    joinMs: { p50: pct(m.joinMs, 50), p95: pct(m.joinMs, 95), max: pct(m.joinMs, 100) },
    ackMs: { p50: pct(m.ackMs, 50), p95: pct(m.ackMs, 95), max: pct(m.ackMs, 100) },
    questionsClosed: resultsSeen, gameFinished: !!finished,
  };
  const file = `load-report-${report.at.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const ok = report.gameFinished && m.joined === N && m.answers === N * QUESTIONS && m.unexpectedCloses === 0 && m.errors.length === 0;
  console.log(ok ? "RESULT: PASS" : "RESULT: PROBLEMS FOUND (see the report)");
  console.log(`Report saved: ${file}. Now open the Usage tab and note the measured numbers.`);
  process.exitCode = ok ? 0 : 1;
} finally {
  await cleanup();
}
