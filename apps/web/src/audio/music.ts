// The score of Gart's background music. Original material written for this project: nothing here is taken from an existing song.
// The sound is made in the browser with the Web Audio API (see engine.ts), so there are no audio files to license, store or download.
//
// Scale: D "Ukrainian Dorian" (D E F G# A B C): a minor scale with the raised fourth, the colour of much Ukrainian folk music.
// This file is pure data and arithmetic so it can be tested without a browser.

export type Variant = "sopilka" | "tsymbaly" | "hopak";
export type Mood = "lobby" | "question" | "hurry";
export type Voice = "flute" | "pluck" | "bass" | "drone" | "kick" | "shaker" | "tick";
export interface Note { beat: number; dur: number; midi: number; voice: Voice; vel: number }

export const VARIANTS: Variant[] = ["sopilka", "tsymbaly", "hopak"];
export const BEATS_PER_BAR = 4;
export const PHRASE_BARS = 8;
const ROOT_MIDI = 62; // D4
const SCALE = [0, 2, 3, 6, 7, 9, 10]; // D E F G# A B C

/** Scale degree to MIDI note. Degree 0 is D4, 7 is D5, -7 is D3; fractional octave steps follow the scale. */
export function degreeToMidi(degree: number): number {
  const octave = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return ROOT_MIDI + (SCALE[idx] ?? 0) + 12 * octave;
}
export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
/** True if a MIDI note belongs to the scale (in any octave). */
export const inScale = (midi: number): boolean => SCALE.includes((((midi - ROOT_MIDI) % 12) + 12) % 12);

// Melody as "degree:beats" tokens; "r" is a rest. Each variant has eight bars (two phrases).
const LEADS: Record<Variant, string[]> = {
  sopilka: [
    "4:1 5:.5 4:.5 2:1 0:1", "2:1.5 3:.5 4:2", "4:1 5:.5 6:.5 7:1.5 6:.5", "5:1 4:1 3:1 4:1",
    "7:1 6:.5 5:.5 4:1 5:1", "6:1.5 5:.5 3:1 4:1", "2:1 3:.5 4:.5 5:1 4:.5 3:.5", "2:1 0:1 0:2",
  ],
  tsymbaly: [
    "0:.5 2:.5 4:.5 2:.5 5:1 4:1", "3:.5 4:.5 5:.5 4:.5 3:1 2:1", "2:.5 4:.5 6:.5 4:.5 7:1 6:1", "5:.5 6:.5 7:.5 6:.5 5:1 4:1",
    "7:.5 9:.5 7:.5 6:.5 5:1 3:1", "6:.5 5:.5 4:.5 3:.5 4:1 2:1", "3:.5 4:.5 5:.5 6:.5 7:1 5:1", "4:1 2:1 0:2",
  ],
  hopak: [
    "0:.5 0:.5 2:.5 4:.5 5:.5 4:.5 2:.5 0:.5", "3:.5 3:.5 4:.5 5:.5 4:1 r:1", "4:.5 4:.5 6:.5 7:.5 8:.5 7:.5 6:.5 4:.5", "5:.5 5:.5 4:.5 3:.5 4:1 r:1",
    "7:.5 8:.5 7:.5 6:.5 5:.5 4:.5 3:.5 4:.5", "2:.5 3:.5 4:.5 5:.5 6:1 5:1", "7:.5 7:.5 6:.5 5:.5 4:.5 3:.5 2:.5 3:.5", "4:.5 3:.5 2:.5 0:.5 0:2",
  ],
};
// Chord roots per bar (scale degrees): triads built on the scale give Dm, F and Am, and the raised fourth in the melody colours them.
const ROOTS: Record<Variant, number[]> = {
  sopilka: [0, 0, 2, 4, 0, 2, 4, 0],
  tsymbaly: [0, 2, 0, 4, 0, 2, 4, 0],
  hopak: [0, 2, 0, 4, 0, 2, 4, 0],
};
const BASE_BPM: Record<Variant, number> = { sopilka: 92, tsymbaly: 104, hopak: 118 };
const MOOD_TEMPO: Record<Mood, number> = { lobby: 1, question: 1.1, hurry: 1.3 };
export const bpmFor = (variant: Variant, mood: Mood): number => Math.round(BASE_BPM[variant] * MOOD_TEMPO[mood]);

