/** Session lifetime rules. Pure so they can be tested without a clock or a database. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000; // sliding idle timeout
export const SESSION_ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000; // hard cap regardless of activity
/** Activity is written back at most this often, to save D1 rows written (Free plan: 100k/day). */
export const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export interface SessionTimes {
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export function newSessionTimes(now: number): SessionTimes {
  return { createdAt: now, lastSeenAt: now, expiresAt: Math.min(now + SESSION_IDLE_MS, now + SESSION_ABSOLUTE_MS) };
}

export function isSessionValid(t: SessionTimes, now: number): boolean {
  return now < t.expiresAt && now < t.createdAt + SESSION_ABSOLUTE_MS;
}

/** Returns the new times if a write-back is due, otherwise null. */
export function touchSession(t: SessionTimes, now: number): SessionTimes | null {
  if (now - t.lastSeenAt < SESSION_TOUCH_INTERVAL_MS) return null;
  return { ...t, lastSeenAt: now, expiresAt: Math.min(now + SESSION_IDLE_MS, t.createdAt + SESSION_ABSOLUTE_MS) };
}
