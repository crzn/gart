// Installation pipelines. Each action is an ordered list of idempotent steps.
// Steps throw StepError on failure; the engine turns that into diagnostics for the wizard.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NPM, IS_WINDOWS, run } from "./runner.mjs";
import {
  brandingSql,
  diagnose,
  extractWorkersDevUrl,
  findDatabaseByName,
  generateSecret,
  isHexColor,
  lastLines,
  nodeVersionOk,
  parseJsonFromOutput,
  renderTemplate,
  sanitizeCompanyName,
  validateD1Name,
  validateWorkerName,
} from "./util.mjs";

export const PIPELINES = {
  prepare: ["preflight", "deps"],
  install: ["preflight", "deps", "account", "database", "config", "build", "migrate", "secrets", "deploy", "branding", "health", "adminSetup"],
  update: ["preflight", "deps", "account", "config", "build", "migrate", "secrets", "deploy", "health"],
  repair: ["preflight", "deps", "account", "database", "config", "build", "migrate", "secrets", "deploy", "health", "adminSetup"],
  admin: ["preflight", "account", "adminSetup"],
  backup: ["preflight", "account", "backup"],
  uninstall: ["preflight", "account", "uninstall"],
};

const WORKER_NOT_YET_VISIBLE = /\[code: 10007\]|does not exist on your account/i;

export const SECRET_NAMES = ["SESSION_SECRET", "WS_TICKET_SECRET"];

// Every table except admin_sessions: backups must never contain session tokens.
export const BACKUP_TABLES = [
  "administrators", "quiz_templates", "uploaded_media", "quizzes", "questions", "answer_options",
  "game_sessions", "game_participants", "game_results", "application_settings", "usage_metrics", "audit_logs",
];

export class StepError extends Error {
  constructor(message, { output = "" } = {}) {
    super(message);
    this.name = "StepError";
    this.output = output;
  }
}

const statePath = (root) => join(root, ".gart", "install.json");

export function readState(root) {
  try {
    return JSON.parse(readFileSync(statePath(root), "utf8"));
  } catch {
    return null;
  }
}

