import { describe, expect, it } from "vitest";
import { inScale } from "./music";
import { waitingBar, waitingProgress } from "./waiting";

const energy = (bar: number, players: number) => waitingBar(bar, players).reduce((s, n) => s + n.vel * n.dur, 0);

describe("waiting theme", () => {
  it("only uses notes of the scale, and mostly one pitch", () => {
    const pitches = new Set<number>();
    for (let bar = 0; bar < 20; bar++) for (const n of waitingBar(bar, 3)) { expect(inScale(n.midi)).toBe(true); if (n.voice !== "kick" && n.voice !== "shaker") pitches.add(n.midi % 12); }
    expect([...pitches].sort()).toEqual([2, 9]); // D and A
  });
  it("builds up bar after bar", () => {
    let last = 0;
    for (let bar = 0; bar < 16; bar += 2) { const e = energy(bar, 0); expect(e).toBeGreaterThanOrEqual(last); last = e; }
    expect(energy(15, 0)).toBeGreaterThan(energy(0, 0) * 3);
  });
  it("sounds fuller with more players, up to eight", () => {
    expect(energy(2, 5)).toBeGreaterThan(energy(2, 0));
    expect(waitingProgress(0, 8)).toBe(waitingProgress(0, 20));
  });
  it("holds at full strength after the build", () => expect(energy(40, 0)).toBe(energy(16, 0)));
});
