// Runs the installer's real "admin" pipeline against a LOCAL Worker, with a fake `wrangler` binary that
// implements only what the pipeline needs: `whoami --json` and `secret put NAME` (stdin -> .dev.vars).
//   node tests/e2e/installer-admin.e2e.mjs
// The script starts its own local Worker (fresh database) and restarts it whenever the fake `secret put`
// changes .dev.vars, because local `wrangler dev` reads those variables only at startup.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runJob } from "../../installer/lib/jobs.mjs";

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const realRepo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(realRepo, "apps", "worker");
const devVars = join(workerDir, ".dev.vars");
const wranglerJs = join(realRepo, "node_modules", "wrangler", "bin", "wrangler.js");
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

copyFileSync(join(workerDir, ".dev.vars.example"), devVars);
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wranglerJs, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });

let server;
const startServer = () => {
  server = spawn(process.execPath, [wranglerJs, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore" });
};
const stopServer = () => new Promise((r) => { if (!server) return r(); server.once("exit", () => setTimeout(r, 800)); server.kill("SIGTERM"); });
let restarting = Promise.resolve();
let lastVars = readFileSync(devVars, "utf8");
const watcher = watch(workerDir, (_e, name) => {
  if (name !== ".dev.vars") return;
  const now = readFileSync(devVars, "utf8");
  if (now === lastVars) return;
  lastVars = now;
  restarting = restarting.then(async () => { await stopServer(); startServer(); });
});
startServer();
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 1000)); }

const root = mkdtempSync(join(tmpdir(), "ql-fake-"));
mkdirSync(join(root, "node_modules", "wrangler", "bin"), { recursive: true });
mkdirSync(join(root, "apps", "worker"), { recursive: true });
mkdirSync(join(root, ".gart"), { recursive: true });
writeFileSync(join(root, "apps", "worker", "wrangler.jsonc"), "{}\n");
writeFileSync(join(root, ".gart", "install.json"), JSON.stringify({ workerName: "gart", d1Name: "gart-db", url: BASE }));
writeFileSync(join(root, "node_modules", "wrangler", "bin", "wrangler.js"), `
const fs = require("fs");
const a = process.argv.slice(2);
if (a[0] === "whoami") { console.log(JSON.stringify({ loggedIn: true, accounts: [{ id: "acc1", name: "Test" }] })); process.exit(0); }
if (a[0] === "secret" && a[1] === "put") {
  let v = ""; process.stdin.on("data", (c) => (v += c)); process.stdin.on("end", () => {
    v = v.trim(); const f = ${JSON.stringify(devVars)};
    const lines = fs.readFileSync(f, "utf8").split("\\n").filter((l) => !l.startsWith(a[2] + "="));
    lines.push(a[2] + "=" + v); fs.writeFileSync(f, lines.filter(Boolean).join("\\n") + "\\n");
    process.exit(0);
  });
} else { console.error("fake wrangler: unsupported " + a.join(" ")); process.exit(2); }
`);

const events = [];
const PASSWORD = "silver canyon morning drum";
const res = await runJob({
  action: "admin", repoRoot: root, version: "test",
  params: { accountId: "acc1", adminEmail: "installer-admin@example.com", adminName: "Installer Admin", adminPassword: PASSWORD },
  emit: (e) => { events.push(e); if (e.type === "log") console.log("   log:", e.line); },
});
const done = events.find((e) => e.type === "done");
const failed = events.find((e) => e.type === "failed");
const state = JSON.parse(readFileSync(join(root, ".gart", "install.json"), "utf8"));
console.log("result:", res.ok ? "ok" : "FAILED", failed ? JSON.stringify(failed) : "");
console.log("state:", JSON.stringify({ adminCreated: state.adminCreated, adminEmail: state.adminEmail, kdfIterations: state.kdfIterations }));

let bad = 0;
const check = (n, c) => { console.log(c ? "  ok  " : "  FAIL", n); if (!c) bad++; };
check("pipeline succeeded", res.ok && done);
check("administrator recorded in state", state.adminCreated === true && state.adminEmail === "installer-admin@example.com");
check("iterations chosen with a safety margin (60 % of 100,000 locally)", state.kdfIterations === 60000);
check("password never appears in any emitted event", !JSON.stringify(events).includes(PASSWORD));
check("setup token never appears in any emitted event", !/SETUP_TOKEN=|"token"/.test(JSON.stringify(events)));
check("state file holds no password", !JSON.stringify(state).includes(PASSWORD));

// The created account really works, with the calibrated cost.
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json", "x-gart-csrf": "1", "cf-connecting-ip": "198.51.100.9" },
  body: JSON.stringify({ email: "installer-admin@example.com", password: PASSWORD }),
});
const body = await login.json();
check("the new administrator can sign in", login.status === 200 && body.admin?.role === "owner");

// Running it again is a safe no-op.
const events2 = [];
const again = await runJob({ action: "admin", repoRoot: root, version: "test", params: { accountId: "acc1", adminEmail: "x@example.com", adminPassword: "another long phrase here" }, emit: (e) => events2.push(e) });
check("a second run is skipped, not duplicated", again.ok && events2.some((e) => e.type === "step" && e.id === "adminSetup" && e.status === "skipped"));
watcher.close();
await restarting;
await stopServer();
try { execFileSync("pkill", ["-f", "workerd"]); } catch { /* none left */ }
copyFileSync(join(workerDir, ".dev.vars.example"), devVars);
process.exit(bad ? 1 : 0);
