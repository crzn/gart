// End-to-end scenario for phase 2. Run against a fresh local Worker:
//   node tests/e2e/auth.e2e.mjs http://127.0.0.1:8787 <SETUP_TOKEN>
// Uses a hand-rolled cookie jar because Node's fetch has none.
const [, , BASE = "http://127.0.0.1:8787", SETUP_TOKEN = "local-dev-setup-token-0123456789"] = process.argv;
let passed = 0, failed = 0;
let lastResponse = null;
const check = (name, cond, extra = "") => {
  if (!cond && !extra && lastResponse) extra = `-> ${lastResponse.status} ${JSON.stringify(lastResponse.json)}`;
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

let ipCounter = 10;
class Client {
  // Each client gets its own address via the header Cloudflare sets in production.
  constructor(ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`) { this.cookie = null; this.ip = ip; }
  async call(method, path, body, { csrf = true, headers = {} } = {}) {
    const h = { "cf-connecting-ip": this.ip, ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    if (csrf) h["x-gart-csrf"] = "1";
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(";")[0];
      if (/Max-Age=0/i.test(c)) this.cookie = null; else this.cookie = pair;
    }
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    return (lastResponse = { status: res.status, json, headers: res.headers, setCookie: set });
  }
}

const OWNER = { email: "Owner@Example.com", displayName: "Олена Власник", password: "correct horse battery staple" };

console.log("setup");
const anon = new Client();
let r = await anon.call("GET", "/api/setup/status");
check("status says setup is needed", r.status === 200 && r.json.needsSetup === true, JSON.stringify(r.json));

r = await anon.call("POST", "/api/setup", { token: SETUP_TOKEN, ...OWNER }, { csrf: false });
check("POST without CSRF header is rejected", r.status === 403 && r.json.error === "csrf_rejected");

r = await anon.call("POST", "/api/setup", { token: SETUP_TOKEN, ...OWNER }, { headers: { origin: "https://evil.example" } });
check("POST with a foreign Origin is rejected", r.status === 403);

r = await anon.call("POST", "/api/setup", { token: "x".repeat(30), ...OWNER });
check("wrong setup token is rejected", r.status === 403 && r.json.error === "invalid_token");

r = await anon.call("POST", "/api/setup", { token: SETUP_TOKEN, ...OWNER, password: "short" });
check("weak password is rejected with reasons", r.status === 400 && r.json.error === "weak_password" && r.json.problems.includes("too_short"));

r = await anon.call("POST", "/api/setup", { token: SETUP_TOKEN, ...OWNER, email: "not-an-email" });
check("invalid e-mail is rejected", r.status === 400 && r.json.error === "invalid_email");

r = await anon.call("POST", "/api/setup/kdf-bench", { token: SETUP_TOKEN, iterations: 5000 });
check("calibration endpoint works before setup", r.status === 200 && r.json.ok === true);

r = await anon.call("POST", "/api/setup/kdf-bench", { token: SETUP_TOKEN, iterations: 200000 });
check("calibration refuses more than 100,000 iterations", r.status === 400);

// Two simultaneous setup requests: exactly one may win.
const [s1, s2] = await Promise.all([
  new Client().call("POST", "/api/setup", { token: SETUP_TOKEN, ...OWNER }),
  new Client().call("POST", "/api/setup", { token: SETUP_TOKEN, ...OWNER, email: "second@example.com" }),
]);
const codes = [s1.status, s2.status].sort();
check("concurrent setup: one 201 and one 409", codes[0] === 201 && codes[1] === 409, JSON.stringify(codes));

r = await anon.call("POST", "/api/setup", { token: SETUP_TOKEN, ...OWNER, email: "third@example.com" });
check("setup is closed after the first administrator", r.status === 409 && r.json.error === "already_set_up");
r = await anon.call("POST", "/api/setup/kdf-bench", { token: SETUP_TOKEN, iterations: 5000 });
check("calibration is closed too", r.status === 409);
r = await anon.call("GET", "/api/setup/status");
check("status now says set up", r.json.needsSetup === false);

// Which of the two racers won decides the owner's e-mail.
const ownerEmail = s1.status === 201 ? OWNER.email.toLowerCase() : "second@example.com";

console.log("login and sessions");
const owner = new Client();
r = await owner.call("POST", "/api/auth/login", { email: ownerEmail, password: "wrong password here" });
check("wrong password gives 401 invalid_credentials", r.status === 401 && r.json.error === "invalid_credentials");
const wrongBody = JSON.stringify(r.json);
r = await owner.call("POST", "/api/auth/login", { email: "nobody@example.com", password: "wrong password here" });
check("unknown account gives the identical answer", r.status === 401 && JSON.stringify(r.json) === wrongBody);

r = await owner.call("GET", "/api/auth/me");
check("me without a session is 401", r.status === 401);

r = await owner.call("POST", "/api/auth/login", { email: ownerEmail.toUpperCase(), password: OWNER.password });
check("login succeeds (e-mail case-insensitive)", r.status === 200 && r.json.admin.role === "owner");
const sc = r.setCookie[0] ?? "";
check("cookie is HttpOnly + SameSite=Strict + Path=/", /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\//.test(sc));
check("response never contains hashes", !JSON.stringify(r.json).match(/hash|salt|kdf/i));
check("API responses are no-store with nosniff", r.headers.get("cache-control") === "no-store" && r.headers.get("x-content-type-options") === "nosniff");

r = await owner.call("GET", "/api/auth/me");
check("me works with the cookie", r.status === 200 && r.json.admin.email === ownerEmail);

const second = new Client();
await second.call("POST", "/api/auth/login", { email: ownerEmail, password: OWNER.password });
r = await owner.call("GET", "/api/auth/sessions");
check("two sessions listed, one marked current", r.json.sessions.length === 2 && r.json.sessions.filter((s) => s.current).length === 1);
const other = r.json.sessions.find((s) => !s.current);
r = await owner.call("DELETE", `/api/auth/sessions/${other.id}`);
check("a session can be revoked", r.status === 200);
r = await second.call("GET", "/api/auth/me");
check("revoked session is rejected", r.status === 401);

console.log("brute-force protection");
const attacker = new Client();
let last;
for (let i = 1; i <= 9; i++) last = await attacker.call("POST", "/api/auth/login", { email: ownerEmail, password: `wrong-attempt-${i}` });
check("account is locked after repeated failures (429 + Retry-After)", last.status === 429 && Number(last.headers.get("retry-after")) > 0, `status ${last.status}`);
const rightButLocked = await new Client().call("POST", "/api/auth/login", { email: ownerEmail, password: OWNER.password });
check("even the right password is refused while locked", rightButLocked.status === 429);

console.log("per-IP protection");
const flood = new Client("203.0.113.77");
let floodLast;
for (let i = 1; i <= 22; i++) floodLast = await flood.call("POST", "/api/auth/login", { email: `nobody${i}@example.com`, password: "irrelevant password" });
check("one address is throttled after 20 attempts across different accounts", floodLast.status === 429, `last status ${floodLast.status}`);

console.log("roles");
r = await owner.call("POST", "/api/admins", { email: "editor@example.com", displayName: "Редактор", password: "violet maple river lamp", role: "editor" });
check("owner creates an editor", r.status === 201 && r.json.admin.role === "editor");
r = await owner.call("POST", "/api/admins", { email: "EDITOR@example.com", displayName: "Dup", password: "violet maple river lamp", role: "editor" });
check("duplicate e-mail is 409", r.status === 409);
r = await owner.call("POST", "/api/admins", { email: "admin@example.com", displayName: "Адмін", password: "orange cloud seven wolf", role: "admin" });
check("owner creates an admin", r.status === 201);
const adminId = r.json.admin.id;
r = await owner.call("POST", "/api/admins", { email: "weak@example.com", displayName: "Weak", password: "password1234", role: "editor" });
check("weak password for a new admin is rejected", r.status === 400 && r.json.error === "weak_password");

const editor = new Client();
r = await editor.call("POST", "/api/auth/login", { email: "editor@example.com", password: "violet maple river lamp" });
check("editor can log in", r.status === 200);
r = await editor.call("GET", "/api/admins");
check("editor cannot list administrators", r.status === 403);
r = await editor.call("POST", "/api/admins", { email: "x@example.com", displayName: "X", password: "some long passphrase", role: "editor" });
check("editor cannot create administrators", r.status === 403);

const admin = new Client();
await admin.call("POST", "/api/auth/login", { email: "admin@example.com", password: "orange cloud seven wolf" });
r = await admin.call("GET", "/api/admins");
check("admin can list administrators", r.status === 200 && r.json.admins.length >= 3 && !JSON.stringify(r.json).match(/hash|salt/i));
r = await admin.call("POST", "/api/admins", { email: "e2@example.com", displayName: "Editor 2", password: "second editor passphrase", role: "editor" });
check("admin can create an editor", r.status === 201);
r = await admin.call("POST", "/api/admins", { email: "a2@example.com", displayName: "A2", password: "another admin passphrase", role: "admin" });
check("admin cannot create another admin", r.status === 403);
r = await admin.call("POST", "/api/admins", { email: "o2@example.com", displayName: "O2", password: "another owner passphrase", role: "owner" });
check("admin cannot create an owner", r.status === 403);

const list = (await owner.call("GET", "/api/admins")).json.admins;
const ownerRow = list.find((a) => a.role === "owner");
r = await admin.call("PATCH", `/api/admins/${ownerRow.id}`, { disabled: true });
check("admin cannot disable an owner", r.status === 403);
r = await admin.call("PATCH", `/api/admins/${adminId}`, { role: "owner" });
check("admin cannot promote itself (self change blocked)", r.status === 403);
r = await owner.call("PATCH", `/api/admins/${ownerRow.id}`, { disabled: true });
check("owner cannot disable itself", r.status === 403 && r.json.error === "forbidden_self");

const editorId = list.find((a) => a.email === "editor@example.com").id;
r = await owner.call("PATCH", `/api/admins/${editorId}`, { disabled: true });
check("owner disables the editor", r.status === 200 && r.json.admin.disabled === true);
r = await editor.call("GET", "/api/auth/me");
check("disabling ends the editor's existing session", r.status === 401);
r = await new Client().call("POST", "/api/auth/login", { email: "editor@example.com", password: "violet maple river lamp" });
check("a disabled account cannot log in (same generic error)", r.status === 401 && r.json.error === "invalid_credentials");
r = await owner.call("PATCH", `/api/admins/${editorId}`, { disabled: false, newPassword: "quiet harbor seven bells" });
check("owner re-enables and resets the password", r.status === 200);
r = await new Client().call("POST", "/api/auth/login", { email: "editor@example.com", password: "quiet harbor seven bells" });
check("new password works after reset", r.status === 200);

console.log("password change");
const pw = new Client();
await pw.call("POST", "/api/auth/login", { email: "admin@example.com", password: "orange cloud seven wolf" });
const pw2 = new Client();
await pw2.call("POST", "/api/auth/login", { email: "admin@example.com", password: "orange cloud seven wolf" });
r = await pw.call("POST", "/api/auth/password", { currentPassword: "not my password", newPassword: "a brand new passphrase" });
check("wrong current password is refused", r.status === 403);
r = await pw.call("POST", "/api/auth/password", { currentPassword: "orange cloud seven wolf", newPassword: "short" });
check("weak new password is refused", r.status === 400);
r = await pw.call("POST", "/api/auth/password", { currentPassword: "orange cloud seven wolf", newPassword: "a brand new passphrase" });
check("password changes", r.status === 200);
r = await pw.call("GET", "/api/auth/me");
check("the current session survives", r.status === 200);
r = await pw2.call("GET", "/api/auth/me");
check("other sessions are signed out", r.status === 401);
r = await new Client().call("POST", "/api/auth/login", { email: "admin@example.com", password: "orange cloud seven wolf" });
check("old password no longer works", r.status === 401);

console.log("logout");
r = await owner.call("POST", "/api/auth/logout");
check("logout succeeds and clears the cookie", r.status === 200 && /Max-Age=0/i.test(r.setCookie[0] ?? ""));
r = await owner.call("GET", "/api/auth/me");
check("session is gone after logout", r.status === 401);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
