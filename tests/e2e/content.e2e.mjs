// Phase 3 API end-to-end: quizzes, questions, images, branding, roles. Starts its own local Worker.
//   node tests/e2e/content.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8793, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 1000)); }

let passed = 0, failed = 0, last = null;
const check = (name, cond) => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`, last ? `-> ${last.status} ${JSON.stringify(last.json)}` : ""); } };
let ipN = 50;
class Client {
  constructor() { this.cookie = null; this.ip = `10.7.0.${++ipN}`; }
  async call(method, path, body, { raw = false, headers = {} } = {}) {
    const h = { "cf-connecting-ip": this.ip, "x-gart-csrf": "1", ...headers };
    if (body !== undefined && !raw) h["content-type"] = "application/json";
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) this.cookie = c.split(";")[0];
    let json = null;
    if ((res.headers.get("content-type") ?? "").includes("json")) { try { json = await res.json(); } catch { /* none */ } }
    return (last = { status: res.status, json, headers: res.headers, res });
  }
}
const PW = "Correct-Horse-Battery-9";
const owner = new Client(), editor = new Client(), editor2 = new Client();
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const opt = (text, isCorrect = false) => ({ text, isCorrect });
const Q = (text, extra = {}) => ({ type: "single", text, options: [opt("A", true), opt("B"), opt("C")], ...extra });

try {
  let r = await owner.call("POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  check("owner created", r.status === 201);
  await owner.call("POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  for (const [c, n] of [[editor, "editor1"], [editor2, "editor2"]]) {
    await owner.call("POST", "/api/admins", { email: `${n}@example.com`, displayName: n, password: "Tulip-Window-Lantern-42", role: "editor" });
    await c.call("POST", "/api/auth/login", { email: `${n}@example.com`, password: "Tulip-Window-Lantern-42" });
  }

  console.log("access");
  const anon = new Client();
  check("anonymous cannot list quizzes", (await anon.call("GET", "/api/quizzes")).status === 401);
  check("anonymous cannot upload", (await anon.call("POST", "/api/media", png, { raw: true, headers: { "content-type": "image/png" } })).status === 401);
  check("branding is public", (await anon.call("GET", "/api/branding")).status === 200);
  check("anonymous cannot change branding", (await anon.call("PUT", "/api/branding", {})).status === 401);

  console.log("templates and quiz creation");
  r = await editor.call("GET", "/api/quizzes/templates");
  check("six system templates are listed", r.status === 200 && r.json.templates.length === 6);
  r = await editor.call("POST", "/api/quizzes", { title: "  Безпека  ", templateId: "tpl_speed" });
  const quiz = r.json?.quiz;
  check("quiz created from a template inherits its settings", r.status === 201 && quiz.title === "Безпека" && quiz.settings.defaultTimeLimitSec === 10 && quiz.settings.autoAdvance === true);
  check("new quiz is a draft with no questions", quiz.status === "draft" && quiz.questions.length === 0);
  check("unknown template is rejected", (await editor.call("POST", "/api/quizzes", { title: "x", templateId: "nope" })).status === 400);
  check("empty title is rejected", (await editor.call("POST", "/api/quizzes", { title: "   " })).status === 400);

  console.log("questions");
  r = await editor.call("PATCH", `/api/quizzes/${quiz.id}`, { status: "active" });
  check("an empty quiz cannot be activated", r.status === 409 && r.json.problems.includes("no_questions"));
  r = await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("Q1"));
  check("question appended", r.status === 201 && r.json.quiz.questions.length === 1 && r.json.quiz.questions[0].position === 0);
  for (const t of ["Q2", "Q3", "Q4"]) await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q(t));
  let cur = (await editor.call("GET", `/api/quizzes/${quiz.id}`)).json.quiz;
  check("positions are 0..3 in order", cur.questions.map((q) => q.position).join() === "0,1,2,3" && cur.questions.map((q) => q.text).join() === "Q1,Q2,Q3,Q4");
  check("no correct answer is rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("bad", { options: [opt("A"), opt("B")] }))).status === 400);
  check("two correct answers are rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("bad", { options: [opt("A", true), opt("B", true)] }))).status === 400);
  check("five options are rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("bad", { options: [opt("A", true), opt("B"), opt("C"), opt("D"), opt("E")] }))).status === 400);
  check("duplicate option texts are rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("bad", { options: [opt("Same", true), opt("same")] }))).status === 400);
  check("true/false needs exactly two options", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, { type: "truefalse", text: "tf", options: [opt("T", true), opt("F"), opt("M")] })).status === 400);
  check("true/false with two options is accepted", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, { type: "truefalse", text: "tf", options: [opt("Так", true), opt("Ні")] })).status === 201);
  check("time limit below 5 s is rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("bad", { timeLimitSec: 2 }))).status === 400);
  check("unknown image id is rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("bad", { imageMediaId: "does-not-exist-123" }))).status === 400);

  cur = (await editor.call("GET", `/api/quizzes/${quiz.id}`)).json.quiz;
  const ids = cur.questions.map((q) => q.id);
  r = await editor.call("POST", `/api/quizzes/${quiz.id}/questions/reorder`, { order: [ids[3], ids[0], ids[1], ids[2], ids[4]] });
  check("reorder works", r.status === 200 && r.json.quiz.questions.map((q) => q.text).join() === "Q4,Q1,Q2,Q3,tf");
  check("reorder with a missing id is rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions/reorder`, { order: ids.slice(1) })).status === 400);
  check("reorder with a duplicate id is rejected", (await editor.call("POST", `/api/quizzes/${quiz.id}/questions/reorder`, { order: [ids[0], ids[0], ids[1], ids[2], ids[3]] })).status === 400);
  r = await editor.call("PUT", `/api/quizzes/${quiz.id}/questions/${ids[0]}`, Q("Q1 edited", { points: 2000, timeLimitSec: 45, explanation: "Because", options: [opt("X"), opt("Y", true)] }));
  const edited = r.json?.quiz?.questions.find((q) => q.id === ids[0]);
  check("question replaced in place", r.status === 200 && edited.text === "Q1 edited" && edited.options.length === 2 && edited.options[1].isCorrect && edited.points === 2000 && edited.explanation === "Because");
  r = await editor.call("DELETE", `/api/quizzes/${quiz.id}/questions/${ids[1]}`);
  check("delete compacts positions", r.status === 200 && r.json.quiz.questions.map((q) => q.position).join() === "0,1,2,3");
  check("deleting an unknown question gives 404", (await editor.call("DELETE", `/api/quizzes/${quiz.id}/questions/nope`)).status === 404);

  console.log("activation and settings");
  r = await editor.call("PATCH", `/api/quizzes/${quiz.id}`, { status: "active", category: "Security", tags: ["a", "b"], difficulty: "hard", settings: { basePoints: 500 } });
  check("quiz with valid questions can be activated", r.status === 200 && r.json.quiz.status === "active" && r.json.quiz.tags.join() === "a,b" && r.json.quiz.settings.basePoints === 500);
  check("partial settings keep the template's other values", r.json.quiz.settings.defaultTimeLimitSec === 10);
  check("invalid settings are rejected", (await editor.call("PATCH", `/api/quizzes/${quiz.id}`, { settings: { basePoints: -5 } })).status === 400);
  check("nickname min > max is rejected", (await editor.call("PATCH", `/api/quizzes/${quiz.id}`, { settings: { nicknameMinLength: 10, nicknameMaxLength: 5 } })).status === 400);
  check("too many tags are rejected", (await editor.call("PATCH", `/api/quizzes/${quiz.id}`, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status === 400);
  check("empty patch is rejected", (await editor.call("PATCH", `/api/quizzes/${quiz.id}`, {})).status === 400);

  console.log("images");
  r = await editor.call("POST", "/api/media", png, { raw: true, headers: { "content-type": "image/png" } });
  const imgId = r.json?.id;
  check("PNG uploaded", r.status === 201 && r.json.mime === "image/png");
  r = await editor.call("POST", "/api/media", png, { raw: true, headers: { "content-type": "image/png" } });
  check("identical upload is de-duplicated", r.status === 200 && r.json.reused === true && r.json.id === imgId);
  check("a script disguised as an image is rejected", (await editor.call("POST", "/api/media", new TextEncoder().encode("<script>alert(1)</script>"), { raw: true, headers: { "content-type": "image/png" } })).status === 415);
  check("SVG is rejected", (await editor.call("POST", "/api/media", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), { raw: true, headers: { "content-type": "image/svg+xml" } })).status === 415);
  const big = new Uint8Array(210 * 1024); big.set(png);
  check("an oversized image is rejected", (await editor.call("POST", "/api/media", big, { raw: true, headers: { "content-type": "image/png" } })).status === 413);
  r = await anon.call("GET", `/api/media/${imgId}`);
  check("image is publicly readable with the right type", r.status === 200 && r.headers.get("content-type") === "image/png" && (await r.res.arrayBuffer()).byteLength === png.length);
  check("image is cached immutably and sandboxed", /immutable/.test(r.headers.get("cache-control")) && r.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(r.headers.get("content-security-policy")));
  r = await anon.call("GET", `/api/media/${imgId}`, undefined, { headers: { "if-none-match": `"${imgId}"` } });
  check("conditional request returns 304", r.status === 304);
  check("unknown image gives 404", (await anon.call("GET", "/api/media/unknown-image-id-000")).status === 404);
  check("path-like id gives 404", (await anon.call("GET", "/api/media/..%2f..%2fetc")).status === 404);
  r = await editor.call("PATCH", `/api/quizzes/${quiz.id}`, { coverMediaId: imgId });
  check("cover image can be attached", r.status === 200 && r.json.quiz.coverMediaId === imgId);
  r = await editor.call("POST", `/api/quizzes/${quiz.id}/questions`, Q("with image", { imageMediaId: imgId, options: [{ text: "a", imageMediaId: imgId, isCorrect: true }, opt("b")] }));
  check("question and option images can be attached", r.status === 201);

  console.log("question limit");
  const lim = (await editor.call("POST", "/api/quizzes", { title: "Limit" })).json.quiz;
  let lastStatus = 0;
  for (let i = 0; i < 50; i++) lastStatus = (await editor.call("POST", `/api/quizzes/${lim.id}/questions`, Q(`L${i}`))).status;
  check("50 questions are accepted", lastStatus === 201);
  check("the 51st question is refused", (await editor.call("POST", `/api/quizzes/${lim.id}/questions`, Q("one too many"))).status === 409);
  await editor.call("DELETE", `/api/quizzes/${lim.id}`);

  console.log("duplicate, delete, ownership");
  r = await editor.call("POST", `/api/quizzes/${quiz.id}/duplicate`);
  const copy = r.json?.quiz;
  check("duplicate is a draft copy with all questions", r.status === 201 && copy.status === "draft" && copy.questions.length === cur.questions.length && copy.id !== quiz.id && copy.title.endsWith("(copy)"));
  check("duplicate does not share option ids", copy.questions[0].options[0].id !== (await editor.call("GET", `/api/quizzes/${quiz.id}`)).json.quiz.questions[0].options[0].id);
  check("another editor cannot delete someone else's quiz", (await editor2.call("DELETE", `/api/quizzes/${copy.id}`)).status === 403);
  check("an editor can delete their own quiz", (await editor.call("DELETE", `/api/quizzes/${copy.id}`)).status === 200);
  r = await owner.call("DELETE", `/api/quizzes/${quiz.id}`);
  check("an owner can delete any quiz", r.status === 200);
  check("deleted quiz is gone", (await owner.call("GET", `/api/quizzes/${quiz.id}`)).status === 404);

  console.log("branding");
  const B = { companyName: "Acme", primaryColor: "#112233", secondaryColor: "#223344", backgroundColor: "#000000", accentColor: "#ffaa00", logoPlacement: "top-center", logoMediaId: imgId, backgroundMediaId: null, welcomeMessage: "Вітаємо!", finalMessage: "Дякуємо" };
  check("an editor cannot change branding", (await editor.call("PUT", "/api/branding", B)).status === 403);
  check("a CSS injection in a colour is rejected", (await owner.call("PUT", "/api/branding", { ...B, primaryColor: "red;} body{display:none" })).status === 400);
  check("a short hex colour is rejected", (await owner.call("PUT", "/api/branding", { ...B, primaryColor: "#fff" })).status === 400);
  check("an unknown logo is rejected", (await owner.call("PUT", "/api/branding", { ...B, logoMediaId: "does-not-exist-123" })).status === 400);
  r = await owner.call("PUT", "/api/branding", B);
  check("owner saves branding", r.status === 200);
  r = await anon.call("GET", "/api/branding");
  check("saved branding is publicly readable", r.json.branding.companyName === "Acme" && r.json.branding.primaryColor === "#112233" && r.json.branding.logoMediaId === imgId);
  check("branding is cacheable briefly", /max-age=60/.test(r.headers.get("cache-control")));

  console.log("api hygiene");
  check("API responses are not cached by default", (await owner.call("GET", "/api/quizzes")).headers.get("cache-control") === "no-store");
  check("writes without the CSRF header are rejected", (await fetch(`${BASE}/api/quizzes`, { method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie }, body: JSON.stringify({ title: "x" }) })).status === 403);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  try { execFileSync("pkill", ["-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
