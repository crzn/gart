import type { Context } from "hono";
import type { ZodType } from "zod";
import type { AppEnv } from "../middleware/context";
import { rateLimitHit } from "../services/rateLimit";
import type { Limit } from "../security/rateLimitPolicy";

/** Parses and validates a JSON body. Returns a Response on failure so callers can `return` it. */
export async function readJson<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: c.json({ error: "invalid_json" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: c.json({ error: "invalid_request" }, 400) };
  return { ok: true, data: parsed.data };
}

/** Applies a rate limit; returns a 429 Response when exceeded, otherwise null. */
export async function limited(c: Context<AppEnv>, key: string, limit: Limit): Promise<Response | null> {
  const r = await rateLimitHit(c.env, key, limit);
  if (r.allowed) return null;
  c.header("Retry-After", String(r.retryAfterSec));
  return c.json({ error: "rate_limited", retryAfterSec: r.retryAfterSec }, 429);
}

export function userAgentOf(c: Context<AppEnv>): string | null {
  const ua = c.req.header("user-agent");
  return ua ? ua.slice(0, 200) : null;
}
