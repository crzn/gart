import { describe, expect, it } from "vitest";
import {
  DAILY_RESOURCES, DEFAULT_SCENARIO, DEFAULT_THRESHOLDS, RESOURCES, additionalGames, calculate, estimateGame, levelFor,
  projectGame, resourceDef, statusFor, utcDay, validateThresholds, worstCase, type Scenario,
} from "./usage";

const game = (over: Partial<Scenario>): Scenario => ({ ...DEFAULT_SCENARIO, answerRate: 1, ...over });

describe("limits come from the config file", () => {
  it("has the Free-plan quotas the architecture relies on", () => {
    expect(resourceDef("durableObjects.sqlRowsWritten").limit).toBe(100_000);
    expect(resourceDef("d1.rowsWritten").limit).toBe(100_000);
    expect(resourceDef("d1.databaseStorageGb").limit).toBe(0.5);
    expect(resourceDef("r2.storageGb").period).toBe("unused");
  });
  it("covers every resource the specification names", () => {
    expect(RESOURCES.map((r) => r.id)).toEqual(expect.arrayContaining(["workers.requests", "workers.cpuMsPerInvocation", "durableObjects.requests", "durableObjects.durationGbSeconds", "durableObjects.storageGb", "durableObjects.sqlRowsRead", "durableObjects.sqlRowsWritten", "d1.rowsRead", "d1.rowsWritten", "d1.databaseStorageGb", "r2.storageGb", "r2.classAOperations", "r2.classBOperations"]));
  });
});

describe("thresholds", () => {
  it("maps percentages to levels at 50, 75, 90 and 100", () => {
    expect([0, 49.9, 50, 74.9, 75, 89.9, 90, 99.9, 100, 140].map((p) => levelFor(p))).toEqual(["ok", "ok", "info", "info", "warning", "warning", "critical", "critical", "full", "full"]);
  });
  it("accepts rising whole numbers only", () => {
    expect(validateThresholds({ info: 40, warning: 60, critical: 80 })).toEqual({ info: 40, warning: 60, critical: 80, full: 100 });
    for (const bad of [{ info: 60, warning: 50, critical: 90 }, { info: 50, warning: 75, critical: 100 }, { info: 0, warning: 75, critical: 90 }, { info: 50.5, warning: 75, critical: 90 }, { info: 50, warning: 75 }]) expect(validateThresholds(bad)).toBeNull();
  });
});

describe("estimateGame", () => {
  it("is never below what the local game test measured (conservative)", () => {
    // tests/e2e/game.e2e.mjs: 30 players x 3 questions, 92 answers -> 152 written, 630 read.
    const small = estimateGame(game({ players: 30, questions: 3, answerRate: 92 / 90, reconnects: 1 }));
    expect(small["durableObjects.sqlRowsWritten"]).toBeGreaterThanOrEqual(152);
    expect(small["durableObjects.sqlRowsRead"]).toBeGreaterThanOrEqual(630);
    // 120 players x 3 questions, 365 answers -> 497 written, 2,460 read.
    const big = estimateGame(game({ players: 120, questions: 3, answerRate: 365 / 360, reconnects: 1 }));
    expect(big["durableObjects.sqlRowsWritten"]).toBeGreaterThanOrEqual(497);
    expect(big["durableObjects.sqlRowsRead"]).toBeGreaterThanOrEqual(2460);
    // ...but not wildly pessimistic either.
    expect(big["durableObjects.sqlRowsWritten"]).toBeLessThan(497 * 2);
    expect(big["durableObjects.sqlRowsRead"]).toBeLessThan(2460 * 1.5);
  });
  it("grows with players and questions", () => {
    const a = estimateGame(game({ players: 60 })), b = estimateGame(game({ players: 120 }));
    for (const id of DAILY_RESOURCES.filter((r) => r !== "durableObjects.durationGbSeconds" && r !== "d1.rowsRead")) expect(b[id]).toBeGreaterThan(a[id]);
  });
  it("a full 120 x 20 game stays well inside the daily write quota", () => {
    const g = estimateGame(game({ players: 120, questions: 20 }));
    expect(g["durableObjects.sqlRowsWritten"]).toBeLessThan(5000);
    expect(g["d1.rowsWritten"]).toBeLessThan(8000);
  });
  it("uses nothing from R2", () => {
    const g = estimateGame(DEFAULT_SCENARIO);
    expect([g["r2.storageGb"], g["r2.classAOperations"], g["r2.classBOperations"]]).toEqual([0, 0, 0]);
  });
});

