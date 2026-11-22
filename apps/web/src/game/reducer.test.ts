import { describe, expect, it } from "vitest";
import type { ServerMessage, SnapshotData } from "@gart/shared";
import { gameReducer, initialGameState, secondsLeft, secondsUntilStart, type GameClientState } from "./reducer";

const base: SnapshotData = {
  serverTime: 10_000, role: "player", state: "LOBBY", paused: false, title: "T", pin: "123456", playerCount: 1,
  settings: { showQuestionProgress: true, countdownSec: 3, soundEnabled: false, showCorrectAnswer: true, leaderboardEnabled: true },
  you: { playerId: "p1", nickname: "Ann", avatar: "fox", points: 0, rank: null },
};
const q = { index: 0, total: 2, text: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], startsAt: 20_000, endsAt: 30_000 };
const feed = (s: GameClientState, msg: ServerMessage, now = 10_500) => gameReducer(s, { type: "msg", msg, now });
const withSnap = (over: Partial<SnapshotData> = {}) => feed(initialGameState, { v: 1, t: "snapshot", d: { ...base, ...over } });

describe("gameReducer", () => {
  it("stores the snapshot and the clock offset", () => {
    const s = withSnap();
    expect(s.conn).toBe("open");
    expect(s.offset).toBe(-500);
    expect(s.hello).toBe(false);
  });
  it("hello alone opens an anonymous connection", () => {
    const s = feed(initialGameState, { v: 1, t: "hello", d: { serverTime: 1, role: "anon", state: "LOBBY", paused: false } });
    expect(s.hello).toBe(true);
    expect(s.snap).toBeNull();
  });
  it("a new question clears the previous results and answer", () => {
    let s = withSnap({ yourAnswer: "a", results: { questionIdx: 0, distribution: {}, answered: 1, total: 1 } });
    s = feed(s, { v: 1, t: "question.start", d: q });
    expect(s.snap?.state).toBe("QUESTION_ACTIVE");
    expect(s.snap?.results).toBeUndefined();
    expect(s.snap?.yourAnswer).toBeNull();
    expect(s.snap?.answered).toBe(0);
  });
  it("an acknowledged answer becomes yourAnswer; a rejection clears pending", () => {
    let s = feed(withSnap(), { v: 1, t: "question.start", d: q });
    s = gameReducer(s, { type: "pending", optionId: "b" });
    expect(feed(s, { v: 1, t: "answer.ack", d: { questionIdx: 0 } }).snap?.yourAnswer).toBe("b");
    const r = feed(s, { v: 1, t: "answer.reject", d: { questionIdx: 0, reason: "closed" } });
    expect(r.pending).toBeNull();
    expect(r.reject).toBe("closed");
  });
  it("results add the question's points to the running total", () => {
    let s = feed(withSnap(), { v: 1, t: "question.start", d: q });
    s = feed(s, { v: 1, t: "results", d: { questionIdx: 0, distribution: { a: 1 }, answered: 1, total: 1, you: { correct: true, points: 1200, rank: 1, movement: 0, answered: true } } });
    expect(s.snap?.you?.points).toBe(1200);
    expect(s.snap?.you?.rank).toBe(1);
    expect(s.snap?.state).toBe("QUESTION_RESULTS");
  });
  it("tracks the player list for the host", () => {
    let s = withSnap({ role: "host", players: [] });
    s = feed(s, { v: 1, t: "player.joined", d: { playerId: "x", nickname: "X", avatar: "owl" } });
    s = feed(s, { v: 1, t: "player.left", d: { playerId: "x" } });
    expect(s.snap?.players).toEqual([{ playerId: "x", nickname: "X", avatar: "owl", connected: false }]);
    s = feed(s, { v: 1, t: "player.reconnected", d: { playerId: "x" } });
    expect(s.snap?.players?.[0]?.connected).toBe(true);
    s = gameReducer(s, { type: "removePlayer", playerId: "x" });
    expect(s.snap?.players).toEqual([]);
  });
  it("freezes the countdown while paused and moves the deadline on resume", () => {
    let s = feed(withSnap(), { v: 1, t: "question.start", d: q }, 10_500);
    expect(secondsUntilStart(s, 11_000)).toBeCloseTo(9.5, 1);
    expect(secondsLeft(s, 21_000)).toBeCloseTo(9.5, 1);
    s = feed(s, { v: 1, t: "game.paused", d: {} }, 25_000);
    expect(secondsLeft(s, 99_000)).toBeCloseTo(5.5, 1);
    s = feed(s, { v: 1, t: "game.resumed", d: { endsAt: 36_000 } }, 40_000);
    expect(s.pausedAt).toBeNull();
    expect(s.snap?.question?.endsAt).toBe(36_000);
  });
  it("kick, cancel and fatal errors are remembered", () => {
    expect(feed(withSnap(), { v: 1, t: "kicked", d: {} }).kicked).toBe(true);
    expect(feed(withSnap(), { v: 1, t: "game.cancelled", d: {} }).cancelled).toBe(true);
    expect(gameReducer(withSnap(), { type: "fatal", code: "replaced" })).toMatchObject({ conn: "failed", error: "replaced" });
  });
  it("final standings update the player's own rank", () => {
    const s = feed(withSnap(), { v: 1, t: "game.finished", d: { top: [], total: 3, you: { playerId: "p1", nickname: "Ann", avatar: "fox", points: 900, rank: 2, movement: 0 } } });
    expect(s.snap?.state).toBe("FINISHED");
    expect(s.snap?.you).toMatchObject({ points: 900, rank: 2 });
  });
});
