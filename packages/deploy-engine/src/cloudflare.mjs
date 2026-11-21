// Minimal Cloudflare API client. The calls and their shapes follow what wrangler itself sends
// (checked against the wrangler source shipped in this project), so they work for any account.
// `base` is "https://api.cloudflare.com/client/v4" or a same-origin relay such as "/cf".

export class CloudflareError extends Error {
  /** @param {string} message @param {{ status?: number, code?: number, path?: string }} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = "CloudflareError";
    this.status = info.status ?? 0;
    this.code = info.code ?? 0;
    this.path = info.path ?? "";
  }
}

export class CloudflareClient {
  /** @param {{ base: string, token: string, fetchImpl?: typeof fetch }} opts */
  constructor({ base, token, fetchImpl }) {
    this.base = base.replace(/\/+$/, "");
    this.token = token;
    this.fetch = fetchImpl ?? ((...a) => fetch(...a));
  }

  /**
   * @param {string} method @param {string} path
   * @param {{ json?: unknown, form?: FormData, headers?: Record<string, string>, query?: Record<string, string>, bearer?: string }} [opts]
   * @returns {Promise<any>} the "result" field of the API answer
   */
  async call(method, path, opts = {}) {
    const url = new URL(this.base + path, "http://relative.invalid");
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const target = this.base.startsWith("http") ? url.toString() : url.pathname + url.search;
    /** @type {Record<string, string>} */
    const headers = { Authorization: `Bearer ${opts.bearer ?? this.token}`, ...(opts.headers ?? {}) };
    /** @type {BodyInit | undefined} */
    let body;
    if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
    else if (opts.form) body = opts.form;
    let res;
    try {
      res = await this.fetch(target, { method, headers, ...(body !== undefined ? { body } : {}) });
    } catch (e) {
      throw new CloudflareError(`Could not reach Cloudflare (${/** @type {Error} */ (e).message}).`, { path });
    }
    const text = await res.text();
    /** @type {any} */
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !data || data.success === false) {
      const first = data?.errors?.[0];
      throw new CloudflareError(first?.message ?? `Cloudflare answered ${res.status}.`, { status: res.status, code: first?.code ?? 0, path });
    }
    return data.result;
  }

  /* ---------- account ---------- */
  async listAccounts() { return /** @type {{ id: string, name: string }[]} */ (await this.call("GET", "/accounts", { query: { per_page: "50" } })); }
  /** @param {string} accountId */
  async listZones(accountId) { return /** @type {{ id: string, name: string }[]} */ (await this.call("GET", "/zones", { query: { "account.id": accountId, status: "active", per_page: "50" } })); }
  /** @param {string} accountId @returns {Promise<string | null>} workers.dev subdomain or null if none is registered */
  async getWorkersSubdomain(accountId) {
    try { return (await this.call("GET", `/accounts/${accountId}/workers/subdomain`)).subdomain ?? null; }
    catch (e) { if (e instanceof CloudflareError && (e.code === 10007 || e.status === 404)) return null; throw e; }
  }
  /** @param {string} accountId @param {string} name */
  async subdomainAvailable(accountId, name) {
    try { await this.call("GET", `/accounts/${accountId}/workers/subdomains/${name}`); return true; }
    catch (e) { if (e instanceof CloudflareError && e.code === 10031) return false; if (e instanceof CloudflareError && e.code === 10032) return true; throw e; }
  }
  /** @param {string} accountId @param {string} name */
  async registerWorkersSubdomain(accountId, name) { return (await this.call("PUT", `/accounts/${accountId}/workers/subdomain`, { json: { subdomain: name } })).subdomain; }

  /* ---------- D1 ---------- */
  /** @param {string} accountId @param {string} name @returns {Promise<{ uuid: string, name: string } | null>} */
  async findD1(accountId, name) {
    const list = await this.call("GET", `/accounts/${accountId}/d1/database`, { query: { name, per_page: "100" } });
    return list.find((/** @type {{ name: string }} */ d) => d.name === name) ?? null;
  }
  /** @param {string} accountId @param {string} name */
  async createD1(accountId, name) { return /** @type {{ uuid: string, name: string }} */ (await this.call("POST", `/accounts/${accountId}/d1/database`, { json: { name } })); }
  /** @param {string} accountId @param {string} dbId @param {string} sql @param {unknown[]} [params] */
  async d1Query(accountId, dbId, sql, params) {
    const result = await this.call("POST", `/accounts/${accountId}/d1/database/${dbId}/query`, { json: params ? { sql, params } : { sql } });
    return /** @type {{ results?: Record<string, unknown>[], success?: boolean }[]} */ (result);
  }

  /* ---------- Worker ---------- */
  /** @param {string} accountId @param {string} name @returns {Promise<{ migrationTag: string | null } | null>} null if the Worker does not exist */
  async getWorker(accountId, name) {
    try {
      const r = await this.call("GET", `/accounts/${accountId}/workers/services/${name}`);
      return { migrationTag: r?.default_environment?.script?.migration_tag ?? null };
    } catch (e) {
      if (e instanceof CloudflareError && (e.code === 10007 || e.code === 10092 || e.status === 404)) return null;
      throw e;
    }
  }
  /** @param {string} accountId @param {string} name @param {Record<string, unknown>} manifest */
  async assetsUploadSession(accountId, name, manifest) {
    return /** @type {{ jwt: string, buckets?: string[][] }} */ (await this.call("POST", `/accounts/${accountId}/workers/scripts/${name}/assets-upload-session`, { json: { manifest } }));
  }
  /** One bucket: files are base64 text, form field name = file hash. @param {string} accountId @param {string} jwt @param {{ hash: string, base64: string, contentType: string }[]} files */
  async assetsUploadBucket(accountId, jwt, files) {
    const form = new FormData();
    for (const f of files) form.append(f.hash, new File([f.base64], f.hash, { type: f.contentType || "application/null" }), f.hash);
    return /** @type {{ jwt?: string }} */ (await this.call("POST", `/accounts/${accountId}/workers/assets/upload`, { form, query: { base64: "true" }, bearer: jwt }));
  }
  /** @param {string} accountId @param {string} name @param {Record<string, unknown>} metadata @param {string} moduleName @param {Uint8Array} moduleBytes */
  async uploadWorker(accountId, name, metadata, moduleName, moduleBytes) {
    const form = new FormData();
    form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.set(moduleName, new File([/** @type {BlobPart} */ (moduleBytes)], moduleName, { type: "application/javascript+module" }));
    return this.call("PUT", `/accounts/${accountId}/workers/scripts/${name}`, { form, query: { excludeScript: "true", bindings_inherit: "strict" } });
  }
  /** @param {string} accountId @param {string} name */
  async enableWorkersDev(accountId, name) {
    return this.call("POST", `/accounts/${accountId}/workers/scripts/${name}/subdomain`, { json: { enabled: true, previews_enabled: false }, headers: { "Cloudflare-Workers-Script-Api-Date": "2025-08-01" } });
  }
  /** @param {string} accountId @param {string} name @param {string} hostname */
  async attachCustomDomain(accountId, name, hostname) {
    return this.call("PUT", `/accounts/${accountId}/workers/scripts/${name}/domains/records`, { json: { origins: [{ hostname }], override_existing_origin: false, override_existing_dns_record: false } });
  }
  /** The D1 database a Worker is bound to (used by the in-app updater, which is given only the Worker's name).
   * @param {string} accountId @param {string} name @returns {Promise<{ uuid: string, name: string } | null>} */
  async getWorkerDatabase(accountId, name) {
    const settings = await this.call("GET", `/accounts/${accountId}/workers/scripts/${name}/settings`);
    const binding = (settings?.bindings ?? []).find((/** @type {{ type: string }} */ b) => b.type === "d1");
    const id = binding?.id ?? binding?.database_id;
    if (!id) return null;
    const db = await this.call("GET", `/accounts/${accountId}/d1/database/${id}`);
    return { uuid: String(id), name: String(db?.name ?? "") };
  }
  /** Time Travel bookmark of a D1 database (used as a recovery point before an update). @param {string} accountId @param {string} dbId */
  async d1Bookmark(accountId, dbId) {
    return /** @type {{ bookmark: string }} */ (await this.call("GET", `/accounts/${accountId}/d1/database/${dbId}/time_travel/bookmark`));
  }
}
