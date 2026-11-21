import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./runner.mjs";
import { adoptLegacyStateDir, readState, runJob, PIPELINES } from "./jobs.mjs";
import { nodeVersionOk, parseJsonFromOutput } from "./util.mjs";

/**
 * Local-only wizard server.
 * Defences: binds to 127.0.0.1, random per-run token, Host allow-list (DNS rebinding),
 * Origin check on writes, JSON body size cap, and a single running job at a time.
 */
export async function startServer({ repoRoot, port = 0, version }) {
  const token = randomBytes(24).toString("hex");
  const uiHtml = readFileSync(join(repoRoot, "installer", "ui", "index.html"), "utf8");
  const wranglerBin = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

  const history = [];
  const clients = new Set();
  let busy = false;

  const emit = (event) => {
    history.push(event);
    if (history.length > 2000) history.shift();
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(data);
  };

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const tokenOk = (given) => {
    if (typeof given !== "string") return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  let boundPort = 0;
  const hostOk = (host) => host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`;

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > 16_384) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          reject(new Error("invalid json"));
        }
      });
      req.on("error", reject);
    });

  async function environment() {
    adoptLegacyStateDir(repoRoot);
    const state = readState(repoRoot);
    const info = {
      node: process.versions.node,
      nodeOk: nodeVersionOk(process.versions.node),
      platform: process.platform,
      depsInstalled: existsSync(wranglerBin),
      state: state
        ? { workerName: state.workerName, d1Name: state.d1Name, url: state.url ?? null, adminCreated: state.adminCreated === true, accountName: state.accountName ?? null, deployedAt: state.deployedAt ?? null }
        : null,
      loggedIn: false,
      accounts: [],
      email: null,
    };
    if (info.depsInstalled) {
      const r = await run(process.execPath, [wranglerBin, "whoami", "--json"], {
        cwd: repoRoot,
        env: { CI: "1", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
      });
      const parsed = r.code === 0 ? parseJsonFromOutput(r.output) : null;
      if (parsed?.loggedIn) {
        info.loggedIn = true;
        info.email = parsed.email ?? null;
        info.accounts = (parsed.accounts ?? []).map((a) => ({ id: a.id, name: a.name }));
      }
    }
    return info;
  }

  const server = createServer(async (req, res) => {
    try {
      if (!hostOk(req.headers.host ?? "")) return json(res, 403, { error: "bad_host" });
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/") {
        if (!tokenOk(url.searchParams.get("t"))) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Open the exact link printed in the terminal (it includes a one-time token).");
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        return res.end(uiHtml.replace("__TOKEN__", token).replace("__VERSION__", version));
      }

      if (!url.pathname.startsWith("/api/")) return json(res, 404, { error: "not_found" });
      if (!tokenOk(req.headers["x-wizard-token"] ?? url.searchParams.get("t"))) return json(res, 401, { error: "unauthorized" });
      if (req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) return json(res, 403, { error: "bad_origin" });
      }

      if (req.method === "GET" && url.pathname === "/api/env") return json(res, 200, await environment());

      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        for (const e of history) res.write(`data: ${JSON.stringify(e)}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/login") {
        if (busy) return json(res, 409, { error: "busy" });
        if (!existsSync(wranglerBin)) return json(res, 400, { error: "deps_missing" });
        busy = true;
        history.length = 0;
        emit({ type: "login", status: "started" });
        void run(process.execPath, [wranglerBin, "login"], {
          cwd: repoRoot,
          env: { WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
          onLine: (line) => emit({ type: "log", line }),
        }).then((r) => {
          busy = false;
          emit({ type: "login", status: r.code === 0 ? "done" : "failed" });
        });
        return json(res, 202, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        const body = await readBody(req);
        const action = typeof body.action === "string" ? body.action : "";
        if (!(action in PIPELINES)) return json(res, 400, { error: "unknown_action" });
        if (busy) return json(res, 409, { error: "busy" });
        const p = body.params && typeof body.params === "object" ? body.params : {};
        const str = (v) => (typeof v === "string" && v.length <= 200 ? v : undefined);
        const params = {
          accountId: str(p.accountId),
          workerName: str(p.workerName),
          d1Name: str(p.d1Name),
          companyName: str(p.companyName),
          primaryColor: str(p.primaryColor),
          adminEmail: str(p.adminEmail),
          adminName: str(p.adminName),
          adminPassword: str(p.adminPassword),
          confirmWorkerName: str(p.confirmWorkerName),
          confirmDatabaseName: str(p.confirmDatabaseName),
        };
        busy = true;
        history.length = 0;
        void runJob({ action, params, repoRoot, emit, version })
          .catch((err) => emit({ type: "failed", step: "internal", message: String(err?.message ?? err), hints: [], tail: [] }))
          .finally(() => {
            busy = false;
          });
        return json(res, 202, { ok: true });
      }

      return json(res, 404, { error: "not_found" });
    } catch (err) {
      return json(res, 400, { error: String(err?.message ?? "bad_request") });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  boundPort = server.address().port;
  return { server, url: `http://127.0.0.1:${boundPort}/?t=${token}`, token, port: boundPort };
}
