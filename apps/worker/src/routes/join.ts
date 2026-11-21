import { GAME_LIMITS, isValidPin } from "@gart/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/context";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { rateLimitHit } from "../services/rateLimit";
import { ACTIVE_STATUSES } from "./games";

/**
 * Public check used by the join page: does a game with this PIN exist (running, or finished a moment ago)?
 * It answers with the same rule as the WebSocket entry, so the join page can refuse a mistyped code at once instead of
 * opening a screen for a game that is not there. It reveals nothing but yes/no, and is rate-limited per address.
 */
export const joinRoutes = new Hono<AppEnv>();

joinRoutes.get("/:pin", async (c) => {
  const pin = c.req.param("pin");
  if (!isValidPin(pin)) return c.json({ error: "not_found" }, 404);
  const rl = await rateLimitHit(c.env, rlKey.pinLookupIp(c.get("ip")), LIMITS.pinLookupPerIp);
  if (!rl.allowed) { c.header("Retry-After", String(rl.retryAfterSec)); return c.json({ error: "rate_limited" }, 429); }
  const since = new Date(Date.now() - GAME_LIMITS.finishedGraceMs).toISOString();
  const game = await c.env.DB.prepare(
    `SELECT status, quiz_title, quiz_snapshot_json FROM game_sessions
     WHERE pin = ? AND (status IN (${ACTIVE_STATUSES}) OR (status IN ('FINISHED','CANCELLED') AND finished_at > ?)) LIMIT 1`,
  ).bind(pin, since).first<{ status: string; quiz_title: string; quiz_snapshot_json: string }>();
  if (!game) return c.json({ error: "not_found" }, 404);
  // What the join page may show before the player has a nickname: the title, what the quiz is about, and whether it is over.
  let snap: { description?: string; coverImageId?: string | null } = {};
  try { snap = JSON.parse(game.quiz_snapshot_json) as typeof snap; } catch { /* keep the title only */ }
  return c.json({
    ok: true,
    over: game.status === "FINISHED" || game.status === "CANCELLED",
    title: game.quiz_title,
    ...(snap.description ? { description: snap.description } : {}),
    ...(snap.coverImageId ? { coverImageId: snap.coverImageId } : {}),
  });
});
