/**
 * Game lifecycle. All transitions are validated on the server.
 * "Paused" is a separate flag on the room, not a lifecycle state.
 */
export const GAME_STATES = [
  "CREATED",
  "LOBBY",
  "QUESTION_ACTIVE",
  "QUESTION_RESULTS",
  "LEADERBOARD",
  "FINISHED",
  "CANCELLED",
] as const;
export type GameState = (typeof GAME_STATES)[number];

export const GAME_EVENTS = [
  "OPEN_LOBBY",
  "START", // LOBBY -> first question
  "CLOSE_QUESTION", // QUESTION_ACTIVE -> QUESTION_RESULTS
  "SHOW_LEADERBOARD", // QUESTION_RESULTS -> LEADERBOARD
  "NEXT", // RESULTS or LEADERBOARD -> next question, or FINISHED when none left
  "END", // host ends the game early
  "CANCEL",
] as const;
export type GameEvent = (typeof GAME_EVENTS)[number];

export interface TransitionContext {
  /** True when at least one more question remains after the current one. */
  hasNextQuestion: boolean;
  /** Number of questions in the game; START requires at least one. */
  questionCount: number;
  /** When false, SHOW_LEADERBOARD is rejected (leaderboard disabled in settings). */
  leaderboardEnabled: boolean;
}

export type TransitionResult =
  | { ok: true; next: GameState }
  | { ok: false; reason: "terminal_state" | "invalid_transition" | "no_questions" | "leaderboard_disabled" };

export function isTerminal(state: GameState): boolean {
  return state === "FINISHED" || state === "CANCELLED";
}

export function transition(
  state: GameState,
  event: GameEvent,
  ctx: TransitionContext,
): TransitionResult {
  if (isTerminal(state)) return { ok: false, reason: "terminal_state" };

  switch (event) {
    case "OPEN_LOBBY":
      return state === "CREATED" ? { ok: true, next: "LOBBY" } : invalid();

    case "START":
      if (state !== "LOBBY") return invalid();
      if (ctx.questionCount < 1) return { ok: false, reason: "no_questions" };
      return { ok: true, next: "QUESTION_ACTIVE" };

    case "CLOSE_QUESTION":
      return state === "QUESTION_ACTIVE" ? { ok: true, next: "QUESTION_RESULTS" } : invalid();

    case "SHOW_LEADERBOARD":
      if (state !== "QUESTION_RESULTS") return invalid();
      if (!ctx.leaderboardEnabled) return { ok: false, reason: "leaderboard_disabled" };
      return { ok: true, next: "LEADERBOARD" };

    case "NEXT":
      if (state !== "QUESTION_RESULTS" && state !== "LEADERBOARD") return invalid();
      return { ok: true, next: ctx.hasNextQuestion ? "QUESTION_ACTIVE" : "FINISHED" };

    case "END":
      // Before any question is shown there is nothing to finish: the game is cancelled.
      if (state === "CREATED" || state === "LOBBY") return { ok: true, next: "CANCELLED" };
      return { ok: true, next: "FINISHED" };

    case "CANCEL":
      return { ok: true, next: "CANCELLED" };
  }
}

function invalid(): TransitionResult {
  return { ok: false, reason: "invalid_transition" };
}
