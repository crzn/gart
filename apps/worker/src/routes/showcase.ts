import { GAME_LIMITS, GUEST_LIMITS, buildGameSnapshot, generatePin, playabilityProblems } from "@gart/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../middleware/context";
import { getQuiz } from "../repositories/quizzes";
import { recordUsage } from "../repositories/usage";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { randomId, randomToken, sha256Hex } from "../security/tokens";
import { signTicket } from "../security/ticket";
import { rateLimitHit } from "../services/rateLimit";
import { ACTIVE_STATUSES } from "./games";
import { readJson } from "./util";

/**
 * The showcase: public list of the quizzes that are ready to play, and games a visitor (no account) can start.
 * A visitor's game is limited to GUEST_LIMITS.maxPlayers. Whoever starts it gets a host secret; only its hash is stored,
 * and it is the only key to control that game. Signed-in administrators do not use these routes.
 */
export const showcaseRoutes = new Hono<AppEnv>();

interface ShowcaseRow {
  id: string; title: string; description: string; category: string; tags_json: string; difficulty: string | null;
  language: string; cover_media_id: string | null; question_count: number;
}

showcaseRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.title, q.description, q.category, q.tags_json, q.difficulty, q.language, q.cover_media_id,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
     FROM quizzes q WHERE q.status = 'active' ORDER BY q.updated_at DESC LIMIT 200`,
  ).all<ShowcaseRow>();
  c.header("Cache-Control", "public, max-age=20");
  return c.json({
    quizzes: results
      .filter((r) => r.question_count > 0)
      .map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        tags: safeTags(r.tags_json),
        difficulty: r.difficulty,
        language: r.language,
        coverMediaId: r.cover_media_id,
        questionCount: r.question_count,
      })),
    guestMaxPlayers: GUEST_LIMITS.maxPlayers,
  });
});

function safeTags(json: string): string[] {
  try { const v = JSON.parse(json) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

const sameText = (a: string, b: string) => a.length === b.length && a === b;

/** Visitor starts a game from the showcase. The reply carries the host secret once; it is never shown again. */
showcaseRoutes.post("/:id/start", async (c) => {
  const limited = await rateLimitHit(c.env, rlKey.guestGameIp(c.get("ip")), LIMITS.guestGamePerIp);
  if (!limited.allowed) { c.header("Retry-After", String(limited.retryAfterSec)); return c.json({ error: "rate_limited" }, 429); }

  const quiz = await getQuiz(c.env.DB, c.req.param("id"));
  if (!quiz) return c.json({ error: "not_found" }, 404);
  if (quiz.status !== "active") return c.json({ error: "quiz_not_active" }, 409);
  if (playabilityProblems(quiz.questions).length) return c.json({ error: "not_playable" }, 409);

  const cutoff = new Date(Date.now() - GAME_LIMITS.idleExpiryMs * 2).toISOString();
  await c.env.DB.prepare(`UPDATE game_sessions SET status = 'CANCELLED', finished_at = ? WHERE status IN (${ACTIVE_STATUSES}) AND created_at < ?`)
    .bind(new Date().toISOString(), cutoff).run();
  const active = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM game_sessions WHERE status IN (${ACTIVE_STATUSES})`).first<{ n: number }>())?.n ?? 0;
  if (active >= GAME_LIMITS.maxActiveGames) return c.json({ error: "too_many_games" }, 409);
  const guests = (await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM game_sessions WHERE guest_token_hash IS NOT NULL AND status IN (${ACTIVE_STATUSES})`,
  ).first<{ n: number }>())?.n ?? 0;
  if (guests >= GUEST_LIMITS.maxConcurrentGames) return c.json({ error: "guest_busy" }, 409);

  const snapshot = buildGameSnapshot(quiz);
  snapshot.settings.maxParticipants = Math.min(snapshot.settings.maxParticipants, GUEST_LIMITS.maxPlayers);
  const hostToken = randomToken(24);
  const tokenHash = await sha256Hex(hostToken);
  const gameId = randomId();
  let pin = "";
  for (let attempt = 0; attempt < 12 && !pin; attempt++) {
    const candidate = generatePin();
    try {
      await c.env.DB.prepare(
        `INSERT INTO game_sessions (id, quiz_id, quiz_title, pin, status, settings_snapshot_json, quiz_snapshot_json, host_admin_id, guest_token_hash)
         VALUES (?, ?, ?, ?, 'LOBBY', ?, ?, NULL, ?)`,
      ).bind(gameId, quiz.id, quiz.title, candidate, JSON.stringify(snapshot.settings), JSON.stringify(snapshot), tokenHash).run();
      pin = candidate;
    } catch {
      // The PIN is in use by another game; try another.
    }
  }
  if (!pin) return c.json({ error: "pin_unavailable" }, 503);

  const init = await c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(pin)).init({ gameId, pin, hostAdminId: "guest", snapshot });
  if (!init.ok) {
    await c.env.DB.prepare("UPDATE game_sessions SET status = 'CANCELLED', finished_at = ? WHERE id = ?").bind(new Date().toISOString(), gameId).run();
    return c.json({ error: init.error }, 409);
  }
  await recordUsage(c.env.DB, { games_started: 1 });
  return c.json({ game: { id: gameId, pin, title: quiz.title, status: "LOBBY" }, hostToken, maxPlayers: GUEST_LIMITS.maxPlayers }, 201);
});

const TicketSchema = z.object({ role: z.enum(["host", "screen"]) });

/** Loads a visitor's game when the secret matches. Anything else looks the same as a missing game. */
async function loadGuestGame(c: { env: AppEnv["Bindings"]; req: { header: (n: string) => string | undefined; param: (n: string) => string } }) {
  const token = c.req.header("x-host-token") ?? "";
  if (token.length < 20 || token.length > 128) return null;
  const row = await c.env.DB.prepare("SELECT id, pin, status, guest_token_hash FROM game_sessions WHERE id = ?")
    .bind(c.req.param("id")).first<{ id: string; pin: string; status: string; guest_token_hash: string | null }>();
  if (!row || !row.guest_token_hash) return null;
  return sameText(row.guest_token_hash, await sha256Hex(token)) ? row : null;
}

showcaseRoutes.post("/games/:id/ticket", async (c) => {
  const body = await readJson(c, TicketSchema);
  if (!body.ok) return body.res;
  const row = await loadGuestGame(c);
  if (!row) return c.json({ error: "forbidden" }, 403);
  if (!["LOBBY", "QUESTION_ACTIVE", "QUESTION_RESULTS", "LEADERBOARD", "FINISHED"].includes(row.status)) return c.json({ error: "game_over" }, 409);
  const ticket = await signTicket(c.env.WS_TICKET_SECRET, { g: row.id, r: body.data.role, a: "guest", e: Date.now() + GAME_LIMITS.ticketTtlMs });
  return c.json({ ticket, pin: row.pin, expiresInSec: GAME_LIMITS.ticketTtlMs / 1000 });
});

showcaseRoutes.post("/games/:id/cancel", async (c) => {
  const row = await loadGuestGame(c);
  if (!row) return c.json({ error: "forbidden" }, 403);
  await c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(row.pin)).cancel();
  // Free the slot in D1 whatever the room answered: a visitor's game must never keep the one visitor place busy.
  await c.env.DB.prepare(`UPDATE game_sessions SET status = 'CANCELLED', finished_at = ? WHERE id = ? AND status IN (${ACTIVE_STATUSES})`)
    .bind(new Date().toISOString(), row.id).run();
  return c.json({ ok: true });
});
