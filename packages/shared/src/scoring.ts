/**
 * Deterministic, integer-only scoring. Runs on the server only; clients never score.
 *
 * points = 0                                   if the answer is wrong
 * points = base                                if the speed bonus is off (0 %)
 * points = base + floor(base * pct * remaining / (100 * limit))   otherwise
 *
 * where `remaining = limit - elapsed` (elapsed is clamped to 0..limit) and
 * `pct` is the maximum speed bonus as a percentage of `base` (0..100).
 *
 * Example: base 1000, pct 50, limit 20 s, answered after 5 s:
 *   remaining = 15 s -> bonus = floor(1000 * 50 * 15000 / (100 * 20000)) = 375 -> 1375 points.
 */
export interface ScoreInput {
  correct: boolean;
  basePoints: number;
  /** Maximum speed bonus as a percentage of basePoints, integer 0..100. 0 disables it. */
  speedBonusPercent: number;
  /** Server-measured time from question start to answer receipt. */
  elapsedMs: number;
  /** Question time limit in milliseconds. */
  limitMs: number;
}

export interface ScoreBreakdown {
  base: number;
  bonus: number;
  total: number;
  remainingMs: number;
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a non-negative integer, got ${String(value)}`);
  }
}

export function scoreBreakdown(input: ScoreInput): ScoreBreakdown {
  assertNonNegativeInt("basePoints", input.basePoints);
  assertNonNegativeInt("speedBonusPercent", input.speedBonusPercent);
  assertNonNegativeInt("limitMs", input.limitMs);
  if (input.speedBonusPercent > 100) {
    throw new RangeError("speedBonusPercent must be at most 100");
  }
  if (!Number.isFinite(input.elapsedMs)) {
    throw new RangeError("elapsedMs must be finite");
  }

  const elapsed = Math.min(Math.max(Math.trunc(input.elapsedMs), 0), input.limitMs);
  const remainingMs = input.limitMs - elapsed;

  if (!input.correct) {
    return { base: 0, bonus: 0, total: 0, remainingMs };
  }
  if (input.speedBonusPercent === 0 || input.limitMs === 0) {
    return { base: input.basePoints, bonus: 0, total: input.basePoints, remainingMs };
  }
  const bonus = Math.floor(
    (input.basePoints * input.speedBonusPercent * remainingMs) / (100 * input.limitMs),
  );
  return { base: input.basePoints, bonus, total: input.basePoints + bonus, remainingMs };
}

export function calculatePoints(input: ScoreInput): number {
  return scoreBreakdown(input).total;
}
