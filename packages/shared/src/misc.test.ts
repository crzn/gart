import { describe, expect, it } from "vitest";
import { AVATAR_IDS, isAvatarId } from "./avatars";
import { rankMovement, rankPlayers } from "./leaderboard";
import { MAX_MESSAGE_BYTES, MAX_PLAYERS_PER_GAME } from "./limits";
import { validateNickname } from "./nickname";
import { generatePin, isValidPin } from "./pin";
import { parseClientMessage } from "./protocol";
import { QuizSettingsSchema, defaultQuizSettings } from "./settings";

describe("nickname validation", () => {
  it("accepts Ukrainian, Latin and digits and normalises spacing", () => {
    const r = validateNickname("  Олена   К.  ");
    expect(r).toEqual({ ok: true, nickname: "Олена К.", key: "олена к." });
    expect(validateNickname("Player_01").ok).toBe(true);
  });

  it("treats case and width variants as the same key", () => {
    const a = validateNickname("Anna");
    const b = validateNickname("ＡＮＮＡ");
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });

  it("rejects empty, short, long and unsafe names", () => {
    expect(validateNickname("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateNickname("a")).toEqual({ ok: false, reason: "too_short" });
    expect(validateNickname("x".repeat(21))).toEqual({ ok: false, reason: "too_long" });
    expect(validateNickname("<script>")).toEqual({ ok: false, reason: "invalid_chars" });
    expect(validateNickname("‮evil")).toEqual({ ok: false, reason: "invalid_chars" });
  });

  it("never exceeds the hard maximum even if rules allow more", () => {
    expect(validateNickname("x".repeat(30), { minLength: 1, maxLength: 99 })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("pin", () => {
  it("generates six-digit zero-padded pins", () => {
    for (let i = 0; i < 200; i++) expect(isValidPin(generatePin())).toBe(true);
    expect(generatePin((b) => ((b[0] = 42), b))).toBe("000042");
  });

  it("rejects out-of-range random values (no modulo bias)", () => {
    const values = [0xffff_ffff, 123_456];
    let i = 0;
    const pin = generatePin((b) => ((b[0] = values[i++] ?? 0), b));
    expect(pin).toBe("123456");
  });

  it("validates format", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a456")).toBe(false);
  });
});

describe("leaderboard", () => {
  const p = (id: string, points: number, ms: number) => ({ playerId: id, nickname: id, points, totalAnswerMs: ms });

  it("orders by points, then speed, and shares ranks only on exact ties", () => {
    const ranked = rankPlayers([p("c", 100, 500), p("a", 200, 900), p("b", 200, 900), p("d", 200, 100)]);
    expect(ranked.map((r) => [r.playerId, r.rank])).toEqual([
      ["d", 1],
      ["a", 2],
      ["b", 2],
      ["c", 4],
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const input = [p("x", 5, 1), p("y", 5, 1), p("z", 9, 3)];
    expect(rankPlayers(input)).toEqual(rankPlayers([...input].reverse()));
  });

  it("computes movement (positive = up)", () => {
    expect(rankMovement(5, 2)).toBe(3);
    expect(rankMovement(2, 5)).toBe(-3);
    expect(rankMovement(undefined, 1)).toBe(0);
  });
});

describe("protocol parsing", () => {
  it("parses a valid answer", () => {
    const r = parseClientMessage(JSON.stringify({ v: 1, t: "answer.submit", seq: 3, d: { questionIdx: 0, optionId: "o1" } }));
    expect(r.ok).toBe(true);
  });

  it("rejects unknown types, bad payloads, bad JSON and oversized frames", () => {
    expect(parseClientMessage(JSON.stringify({ v: 1, t: "nope" }))).toEqual({ ok: false, error: "invalid_message" });
    expect(parseClientMessage(JSON.stringify({ v: 1, t: "answer.submit", d: { questionIdx: -1, optionId: "x" } }))).toEqual({
      ok: false,
      error: "invalid_message",
    });
    expect(parseClientMessage("{oops")).toEqual({ ok: false, error: "bad_json" });
    expect(parseClientMessage("x".repeat(MAX_MESSAGE_BYTES + 1))).toEqual({ ok: false, error: "too_large" });
  });

  it("requires a payload for kick but not for simple host commands", () => {
    expect(parseClientMessage(JSON.stringify({ v: 1, t: "host.next" })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ v: 1, t: "host.kick" })).ok).toBe(false);
  });
});

describe("settings and avatars", () => {
  it("fills defaults from an empty object and caps participants at the product limit", () => {
    const s = defaultQuizSettings();
    expect(s.maxParticipants).toBe(MAX_PLAYERS_PER_GAME);
    expect(QuizSettingsSchema.safeParse({ maxParticipants: 121 }).success).toBe(false);
  });

  it("rejects inverted nickname bounds", () => {
    expect(QuizSettingsSchema.safeParse({ nicknameMinLength: 10, nicknameMaxLength: 5 }).success).toBe(false);
  });

  it("has unique avatar ids", () => {
    expect(new Set(AVATAR_IDS).size).toBe(AVATAR_IDS.length);
    expect(isAvatarId("fox")).toBe(true);
    expect(isAvatarId("hacker")).toBe(false);
  });
});
