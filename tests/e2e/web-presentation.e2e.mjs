// Browser test of the 0.9.0 presentation features: QR code, sound, animation, and that phones get none of it.
//   npm run build -w @gart/web && node tests/e2e/web-presentation.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8805, BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SAMPLES ?? null; // optional folder: keep the rendered WAV samples
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const { chromium } = createRequire((process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim()) + "/")("playwright");
const jsQR = readFileSync(join(root, "node_modules", "jsqr", "dist", "jsQR.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (OUT) mkdirSync(OUT, { recursive: true });

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

// Records every AudioContext and taps what reaches the speakers, so the test can hear (measure) the output.
const AUDIO_PROBE = () => {
  window.__ctxs = [];
  const A = window.AudioContext;
  window.AudioContext = class extends A { constructor(...a) { super(...a); window.__ctxs.push(this); } };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode && this.context instanceof A && !this.context.__tap) {
      const an = this.context.createAnalyser(); an.fftSize = 2048; this.context.__tap = an; connect.call(this, an);
    }
    return connect.call(this, dest, ...rest);
  };
  window.__level = () => { const an = window.__ctxs[0]?.__tap; if (!an) return -1; const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); return m; };
  window.__peakOver = async (ms) => { let m = 0; const end = performance.now() + ms; while (performance.now() < end) { m = Math.max(m, window.__level()); await new Promise((r) => setTimeout(r, 30)); } return m; };
};

function readWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rate = dv.getUint32(24, true), n = dv.getUint32(40, true) / 2;
  const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = dv.getInt16(44 + i * 2, true) / 32768;
  return { rate, s };
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
try {
  const cookie = { v: null };
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-gart-csrf": "1", ...(cookie.v ? { cookie: cookie.v } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const c = res.headers.getSetCookie?.()[0]; if (c) cookie.v = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  const o = (text, isCorrect = false) => ({ text, isCorrect });
  async function makeQuiz(title, settings) {
    const quiz = (await call("POST", "/api/quizzes", { title })).json.quiz;
    await call("PATCH", `/api/quizzes/${quiz.id}`, { settings: { countdownBeforeQuestionSec: 2, defaultTimeLimitSec: 20, ...settings } });
    await call("POST", `/api/quizzes/${quiz.id}/questions`, { type: "single", text: "Питання один?", options: [o("Так", true), o("Ні"), o("Може"), o("Не знаю")] });
    await call("POST", `/api/quizzes/${quiz.id}/questions`, { type: "single", text: "Питання два?", options: [o("Так"), o("Ні", true)] });
    await call("PATCH", `/api/quizzes/${quiz.id}`, { status: "active" });
    return quiz;
  }
  const quiz = await makeQuiz("З музикою", {});
  const quietQuiz = await makeQuiz("Без звуку", { soundEnabled: false });
  const startGame = async (quizId) => { const r = await call("POST", "/api/games", { quizId, acknowledgeQuota: true }); return r.json.game; };

  // ---------- host + projector
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await hostCtx.addInitScript(AUDIO_PROBE);
  await hostCtx.addInitScript({ content: jsQR }); // init scripts are not subject to the page's content security policy
  const host = await hostCtx.newPage(); host.on("pageerror", (e) => errors.push(`host: ${e.message}`));
  await host.goto(`${BASE}/login`);
  await host.fill("#email", "owner@example.com"); await host.fill("#password", PW); await host.click("button[type=submit]");
  await host.waitForSelector("[role=tablist]");
  const game = await startGame(quiz.id);
  const requests = [];
  const screen = await hostCtx.newPage(); screen.on("pageerror", (e) => errors.push(`screen: ${e.message}`));
  screen.on("request", (r) => requests.push(r.url()));
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto(`${BASE}/screen/${game.id}`);
  await until(screen, (t) => t.includes(game.pin), "projector shows the PIN");

  // QR code
  await screen.getByTestId("qr").waitFor();
  const decode = (page) => page.evaluate(async () => {
    const el = document.querySelector("[data-testid=qr]");
    const svg = new XMLSerializer().serializeToString(el);
    const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
    const c = document.createElement("canvas"); c.width = c.height = 600; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 600, 600); x.drawImage(img, 0, 0, 600, 600);
    const d = x.getImageData(0, 0, 600, 600); const res = window.jsQR(d.data, 600, 600); return res?.data ?? null;
  });
  const expected = `${BASE}/play/${game.pin}`;
  check("the projector's QR code decodes to the join address with the PIN", (await decode(screen)) === expected, String(await decode(screen)));
  await host.goto(`${BASE}/host/${game.id}`);
  await host.getByTestId("qr").waitFor();
  check("the host screen has the same QR code", (await decode(host)) === expected);

  // The link from the QR code opens the join form with the PIN already known.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage();
  phone.on("pageerror", (e) => errors.push(`phone: ${e.message}`));
  const phoneRequests = [];
  phone.on("request", (r) => phoneRequests.push(r.url()));
  await phone.goto(expected);
  await until(phone, (t) => t.includes("Ваш нікнейм"), "join form from the QR link");
  check("the QR link goes straight to the nickname form", true);

  // Join link on the host screen (the projector keeps showing the bare address).
  check("the host screen shows a copyable join link with the PIN", (await host.getByTestId("join-url").innerText().catch(() => "")).includes(expected) || (await host.getByTestId("join-url").inputValue().catch(() => "")) === expected);
  check("the projector does not show the full link", (await screen.getByTestId("join-url").count()) === 0);

  // Games that do not exist are refused.
  check("the PIN lookup says yes for a live game", (await call("GET", `/api/join/${game.pin}`)).status === 200);
  check("the PIN lookup says no for a made-up PIN", (await call("GET", "/api/join/000000")).status === 404);
  await phone.goto(`${BASE}/`);
  await phone.fill("input[inputmode=numeric]", "000000");
  await phone.keyboard.press("Enter");
  await sleep(1200);
  check("a wrong PIN stays on the join form with a message", new URL(phone.url()).pathname === "/" && (await text(phone)).includes("Гру з таким кодом не знайдено"), (await text(phone)).slice(0, 200));
  await phone.goto(`${BASE}/play/000000`);
  await sleep(1200);
  check("opening /play with a made-up PIN says the game does not exist", (await text(phone)).includes("Гру не знайдено"));
  await phone.goto(expected);
  await until(phone, (t) => t.includes("Ваш нікнейм"), "join form for a real PIN");

  // Sound: off until clicked, then really plays.
  check("the projector offers sound but does not start it", (await screen.getByRole("button", { name: "Увімкнути звук" }).count()) === 1 && (await screen.evaluate(() => window.__ctxs.length)) === 0);
  check("no sound engine was downloaded before the click", !requests.some((u) => /engine-/.test(u)));
  await screen.getByRole("button", { name: "Увімкнути звук" }).click();
  await screen.getByRole("button", { name: "Вимкнути звук" }).waitFor();
  check("the engine is downloaded on demand", requests.some((u) => /engine-/.test(u)));
  check("the audio context is running", (await screen.evaluate(() => window.__ctxs[0]?.state)) === "running");
  const lobbyLevel = await screen.evaluate(() => window.__peakOver(1500));
  check("the lobby music is audible", lobbyLevel > 0.02, String(lobbyLevel));
  check("and not clipping", lobbyLevel <= 1.0, String(lobbyLevel));
  await screen.getByRole("button", { name: "Вимкнути звук" }).click();
  await sleep(700);
  const silent = await screen.evaluate(() => window.__peakOver(500));
  check("turning sound off silences it", silent < 0.002, String(silent));
  await screen.getByRole("button", { name: "Увімкнути звук" }).click();
  await screen.getByRole("button", { name: "Вимкнути звук" }).waitFor();
  check("the choice of music is offered", (await screen.locator("select option").count()) === 3);
  check("sound has the 'listen' link", (await screen.getByRole("link", { name: "Послухати варіанти" }).count()) === 1);

  // Animation classes on the projector, none on the phone.
  // (a player joins so the lobby has an avatar)
  await phone.fill("#nick", "Анна"); await phone.getByRole("button", { name: "Приєднатися" }).click();
  await until(phone, (t) => t.includes("Ви в грі"), "joined");
  await until(screen, (t) => t.includes("Анна"), "projector lists the player");
  check("a joining player pops in on the projector", (await screen.locator("li.fx-pop").count()) >= 1);
  check("the phone has no animation classes at all", (await phone.locator("[class*=fx-]").count()) === 0);
  check("the phone never downloaded the sound engine or the QR library", !phoneRequests.some((u) => /engine-|QrCode-|ListenPage-/.test(u)), phoneRequests.filter((u) => /assets/.test(u)).join(", "));
  check("the phone has no sound switch", (await phone.getByText("Увімкнути звук").count()) === 0);

  // Projector design: the lobby and the question must fit the screen without scrolling, at both common sizes.
  const fits = (p) => p.evaluate(() => ({ h: document.documentElement.scrollHeight - innerHeight, w: document.documentElement.scrollWidth - innerWidth }));
  const shot = async (p, name) => { if (OUT) await p.screenshot({ path: join(OUT, `${name}.png`) }); };
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    await screen.setViewportSize({ width: w, height: h }); await sleep(900);
    const f = await fits(screen);
    check(`the projector lobby fits ${w}x${h} without scrolling`, f.h <= 1 && f.w <= 1, JSON.stringify(f));
    await shot(screen, `projector-lobby-${w}`);
  }

  // Play a question and look at what the sound does.
  await host.getByRole("button", { name: "Почати гру" }).click();
  await until(screen, (t) => /Питання один\?/.test(t), "question on the projector", 15000);
  const qLevel = await screen.evaluate(() => window.__peakOver(1500));
  check("music plays during the question", qLevel > 0.02, String(qLevel));
  check("question options rise in on the projector", (await screen.locator(".fx-rise").count()) >= 4);
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    await screen.setViewportSize({ width: w, height: h }); await sleep(1500);
    const f = await fits(screen);
    check(`the projector question fits ${w}x${h} without scrolling`, f.h <= 1 && f.w <= 1, JSON.stringify(f));
    await shot(screen, `projector-question-${w}`);
  }
  await phone.getByRole("button", { name: /Так/ }).click();
  await until(screen, (t) => t.includes("Відповіли") || true, "answered", 1000);
  await until(host, (t) => t.includes("Повідомте") || t.includes("Рейтинг") || t.includes("Далі"), "results", 15000);
  check("answer bars grow on the projector", (await screen.locator(".fx-grow").count()) >= 1);
  await host.getByRole("button", { name: "Рейтинг" }).click();
  await until(screen, (t) => t.includes("Рейтинг"), "projector leaderboard");
  await host.getByRole("button", { name: "Далі" }).click();
  await until(screen, (t) => /Питання два\?/.test(t), "second question", 15000);
  await phone.getByRole("button", { name: /Ні/ }).click();
  await until(host, (t) => t.includes("Завершити гру"), "finish offered", 15000);
  await host.getByRole("button", { name: "Завершити гру" }).click();
  await until(screen, (t) => t.includes("Гру завершено"), "final");
  check("the podium rises in on the projector", (await screen.locator(".fx-podium").count()) >= 1);

  // A quiz carrying the old "music off" setting behaves like any other: only the Gart sound setting counts.
  const quiet = await startGame(quietQuiz.id);
  const q = await hostCtx.newPage(); q.on("pageerror", (e) => errors.push(`quiet: ${e.message}`));
  await q.goto(`${BASE}/screen/${quiet.id}`);
  await until(q, (t) => t.includes(quiet.pin), "quiet projector");
  check("the old per-quiz music setting no longer hides the sound control", (await q.getByTestId("sound-control").count()) === 1);
  await q.getByRole("button", { name: "Увімкнути звук" }).click();
  await q.getByRole("button", { name: "Вимкнути звук" }).waitFor();
  check("the intro plays", (await q.evaluate(() => window.__peakOver(3500))) > 0.05);
  await q.close();

  // The loud quiz: the waiting theme builds with the players.
  check("the waiting theme plays in the lobby after the intro", (await screen.evaluate(() => window.__peakOver(1500))) > 0.02);

  // Gart sound switched off in the settings: nothing is offered anywhere.
  const brand = (await call("GET", "/api/branding")).json.branding;
  await call("PUT", "/api/branding", { ...brand, soundEnabled: false });
  const offCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await offCtx.addCookies([{ name: cookie.v.split("=")[0], value: cookie.v.split("=")[1], url: BASE }]);
  const off = await offCtx.newPage();
  await off.goto(`${BASE}/screen/${game.id}`);
  await until(off, (t) => t.includes(game.pin), "projector with Gart sound off");
  check("with Gart sound switched off there is no sound control", (await off.getByTestId("sound-control").count()) === 0);
  await call("PUT", "/api/branding", { ...brand, soundEnabled: true });
  await off.context().close();

  // Reduced motion: animations collapse.
  const rm = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  await rm.addCookies([{ name: cookie.v.split("=")[0], value: cookie.v.split("=")[1], url: BASE }]);
  const rmp = await rm.newPage(); await rmp.goto(`${BASE}/screen/${quiet.id}`);
  await until(rmp, (t) => t.includes(quiet.pin), "reduced-motion projector");
  const dur = await rmp.evaluate(() => { const el = document.querySelector("[class*=fx-]"); return el ? getComputedStyle(el).animationDuration : "none-found"; });
  check("with 'reduce motion' the animations are effectively off", dur === "none-found" || parseFloat(dur) < 0.01, dur);

  // ---------- listening page and sound samples
  const listen = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  listen.on("pageerror", (e) => errors.push(`listen: ${e.message}`));
  await listen.goto(`${BASE}/listen`);
  await listen.getByTestId("listen").waitFor();
  const wavs = {};
  for (const [id, label] of [["sopilka", "Сопілка"], ["tsymbaly", "Цимбали"], ["hopak", "Гопак"]]) {
    const card = listen.locator("div", { has: listen.getByRole("heading", { name: label }) }).last();
    const [dl] = await Promise.all([listen.waitForEvent("download", { timeout: 60000 }), card.getByRole("button", { name: /Зберегти зразок/ }).click()]);
    const path = await dl.path(); const buf = readFileSync(path);
    if (OUT) writeFileSync(join(OUT, dl.suggestedFilename()), buf);
    wavs[id] = readWav(buf);
    const { rate, s } = wavs[id];
    let peak = 0, sum = 0; for (const v of s) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    const rms = Math.sqrt(sum / s.length);
    const win = Math.floor(rate * 0.25); let quiet = 0, total = 0;
    for (let i = 0; i + win < s.length - rate; i += win) { let m = 0; for (let j = i; j < i + win; j++) m = Math.max(m, Math.abs(s[j])); total++; if (m < 0.01) quiet++; }
    check(`${id}: the sample is ${(s.length / rate).toFixed(1)} s long, level rms ${rms.toFixed(3)} peak ${peak.toFixed(2)}`, s.length / rate > 10 && rms > 0.02 && rms < 0.4 && peak < 0.99);
    check(`${id}: no gaps of silence inside the music`, quiet / total < 0.05, `${quiet}/${total}`);
  }
  const hash = (w) => createHash("sha1").update(Buffer.from(w.s.buffer)).digest("hex");
  check("the three variants really sound different", new Set(Object.values(wavs).map(hash)).size === 3);
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
