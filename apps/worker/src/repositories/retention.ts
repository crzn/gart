import { DEFAULT_PRIVACY, PrivacySchema, type Privacy } from "@gart/shared";

export async function loadPrivacy(db: D1Database): Promise<Privacy> {
  const row = await db.prepare("SELECT value_json FROM application_settings WHERE key = 'privacy'").first<{ value_json: string }>();
  let stored: unknown = {};
  try { stored = row ? JSON.parse(row.value_json) : {}; } catch { /* defaults */ }
  const parsed = PrivacySchema.safeParse({ ...DEFAULT_PRIVACY, ...(stored as object) });
  return parsed.success ? parsed.data : DEFAULT_PRIVACY;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes finished or cancelled games (and, by cascade, their players and answers) older than the retention period. */
export async function purgeOldGames(db: D1Database, nowMs: number, retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return;
  const cutoff = new Date(nowMs - retentionDays * DAY_MS).toISOString();
  await db.prepare("DELETE FROM game_sessions WHERE status IN ('FINISHED', 'CANCELLED') AND COALESCE(finished_at, created_at) < ?").bind(cutoff).run();
}

/** Runs the purge at most once a day, piggybacking on a sign-in or a new game (no scheduled trigger is needed). Never throws. */
export async function maybePurge(db: D1Database, nowMs: number): Promise<void> {
  try {
    const marker = await db.prepare("SELECT value_json FROM application_settings WHERE key = 'last_purge'").first<{ value_json: string }>();
    const last = marker ? Number((JSON.parse(marker.value_json) as { at?: number }).at ?? 0) : 0;
    if (nowMs - last < DAY_MS) return;
    await db.prepare(
      `INSERT INTO application_settings (key, value_json, updated_at) VALUES ('last_purge', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify({ at: nowMs }), new Date(nowMs).toISOString()).run();
    await purgeOldGames(db, nowMs, (await loadPrivacy(db)).retentionDays);
  } catch { /* the purge is housekeeping: it must never block a sign-in */ }
}
