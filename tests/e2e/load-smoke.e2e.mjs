// Runs tests/load/load-test.mjs against a local Worker (120 players, 3 questions) to prove the script itself works.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, rmSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8800, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore", detached: true });
let code = 1;
try {
  for (let i = 0; ; i++) { try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ } if (i > 60) throw new Error("worker did not start"); await sleep(1000); }
  const PW = "Correct-Horse-Battery-9";
  const s = await fetch(`${BASE}/api/setup`, { method: "POST", headers: { "content-type": "application/json", "x-gart-csrf": "1" }, body: JSON.stringify({ token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: PW }) });
  if (s.status !== 201) throw new Error(`setup failed ${s.status}`);
  const out = spawnSync(process.execPath, [join(root, "tests", "load", "load-test.mjs"), "--players", process.env.PLAYERS ?? "120", "--questions", "3", "--spread", "3", "--yes"],
    { cwd: workerDir, env: { ...process.env, GART_URL: BASE, GART_EMAIL: "owner@example.com", GART_PASSWORD: PW }, encoding: "utf8", timeout: 180_000 });
  console.log(out.stdout); console.log(out.stderr);
  code = out.status === 0 && /RESULT: PASS/.test(out.stdout) ? 0 : 1;
  for (const f of readdirSync(workerDir)) if (f.startsWith("load-report-")) unlinkSync(join(workerDir, f));
  console.log(code === 0 ? "load script smoke test: ok" : "load script smoke test: FAIL");
} finally {
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  await sleep(1200); try { execFileSync("pkill", ["-9", "-f", "workerd"]); } catch { /* none */ }
}
process.exit(code);
