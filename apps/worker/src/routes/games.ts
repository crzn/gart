import { GAME_LIMITS, SAFE_MODE_MAX_PLAYERS, buildGameSnapshot, generatePin, playabilityProblems, roleAtLeast } from "@gart/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { writeAudit } from "../repositories/audit";
import { getQuiz } from "../repositories/quizzes";
import { recordUsage } from "../repositories/usage";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { randomId } from "../security/tokens";
import { signTicket } from "../security/ticket";
import { rateLimitHit } from "../services/rateLimit";
import { forecastGame } from "./usage";
import { readJson } from "./util";

export const ACTIVE_STATUSES = "'CREATED','LOBBY','QUESTION_ACTIVE','QUESTION_RESULTS','LEADERBOARD'";

interface SessionRow {
  id: string; quiz_id: string | null; quiz_title: string; pin: string; status: string; host_admin_id: string | null;
  started_at: string | null; finished_at: string | null; created_at: string;
}

const view = (r: SessionRow, participants?: number) => ({
  id: r.id, quizId: r.quiz_id, title: r.quiz_title, pin: r.pin, status: r.status, hostAdminId: r.host_admin_id,
  startedAt: r.started_at, finishedAt: r.finished_at, createdAt: r.created_at, ...(participants === undefined ? {} : { participants }),
});

export const gameRoutes = new Hono<AppEnv>();
gameRoutes.use("*", requireAuth);

const CreateGameSchema = z.object({
  quizId: z.string().min(1).max(64),
  /** Reduced game for a day when a quota is close: fewer players, no optional extras. */
  safeMode: z.boolean().default(false),
  /** The administrator saw the quota warning and wants to go ahead. */
  acknowledgeQuota: z.boolean().default(false),
});
const TicketSchema = z.object({ role: z.enum(["host", "screen"]) });

async function loadControlled(c: { env: AppEnv["Bindings"]; get: (k: "auth") => AppEnv["Variables"]["auth"] }, id: string) {
  const row = await c.env.DB.prepare("SELECT * FROM game_sessions WHERE id = ?").bind(id).first<SessionRow>();
  if (!row) return { error: "not_found" as const, status: 404 as const };
  const auth = c.get("auth");
  // The administrator who started a game controls it; administrators and owners can control any game.
  if (row.host_admin_id !== auth.adminId && !roleAtLeast(auth.role, "admin")) return { error: "forbidden" as const, status: 403 as const };
  return { row };
}

gameRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = await readJson(c, CreateGameSchema);
  if (!body.ok) return body.res;
  const limited = await rateLimitHit(c.env, rlKey.gameCreate(auth.adminId), LIMITS.gameCreatePerAdmin);
  if (!limited.allowed) return c.json({ error: "rate_limited" }, 429);

  const quiz = await getQuiz(c.env.DB, body.data.quizId);
  if (!quiz) return c.json({ error: "not_found" }, 404);
  if (quiz.status !== "active") return c.json({ error: "quiz_not_active" }, 409);
  const problems = playabilityProblems(quiz.questions);
  if (problems.length) return c.json({ error: "not_playable", problems }, 409);

  // Free abandoned PINs first: a game nobody touched for a long time is cancelled.
  const cutoff = new Date(Date.now() - GAME_LIMITS.idleExpiryMs * 2).toISOString();
  await c.env.DB.prepare(`UPDATE game_sessions SET status = 'CANCELLED', finished_at = ? WHERE status IN (${ACTIVE_STATUSES}) AND created_at < ?`)
    .bind(new Date().toISOString(), cutoff).run();
  const active = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM game_sessions WHERE status IN (${ACTIVE_STATUSES})`).first<{ n: number }>())?.n ?? 0;
  if (active >= GAME_LIMITS.maxActiveGames) return c.json({ error: "too_many_games" }, 409);

  const snapshot = buildGameSnapshot(quiz);
  if (body.data.safeMode) {
    snapshot.settings.maxParticipants = Math.min(snapshot.settings.maxParticipants, SAFE_MODE_MAX_PLAYERS);
  }
  // Warn before the game starts; never refuse outright, and never switch anything paid on.
  const forecast = await forecastGame(c.env.DB, quiz.questions.length, snapshot.settings.maxParticipants);
  if (forecast.projection.concerns.length > 0 && !body.data.acknowledgeQuota) return c.json({ error: "quota_risk", forecast }, 409);
  const gameId = randomId();
  let pin = "";
  for (let attempt = 0; attempt < 12 && !pin; attempt++) {
    const candidate = generatePin();
    try {
      await c.env.DB.prepare(
        `INSERT INTO game_sessions (id, quiz_id, quiz_title, pin, status, settings_snapshot_json, quiz_snapshot_json, host_admin_id)
         VALUES (?, ?, ?, ?, 'LOBBY', ?, ?, ?)`,
      ).bind(gameId, quiz.id, quiz.title, candidate, JSON.stringify(snapshot.settings), JSON.stringify(snapshot), auth.adminId).run();
      pin = candidate;
    } catch {
      // The partial unique index rejected a PIN that is already in use; try another.
    }
  }
  if (!pin) return c.json({ error: "pin_unavailable" }, 503);

  const init = await c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(pin)).init({ gameId, pin, hostAdminId: auth.adminId, snapshot });
  if (!init.ok) {
    await c.env.DB.prepare("UPDATE game_sessions SET status = 'CANCELLED', finished_at = ? WHERE id = ?").bind(new Date().toISOString(), gameId).run();
    return c.json({ error: init.error }, 409);
  }
  await writeAudit(c.env.DB, { adminId: auth.adminId, action: "game.created", entity: "game", entityId: gameId, meta: { quizId: quiz.id, safeMode: body.data.safeMode, quotaLevel: forecast.projection.level } });
  await recordUsage(c.env.DB, { games_started: 1 });
  return c.json({ game: { id: gameId, pin, title: quiz.title, status: "LOBBY" } }, 201);
});

gameRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM game_participants p WHERE p.game_id = s.id) AS participants
     FROM game_sessions s ORDER BY s.created_at DESC LIMIT 30`,
  ).all<SessionRow & { participants: number }>();
  return c.json({ games: results.map((r) => view(r, r.participants)) });
});

