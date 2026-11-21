// A local stand-in for the parts of the Cloudflare API that the Gart deploy engine uses. For tests only.
// It checks the shape of every request the way the real API does (multipart upload, asset upload session
// with JWTs, Durable Object migration payload, secrets) and runs the migrations on a real SQLite database.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

const TOKEN = "test-token";

export function startFakeCloudflare({ port = 0, subdomain = "acme", bucketSize = 2 } = {}) {
  const state = {
    token: TOKEN,
    subdomain,
    databases: new Map(), // name -> { uuid, name, db }
    workers: new Map(), // name -> { migrationTag, metadata, moduleName, moduleSize, secretNames, assetsOk, workersDev, domain }
    knownAssets: new Set(),
    session: null,
    log: [],
  };
  const err = (res, status, code, message) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ success: false, errors: [{ code, message }], messages: [], result: null })); };
  const ok = (res, result, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ success: true, errors: [], messages: [], result })); };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname.replace(/^\/client\/v4/, "");
      state.log.push(`${req.method} ${path}`);
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const isAssetUpload = /\/workers\/assets\/upload$/.test(path);
      if (isAssetUpload ? bearer !== "upload-jwt" : bearer !== state.token) return err(res, 403, 10000, "Authentication error");

      let m;
      if (req.method === "GET" && path === "/accounts") return ok(res, [{ id: "acc1", name: "Test account" }]);
      if (req.method === "GET" && path === "/zones") return ok(res, [{ id: "zone1", name: "example.com" }]);
      if (req.method === "GET" && path === "/accounts/acc1/workers/subdomain") return state.subdomain ? ok(res, { subdomain: state.subdomain }) : err(res, 404, 10007, "no subdomain");
      if (req.method === "PUT" && path === "/accounts/acc1/workers/subdomain") { const b = JSON.parse(await text(req)); state.subdomain = b.subdomain; return ok(res, { subdomain: b.subdomain }); }
      if ((m = path.match(/^\/accounts\/acc1\/workers\/subdomains\/([^/]+)$/)) && req.method === "GET") return m[1] === "taken" ? err(res, 409, 10031, "taken") : err(res, 404, 10032, "free");

      if (req.method === "GET" && path === "/accounts/acc1/d1/database") { const n = url.searchParams.get("name"); return ok(res, [...state.databases.values()].filter((d) => !n || d.name === n).map(({ uuid, name }) => ({ uuid, name }))); }
      if (req.method === "POST" && path === "/accounts/acc1/d1/database") {
        const { name } = JSON.parse(await text(req));
        const d = { uuid: crypto.randomUUID(), name, db: new DatabaseSync(":memory:") };
        state.databases.set(d.uuid, d); return ok(res, { uuid: d.uuid, name });
      }
      if ((m = path.match(/^\/accounts\/acc1\/d1\/database\/([^/]+)\/query$/)) && req.method === "POST") {
        const d = state.databases.get(m[1]); if (!d) return err(res, 404, 7404, "database not found");
        const { sql } = JSON.parse(await text(req));
        try {
          const isSelect = /^\s*SELECT/i.test(sql);
          if (isSelect) return ok(res, [{ results: d.db.prepare(sql).all(), success: true }]);
          d.db.exec("BEGIN;"); try { d.db.exec(sql); d.db.exec("COMMIT;"); } catch (e) { d.db.exec("ROLLBACK;"); throw e; }
          return ok(res, [{ results: [], success: true }]);
        } catch (e) { return err(res, 400, 7500, `SQL error: ${e.message}`); }
      }
      if ((m = path.match(/^\/accounts\/acc1\/d1\/database\/([^/]+)$/)) && req.method === "GET") {
        const d = state.databases.get(m[1]); if (!d) return err(res, 404, 7404, "database not found");
        return ok(res, { uuid: d.uuid, name: d.name });
      }
      if ((m = path.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)\/settings$/)) && req.method === "GET") {
        const w = state.workers.get(m[1]); if (!w) return err(res, 404, 10007, "no such worker");
        return ok(res, { bindings: w.metadata.bindings.map((b) => (b.type === "secret_text" ? { type: b.type, name: b.name } : b)) });
      }
      if ((m = path.match(/^\/accounts\/acc1\/d1\/database\/([^/]+)\/time_travel\/bookmark$/))) return ok(res, { bookmark: "00000001-00000002-00004e2f-abc" });

      if ((m = path.match(/^\/accounts\/acc1\/workers\/services\/([^/]+)$/)) && req.method === "GET") {
        const w = state.workers.get(m[1]); if (!w) return err(res, 404, 10090, "worker not found");
        return ok(res, { default_environment: { script: { migration_tag: w.migrationTag } } });
      }
      if ((m = path.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)\/assets-upload-session$/)) && req.method === "POST") {
        const { manifest } = JSON.parse(await text(req));
        const hashes = Object.values(manifest).map((v) => v.hash);
        if (!hashes.every((h) => /^[0-9a-f]{32}$/.test(h))) return err(res, 400, 10021, "bad asset hash");
        const need = [...new Set(hashes)].filter((h) => !state.knownAssets.has(h));
        state.session = { manifest, need: new Set(need), hashes };
        if (need.length === 0) return ok(res, { jwt: "completion-jwt", buckets: [] });
        const buckets = []; for (let i = 0; i < need.length; i += bucketSize) buckets.push(need.slice(i, i + bucketSize));
        return ok(res, { jwt: "upload-jwt", buckets });
      }
      if (isAssetUpload && req.method === "POST") {
        if (url.searchParams.get("base64") !== "true") return err(res, 400, 10021, "base64=true required");
        const form = await formData(req);
        for (const [hash, file] of form.entries()) {
          if (!state.session?.need.has(hash)) return err(res, 400, 10021, "unexpected asset");
          const b64 = await file.text();
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return err(res, 400, 10021, "not base64");
          state.session.need.delete(hash); state.knownAssets.add(hash);
        }
        return state.session.need.size === 0 ? ok(res, { jwt: "completion-jwt" }, 201) : ok(res, {}, 202);
      }
      if ((m = path.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)$/)) && req.method === "PUT") {
        if (url.searchParams.get("bindings_inherit") !== "strict") return err(res, 400, 10021, "expected bindings_inherit=strict");
        const form = await formData(req);
        const meta = JSON.parse(await form.get("metadata").text());
        const mod = form.get(meta.main_module); if (!mod) return err(res, 400, 10021, "main module part missing");
        if (meta.assets?.jwt !== "completion-jwt") return err(res, 400, 10021, "assets must be completed before upload");
        const prev = state.workers.get(m[1]);
        const db = [...state.databases.values()].find((d) => d.uuid === meta.bindings.find((b) => b.type === "d1")?.id);
        if (!db) return err(res, 400, 10021, "d1 binding points to an unknown database");
        for (const b of meta.bindings) if (!["d1", "assets", "durable_object_namespace", "secret_text", "plain_text"].includes(b.type)) return err(res, 400, 10021, `bad binding type ${b.type}`);
        const secretNames = meta.bindings.filter((b) => b.type === "secret_text").map((b) => b.name);
        if (!prev && !(secretNames.includes("SESSION_SECRET") && secretNames.includes("WS_TICKET_SECRET"))) return err(res, 400, 10021, "a new Worker needs its secrets");
        if (prev && !meta.keep_bindings?.includes("secret_text")) return err(res, 400, 10021, "an update must keep existing secrets");
        if (prev && secretNames.length) return err(res, 400, 10021, "an update must not resend secrets");
        let tag = prev?.migrationTag ?? null;
        if (meta.migrations) {
          if ((meta.migrations.old_tag ?? null) !== tag) return err(res, 400, 10074, "migration old_tag does not match");
          if (!Array.isArray(meta.migrations.steps) || !meta.migrations.new_tag) return err(res, 400, 10074, "bad migrations payload");
          tag = meta.migrations.new_tag;
        } else if (!prev) return err(res, 400, 10074, "a new Worker with Durable Objects needs migrations");
        state.workers.set(m[1], { migrationTag: tag, metadata: meta, moduleName: meta.main_module, moduleSize: mod.size, secretNames: prev ? prev.secretNames : secretNames, workersDev: prev?.workersDev ?? false, domain: prev?.domain ?? null });
        return ok(res, { id: m[1] });
      }
      if ((m = path.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)\/subdomain$/)) && req.method === "POST") {
        const w = state.workers.get(m[1]); if (!w) return err(res, 404, 10007, "no such worker"); w.workersDev = true; return ok(res, { enabled: true });
      }
      if ((m = path.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)\/domains\/records$/)) && req.method === "PUT") {
        const w = state.workers.get(m[1]); if (!w) return err(res, 404, 10007, "no such worker");
        const b = JSON.parse(await text(req)); if (!b.origins?.[0]?.hostname) return err(res, 400, 10021, "hostname missing"); w.domain = b.origins[0].hostname; return ok(res, {});
      }
      return err(res, 404, 7000, `No route for ${req.method} ${path}`);
    } catch (e) { return err(res, 500, 9999, e.message); }
  });
  const text = (req) => new Promise((resolve, reject) => { let s = ""; req.setEncoding("utf8"); req.on("data", (c) => (s += c)); req.on("end", () => resolve(s)); req.on("error", reject); });
  const formData = async (req) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    return new Request("http://x/", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "" }, body: Buffer.concat(chunks) }).formData();
  };
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/client/v4`, port: server.address().port, state, token: TOKEN,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  })));
}
