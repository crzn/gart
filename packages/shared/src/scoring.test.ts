import { describe, expect, it } from "vitest";
import { calculatePoints, scoreBreakdown } from "./scoring";

const base = { basePoints: 1000, speedBonusPercent: 50, limitMs: 20_000 };

describe("calculatePoints", () => {
  it("gives zero for a wrong answer regardless of speed", () => {
    expect(calculatePoints({ ...base, correct: false, elapsedMs: 0 })).toBe(0);
  });

  it("matches the documented worked example (5 s of 20 s, 50 %) = 1375", () => {
    expect(calculatePoints({ ...base, correct: true, elapsedMs: 5_000 })).toBe(1375);
  });

  it("gives the full bonus for an instant answer and none at the deadline", () => {
    expect(calculatePoints({ ...base, correct: true, elapsedMs: 0 })).toBe(1500);
    expect(calculatePoints({ ...base, correct: true, elapsedMs: 20_000 })).toBe(1000);
  });

  it("clamps negative and over-limit elapsed times", () => {
    expect(calculatePoints({ ...base, correct: true, elapsedMs: -50 })).toBe(1500);
    expect(calculatePoints({ ...base, correct: true, elapsedMs: 99_999 })).toBe(1000);
  });

  it("returns only base points when the speed bonus is disabled", () => {
    expect(
      calculatePoints({ ...base, speedBonusPercent: 0, correct: true, elapsedMs: 100 }),
    ).toBe(1000);
  });

  it("floors fractional bonuses (integer-only, deterministic)", () => {
    // 1000 * 50 * 3333 / (100 * 20000) = 83.325 -> 83
    expect(
      scoreBreakdown({ ...base, correct: true, elapsedMs: 16_667 }).bonus,
    ).toBe(83);
  });

  it("is monotonic: a faster answer never scores less", () => {
    let previous = Infinity;
    for (let ms = 0; ms <= 20_000; ms += 137) {
      const pts = calculatePoints({ ...base, correct: true, elapsedMs: ms });
      expect(pts).toBeLessThanOrEqual(previous);
      previous = pts;
    }
  });

  it("rejects invalid configuration", () => {
    expect(() => calculatePoints({ ...base, correct: true, elapsedMs: 1, basePoints: -1 })).toThrow(RangeError);
    expect(() => calculatePoints({ ...base, correct: true, elapsedMs: 1, speedBonusPercent: 101 })).toThrow(RangeError);
    expect(() => calculatePoints({ ...base, correct: true, elapsedMs: Number.NaN })).toThrow(RangeError);
  });
});