function writeState(root, state) {
  mkdirSync(dirname(statePath(root)), { recursive: true });
  writeFileSync(statePath(root), JSON.stringify(state, null, 2) + "\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ----------------------------------- steps ----------------------------------- */

const STEPS = {
  async preflight(ctx) {
    if (!nodeVersionOk(process.versions.node)) {
      throw new StepError(`Node.js ${process.versions.node} is too old. Version 22.12 or newer is required.`);
    }
    const npm = await run(NPM, ["--version"], { shell: IS_WINDOWS });
    if (npm.code !== 0) throw new StepError("npm was not found. Install Node.js from https://nodejs.org (it includes npm).");
    ctx.log(`Node.js ${process.versions.node}, npm ${npm.output.trim()}`);
  },

  async deps(ctx) {
    if (existsSync(ctx.wranglerBin)) {
      ctx.log("Dependencies already installed (Wrangler found).");
      return;
    }
    ctx.log("Installing dependencies (npm install)...");
    const r = await run(NPM, ["install", "--no-audit", "--no-fund"], { cwd: ctx.repoRoot, shell: IS_WINDOWS, onLine: ctx.log });
    if (r.code !== 0 || !existsSync(ctx.wranglerBin)) throw new StepError("npm install failed.", { output: r.output });
  },

  async account(ctx) {
    const r = await ctx.wr(["whoami", "--json"], { noAccount: true, quiet: true });
    if (r.code !== 0) throw new StepError("You are not signed in to Cloudflare. Sign in first.", { output: "not authenticated\n" + r.output });
    const info = parseJsonFromOutput(r.output);
    const accounts = Array.isArray(info?.accounts) ? info.accounts : [];
    if (accounts.length === 0) throw new StepError("No Cloudflare accounts are available for this login.");

    const wanted = ctx.params.accountId ?? ctx.state.accountId;
    const chosen = wanted ? accounts.find((a) => a.id === wanted) : accounts.length === 1 ? accounts[0] : undefined;
    if (!chosen) throw new StepError("Select a Cloudflare account to use.");
    ctx.accountId = chosen.id;
    ctx.accountName = chosen.name;
    ctx.log(`Using Cloudflare account "${chosen.name}".`);
  },

  async database(ctx) {
    const find = async () => {
      const r = await ctx.wr(["d1", "list", "--json"], { quiet: true });
      if (r.code !== 0) throw new StepError("Could not list D1 databases.", { output: r.output });
      return findDatabaseByName(parseJsonFromOutput(r.output), ctx.d1Name);
    };
    let db = await find();
    if (db) {
      ctx.log(`Reusing existing D1 database "${ctx.d1Name}" (data is preserved).`);
    } else {
      ctx.log(`Creating D1 database "${ctx.d1Name}"...`);
      const created = await ctx.wr(["d1", "create", ctx.d1Name], { cwd: ctx.quizDir });
      if (created.code !== 0) throw new StepError("Creating the D1 database failed.", { output: created.output });
      db = await find();
      if (!db) throw new StepError("The database was created but could not be found afterwards.", { output: created.output });
    }
    ctx.d1Id = db.id;
  },

  async config(ctx) {
    const d1Id = ctx.d1Id ?? ctx.state.d1Id;
    if (!d1Id) throw new StepError("The database id is unknown. Run Install or Repair first.");
    const template = readFileSync(join(ctx.workerDir, "wrangler.template.jsonc"), "utf8");
    writeFileSync(
      ctx.wranglerConfig,
      renderTemplate(template, { WORKER_NAME: ctx.workerName, D1_NAME: ctx.d1Name, D1_ID: d1Id }),
    );
    ctx.d1Id = d1Id;
    ctx.state = { ...ctx.state, workerName: ctx.workerName, d1Name: ctx.d1Name, d1Id, accountId: ctx.accountId, accountName: ctx.accountName };
    writeState(ctx.repoRoot, ctx.state);
    ctx.log("Wrote apps/worker/wrangler.jsonc (contains resource ids, no secrets).");
  },

  async build(ctx) {
    ctx.log("Building the web app...");
    const r = await run(NPM, ["run", "build"], { cwd: ctx.repoRoot, shell: IS_WINDOWS, onLine: ctx.log });
    if (r.code !== 0 || !existsSync(join(ctx.repoRoot, "apps", "web", "dist", "index.html"))) {
      throw new StepError("The web build failed.", { output: r.output });
    }
  },

  async migrate(ctx) {
    ctx.log("Applying database migrations...");
    const r = await ctx.wr(["d1", "migrations", "apply", ctx.d1Name, "--remote", "--force", "-c", ctx.wranglerConfig], { cwd: ctx.workerDir });
    if (r.code !== 0) throw new StepError("Applying migrations failed.", { output: r.output });
  },

  // Generates any missing secrets into a private temp file that is passed to `wrangler deploy`
  // and deleted afterwards. Existing secrets are never rotated by Update or Repair.
  async secrets(ctx) {
    let existing = [];
    const ls = await ctx.wr(["secret", "list", "--format", "json", "-c", ctx.wranglerConfig], { cwd: ctx.workerDir, quiet: true });
    if (ls.code !== 0 && !ctx.state.deployedBefore) ctx.log("The Worker does not exist yet (first installation), so there are no secrets to keep. This is expected.");
    if (ls.code === 0) {
      const parsed = parseJsonFromOutput(ls.output);
      existing = Array.isArray(parsed) ? parsed.map((s) => s?.name) : [];
    } else if (ctx.state.deployedBefore) {
      throw new StepError(
        "Could not read the existing secrets. Refusing to generate new ones because that would sign every user out. Check the connection and retry.",
        { output: ls.output },
      );
    }
    const missing = SECRET_NAMES.filter((n) => !existing.includes(n));
    if (missing.length === 0) {
      ctx.log("Secrets already present. Keeping them unchanged.");
      return;
    }
    const values = Object.fromEntries(missing.map((n) => [n, generateSecret()]));
    for (const v of Object.values(values)) ctx.redact.push(v);
    ctx.secretsDir = mkdtempSync(join(tmpdir(), "gart-"));
    ctx.secretsFile = join(ctx.secretsDir, "secrets.json");
    writeFileSync(ctx.secretsFile, JSON.stringify(values), { mode: 0o600 });
    ctx.log(`Generated ${missing.length} new secret(s): ${missing.join(", ")} (values are never shown or stored in the project).`);
  },

  async deploy(ctx) {
    ctx.log("Deploying to Cloudflare...");
    const args = ["deploy", "-c", ctx.wranglerConfig];
    if (ctx.secretsFile) args.push("--secrets-file", ctx.secretsFile);
    // Right after the first upload Cloudflare can briefly answer "Worker does not exist"
    // (code 10007) to Wrangler's follow-up lookup. The upload itself has succeeded, so wait and
    // repeat; the second pass takes the normal "update an existing Worker" path.
    let r;
    for (let attempt = 1; attempt <= 3; attempt++) {
      r = await ctx.wr(args, { cwd: ctx.workerDir });
      if (r.code === 0 || attempt === 3 || !WORKER_NOT_YET_VISIBLE.test(r.output)) break;
      ctx.log(`Cloudflare has not registered the new Worker yet (code 10007). Waiting 20 s, then retrying (${attempt}/3)...`);
      await sleep(20_000);
    }
    cleanupSecrets(ctx);
    if (r.code !== 0) throw new StepError("Deployment failed.", { output: r.output });

    const url = extractWorkersDevUrl(r.output) ?? ctx.state.url ?? null;
    ctx.state = { ...ctx.state, url, deployedBefore: true, version: ctx.version, deployedAt: new Date().toISOString() };
    writeState(ctx.repoRoot, ctx.state);
    if (!url) ctx.log("Deployed, but the public URL was not detected. Find it in the Cloudflare dashboard under Workers & Pages.");
  },

  async branding(ctx) {
    const { companyName, primaryColor } = ctx.params;
    if (!companyName && !primaryColor) return { skipped: true };
    const name = sanitizeCompanyName(companyName ?? "");
    if (name === null) throw new StepError("The company name contains unsupported characters or is too long.");
    const color = primaryColor || "#4f46e5";
    if (!isHexColor(color)) throw new StepError("The primary colour must look like #4f46e5.");
    const r = await ctx.wr(["d1", "execute", ctx.d1Name, "--remote", "-y", "--command", brandingSql(name, color), "-c", ctx.wranglerConfig], { cwd: ctx.workerDir });
    if (r.code !== 0) throw new StepError("Saving the branding failed.", { output: r.output });
  },

  async health(ctx) {
    const url = ctx.state.url;
    if (!url) throw new StepError("No public URL is known, so the health check cannot run. Open the Cloudflare dashboard to find your Worker address.");
    ctx.log(`Checking ${url} (new deployments can take a few seconds to become reachable)...`);

    const attempt = async () => {
      const api = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000) });
      const body = await api.json().catch(() => null);
      if (!body || body.status !== "ok") throw new Error(`/api/health reported ${JSON.stringify(body)}`);

      const page = await fetch(`${url}/`, { signal: AbortSignal.timeout(10_000) });
      const html = await page.text();
      if (!html.includes('id="root"')) throw new Error("The web app is not being served at /");

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(url.replace(/^http/, "ws") + "/api/health/ws");
        const timer = setTimeout(() => { ws.close(); reject(new Error("WebSocket did not answer in time")); }, 10_000);
        ws.onmessage = (e) => {
          clearTimeout(timer);
          ws.close();
          try {
            JSON.parse(String(e.data)).t === "hello" ? resolve() : reject(new Error("Unexpected WebSocket reply"));
          } catch {
            reject(new Error("Invalid WebSocket reply"));
          }
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); };
      });
    };

    let lastError = "unknown";
    for (let i = 1; i <= 8; i++) {
      try {
        await attempt();
        ctx.log("Health check passed: database, schema, web app and WebSocket/Durable Object all respond.");
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        ctx.log(`Attempt ${i}/8 not ready yet: ${lastError}`);
        await sleep(5000);
      }
    }
    throw new StepError(`The health check did not pass: ${lastError}`, { output: lastError });
  },


  // Creates the first administrator through the Worker's one-time setup endpoint and, before that,
  // calibrates how expensive password hashing may be on THIS account (Free plan: 10 ms CPU).
  // The setup token and the password exist only in memory here; they are never written to disk or logs.
  async adminSetup(ctx) {
    if (ctx.state.adminCreated) {
      ctx.log("The first administrator already exists.");
      return { skipped: true };
    }
    const { adminEmail, adminName, adminPassword } = ctx.params;
    if (!adminEmail || !adminPassword) {
      ctx.log("No administrator details were provided, so no administrator was created. Use \"Create administrator\" in the wizard.");
      return { skipped: true };
    }
    const url = ctx.state.url;
    if (!url) throw new StepError("The application address is unknown. Run Install or Repair first.");
    if (!existsSync(ctx.wranglerConfig)) throw new StepError("apps/worker/wrangler.jsonc is missing. Run Repair first.");

    const token = generateSecret();
    ctx.redact.push(token, adminPassword);
    const call = (path, body) => postJson(url, path, body);

    ctx.log("Setting the one-time setup token...");
    const put = await ctx.wr(["secret", "put", "SETUP_TOKEN", "-c", ctx.wranglerConfig], { cwd: ctx.workerDir, input: token + "\n", quiet: true });
    if (put.code !== 0) throw new StepError("Could not store the setup token.", { output: put.output });

    // A new secret takes a few seconds to reach all copies of the Worker.
    let ready = false;
    for (let i = 1; i <= 14 && !ready; i++) {
      const r = await call("/api/setup/kdf-bench", { token, iterations: 5000 });
      if (r.status === 200) ready = true;
      else if (r.status === 409) {
        ctx.state = { ...ctx.state, adminCreated: true };
        writeState(ctx.repoRoot, ctx.state);
        ctx.log("An administrator already exists in this installation; nothing to create.");
        return { skipped: true };
      } else {
        ctx.log(`Waiting for the setup token to become active (${i}/14, status ${r.status || "no answer"})...`);
        await sleep(5000);
      }
    }
    if (!ready) throw new StepError("The application did not accept the setup token in time. Press Try again.");

    ctx.log("Measuring how much password hashing this account can afford (about 40 short requests)...");
    const cal = await calibrateIterations((n) => call("/api/setup/kdf-bench", { token, iterations: n }), ctx.log);
    if (cal.best === 0) {
      throw new StepError(
        "Password hashing exceeds the Free plan's CPU limit even at the minimum strength, so secure sign-in cannot work on this account. Nothing was created.",
      );
    }
    const iterations = chooseIterations(cal.best);
    ctx.log(`Highest passing strength: ${cal.best.toLocaleString("en")} iterations. Using ${iterations.toLocaleString("en")} (safety margin for sign-in requests).`);
    if (iterations < 10000) ctx.log("WARNING: password hashing is cheaper than recommended because of the Free plan CPU limit. Use long passphrases.");

    const kdf = await ctx.wr(["secret", "put", "KDF_ITERATIONS", "-c", ctx.wranglerConfig], { cwd: ctx.workerDir, input: String(iterations) + "\n", quiet: true });
    if (kdf.code !== 0) throw new StepError("Could not store the password-hashing setting.", { output: kdf.output });

    ctx.log("Creating the first administrator...");
    let last = { status: 0, json: null };
    for (let i = 1; i <= 6; i++) {
      last = await call("/api/setup", { token, email: adminEmail, displayName: adminName || adminEmail, password: adminPassword });
      if (last.status === 201 || last.status === 409) break;
      if (last.status === 400 || last.status === 429) break; // retrying cannot help
      await sleep(5000);
    }
    if (last.status === 201 || last.status === 409) {
      ctx.state = { ...ctx.state, adminCreated: true, adminEmail, kdfIterations: iterations };
      writeState(ctx.repoRoot, ctx.state);
      ctx.log(last.status === 201 ? `Administrator ${adminEmail} created.` : "An administrator already existed.");
      ctx.adminEmail = adminEmail;
      return;
    }
    const code = last.json?.error ?? `http ${last.status}`;
    const detail = Array.isArray(last.json?.problems) ? ` (${last.json.problems.join(", ")})` : "";
    throw new StepError(`Creating the administrator failed: ${code}${detail}.`, { output: `setup_${code}` });
  },

  async backup(ctx) {
    requireState(ctx);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const dir = join(ctx.repoRoot, "backups", stamp);
    mkdirSync(dir, { recursive: true });
    copyFileSync(statePath(ctx.repoRoot), join(dir, "install.json"));
    if (existsSync(ctx.wranglerConfig)) copyFileSync(ctx.wranglerConfig, join(dir, "wrangler.jsonc"));

    ctx.log("Exporting database (admin_sessions excluded)...");
    const args = ["d1", "export", ctx.state.d1Name, "--remote", "--output", join(dir, "database.sql")];
    for (const t of BACKUP_TABLES) args.push("--table", t);
    const r = await ctx.wr(args, { cwd: ctx.quizDir });
    if (r.code !== 0) throw new StepError("Exporting the database failed.", { output: r.output });
    ctx.backupDir = dir;
    ctx.log(`Backup saved to ${dir}`);
  },

  async uninstall(ctx) {
    requireState(ctx);
    if (ctx.params.confirmWorkerName !== ctx.state.workerName) {
      throw new StepError("Confirmation does not match the Worker name. Nothing was deleted.");
    }
    ctx.log(`Deleting Worker "${ctx.state.workerName}" (the app and live-game data held in Durable Objects)...`);
    const del = await ctx.wr(["delete", ctx.state.workerName, "--force"], { cwd: ctx.quizDir });
    if (del.code !== 0) throw new StepError("Deleting the Worker failed.", { output: del.output });

    if (ctx.params.confirmDatabaseName === ctx.state.d1Name) {
      ctx.log(`Deleting D1 database "${ctx.state.d1Name}" as explicitly confirmed...`);
      const r = await ctx.wr(["d1", "delete", ctx.state.d1Name, "-y"], { cwd: ctx.quizDir });
      if (r.code !== 0) throw new StepError("Deleting the database failed.", { output: r.output });
      ctx.databaseDeleted = true;
    } else {
      ctx.log(`D1 database "${ctx.state.d1Name}" was KEPT. Your quizzes and results are preserved.`);
      ctx.databaseDeleted = false;
    }
    rmSync(ctx.wranglerConfig, { force: true });
    rmSync(statePath(ctx.repoRoot), { force: true });
  },
};


