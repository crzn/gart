import { BrandingSchema, DEFAULT_BRANDING } from "@gart/shared";
import { Hono } from "hono";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { writeAudit } from "../repositories/audit";
import { mediaExists } from "../repositories/quizzes";
import { readJson } from "./util";

export async function loadBranding(db: D1Database) {
  const row = await db.prepare("SELECT value_json FROM application_settings WHERE key = 'branding'").first<{ value_json: string }>();
  let stored: unknown = {};
  try { stored = row ? JSON.parse(row.value_json) : {}; } catch { /* fall back to defaults */ }
  const parsed = BrandingSchema.safeParse({ ...DEFAULT_BRANDING, ...(stored as object) });
  return parsed.success ? parsed.data : DEFAULT_BRANDING;
}

export const brandingRoutes = new Hono<AppEnv>();

/** Public: the sign-in page and the player screens need the colours before anyone signs in. */
brandingRoutes.get("/", async (c) => {
  c.header("Cache-Control", "public, max-age=5");
  return c.json({ branding: await loadBranding(c.env.DB) });
});

brandingRoutes.put("/", requireAuth, requireRole("admin"), async (c) => {
  const body = await readJson(c, BrandingSchema);
  if (!body.ok) return body.res;
  if (!(await mediaExists(c.env.DB, [body.data.logoMediaId, body.data.backgroundMediaId]))) return c.json({ error: "unknown_media" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO application_settings (key, value_json, updated_at) VALUES ('branding', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(JSON.stringify(body.data), new Date().toISOString()).run();
  await writeAudit(c.env.DB, { adminId: c.get("auth").adminId, action: "branding.updated", entity: "settings", entityId: "branding" });
  return c.json({ branding: body.data });
});
