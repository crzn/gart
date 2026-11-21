import { z } from "zod";
import { MAX_MESSAGE_BYTES } from "./limits";
import type { GameState } from "./stateMachine";

/**
 * WebSocket protocol v1 (JSON text frames).
 * Envelope: { v: 1, t: <type>, id?: <client message id>, seq?: <monotonic int>, d?: <payload> }
 * Every client frame is validated with zod before it touches game state.
 */
const envelope = {
  v: z.literal(1),
  id: z.string().max(64).optional(),
  seq: z.number().int().nonnegative().optional(),
};

function noPayload<T extends string>(t: T) {
  return z.object({ ...envelope, t: z.literal(t) });
}

export const ClientMessageSchema = z.discriminatedUnion("t", [
  z.object({
    ...envelope,
    t: z.literal("player.join"),
    d: z.object({ nickname: z.string().max(64), avatar: z.string().max(32) }),
  }),
  z.object({
    ...envelope,
    t: z.literal("player.resume"),
    d: z.object({ playerToken: z.string().min(16).max(128) }),
  }),
  z.object({
    ...envelope,
    t: z.literal("host.auth"),
    d: z.object({ ticket: z.string().min(16).max(512) }),
  }),
  z.object({
    ...envelope,
    t: z.literal("screen.attach"),
    d: z.object({ ticket: z.string().min(16).max(512) }),
  }),
  z.object({
    ...envelope,
    t: z.literal("answer.submit"),
    d: z.object({ questionIdx: z.number().int().nonnegative(), optionId: z.string().min(1).max(64) }),
  }),
  noPayload("host.start"),
  noPayload("host.closeQuestion"),
  noPayload("host.showLeaderboard"),
  noPayload("host.next"),
  noPayload("host.pause"),
  noPayload("host.resume"),
  noPayload("host.end"),
  z.object({
    ...envelope,
    t: z.literal("host.kick"),
    d: z.object({ playerId: z.string().min(1).max(64) }),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ClientMessageType = ClientMessage["t"];

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: "too_large" | "bad_json" | "invalid_message" };

const encoder = new TextEncoder();

export function parseClientMessage(raw: string): ParseResult {
  if (encoder.encode(raw).byteLength > MAX_MESSAGE_BYTES) return { ok: false, error: "too_large" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "bad_json" };
  }
  const parsed = ClientMessageSchema.safeParse(json);
  return parsed.success ? { ok: true, message: parsed.data } : { ok: false, error: "invalid_message" };
}

/* ---------------- Server -> client message catalogue (contract for Phase 4) ---------------- */

export type WsRole = "host" | "player" | "screen";

export type RejectReason =
  | "not_active"
  | "closed"
  | "duplicate"
  | "invalid_option"
  | "paused"
  | "rate_limited"
  | "unknown_player"
  | "wrong_question";

export interface PublicOption {
  id: string;
  text: string;
  imageId?: string;
}

/** Question as sent to clients: never contains the correct flag. */
export interface PublicQuestion {
  index: number;
  total: number;
  text: string;
  imageId?: string;
  options: PublicOption[];
  /** Server epoch ms. Clients render countdowns from these; the server enforces them. */
  startsAt: number;
  endsAt: number | null;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  avatar: string;
  points: number;
  rank: number;
  movement: number;
}

type Frame<T extends string, D> = { v: 1; t: T; d: D };

export interface PlayerView { playerId: string; nickname: string; avatar: string; connected: boolean }

export interface ResultsData {
  questionIdx: number;
  /** Omitted when the quiz hides correct answers. */
  correctOptionId?: string;
  explanation?: string;
  distribution: Record<string, number>;
  answered: number;
  total: number;
  you?: { correct: boolean; points: number; rank: number; movement: number; answered: boolean };
}

export interface LeaderboardData { top: LeaderboardEntry[]; you?: LeaderboardEntry; total: number }

export interface SnapshotData {
  serverTime: number;
  role: WsRole;
  state: GameState;
  paused: boolean;
  title: string;
  /** What the quiz is about and its cover picture; shown in the lobby to everyone. */
  description?: string;
  coverImageId?: string;
  pin: string;
  playerCount: number;
  settings: { showQuestionProgress: boolean; soundEnabled: boolean; showCorrectAnswer: boolean; leaderboardEnabled: boolean };
  you?: { playerId: string; nickname: string; avatar: string; points: number; rank: number | null };
  /** Host and projector only. */
  players?: PlayerView[];
  question?: PublicQuestion;
  answered?: number;
  /** The option this player already chose for the active question, if any. */
  yourAnswer?: string | null;
  results?: ResultsData;
  leaderboard?: LeaderboardData;
  final?: LeaderboardData;
}

export type ServerMessage =
  | Frame<"hello", { serverTime: number; role: WsRole | "anon"; state: GameState; paused: boolean; /** Players in the game at this moment; lets the join form say how many are already in. */ playerCount?: number }>
  | Frame<"snapshot", SnapshotData>
  | Frame<"kicked", Record<string, never>>
  | Frame<"game.cancelled", Record<string, never>>
  | Frame<"error", { code: string }>
  | Frame<"joined", { playerId: string; playerToken: string; nickname: string; avatar: string }>
  | Frame<"lobby.update", { playerCount: number }>
  | Frame<"player.joined", { playerId: string; nickname: string; avatar: string }>
  | Frame<"player.left", { playerId: string }>
  | Frame<"player.reconnected", { playerId: string }>
  | Frame<"question.start", PublicQuestion>
  | Frame<"answer.ack", { questionIdx: number }>
  | Frame<"answer.reject", { questionIdx: number; reason: RejectReason }>
  | Frame<"progress.update", { answered: number; total: number }>
  | Frame<"question.closed", { questionIdx: number; answered: number; total: number }>
  | Frame<"results", ResultsData>
  | Frame<"leaderboard", LeaderboardData>
  | Frame<"game.paused", Record<string, never>>
  | Frame<"game.resumed", { endsAt: number | null }>
  | Frame<"game.finished", LeaderboardData>;
