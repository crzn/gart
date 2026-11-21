import {
  COEF, DEFAULT_THRESHOLDS, RESOURCES, resourceDef, utcDay, validateThresholds, type ResourceId, type Thresholds,
} from "@gart/shared";

/** Counters the application keeps about itself, per UTC day. Always a lower bound of Cloudflare's own figures. */
export const METRICS = [
  "games_started", "games_finished", "players_joined", "answers", "questions_served",
  "ws_connects", "ws_messages_in", "do_rows_written", "do_rows_read", "d1_rows_written",
  "game_seconds", "uploads", "upload_bytes",
] as const;
export type Metric = (typeof METRICS)[number];
export type MetricDelta = Partial<Record<Metric, number>>;

/** One statement that adds the deltas to today's counters. Used alone or inside a batch. */
export function usageStatement(db: D1Database, delta: MetricDelta, day: string = utcDay()): D1PreparedStatement | null {
  const entries = Object.entries(delta).filter(([, v]) => Number.isFinite(v) && (v as number) > 0) as [Metric, number][];
  if (entries.length === 0) return null;
  const sql = `INSERT INTO usage_metrics (day, metric, value) VALUES ${entries.map(() => "(?, ?, ?)").join(", ")}
               ON CONFLICT (day, metric) DO UPDATE SET value = value + excluded.value`;
  return db.prepare(sql).bind(...entries.flatMap(([m, v]) => [day, m, Math.round(v)]));
}

/** Never lets a counter problem break the action being counted. */
export async function recordUsage(db: D1Database, delta: MetricDelta): Promise<void> {
  try {
    await usageStatement(db, delta)?.run();
  } catch (error) {
    console.error("usage_record_failed", error instanceof Error ? error.message : "unknown");
  }
}

export type DayMetrics = Partial<Record<Metric, number>>;

export async function readMetrics(db: D1Database, fromDay: string): Promise<Map<string, DayMetrics>> {
  const { results } = await db.prepare("SELECT day, metric, value FROM usage_metrics WHERE day >= ? ORDER BY day").bind(fromDay).all<{ day: string; metric: Metric; value: number }>();
  const out = new Map<string, DayMetrics>();
  for (const r of results) out.set(r.day, { ...(out.get(r.day) ?? {}), [r.metric]: r.value });
  return out;
}

/** What the counters say about each resource for one day. Resources the application cannot see are left out. */
export function measuredResources(m: DayMetrics): Partial<Record<ResourceId, number>> {
  const v = (k: Metric) => m[k] ?? 0;
  return {
    "durableObjects.sqlRowsWritten": v("do_rows_written"),
    "durableObjects.sqlRowsRead": v("do_rows_read"),
    "durableObjects.requests": v("ws_connects") + Math.ceil(v("ws_messages_in") / COEF.wsMessageBillingRatio),
    "durableObjects.durationGbSeconds": v("game_seconds") * COEF.doMemoryGb,
    "d1.rowsWritten": v("d1_rows_written"),
    // Every WebSocket upgrade is one Worker request. API calls are not counted one by one: counting would itself spend D1 writes.
    "workers.requests": v("ws_connects") + v("games_started") + v("uploads"),
  };
}

export async function storedBytes(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT
       COALESCE((SELECT SUM(bytes) FROM uploaded_media), 0)
     + COALESCE((SELECT SUM(LENGTH(quiz_snapshot_json) + LENGTH(settings_snapshot_json)) FROM game_sessions), 0)
     + COALESCE((SELECT COUNT(*) FROM game_results), 0) * ?
     + COALESCE((SELECT COUNT(*) FROM game_participants), 0) * ? AS n`,
  ).bind(COEF.d1BytesPerAnswer, COEF.d1BytesPerPlayer).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function readOfficial(db: D1Database, fromDay: string): Promise<Map<string, Partial<Record<ResourceId, number>>>> {
  const { results } = await db.prepare("SELECT day, resource, value FROM usage_official WHERE day >= ?").bind(fromDay).all<{ day: string; resource: ResourceId; value: number }>();
  const out = new Map<string, Partial<Record<ResourceId, number>>>();
  for (const r of results) out.set(r.day, { ...(out.get(r.day) ?? {}), [r.resource]: r.value });
  return out;
}

export async function saveOfficial(db: D1Database, e: { day: string; resource: ResourceId; value: number; note: string; adminId: string }): Promise<void> {
  await db.prepare(
    `INSERT INTO usage_official (day, resource, value, note, entered_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (day, resource) DO UPDATE SET value = excluded.value, note = excluded.note, entered_by = excluded.entered_by, entered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(e.day, e.resource, e.value, e.note, e.adminId).run();
}

export async function deleteOfficial(db: D1Database, day: string, resource: ResourceId): Promise<void> {
  await db.prepare("DELETE FROM usage_official WHERE day = ? AND resource = ?").bind(day, resource).run();
}

export async function loadThresholds(db: D1Database): Promise<Thresholds> {
  const row = await db.prepare("SELECT value_json FROM application_settings WHERE key = 'usage.thresholds'").first<{ value_json: string }>();
  if (!row) return DEFAULT_THRESHOLDS;
  try { return validateThresholds(JSON.parse(row.value_json) as Partial<Thresholds>) ?? DEFAULT_THRESHOLDS; } catch { return DEFAULT_THRESHOLDS; }
}

export async function saveThresholds(db: D1Database, t: Thresholds): Promise<void> {
  await db.prepare(
    `INSERT INTO application_settings (key, value_json) VALUES ('usage.thresholds', ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(JSON.stringify(t)).run();
}

export const dailyResourceIds = RESOURCES.filter((r) => r.period === "day").map((r) => r.id);
export const isResourceId = (s: string): s is ResourceId => RESOURCES.some((r) => r.id === s && r.period !== "unused");
export { resourceDef };
