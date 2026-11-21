// Privacy page, data retention, deleting a game, and the header/robots hardening from the security scan.
//   npm run build && node tests/e2e/web-privacy.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8811, BASE = `http://127.0.0.1:${PORT}`;
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
const d1 = (sql) => execFileSync(process.execPath, [wr, "d1", "execute", "DB", "--local", "-c", "wrangler.dev.jsonc", "--command", sql], { cwd: workerDir, env, stdio: "ignore" });
const browser = await chromium.launch();
const errors = [];
try {
  const jar = { owner: null, editor: null };
  const call = async (who, method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-gart-csrf": "1", ...(jar[who] ? { cookie: jar[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const c = res.headers.getSetCookie?.()[0]; if (c) jar[who] = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await call("owner", "POST", "/api/setup", { token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW });
  await call("owner", "POST", "/api/auth/login", { email: "owner@example.com", password: PW });
  await call("owner", "POST", "/api/admins", { email: "ed@example.com", displayName: "Ed", password: "Tulip-Window-Lantern-42", role: "editor" });
  await call("editor", "POST", "/api/auth/login", { email: "ed@example.com", password: "Tulip-Window-Lantern-42" });

  // Headers and robots from the security scan.
  const health = await fetch(`${BASE}/api/health`);
  check("API answers carry HSTS", (health.headers.get("strict-transport-security") ?? "").includes("max-age=31536000"));
  const home = await fetch(`${BASE}/`);
  check("pages carry HSTS", (home.headers.get("strict-transport-security") ?? "").includes("max-age=31536000"));
  check("pages say noindex", (home.headers.get("x-robots-tag") ?? "").includes("noindex"));
  check("the HTML has a noindex tag", (await home.text()).includes('name="robots" content="noindex'));
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check("robots.txt keeps everyone out", /User-agent: \*/.test(robots) && /Disallow: \//.test(robots), robots);

  // Settings API.
  const def = (await call("owner", "GET", "/api/privacy")).json.privacy;
  check("by default results are kept for a year", def.retentionDays === 365 && def.contact === "");
  check("an editor cannot change privacy settings", (await call("editor", "PUT", "/api/privacy", { retentionDays: 30, contact: "x", note: "" })).status === 403);
  check("a nonsense retention is refused", (await call("owner", "PUT", "/api/privacy", { retentionDays: 7, contact: "", note: "" })).status === 400);

  // Public page and the admin tab.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const anon = await ctx.newPage(); anon.on("pageerror", (e) => errors.push(e.message));
  await anon.goto(`${BASE}/privacy`);
  await anon.getByTestId("privacy").waitFor();
  const t1 = await anon.getByTestId("privacy").innerText();
  check("the privacy page lists what is stored and has no sign-in", t1.includes("нікнейм") && t1.includes("1 рік") === false && t1.includes("365 днів"), t1.slice(0, 200));
  check("without a contact it says how to find the owner", (await anon.getByTestId("privacy-contact").innerText()).includes("Контакт власника"));
  const admin = await ctx.newPage(); admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto(`${BASE}/login`); await admin.fill("#email", "owner@example.com"); await admin.fill("#password", PW); await admin.click("button[type=submit]");
  await admin.waitForSelector("[role=tablist]");
  await admin.getByRole("tab", { name: "Налаштування" }).click(); await admin.getByRole("tab", { name: "Конфіденційність" }).click();
  await admin.selectOption("#pr-ret", "90");
  await admin.fill("#pr-contact", "privacy@example.com");
  await admin.fill("#pr-note", "Дані з гри видаляє адміністратор.");
  await admin.getByRole("button", { name: "Зберегти" }).click();
  await admin.getByText("Збережено").waitFor();
  await anon.reload(); await anon.getByTestId("privacy").waitFor(); await sleep(400);
  const t2 = await anon.getByTestId("privacy").innerText();
  check("the page shows the owner's contact, period and note", t2.includes("privacy@example.com") && t2.includes("90 днів") && t2.includes("Дані з гри видаляє адміністратор."), t2.slice(0, 300));
  check("the footer links to the policy", (await anon.getByRole("link", { name: "Конфіденційність" }).count()) >= 1);

  // Retention and deleting a game (rows are written straight into the local database).
  const game = (id, status, finished) => `INSERT INTO game_sessions (id, quiz_id, quiz_title, pin, status, settings_snapshot_json, quiz_snapshot_json, host_admin_id, finished_at) VALUES ('${id}', NULL, 'T ${id}', '${id.slice(-6)}', '${status}', '{}', '{}', (SELECT id FROM administrators WHERE role = 'owner'), ${finished ? `'${finished}'` : "NULL"});` +
    ` INSERT INTO game_participants (id, game_id, nickname, nickname_key, avatar) VALUES ('p-${id}', '${id}', 'Анна', 'анна', 'fox');`;
  const old = new Date(Date.now() - 200 * 86400000).toISOString(), recent = new Date(Date.now() - 5 * 86400000).toISOString();
  d1(game("old-111111", "FINISHED", old)); d1(game("new-222222", "FINISHED", recent)); d1(game("del-333333", "FINISHED", recent)); d1(game("live-444444", "LOBBY", null));
  await call("owner", "PUT", "/api/privacy", { retentionDays: 90, contact: "privacy@example.com", note: "" });
  let ids = (await call("owner", "GET", "/api/games")).json.games.map((g) => g.id);
  check("saving a shorter period removes games older than it at once", !ids.includes("old-111111"), ids.join());
  check("recent games stay", ids.includes("new-222222") && ids.includes("live-444444"));
  await call("owner", "PUT", "/api/privacy", { retentionDays: 0, contact: "", note: "" });
  d1(game("old-555555", "FINISHED", old));
  await call("owner", "PUT", "/api/privacy", { retentionDays: 0, contact: "", note: "" });
  ids = (await call("owner", "GET", "/api/games")).json.games.map((g) => g.id);
  check("'keep until deleted by hand' removes nothing", ids.includes("old-555555"));
  check("an editor cannot delete a game", (await call("editor", "DELETE", "/api/games/del-333333")).status === 403);
  check("a game in progress cannot be deleted", (await call("owner", "DELETE", "/api/games/live-444444")).status === 409);
  check("an owner deletes a finished game", (await call("owner", "DELETE", "/api/games/del-333333")).status === 200);
  ids = (await call("owner", "GET", "/api/games")).json.games.map((g) => g.id);
  check("the deleted game is gone", !ids.includes("del-333333"));
  check("deleting an unknown game says so", (await call("owner", "DELETE", "/api/games/nope")).status === 404);

  // The delete button is in the results view.
  await admin.goto(`${BASE}/admin`); await admin.waitForSelector("[role=tablist]");
  await admin.getByRole("tab", { name: "Ігри" }).click();
  await admin.getByRole("button", { name: "Результати" }).first().click();
  await admin.getByTestId("delete-game").waitFor({ timeout: 8000 }).catch(() => {});
  check("results have a Delete game button", (await admin.getByTestId("delete-game").count()) === 1);
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
} catch (e) { bad++; console.log("  FAIL (exception)", e instanceof Error ? e.message : e); }
finally {
  await browser.close().catch(() => undefined);
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1000);
  try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