describe("calculate", () => {
  it("reports per-game, busy-day, month, percentage and games that fit", () => {
    const r = calculate(game({ gamesPerMonth: 8, gamesPerBusyDay: 2 }));
    const w = r.rows.find((x) => x.resource === "durableObjects.sqlRowsWritten")!;
    expect(w.busyDay).toBeCloseTo(w.perGame * 2);
    expect(w.month).toBeCloseTo(w.perGame * 8);
    expect(w.busyDayPct).toBeCloseTo((w.busyDay / 100_000) * 100);
    expect(w.gamesThatFit).toBe(Math.floor(100_000 / w.perGame));
  });
  it("finds the resource that runs out first", () => {
    const r = calculate(DEFAULT_SCENARIO);
    expect(r.bottleneck).not.toBeNull();
    const min = Math.min(...r.rows.filter((x) => resourceDef(x.resource).period === "day" && x.gamesThatFit !== null).map((x) => x.gamesThatFit!));
    expect(r.bottleneck!.games).toBe(min);
  });
  it("worst case is never cheaper than the typical case", () => {
    const base = DEFAULT_SCENARIO;
    const typ = estimateGame(base), worst = estimateGame(worstCase(base));
    for (const id of DAILY_RESOURCES) expect(worst[id]).toBeGreaterThanOrEqual(typ[id]);
    const row = calculate(base).rows.find((x) => x.resource === "durableObjects.sqlRowsRead")!;
    expect(row.worstDayPct!).toBeGreaterThan(row.busyDayPct!);
  });
  it("storage accumulates over the retention period", () => {
    const one = calculate(game({ retentionMonths: 1 })).rows.find((x) => x.resource === "d1.databaseStorageGb")!;
    const year = calculate(game({ retentionMonths: 12 })).rows.find((x) => x.resource === "d1.databaseStorageGb")!;
    expect(year.busyDay).toBeGreaterThan(one.busyDay * 10);
  });
});

describe("today's position", () => {
  const per = estimateGame(game({}));
  it("alerts on the larger of measured and official figures", () => {
    const st = statusFor({ "durableObjects.sqlRowsWritten": 30_000 }, { "durableObjects.sqlRowsWritten": 92_000 });
    const w = st.find((s) => s.resource === "durableObjects.sqlRowsWritten")!;
    expect(w).toMatchObject({ measured: 30_000, official: 92_000, used: 92_000, level: "critical" });
  });
  it("leaves out unused and per-invocation resources", () => {
    const ids = statusFor({}, {}).map((s) => s.resource);
    expect(ids).not.toContain("r2.storageGb");
    expect(ids).not.toContain("workers.cpuMsPerInvocation");
  });
  it("warns when the proposed game would push a resource past a threshold", () => {
    const quiet = projectGame(statusFor({}, {}), per);
    expect(quiet.level).toBe("ok");
    const busy = projectGame(statusFor({ "durableObjects.sqlRowsWritten": 99_000 }, {}), per);
    expect(busy.level).toBe("full");
    expect(busy.concerns.map((c) => c.resource)).toContain("durableObjects.sqlRowsWritten");
    expect(busy.rows.find((r) => r.resource === "durableObjects.sqlRowsWritten")!.pctAfter).toBeGreaterThan(100);
  });
  it("counts the games that still fit today", () => {
    const empty = additionalGames(statusFor({}, {}), per)!;
    const used = additionalGames(statusFor({ [empty.resource]: resourceDef(empty.resource).limit! / 2 }, {}), per)!;
    expect(used.games).toBeLessThanOrEqual(Math.ceil(empty.games / 2));
    const full = additionalGames(statusFor({ "d1.rowsWritten": 100_000 }, {}), per)!;
    expect(full.games).toBe(0);
    expect(full.resource).toBe("d1.rowsWritten");
  });
  it("uses UTC days, matching the Cloudflare reset", () => {
    expect(utcDay(new Date("2026-11-20T23:59:59+02:00"))).toBe("2026-11-20");
    expect(utcDay(new Date("2026-11-21T00:30:00+02:00"))).toBe("2026-11-20");
  });
  it("never recommends more games after the threshold defaults change meaning", () => {
    expect(DEFAULT_THRESHOLDS.full).toBe(100);
  });
});