gameRoutes.get("/:id", async (c) => {
  const r = await loadControlled(c, c.req.param("id"));
  return "row" in r ? c.json({ game: view(r.row) }) : c.json({ error: r.error }, r.status);
});

gameRoutes.post("/:id/ticket", async (c) => {
  const auth = c.get("auth");
  const body = await readJson(c, TicketSchema);
  if (!body.ok) return body.res;
  const r = await loadControlled(c, c.req.param("id"));
  if (!("row" in r)) return c.json({ error: r.error }, r.status);
  if (!["LOBBY", "QUESTION_ACTIVE", "QUESTION_RESULTS", "LEADERBOARD", "FINISHED"].includes(r.row.status)) return c.json({ error: "game_over" }, 409);
  const ticket = await signTicket(c.env.WS_TICKET_SECRET, { g: r.row.id, r: body.data.role, a: auth.adminId, e: Date.now() + GAME_LIMITS.ticketTtlMs });
  return c.json({ ticket, pin: r.row.pin, expiresInSec: GAME_LIMITS.ticketTtlMs / 1000 });
});

gameRoutes.post("/:id/cancel", async (c) => {
  const auth = c.get("auth");
  const r = await loadControlled(c, c.req.param("id"));
  if (!("row" in r)) return c.json({ error: r.error }, r.status);
  const result = await c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(r.row.pin)).cancel();
  if (!result.ok) {
    // The room is already gone or finished; make sure the PIN is released in D1 anyway.
    await c.env.DB.prepare(`UPDATE game_sessions SET status = 'CANCELLED', finished_at = ? WHERE id = ? AND status IN (${ACTIVE_STATUSES})`)
      .bind(new Date().toISOString(), r.row.id).run();
  }
  await writeAudit(c.env.DB, { adminId: auth.adminId, action: "game.cancelled", entity: "game", entityId: r.row.id });
  return c.json({ ok: true });
});

gameRoutes.get("/:id/results", async (c) => {
  const r = await loadControlled(c, c.req.param("id"));
  if (!("row" in r)) return c.json({ error: r.error }, r.status);
  const [people, answers] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, nickname, avatar, final_rank, total_points, correct_count FROM game_participants WHERE game_id = ? ORDER BY final_rank, nickname").bind(r.row.id),
    c.env.DB.prepare("SELECT question_position AS q, COUNT(*) AS answered, SUM(is_correct) AS correct, AVG(answer_ms) AS avgMs FROM game_results WHERE game_id = ? GROUP BY question_position ORDER BY question_position").bind(r.row.id),
  ]);
  return c.json({ game: view(r.row), participants: people?.results ?? [], questions: answers?.results ?? [] });
});

gameRoutes.get("/:id/usage", async (c) => {
  const r = await loadControlled(c, c.req.param("id"));
  if (!("row" in r)) return c.json({ error: r.error }, r.status);
  return c.json({ usage: await c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(r.row.pin)).usageStats() });
});
