import { describe, expect, it } from "vitest";
import { CALIBRATION_LADDER, CALIBRATION_TRIALS, calibrateIterations, chooseIterations } from "./jobs.mjs";

const probeUpTo = (limit) => async (n) => ({ status: n <= limit ? 200 : 503 });

describe("calibrateIterations", () => {
  it("climbs the whole ladder when everything passes", async () => {
    const r = await calibrateIterations(probeUpTo(1e9));
    expect(r).toEqual({ best: 100000, limited: false });
  });
  it("stops at the first failing step and keeps the last passing one", async () => {
    const r = await calibrateIterations(probeUpTo(30000));
    expect(r.best).toBe(30000);
  });
  it("returns 0 when even the lowest step fails", async () => {
    expect((await calibrateIterations(probeUpTo(100))).best).toBe(0);
  });
  it("requires every trial to pass, not just one", async () => {
    let calls = 0;
    const flaky = async (n) => (n === 20000 && ++calls === 3 ? { status: 503 } : { status: 200 });
    expect((await calibrateIterations(flaky)).best).toBe(15000);
  });
  it("runs the configured number of trials per step", async () => {
    let calls = 0;
    await calibrateIterations(async () => (calls++, { status: 200 }));
    expect(calls).toBe(CALIBRATION_LADDER.length * CALIBRATION_TRIALS);
  });
  it("keeps the best result when rate limited", async () => {
    let step = 0;
    const r = await calibrateIterations(async () => (++step > 12 ? { status: 429 } : { status: 200 }));
    expect(r.limited).toBe(true);
    expect(r.best).toBe(10000);
  });
});

describe("chooseIterations", () => {
  it("applies a 40 % safety margin and rounds down to thousands", () => {
    expect(chooseIterations(100000)).toBe(60000);
    expect(chooseIterations(15000)).toBe(9000);
  });
  it("never goes below the minimum", () => {
    expect(chooseIterations(0)).toBe(5000);
    expect(chooseIterations(5000)).toBe(5000);
  });
});