function parseBar(text: string): { beat: number; degree: number | null; dur: number }[] {
  let beat = 0;
  return text.split(" ").map((tok) => {
    const [d = "r", len = "1"] = tok.split(":");
    const dur = Number(len.startsWith(".") ? `0${len}` : len);
    const out = { beat, degree: d === "r" ? null : Number(d), dur };
    beat += dur;
    return out;
  });
}

/** Length in beats of one melody bar, rests included (a bar must always add up to a whole bar). */
export const leadBeats = (variant: Variant, bar: number): number => parseBar(LEADS[variant][bar] ?? "").reduce((sum, n) => sum + n.dur, 0);

/** All notes of one bar. The bar number repeats every eight bars; bars after the eighth start the phrase again, one octave brighter on odd rounds. */
export function barNotes(variant: Variant, mood: Mood, barIndex: number): Note[] {
  const bar = ((barIndex % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
  const round = Math.floor(barIndex / PHRASE_BARS);
  const lift = mood !== "lobby" && round % 2 === 1 ? 7 : 0;
  const root = ROOTS[variant][bar] ?? 0;
  const out: Note[] = [];
  const melody = variant === "tsymbaly" ? "pluck" : "flute";
  for (const n of parseBar(LEADS[variant][bar] ?? "")) {
    if (n.degree === null) continue;
    out.push({ beat: n.beat, dur: n.dur * 0.95, midi: degreeToMidi(n.degree + lift), voice: melody, vel: mood === "lobby" ? 0.55 : 0.7 });
  }
  const full = mood !== "lobby";
  // Drone: root and fifth, very quiet, holds the key.
  out.push({ beat: 0, dur: BEATS_PER_BAR, midi: degreeToMidi(-14), voice: "drone", vel: full ? 0.22 : 0.3 });
  out.push({ beat: 0, dur: BEATS_PER_BAR, midi: degreeToMidi(-10), voice: "drone", vel: full ? 0.14 : 0.2 });
  if (variant !== "tsymbaly" || full) {
    // Arpeggio of the chord, on the off-beats so it does not fight the melody.
    const chord = [root, root + 2, root + 4, root + 7];
    for (let i = 0; i < 8; i++) {
      if (!full && i % 2 === 0) continue;
      out.push({ beat: i * 0.5, dur: 0.5, midi: degreeToMidi((chord[i % 4] ?? root) - 7), voice: "pluck", vel: variant === "tsymbaly" ? 0.32 : 0.22 });
    }
  }
  if (full) {
    // Bass walks root and fifth; the dance variant gets an "oom-pah".
    out.push({ beat: 0, dur: 1.5, midi: degreeToMidi(root - 14), voice: "bass", vel: 0.6 });
    out.push({ beat: 2, dur: 1.5, midi: degreeToMidi(root - 10), voice: "bass", vel: 0.5 });
    for (const b of variant === "hopak" ? [0, 2] : [0]) out.push({ beat: b, dur: 0.2, midi: 36, voice: "kick", vel: 0.8 });
    for (let b = 0.5; b < BEATS_PER_BAR; b += 1) out.push({ beat: b, dur: 0.05, midi: 90, voice: "shaker", vel: variant === "hopak" ? 0.5 : 0.28 });
  }
  if (mood === "hurry") for (let b = 0; b < BEATS_PER_BAR; b++) out.push({ beat: b, dur: 0.05, midi: 96, voice: "tick", vel: 0.5 });
  return out.sort((a, b) => a.beat - b.beat);
}

/** Short celebratory phrases: "short" for the leaderboard, "podium" for the end of the game. */
export function fanfare(kind: "short" | "podium"): Note[] {
  const seq: [number, number, number][] = kind === "short"
    ? [[0, 0.25, 0], [0.25, 0.25, 4], [0.5, 0.25, 7], [0.75, 1, 9]]
    : [[0, 0.25, 0], [0.25, 0.25, 4], [0.5, 0.25, 7], [0.75, 0.5, 9], [1.5, 0.25, 7], [1.75, 0.25, 9], [2, 0.25, 11], [2.25, 1.5, 14]];
  const out: Note[] = seq.map(([beat, dur, d]) => ({ beat, dur, midi: degreeToMidi(d), voice: "flute", vel: 0.75 }));
  const last = seq[seq.length - 1]!;
  for (const d of [0, 2, 4]) out.push({ beat: last[0], dur: last[1], midi: degreeToMidi(d - 7), voice: "pluck", vel: 0.45 });
  out.push({ beat: 0, dur: 0.2, midi: 36, voice: "kick", vel: 0.8 }, { beat: last[0], dur: 0.25, midi: 36, voice: "kick", vel: 0.9 });
  return out;
}
