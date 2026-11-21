import { describe, expect, it } from "vitest";
import { BEATS_PER_BAR, PHRASE_BARS, VARIANTS, barNotes, bpmFor, degreeToMidi, fanfare, inScale, leadBeats, midiToHz } from "./music";

const PITCHED = ["flute", "pluck", "bass", "drone"];

describe("music score", () => {
  it("maps scale degrees to the D Ukrainian Dorian scale", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(degreeToMidi)).toEqual([62, 64, 65, 68, 69, 71, 72, 74]);
    expect(degreeToMidi(-7)).toBe(50);
    expect(midiToHz(69)).toBeCloseTo(440);
  });
  it("every pitched note of every variant, mood and bar is in the scale", () => {
    for (const v of VARIANTS) for (const mood of ["lobby", "question", "hurry"] as const) for (let bar = 0; bar < PHRASE_BARS * 2; bar++)
      for (const n of barNotes(v, mood, bar)) if (PITCHED.includes(n.voice)) expect(inScale(n.midi), `${v} ${mood} bar ${bar} midi ${n.midi}`).toBe(true);
  });
  it("the raised fourth (G#) that gives the scale its colour is used in every melody", () => {
    for (const v of VARIANTS) {
      const used = new Set<number>();
      for (let bar = 0; bar < PHRASE_BARS; bar++) for (const n of barNotes(v, "question", bar)) if (n.voice === "flute" || n.voice === "pluck") used.add(n.midi % 12);
      expect(used.has(8), v).toBe(true); // G# is pitch class 8
    }
  });
  it("notes stay inside their bar and start on or after beat zero", () => {
    for (const v of VARIANTS) for (let bar = 0; bar < PHRASE_BARS; bar++) for (const n of barNotes(v, "question", bar)) {
      expect(n.beat).toBeGreaterThanOrEqual(0);
      expect(n.beat).toBeLessThan(BEATS_PER_BAR);
      expect(n.vel).toBeGreaterThan(0);
      expect(n.vel).toBeLessThanOrEqual(1);
    }
  });
  it("each melody bar adds up to exactly one bar, rests included", () => {
    for (const v of VARIANTS) for (let bar = 0; bar < PHRASE_BARS; bar++) expect(leadBeats(v, bar), `${v} bar ${bar}`).toBeCloseTo(BEATS_PER_BAR, 5);
  });
  it("the music is fully deterministic", () => {
    expect(barNotes("hopak", "question", 11)).toEqual(barNotes("hopak", "question", 11));
  });
  it("the lobby is calmer than a question, and the last seconds are faster", () => {
    for (const v of VARIANTS) {
      expect(barNotes(v, "lobby", 0).length).toBeLessThan(barNotes(v, "question", 0).length);
      expect(bpmFor(v, "lobby")).toBeLessThan(bpmFor(v, "question"));
      expect(bpmFor(v, "question")).toBeLessThan(bpmFor(v, "hurry"));
      expect(barNotes(v, "question", 0).some((n) => n.voice === "kick")).toBe(true);
      expect(barNotes(v, "lobby", 0).some((n) => n.voice === "kick")).toBe(false);
      expect(barNotes(v, "hurry", 0).some((n) => n.voice === "tick")).toBe(true);
    }
  });
  it("the three variants are different melodies", () => {
    const sig = (v: "sopilka" | "tsymbaly" | "hopak") => [0, 1, 2, 3].flatMap((b) => barNotes(v, "lobby", b).filter((n) => n.voice === "flute" || n.voice === "pluck").map((n) => `${n.beat}:${n.midi}`)).join();
    expect(new Set(VARIANTS.map(sig)).size).toBe(3);
  });
  it("fanfares are short and end on a chord", () => {
    const p = fanfare("podium"), s = fanfare("short");
    expect(Math.max(...p.map((n) => n.beat + n.dur))).toBeLessThan(5);
    expect(Math.max(...s.map((n) => n.beat + n.dur))).toBeLessThan(2.5);
    expect(p.filter((n) => n.voice === "pluck").length).toBeGreaterThanOrEqual(3);
  });
});
