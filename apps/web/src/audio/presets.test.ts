import { describe, expect, it } from "vitest";
import { BEATS_PER_BAR, type Mood, type Note } from "./music";
import { DEFAULT_PRESET, PRESETS, PRESET_IDS } from "./presets";

const MOODS: Mood[] = ["lobby", "question", "hurry"];
const VOICES = ["flute", "pluck", "bass", "drone", "kick", "shaker", "tick"];
const sane = (notes: Note[], label: string, maxBeat = BEATS_PER_BAR) => {
  expect(notes.length, label).toBeGreaterThan(0);
  for (const x of notes) {
    expect(VOICES, `${label} voice ${x.voice}`).toContain(x.voice);
    expect(x.beat, label).toBeGreaterThanOrEqual(0);
    expect(x.beat, label).toBeLessThan(maxBeat);
    expect(x.dur, label).toBeGreaterThan(0);
    expect(x.vel, label).toBeGreaterThan(0);
    expect(x.vel, label).toBeLessThanOrEqual(1);
    expect(x.midi, label).toBeGreaterThanOrEqual(24);
    expect(x.midi, label).toBeLessThanOrEqual(110);
  }
};

describe("sound presets", () => {
  it("Carpathians is the only preset and the default", () => {
    expect(PRESET_IDS).toEqual(["carpathians"]);
    expect(DEFAULT_PRESET).toBe("carpathians");
    expect(PRESETS.carpathians.variants).toEqual(["sopilka", "tsymbaly", "hopak"]);
  });
  it("every bar of every mood has sane notes inside the bar", () => {
    for (const id of PRESET_IDS) for (const mood of MOODS) for (let bar = 0; bar < 16; bar++) sane(PRESETS[id].bar(mood, bar), `${id} ${mood} bar ${bar}`);
  });
  it("tempo rises from the lobby to the last seconds", () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      expect(p.bpm("lobby")).toBeLessThan(p.bpm("question"));
      expect(p.bpm("question")).toBeLessThan(p.bpm("hurry"));
    }
  });
  it("the waiting theme builds with the bars and with the players", () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      sane(p.waitingBar(0, 0), `${id} waiting first bar`);
      expect(p.waitingBar(40, 0).length, id).toBeGreaterThan(p.waitingBar(0, 0).length);
      expect(p.waitingBar(0, 8).length, id).toBeGreaterThan(p.waitingBar(0, 0).length);
    }
  });
  it("the original effects and fanfares are used", () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      expect(p.sfx).toBeNull();
      expect(p.intro).toBeNull();
      for (const k of ["short", "podium"] as const) { const f = p.fanfare(k); expect(f.spb).toBeGreaterThan(0); sane(f.notes, `${id} fanfare ${k}`, 6); }
    }
  });
});
