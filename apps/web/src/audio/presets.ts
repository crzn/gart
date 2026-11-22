// Sound presets. Gart has one for now: "carpathians", the original sound (folk flute, dulcimer and dance in a D "Ukrainian Dorian" scale).
// The structure stays so that another preset can be added later. This file is pure data and arithmetic so it can be tested without a browser.
import { barNotes, bpmFor, fanfare as carpathianFanfare, type Mood, type Note, type Variant } from "./music";
import { WAITING_BPM, waitingBar as carpathianWaiting } from "./waiting";

export type PresetId = "carpathians";
export const PRESET_IDS: PresetId[] = ["carpathians"];
export const DEFAULT_PRESET: PresetId = "carpathians";
export type PresetSfx = "join" | "tick" | "go" | "timeup" | "reveal" | "rank";

/** Reverb and echo of a preset (applied by the master chain). Mixes are 0..1. */
export interface Fx { reverbSec: number; reverbMix: number; delaySec: number; delayFeedback: number; delayMix: number }

export interface Preset {
  id: PresetId;
  fx: Fx | null;
  /** The variants of the music (null: one variant only). */
  variants: Variant[] | null;
  bpm(mood: Mood, variant?: Variant): number;
  bar(mood: Mood, barIndex: number, variant?: Variant): Note[];
  waitingBpm: number;
  waitingBar(bar: number, players: number): Note[];
  fanfare(kind: "short" | "podium"): { notes: Note[]; spb: number };
  /** Effects in notes; null means the original effects of the engine. */
  sfx: ((name: PresetSfx) => Note[]) | null;
  /** The short opening sting; null means the original six-second intro. */
  intro: { notes: Note[]; spb: number; seconds: number } | null;
}

/* ------------------------------------------------------------------ Carpathians (the original sound) */

const carpathians: Preset = {
  id: "carpathians",
  fx: null,
  variants: ["sopilka", "tsymbaly", "hopak"],
  bpm: (mood, variant = "sopilka") => bpmFor(variant, mood),
  bar: (mood, i, variant = "sopilka") => barNotes(variant, mood, i),
  waitingBpm: WAITING_BPM,
  waitingBar: carpathianWaiting,
  fanfare: (kind) => ({ notes: carpathianFanfare(kind), spb: 0.3 }),
  sfx: null,
  intro: null,
};

export const PRESETS: Record<PresetId, Preset> = { carpathians };
export const isPresetId = (v: unknown): v is PresetId => typeof v === "string" && (PRESET_IDS as string[]).includes(v);
