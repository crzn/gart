// The deploy engine: installs Gart into a Cloudflare account, or updates an installed copy, from a verified package.
// Every step is safe to repeat. Nothing here prints secrets.
import { brandingSql, isHexColor, sanitizeCompanyName } from "./branding.mjs";
import { base64ToBytes, blobBytes, compareVersions } from "./package-format.mjs";

/**
 * @typedef {import("./package-format.mjs").GartPackage} Pkg
 * @typedef {import("./package-format.mjs").Manifest} Man
 * @typedef {import("./cloudflare.mjs").CloudflareClient} Client
 * @typedef {{ step: string, status: "running" | "done" | "skipped" | "failed", detail?: string }} Progress
 */

export const STEPS = ["database", "migrations", "assets", "worker", "address", "domain", "branding"];

export class DeployError extends Error {
  /** @param {string} message @param {string} step */
  constructor(message, step) { super(message); this.name = "DeployError"; this.step = step; }
}

/** @param {number} n */
function randomHex(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Wrangler's own check: SQL file plus a bookkeeping insert, sent together. @param {string} name @param {string} sql */
export function migrationScript(name, sql) {
  return `${sql}\nINSERT INTO "d1_migrations" (name)\nvalues ('${name.replace(/'/g, "''")}');`;
}
const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "d1_migrations"(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;

/** Durable Object migration payload for the upload, from the tag already on the Worker (null = new Worker).
 * @param {Man["durableObjects"]["migrations"]} all @param {string | null} currentTag */
export function durableObjectMigrations(all, currentTag) {
  if (all.length === 0) return undefined;
  const last = all[all.length - 1];
  if (!last) return undefined;
  if (!currentTag) return { new_tag: last.tag, steps: all.map(({ tag: _t, ...rest }) => rest) };
  const idx = all.findIndex((m) => m.tag === currentTag);
  if (idx === -1) return { old_tag: currentTag, new_tag: last.tag, steps: all.map(({ tag: _t, ...rest }) => rest) };
  if (idx === all.length - 1) return undefined;
  return { old_tag: currentTag, new_tag: last.tag, steps: all.slice(idx + 1).map(({ tag: _t, ...rest }) => rest) };
}

/** Worker bindings for the upload. @param {Man} m @param {string} dbId @param {Record<string, string> | null} secrets null on update (existing ones are kept) */
export function workerBindings(m, dbId, secrets) {
  /** @type {Record<string, unknown>[]} */
  const b = [
    { type: "d1", name: m.d1.binding, id: dbId },
    { type: "assets", name: "ASSETS" },
    ...m.durableObjects.bindings.map((d) => ({ type: "durable_object_namespace", name: d.name, class_name: d.class_name })),
  ];
  for (const [name, text] of Object.entries(secrets ?? {})) b.push({ type: name === "KDF_ITERATIONS" ? "plain_text" : "secret_text", name, text });
  return b;
}

/**
 * Installs (or updates) Gart.
 * @param {{
 *   client: Client, accountId: string, pkg: Pkg, manifest: Man, workerName: string, databaseName: string,
 *   mode: "install" | "update", hostname?: string | null, kdfIterations?: number, companyName?: string, primaryColor?: string,
 *   onProgress?: (p: Progress) => void,
 * }} o
 * @returns {Promise<{ workerName: string, databaseId: string, version: string, setupToken: string | null, migrationsApplied: string[], bookmark: string | null }>}
 */
export async function deploy(o) {
  const { client, accountId, pkg, manifest, workerName, databaseName, mode } = o;
  const emit = o.onProgress ?? (() => {});
  /** @template T @param {string} step @param {() => Promise<T>} fn @returns {Promise<T>} */
  const run = async (step, fn) => {
    emit({ step, status: "running" });
    try { const r = await fn(); emit({ step, status: "done" }); return r; }
    catch (e) { emit({ step, status: "failed", detail: /** @type {Error} */ (e).message }); throw e instanceof DeployError ? e : new DeployError(/** @type {Error} */ (e).message, step); }
  };

  // The Worker may already exist: that decides install or update behaviour for secrets and Durable Object migrations.
  const existing = await client.getWorker(accountId, workerName);
  if (mode === "install" && existing) throw new DeployError(`A Worker named "${workerName}" already exists in this account. Choose another name, or use the update function.`, "database");
  if (mode === "update" && !existing) throw new DeployError(`There is no Worker named "${workerName}" to update.`, "database");

  if (mode === "install" && o.companyName && sanitizeCompanyName(o.companyName) === null) throw new DeployError("The company name contains unsupported characters or is too long.", "database");
  if (mode === "install" && o.primaryColor && !isHexColor(o.primaryColor)) throw new DeployError("The primary colour must look like #4f46e5.", "database");

  const db = await run("database", async () => (await client.findD1(accountId, databaseName)) ?? client.createD1(accountId, databaseName));
  if (mode === "update" && !db) throw new DeployError("Database not found.", "database");

  /** @type {string | null} */
  let bookmark = null;
  if (mode === "update") { try { bookmark = (await client.d1Bookmark(accountId, db.uuid)).bookmark; } catch { bookmark = null; } }

  const applied = await run("migrations", async () => {
    await client.d1Query(accountId, db.uuid, MIGRATIONS_TABLE);
    const rows = (await client.d1Query(accountId, db.uuid, 'SELECT name FROM "d1_migrations" ORDER BY id'))[0]?.results ?? [];
    const done = new Set(rows.map((r) => String(r.name)));
    /** @type {string[]} */
    const now = [];
    for (const m of manifest.migrations) {
      if (done.has(m.name)) continue;
      const sql = new TextDecoder().decode(blobBytes(pkg, m.sha256));
      await client.d1Query(accountId, db.uuid, migrationScript(m.name, sql));
      now.push(m.name);
    }
    return now;
  });

  const jwt = await run("assets", async () => {
    /** @type {Record<string, { hash: string, size: number }>} */
    const assetManifest = {};
    for (const a of manifest.assets) assetManifest[a.path] = { hash: a.cfHash, size: a.size };
    const session = await client.assetsUploadSession(accountId, workerName, assetManifest);
    const buckets = session.buckets ?? [];
    if (buckets.length === 0) return session.jwt;
    const byHash = new Map(manifest.assets.map((a) => [a.cfHash, a]));
    /** @type {string | undefined} */
    let completion;
    for (const bucket of buckets) {
      const files = bucket.map((h) => {
        const a = byHash.get(h);
        if (!a) throw new DeployError("Cloudflare asked for a file that is not in the package.", "assets");
        return { hash: h, base64: pkg.blobs[a.sha256] ?? "", contentType: a.contentType };
      });
      const r = await client.assetsUploadBucket(accountId, session.jwt, files);
      if (r?.jwt) completion = r.jwt;
    }
    if (!completion) throw new DeployError("Cloudflare did not confirm the file upload.", "assets");
    return completion;
  });

  /** @type {Record<string, string> | null} */
  let secrets = null;
  /** @type {string | null} */
  let setupToken = null;
  if (mode === "install") {
    setupToken = randomHex(24);
    secrets = { SESSION_SECRET: randomHex(32), WS_TICKET_SECRET: randomHex(32), SETUP_TOKEN: setupToken, KDF_ITERATIONS: String(o.kdfIterations ?? 60000) };
  }

  if (mode === "install" && (o.companyName || o.primaryColor)) {
    await run("branding", async () => { await client.d1Query(accountId, db.uuid, brandingSql(o.companyName ?? "", o.primaryColor || "#4f46e5")); });
  } else emit({ step: "branding", status: "skipped" });

  await run("worker", async () => {
    const migrations = durableObjectMigrations(manifest.durableObjects.migrations, existing?.migrationTag ?? null);
    const metadata = {
      main_module: manifest.mainModule,
      compatibility_date: manifest.compatibilityDate,
      bindings: workerBindings(manifest, db.uuid, secrets),
      ...(migrations ? { migrations } : {}),
      ...(mode === "update" ? { keep_bindings: ["secret_text", "secret_key", "plain_text", "json"] } : {}),
      assets: { jwt, config: { not_found_handling: manifest.assetsConfig.not_found_handling, run_worker_first: manifest.assetsConfig.run_worker_first } },
      observability: { enabled: true },
    };
    await client.uploadWorker(accountId, workerName, metadata, manifest.mainModule, blobBytes(pkg, manifest.worker.sha256));
  });

  // An update never touches the address settings: the administrator may have turned workers.dev off on purpose.
  if (mode === "install") await run("address", async () => { await client.enableWorkersDev(accountId, workerName); });
  else emit({ step: "address", status: "skipped" });
  if (o.hostname) await run("domain", async () => { await client.attachCustomDomain(accountId, workerName, o.hostname ?? ""); });
  else emit({ step: "domain", status: "skipped" });

  return { workerName, databaseId: db.uuid, version: manifest.version, setupToken, migrationsApplied: applied, bookmark };
}

/** Public address of a Worker on workers.dev. @param {string} worker @param {string} subdomain */
export const workersDevUrl = (worker, subdomain) => `https://${worker}.${subdomain}.workers.dev`;

/** True if `candidate` is a newer version than `current`. @param {string} current @param {string} candidate */
export const isNewer = (current, candidate) => compareVersions(current, candidate) < 0;

export { base64ToBytes };
