import { PrivacySchema } from "@gart/shared";
import { Hono } from "hono";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { writeAudit } from "../repositories/audit";
import { loadPrivacy, purgeOldGames } from "../repositories/retention";
import { readJson } from "./util";

export const privacyRoutes = new Hono<AppEnv>();

/** Public: the privacy page is for players and visitors who have no account. */
privacyRoutes.get("/", async (c) => {
  c.header("Cache-Control", "public, max-age=5");
  return c.json({ privacy: await loadPrivacy(c.env.DB) });
});

privacyRoutes.put("/", requireAuth, requireRole("admin"), async (c) => {
  const body = await readJson(c, PrivacySchema);
  if (!body.ok) return body.res;
  await c.env.DB.prepare(
    `INSERT INTO application_settings (key, value_json, updated_at) VALUES ('privacy', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(JSON.stringify(body.data), new Date().toISOString()).run();
  await writeAudit(c.env.DB, { adminId: c.get("auth").adminId, action: "privacy.updated", entity: "settings", entityId: "privacy" });
  // A shorter period takes effect at once, not at the next daily run.
  await purgeOldGames(c.env.DB, Date.now(), body.data.retentionDays);
  return c.json({ privacy: body.data });
});
