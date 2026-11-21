import { describe, expect, it } from "vitest";
import {
  GAME_EVENTS,
  GAME_STATES,
  isTerminal,
  transition,
  type GameEvent,
  type GameState,
  type TransitionContext,
} from "./stateMachine";

const ctx: TransitionContext = { hasNextQuestion: true, questionCount: 5, leaderboardEnabled: true };

function next(state: GameState, event: GameEvent, c: Partial<TransitionContext> = {}) {
  return transition(state, event, { ...ctx, ...c });
}

describe("game state machine", () => {
  it("walks a full happy path", () => {
    expect(next("CREATED", "OPEN_LOBBY")).toEqual({ ok: true, next: "LOBBY" });
    expect(next("LOBBY", "START")).toEqual({ ok: true, next: "QUESTION_ACTIVE" });
    expect(next("QUESTION_ACTIVE", "CLOSE_QUESTION")).toEqual({ ok: true, next: "QUESTION_RESULTS" });
    expect(next("QUESTION_RESULTS", "SHOW_LEADERBOARD")).toEqual({ ok: true, next: "LEADERBOARD" });
    expect(next("LEADERBOARD", "NEXT")).toEqual({ ok: true, next: "QUESTION_ACTIVE" });
    expect(next("LEADERBOARD", "NEXT", { hasNextQuestion: false })).toEqual({ ok: true, next: "FINISHED" });
  });

  it("allows skipping the leaderboard", () => {
    expect(next("QUESTION_RESULTS", "NEXT")).toEqual({ ok: true, next: "QUESTION_ACTIVE" });
    expect(next("QUESTION_RESULTS", "NEXT", { hasNextQuestion: false })).toEqual({ ok: true, next: "FINISHED" });
  });

  it("refuses to start without questions", () => {
    expect(next("LOBBY", "START", { questionCount: 0 })).toEqual({ ok: false, reason: "no_questions" });
  });

  it("goes straight to the winners after the last question: no in-between leaderboard", () => {
    expect(next("QUESTION_RESULTS", "SHOW_LEADERBOARD", { hasNextQuestion: false })).toEqual({ ok: false, reason: "last_question" });
  });

  it("refuses the leaderboard when disabled in settings", () => {
    expect(next("QUESTION_RESULTS", "SHOW_LEADERBOARD", { leaderboardEnabled: false })).toEqual({
      ok: false,
      reason: "leaderboard_disabled",
    });
  });

  it("cancels before play and finishes after play when ended", () => {
    expect(next("LOBBY", "END")).toEqual({ ok: true, next: "CANCELLED" });
    expect(next("QUESTION_ACTIVE", "END")).toEqual({ ok: true, next: "FINISHED" });
    expect(next("LEADERBOARD", "END")).toEqual({ ok: true, next: "FINISHED" });
  });

  it("allows CANCEL from every non-terminal state", () => {
    for (const s of GAME_STATES.filter((x) => !isTerminal(x))) {
      expect(next(s, "CANCEL")).toEqual({ ok: true, next: "CANCELLED" });
    }
  });

  it("never leaves a terminal state", () => {
    for (const s of ["FINISHED", "CANCELLED"] as const) {
      for (const e of GAME_EVENTS) {
        expect(next(s, e)).toEqual({ ok: false, reason: "terminal_state" });
      }
    }
  });

  it("rejects out-of-order events", () => {
    expect(next("CREATED", "START").ok).toBe(false);
    expect(next("LOBBY", "CLOSE_QUESTION").ok).toBe(false);
    expect(next("QUESTION_ACTIVE", "NEXT").ok).toBe(false);
    expect(next("QUESTION_ACTIVE", "SHOW_LEADERBOARD").ok).toBe(false);
    expect(next("LEADERBOARD", "OPEN_LOBBY").ok).toBe(false);
  });
});
