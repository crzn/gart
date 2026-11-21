import { DurableObject } from "cloudflare:workers";
import { CloudflareClient, CloudflareError, compareVersions, deploy, verifyPackage } from "@gart/deploy-engine";
import { APP_VERSION, type Env } from "../env";
import { open, seal } from "../security/secretBox";
import { releaseConfig } from "../services/releaseConfig";

/**
 * In-app updates. One instance ("main") keeps the encrypted Cloudflare token, remembers the last check and runs the update.
 * The work happens in an alarm: a Durable Object invocation may use 30 s of CPU, a normal request only 10 ms on the Free plan.
 * Nothing here writes to D1: progress lives in this object's own storage.
 */

const TOKEN_PURPOSE = "gart-updater-token-v1";
const CHECK_TTL_MS = 30 * 60_000;
const CHECK_MIN_GAP_MS = 60_000;
const RUN_TIMEOUT_MS = 20 * 60_000;
const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
const VERSION_TAG = /^v\d+\.\d+\.\d+$/;

export interface ReleaseInfo { version: string; title: string; notes: string; publishedAt: string }
interface Connection { sealedToken: string; accountId: string; accountName: string; workerName: string; databaseName: string; connectedAt: number }
export interface RunState {
  target: string;
  from: string;
  kind: "update" | "rollback";
  phase: "running" | "confirm" | "done" | "failed";
  steps: { step: string; status: string; detail?: string }[];
  startedAt: number;
  finishedAt?: number;
  acknowledged: boolean;
  destructive?: string[];
  error?: { code: string; message: string };
  bookmark?: string | null;
}
export interface UpdaterView {
  current: string;
  connection: { accountName: string; workerName: string; databaseName: string; connectedAt: number } | null;
  run: RunState | null;
  releases: { checkedAt: number; list: ReleaseInfo[]; error?: string; detail?: string } | null;
}
type Fail = { ok: false; code: string };

export class Updater extends DurableObject<Env> {
  private async conn(): Promise<Connection | null> { return (await this.ctx.storage.get<Connection>("conn")) ?? null; }

  async view(): Promise<UpdaterView> {
    const conn = await this.conn();
    let run = (await this.ctx.storage.get<RunState>("run")) ?? null;
    if (run && run.phase === "running") {
      if (run.target === APP_VERSION) {
        // The new code is serving this very request: the update went through even if the old code never got to say so.
        run = { ...run, phase: "done", finishedAt: Date.now() };
        await this.ctx.storage.put("run", run);
      } else if (Date.now() - run.startedAt > RUN_TIMEOUT_MS) {
        run = { ...run, phase: "failed", finishedAt: Date.now(), error: { code: "timeout", message: "The update did not finish in time." } };
        await this.ctx.storage.put("run", run);
      }
    }
    const releases = (await this.ctx.storage.get<{ checkedAt: number; list: ReleaseInfo[]; error?: string; detail?: string }>("releases")) ?? null;
    return {
      current: APP_VERSION,
      connection: conn ? { accountName: conn.accountName, workerName: conn.workerName, databaseName: conn.databaseName, connectedAt: conn.connectedAt } : null,
      run,
      releases,
    };
  }

  /** Stores the token after proving that it can see the Worker and its database. */
  async saveConnection(token: string, workerName: string): Promise<{ ok: true } | Fail> {
    const cfg = releaseConfig(this.env);
    const client = new CloudflareClient({ base: cfg.cfBase, token });
    let accounts: { id: string; name: string }[];
    try { accounts = await client.listAccounts(); }
    catch (e) { return { ok: false, code: e instanceof CloudflareError && e.status >= 400 && e.status < 500 ? "token_rejected" : "cloudflare_unreachable" }; }
    for (const account of accounts) {
      let worker;
      try { worker = await client.getWorker(account.id, workerName); } catch { continue; }
      if (!worker) continue;
      let db;
      try { db = await client.getWorkerDatabase(account.id, workerName); } catch { return { ok: false, code: "token_missing_rights" }; }
      if (!db?.name) return { ok: false, code: "database_not_found" };
      const conn: Connection = {
        sealedToken: await seal(this.env.SESSION_SECRET, TOKEN_PURPOSE, token),
        accountId: account.id, accountName: account.name, workerName, databaseName: db.name, connectedAt: Date.now(),
      };
      await this.ctx.storage.put("conn", conn);
      return { ok: true };
    }
    return { ok: false, code: accounts.length === 0 ? "token_no_account" : "worker_not_found" };
  }

