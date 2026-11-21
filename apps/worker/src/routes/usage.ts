import {
  DEFAULT_SCENARIO, DEFAULT_THRESHOLDS, LIMITS_VERIFIED_ON, RESOURCES, SAFE_MODE_MAX_PLAYERS, additionalGames, estimateGame,
  projectGame, statusFor, utcDay, validateThresholds, type Amounts, type Projection, type ResourceStatus, type Scenario, type Thresholds,
} from "@gart/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { writeAudit } from "../repositories/audit";
import {
  deleteOfficial, isResourceId, loadThresholds, measuredResources, readMetrics, readOfficial, saveOfficial, saveThresholds, storedBytes,
} from "../repositories/usage";
import { readJson } from "./util";

export const usageRoutes = new Hono<AppEnv>();
usageRoutes.use("*", requireAuth, requireRole("admin"));

const GB = 1024 ** 3;

export function daysBack(n: number, from = new Date()): string {
  return utcDay(new Date(from.getTime() - n * 86_400_000));
}

/** Where today stands, from the application's own counters and any manually entered official figures. */
export async function todayStatus(db: D1Database, t: Thresholds): Promise<{ status: ResourceStatus[]; day: string }> {
  const day = utcDay();
  const [metrics, official, bytes] = await Promise.all([readMetrics(db, day), readOfficial(db, day), storedBytes(db)]);
  const measured = { ...measuredResources(metrics.get(day) ?? {}), "d1.databaseStorageGb": bytes / GB };
  return { status: statusFor(measured, official.get(day) ?? {}, t), day };
}

/** The proposed game as the quota model sees it. */
export function gameScenario(questions: number, players: number): Scenario {
  return { ...DEFAULT_SCENARIO, questions, players, durationMin: Math.max(10, Math.round(questions * 1.2)), reconnects: Math.round(players / 6), answerRate: 1 };
}

export interface GameForecast { perGame: Amounts; projection: Projection; additional: { games: number; resource: string } | null; safeMode: { maxPlayers: number } }

export async function forecastGame(db: D1Database, questions: number, players: number): Promise<GameForecast> {
  const t = await loadThresholds(db);
  const { status } = await todayStatus(db, t);
  const perGame = estimateGame(gameScenario(questions, players));
  return { perGame, projection: projectGame(status, perGame, t), additional: additionalGames(status, perGame), safeMode: { maxPlayers: SAFE_MODE_MAX_PLAYERS } };
}

usageRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const t = await loadThresholds(db);
  const since = daysBack(13);
  const [{ status, day }, metrics, official] = await Promise.all([todayStatus(db, t), readMetrics(db, since), readOfficial(db, since)]);
  const history = [...metrics.entries()].map(([d, m]) => ({ day: d, metrics: m })).sort((a, b) => b.day.localeCompare(a.day));
  const officialRows = [...official.entries()].flatMap(([d, r]) => Object.entries(r).map(([resource, value]) => ({ day: d, resource, value }))).sort((a, b) => b.day.localeCompare(a.day));
  return c.json({
    day, limitsVerifiedOn: LIMITS_VERIFIED_ON, thresholds: t, defaultThresholds: DEFAULT_THRESHOLDS, safeModeMaxPlayers: SAFE_MODE_MAX_PLAYERS,
    resources: RESOURCES, status, history, official: officialRows,
  });
});

usageRoutes.get("/forecast", async (c) => {
  const q = z.object({ questions: z.coerce.number().int().min(1).max(50), players: z.coerce.number().int().min(1).max(120) }).safeParse(c.req.query());
  if (!q.success) return c.json({ error: "invalid_request" }, 400);
  return c.json(await forecastGame(c.env.DB, q.data.questions, q.data.players));
});

const OfficialSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resource: z.string().refine(isResourceId),
  value: z.number().min(0).max(1e12),
  note: z.string().max(200).default(""),
});

usageRoutes.put("/official", async (c) => {
  const body = await readJson(c, OfficialSchema);
  if (!body.ok) return body.res;
  const d = body.data;
  if (Number.isNaN(Date.parse(d.day)) || d.day > utcDay()) return c.json({ error: "invalid_request" }, 400);
  await saveOfficial(c.env.DB, { day: d.day, resource: d.resource as never, value: d.value, note: d.note, adminId: c.get("auth").adminId });
  await writeAudit(c.env.DB, { adminId: c.get("auth").adminId, action: "usage.official", entity: "usage", entityId: d.resource, meta: { day: d.day, value: d.value } });
  return c.json({ ok: true });
});

usageRoutes.delete("/official", async (c) => {
  const q = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), resource: z.string().refine(isResourceId) }).safeParse(c.req.query());
  if (!q.success) return c.json({ error: "invalid_request" }, 400);
  await deleteOfficial(c.env.DB, q.data.day, q.data.resource as never);
  return c.json({ ok: true });
});

usageRoutes.put("/thresholds", async (c) => {
  const body = await readJson(c, z.object({ info: z.number(), warning: z.number(), critical: z.number() }));
  if (!body.ok) return body.res;
  const t = validateThresholds(body.data);
  if (!t) return c.json({ error: "invalid_thresholds" }, 400);
  await saveThresholds(c.env.DB, t);
  await writeAudit(c.env.DB, { adminId: c.get("auth").adminId, action: "usage.thresholds", entity: "usage", meta: { ...t } });
  return c.json({ thresholds: t });
});
