import { GAME_LIMITS, isValidPin } from "@gart/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/context";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { rateLimitHit } from "../services/rateLimit";
import { ACTIVE_STATUSES } from "./games";

/**
 * Public WebSocket entry: /ws/:pin
 * A room is only reachable for a PIN that an authenticated host registered in D1, so nobody can make the
 * platform create Durable Objects by guessing PINs.
 */
export const wsRoutes = new Hono<AppEnv>();

wsRoutes.get("/:pin", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "websocket_required" }, 426);
  const pin = c.req.param("pin");
  if (!isValidPin(pin)) return c.json({ error: "not_found" }, 404);

  // Browsers always send Origin on WebSocket handshakes. Refusing foreign origins stops other websites
  // from opening connections with a visitor's browser.
  const origin = c.req.header("Origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "bad_origin" }, 403);

  const limited = await rateLimitHit(c.env, rlKey.wsConnectIp(c.get("ip")), LIMITS.wsConnectPerIp);
  if (!limited.allowed) return c.json({ error: "rate_limited" }, 429);

  const since = new Date(Date.now() - GAME_LIMITS.finishedGraceMs).toISOString();
  const game = await c.env.DB.prepare(
    `SELECT id FROM game_sessions
     WHERE pin = ? AND (status IN (${ACTIVE_STATUSES}) OR (status IN ('FINISHED','CANCELLED') AND finished_at > ?))
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(pin, since).first<{ id: string }>();
  if (!game) return c.json({ error: "not_found" }, 404);

  // Build a fresh request so a client can never supply its own x-gart-game header.
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-gart-game", game.id);
  return c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(pin)).fetch(new Request(c.req.raw, { headers }));
});