  async disconnect(): Promise<void> {
    await this.ctx.storage.delete("conn");
  }

  /** Reads the public release list (cached: GitHub limits anonymous API requests per address, and Cloudflare's addresses are shared).
   * The API is tried first; if it refuses, the public Atom feed of the releases page is used, which has no such limit. */
  async check(force: boolean): Promise<{ ok: true } | Fail> {
    const cached = await this.ctx.storage.get<{ checkedAt: number; list: ReleaseInfo[]; error?: string }>("releases");
    const age = cached ? Date.now() - cached.checkedAt : Infinity;
    const gap = Number(this.env.RELEASE_CHECK_GAP_MS ?? CHECK_MIN_GAP_MS);
    if (cached && !cached.error && (force ? age < gap : age < CHECK_TTL_MS)) return { ok: true };
    const cfg = releaseConfig(this.env);
    const failures: string[] = [];
    let list: ReleaseInfo[] | null = null;
    try { list = await readReleasesApi(cfg.apiBase, cfg.repo); } catch (e) { failures.push(`api: ${(e as Error).message}`); }
    if (!list) { try { list = await readReleasesFeed(cfg.dlBase, cfg.repo); } catch (e) { failures.push(`feed: ${(e as Error).message}`); } }
    if (list) {
      list.sort((a, b) => compareVersions(b.version, a.version));
      await this.ctx.storage.put("releases", { checkedAt: Date.now(), list });
      return { ok: true };
    }
    await this.ctx.storage.put("releases", { checkedAt: Date.now(), list: cached?.list ?? [], error: "github_unavailable", detail: failures.join("; ").slice(0, 300) });
    return { ok: false, code: "github_unavailable" };
  }

  async start(version: string, acknowledge: boolean): Promise<{ ok: true } | Fail> {
    if (!(await this.conn())) return { ok: false, code: "not_connected" };
    const existing = await this.ctx.storage.get<RunState>("run");
    if (existing?.phase === "running" && Date.now() - existing.startedAt < RUN_TIMEOUT_MS) return { ok: false, code: "already_running" };
    const cmp = compareVersions(APP_VERSION, version);
    if (cmp === 0) return { ok: false, code: "same_version" };
    const checked = await this.check(false);
    const cached = await this.ctx.storage.get<{ list: ReleaseInfo[] }>("releases");
    if (!cached?.list.some((r) => r.version === version)) return { ok: false, code: checked.ok ? "unknown_version" : checked.code };
    const run: RunState = { target: version, from: APP_VERSION, kind: cmp < 0 ? "update" : "rollback", phase: "running", steps: [], startedAt: Date.now(), acknowledged: acknowledge };
    await this.ctx.storage.put("run", run);
    await this.ctx.storage.setAlarm(Date.now() + 50);
    return { ok: true };
  }