async function postJson(baseUrl, path, body) {
  try {
    const res = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-gart-csrf": "1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

export const CALIBRATION_LADDER = [5000, 10000, 15000, 20000, 30000, 40000, 50000, 60000, 80000, 100000];
export const CALIBRATION_TRIALS = 5;

/**
 * Walks up the ladder; a strength "passes" only if every one of several trials succeeds, because CPU
 * time varies from request to request. Stops at the first failure. `probe(n)` returns {status}.
 */
export async function calibrateIterations(probe, log = () => {}) {
  let best = 0;
  for (const n of CALIBRATION_LADDER) {
    let ok = true;
    for (let i = 0; i < CALIBRATION_TRIALS; i++) {
      const r = await probe(n);
      if (r.status === 429) { log("Calibration was rate limited; using the best result so far."); return { best, limited: true }; }
      if (r.status !== 200) { ok = false; break; }
    }
    log(`  ${n.toLocaleString("en")} iterations: ${ok ? "ok" : "too slow"}`);
    if (!ok) break;
    best = n;
  }
  return { best, limited: false };
}

/** About 60 % of the highest passing strength, rounded down to 1,000, never below the minimum. */
export function chooseIterations(best) {
  return Math.max(5000, Math.floor((best * 0.6) / 1000) * 1000);
}

function requireState(ctx) {
  if (!ctx.state.workerName || !ctx.state.d1Name) {
    throw new StepError("Nothing has been installed from this folder yet. Run Install first.");
  }
}

function cleanupSecrets(ctx) {
  if (ctx.secretsDir) {
    rmSync(ctx.secretsDir, { recursive: true, force: true });
    ctx.secretsDir = null;
    ctx.secretsFile = null;
  }
}

/* ----------------------------------- engine ----------------------------------- */

/** Versions before the rename kept their state in `.quizlab`. Adopt it so Repair and Update keep working. */
export function adoptLegacyStateDir(repoRoot) {
  const legacy = join(repoRoot, ".quizlab");
  const current = join(repoRoot, ".gart");
  if (!existsSync(current) && existsSync(legacy)) {
    renameSync(legacy, current);
    return true;
  }
  return false;
}

export async function runJob({ action, params = {}, repoRoot, emit, version = "0.10.2" }) {
  const pipeline = PIPELINES[action];
  if (!pipeline) throw new Error(`Unknown action: ${action}`);

  adoptLegacyStateDir(repoRoot);
  const state = readState(repoRoot) ?? {};
  const needsState = action !== "install" && action !== "repair" && action !== "prepare";
  const workerName = params.workerName ?? state.workerName ?? "gart";
  const d1Name = params.d1Name ?? state.d1Name ?? `${workerName}-db`;

  const ctx = {
    action,
    params,
    repoRoot,
    version,
    workerDir: join(repoRoot, "apps", "worker"),
    wranglerConfig: join(repoRoot, "apps", "worker", "wrangler.jsonc"),
    quizDir: join(repoRoot, ".gart"),
    wranglerBin: join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
    state,
    workerName,
    d1Name,
    accountId: null,
    accountName: null,
    d1Id: null,
    secretsDir: null,
    secretsFile: null,
    redact: [],
    log: (line) => emit({ type: "log", line }),
  };
  mkdirSync(ctx.quizDir, { recursive: true });

  ctx.wr = (args, { cwd = repoRoot, noAccount = false, quiet = false, input } = {}) =>
    run(process.execPath, [ctx.wranglerBin, ...args], {
      cwd,
      input,
      env: {
        CI: "1", // no interactive prompts
        WRANGLER_SEND_METRICS: "false",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        ...(ctx.accountId && !noAccount ? { CLOUDFLARE_ACCOUNT_ID: ctx.accountId } : {}),
      },
      onLine: quiet ? undefined : ctx.log,
      redact: ctx.redact,
    });

  emit({ type: "plan", action, steps: pipeline });

  try {
    if (!needsState && (!validateWorkerName(workerName) || !validateD1Name(d1Name))) {
      throw new StepError("Names may only use lowercase letters, digits and hyphens (Worker name up to 40 characters).");
    }
  } catch (err) {
    emit({ type: "failed", step: "preflight", message: err.message, hints: [], tail: [] });
    return { ok: false };
  }

  for (const id of pipeline) {
    emit({ type: "step", id, status: "running" });
    try {
      const result = await STEPS[id](ctx);
      emit({ type: "step", id, status: result?.skipped ? "skipped" : "done" });
    } catch (err) {
      cleanupSecrets(ctx);
      const message = err instanceof Error ? err.message : String(err);
      const output = err instanceof StepError ? err.output : message;
      emit({ type: "step", id, status: "failed" });
      emit({
        type: "failed",
        step: id,
        message,
        hints: diagnose(`${message}\n${output}`, { accountId: ctx.accountId ?? state.accountId }),
        tail: lastLines(output),
      });
      return { ok: false };
    }
  }

  emit({
    type: "done",
    action,
    result: {
      url: ctx.state.url ?? null,
      backupDir: ctx.backupDir ?? null,
      adminEmail: ctx.adminEmail ?? null,
      adminCreated: ctx.state.adminCreated === true,
      databaseDeleted: ctx.databaseDeleted ?? null,
      workerName: ctx.state.workerName ?? workerName,
      d1Name: ctx.state.d1Name ?? d1Name,
    },
  });
  return { ok: true };
}
