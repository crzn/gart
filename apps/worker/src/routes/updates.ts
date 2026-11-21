import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { writeAudit } from "../repositories/audit";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { limited, readJson } from "./util";

/** In-app updates. Only the owner: the stored Cloudflare token can replace the whole application. */
export const updateRoutes = new Hono<AppEnv>();
updateRoutes.use("*", requireAuth, requireRole("owner"));

const stub = (c: { env: AppEnv["Bindings"] }) => c.env.UPDATER.get(c.env.UPDATER.idFromName("main"));
const STATUS: Record<string, number> = { not_connected: 409, already_running: 409, same_version: 400, unknown_version: 404, github_unavailable: 502 };

updateRoutes.get("/", async (c) => c.json(await stub(c).view()));

updateRoutes.post("/check", async (c) => {
  const rl = await limited(c, rlKey.updates(c.get("auth").adminId), LIMITS.updatesPerAdmin);
  if (rl) return rl;
  const r = await stub(c).check(true);
  return r.ok ? c.json(await stub(c).view()) : c.json({ error: r.code }, 502);
});

const connectSchema = z.object({
  token: z.string().trim().min(20).max(200).regex(/^\S+$/),
  workerName: z.string().trim().regex(/^[A-Za-z0-9_-]{1,63}$/),
});
updateRoutes.post("/connect", async (c) => {
  const auth = c.get("auth");
  const rl = await limited(c, rlKey.updateConnect(auth.adminId), LIMITS.updateConnectPerAdmin);
  if (rl) return rl;
  const body = await readJson(c, connectSchema);
  if (!body.ok) return body.res;
  const r = await stub(c).saveConnection(body.data.token, body.data.workerName);
  if (!r.ok) return c.json({ error: r.code }, r.code === "cloudflare_unreachable" ? 502 : 400);
  await writeAudit(c.env.DB, { adminId: auth.adminId, action: "updates.connect", entity: "worker", entityId: body.data.workerName });
  return c.json(await stub(c).view());
});

updateRoutes.delete("/connection", async (c) => {
  await stub(c).disconnect();
  await writeAudit(c.env.DB, { adminId: c.get("auth").adminId, action: "updates.disconnect" });
  return c.json(await stub(c).view());
});

const startSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), acknowledge: z.boolean().optional() });
updateRoutes.post("/start", async (c) => {
  const auth = c.get("auth");
  const rl = await limited(c, rlKey.updates(auth.adminId), LIMITS.updatesPerAdmin);
  if (rl) return rl;
  const body = await readJson(c, startSchema);
  if (!body.ok) return body.res;
  const r = await stub(c).start(body.data.version, body.data.acknowledge === true);
  if (!r.ok) return c.json({ error: r.code }, (STATUS[r.code] ?? 400) as 400);
  await writeAudit(c.env.DB, { adminId: auth.adminId, action: "updates.start", entity: "version", entityId: body.data.version });
  return c.json(await stub(c).view());
});