  override async alarm(): Promise<void> {
    const run = await this.ctx.storage.get<RunState>("run");
    if (!run || run.phase !== "running") return;
    const save = (patch: Partial<RunState>) => { Object.assign(run, patch); return this.ctx.storage.put("run", run); };
    const step = (name: string, status: string, detail?: string) => {
      const found = run.steps.find((s) => s.step === name);
      if (found) { found.status = status; if (detail) found.detail = detail; } else run.steps.push({ step: name, status, ...(detail ? { detail } : {}) });
      return this.ctx.storage.put("run", run);
    };
    try {
      const conn = await this.conn();
      if (!conn) throw new Failure("not_connected", "The Cloudflare token was removed.");
      const token = await open(this.env.SESSION_SECRET, TOKEN_PURPOSE, conn.sealedToken);
      if (!token) throw new Failure("token_unreadable", "The stored token cannot be read. Connect again.");
      const cfg = releaseConfig(this.env);

      await step("download", "running");
      const res = await fetch(`${cfg.dlBase}/${cfg.repo}/releases/download/v${run.target}/gart-package.json`, { headers: { "User-Agent": "gart-updater" } });
      if (!res.ok) throw new Failure("download_failed", `The release package could not be downloaded (status ${res.status}).`);
      if (Number(res.headers.get("content-length") ?? 0) > MAX_PACKAGE_BYTES) throw new Failure("download_failed", "The release package is unexpectedly large.");
      const pkg = (await res.json()) as Parameters<typeof deploy>[0]["pkg"];
      await step("download", "done");

      await step("verify", "running");
      let manifest;
      try { manifest = await verifyPackage(pkg, cfg.publicKey); }
      catch (e) { throw new Failure("package_invalid", (e as Error).message); }
      if (manifest.version !== run.target) throw new Failure("package_invalid", "The package version does not match the release.");
      await step("verify", "done");

      const client = new CloudflareClient({ base: cfg.cfBase, token });
      let worker;
      try { worker = await client.getWorker(conn.accountId, conn.workerName); }
      catch (e) { throw cloudflareFailure(e); }
      if (!worker) throw new Failure("worker_not_found", "The Worker was not found in the account any more.");
      const tags = manifest.durableObjects.migrations.map((m) => m.tag);
      if (worker.migrationTag && !tags.includes(worker.migrationTag)) {
        throw new Failure("rollback_unsupported", "That version is older than the installed storage layout and cannot be restored here.");
      }

      // Warn before anything that removes data. The migrations already applied are in this installation's own database.
      let applied = new Set<string>();
      try { applied = new Set((await this.env.DB.prepare('SELECT name FROM "d1_migrations"').all<{ name: string }>()).results.map((r) => r.name)); } catch { /* no table yet */ }
      const destructive = manifest.migrations.filter((m) => m.destructive && !applied.has(m.name)).map((m) => m.name);
      if (destructive.length > 0 && !run.acknowledged) {
        await save({ phase: "confirm", destructive, finishedAt: Date.now() });
        return;
      }

      const result = await deploy({
        client, accountId: conn.accountId, pkg, manifest, workerName: conn.workerName, databaseName: conn.databaseName, mode: "update",
        onProgress: (p) => { void step(p.step, p.status, p.detail); },
      });
      await save({ phase: "done", finishedAt: Date.now(), bookmark: result.bookmark });
    } catch (e) {
      const f = e instanceof Failure ? e : cloudflareFailure(e);
      await save({ phase: "failed", finishedAt: Date.now(), error: { code: f.code, message: f.message } });
    }
  }
}

class Failure extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function cloudflareFailure(e: unknown): Failure {
  if (e instanceof CloudflareError && (e.status === 401 || e.status === 403)) return new Failure("token_rejected", "Cloudflare did not accept the stored token. Create a new one and connect again.");
  const message = e instanceof Error ? e.message : "Unknown error";
  return new Failure("deploy_failed", message.slice(0, 500));
}

const UA = { "User-Agent": "gart-updater" };

async function readReleasesApi(apiBase: string, repo: string): Promise<ReleaseInfo[]> {
  const res = await fetch(`${apiBase}/repos/${repo}/releases?per_page=20`, { headers: { Accept: "application/vnd.github+json", ...UA } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const raw = (await res.json()) as { tag_name?: string; name?: string; body?: string; draft?: boolean; prerelease?: boolean; published_at?: string; assets?: { name?: string }[] }[];
  return raw
    .filter((r) => !r.draft && !r.prerelease && VERSION_TAG.test(r.tag_name ?? "") && (r.assets ?? []).some((a) => a.name === "gart-package.json"))
    .map((r) => ({ version: String(r.tag_name).slice(1), title: String(r.name ?? r.tag_name), notes: String(r.body ?? "").slice(0, 4000), publishedAt: String(r.published_at ?? "") }));
}

const decodeEntities = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** The Atom feed has no asset list; a release without a package simply fails at download with a clear message. */
async function readReleasesFeed(base: string, repo: string): Promise<ReleaseInfo[]> {
  const res = await fetch(`${base}/${repo}/releases.atom`, { headers: UA });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const xml = await res.text();
  const out: ReleaseInfo[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const tag = /releases\/tag\/([^"<\s]+)/.exec(entry)?.[1];
    if (!tag || !VERSION_TAG.test(tag)) continue;
    const title = decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? tag);
    const html = decodeEntities(/<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? "");
    const notes = decodeEntities(html.replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
    out.push({ version: tag.slice(1), title, notes, publishedAt: /<updated>([^<]*)<\/updated>/.exec(entry)?.[1] ?? "" });
  }
  return out;
}
