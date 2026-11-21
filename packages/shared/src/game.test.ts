import { describe, expect, it } from "vitest";
import { GAME_LIMITS, shuffled } from "./game";

describe("shuffled", () => {
  it("returns a permutation and leaves the input untouched", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffled(input);
    expect(out).toHaveLength(50);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(input[0]).toBe(0);
  });
  it("is deterministic for a fixed random source", () => {
    expect(shuffled([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });
  it("is roughly uniform for 3 items", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) { const k = shuffled([1, 2, 3]).join(""); counts.set(k, (counts.get(k) ?? 0) + 1); }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) expect(c).toBeGreaterThan(800);
  });
  it("handles empty and single arrays", () => {
    expect(shuffled([])).toEqual([]);
    expect(shuffled([7])).toEqual([7]);
  });
});

describe("GAME_LIMITS", () => {
  it("keeps the Free-plan guard rails", () => {
    expect(GAME_LIMITS.maxActiveGames).toBe(3);
    expect(GAME_LIMITS.ticketTtlMs).toBeLessThanOrEqual(60_000);
  });
});
