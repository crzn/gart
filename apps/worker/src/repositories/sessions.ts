import type { Role, SessionView } from "@gart/shared";
import type { SessionTimes } from "../security/sessionTimes";

const iso = (ms: number) => new Date(ms).toISOString();

export interface SessionWithAdmin {
  sessionId: string;
  times: SessionTimes;
  adminId: string;
  email: string;
  displayName: string;
  role: Role;
  disabled: boolean;
}

export async function createSession(
  db: D1Database,
  s: { id: string; adminId: string; tokenHash: string; times: SessionTimes; ipHash: string | null; userAgent: string | null },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at, last_seen_at, ip_hash, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(s.id, s.adminId, s.tokenHash, iso(s.times.expiresAt), iso(s.times.lastSeenAt), s.ipHash, s.userAgent, iso(s.times.createdAt))
    .run();
}

export async function findSessionByTokenHash(db: D1Database, tokenHash: string): Promise<SessionWithAdmin | null> {
  const row = await db
    .prepare(
      "SELECT s.id AS sid, s.expires_at, s.last_seen_at, s.created_at, a.id AS aid, a.email, a.display_name, a.role, a.disabled " +
        "FROM admin_sessions s JOIN administrators a ON a.id = s.admin_id WHERE s.token_hash = ?",
    )
    .bind(tokenHash)
    .first<{ sid: string; expires_at: string; last_seen_at: string; created_at: string; aid: string; email: string; display_name: string; role: Role; disabled: number }>();
  if (!row) return null;
  return {
    sessionId: row.sid,
    times: { createdAt: Date.parse(row.created_at), lastSeenAt: Date.parse(row.last_seen_at), expiresAt: Date.parse(row.expires_at) },
    adminId: row.aid,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    disabled: row.disabled === 1,
  };
}

export async function touchSessionRow(db: D1Database, sessionId: string, times: SessionTimes): Promise<void> {
  await db
    .prepare("UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
    .bind(iso(times.lastSeenAt), iso(times.expiresAt), sessionId)
    .run();
}

export async function deleteSessionById(db: D1Database, sessionId: string, adminId?: string): Promise<boolean> {
  const res = adminId
    ? await db.prepare("DELETE FROM admin_sessions WHERE id = ? AND admin_id = ?").bind(sessionId, adminId).run()
    : await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(sessionId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Revokes every session of an administrator, optionally keeping one (the caller's own). */
export async function deleteSessionsForAdmin(db: D1Database, adminId: string, keepSessionId?: string): Promise<void> {
  if (keepSessionId) {
    await db.prepare("DELETE FROM admin_sessions WHERE admin_id = ? AND id <> ?").bind(adminId, keepSessionId).run();
  } else {
    await db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").bind(adminId).run();
  }
}

export async function deleteExpiredSessions(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(iso(nowMs)).run();
}

export async function listSessions(db: D1Database, adminId: string, currentSessionId: string): Promise<SessionView[]> {
  const res = await db
    .prepare("SELECT id, created_at, last_seen_at, expires_at, user_agent FROM admin_sessions WHERE admin_id = ? ORDER BY created_at DESC")
    .bind(adminId)
    .all<{ id: string; created_at: string; last_seen_at: string; expires_at: string; user_agent: string | null }>();
  return res.results.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    userAgent: r.user_agent,
    current: r.id === currentSessionId,
  }));
}
