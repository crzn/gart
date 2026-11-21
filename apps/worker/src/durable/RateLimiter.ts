import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { decide } from "../security/rateLimitPolicy";

export interface HitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/**
 * Fixed-window rate limiter backed by Durable Object SQLite. One global instance serves all keys.
 * Every hit is one row written, which is acceptable for login-rate traffic and avoids D1 writes on
 * the hot path (Free plan: 100k rows written per day).
 */
export class RateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS windows (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)",
      );
      this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_windows_start ON windows (window_start)");
    });
  }

  hit(key: string, limit: number, windowSec: number): HitResult {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<{ count: number; window_start: number }>("SELECT count, window_start FROM windows WHERE key = ?", key)
      .toArray()[0];
    const result = decide(row ? { count: row.count, windowStart: row.window_start } : undefined, now, { limit, windowSec });
    sql.exec(
      "INSERT INTO windows (key, count, window_start) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start",
      key,
      result.count,
      result.windowStart,
    );
    // Drop windows that ended more than a day ago so the table cannot grow without bound.
    sql.exec("DELETE FROM windows WHERE window_start < ?", now - 24 * 60 * 60 * 1000);
    return { allowed: result.allowed, retryAfterSec: result.retryAfterSec };
  }

  reset(key: string): void {
    this.ctx.storage.sql.exec("DELETE FROM windows WHERE key = ?", key);
  }
}
