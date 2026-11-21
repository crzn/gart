// The waiting theme for the lobby: a monotone pulse on D that slowly builds while players join. It has no melody to speak of:
// one note (D) and, near the top of the build, its fifth (A). More players move it further along, so a full lobby sounds fuller.
import type { Note } from "./music";

export const WAITING_BPM = 104;
const D2 = 38, D3 = 50, D4 = 62, A4 = 69, D5 = 74;
/** Bars after which the theme stays at full strength and just keeps pulsing. */
export const WAITING_BUILD_BARS = 16;

/** How far along the build a bar is, 0..1. Each joined player counts for one and a half bars, up to eight players. */
export function waitingProgress(bar: number, players: number): number {
  return Math.min(1, (bar + Math.min(Math.max(players, 0), 8) * 1.5) / WAITING_BUILD_BARS);
}

export function waitingBar(bar: number, players: number): Note[] {
  const p = waitingProgress(bar, players);
  const eff = p * WAITING_BUILD_BARS; // the bar number the layers are chosen by
  const swell = 0.35 + 0.65 * p; // everything gets louder as the build goes on
  const n: Note[] = [];
  const add = (beat: number, dur: number, midi: number, voice: Note["voice"], vel: number) => n.push({ beat, dur, midi, voice, vel: +(vel * swell).toFixed(3) });
  for (let b = 0; b < 4; b++) add(b, 0.9, D2, "bass", 0.9);                                  // the pulse, from the first bar
  if (eff >= 2) for (let i = 0; i < 8; i++) add(i / 2, 0.4, D4, "pluck", i % 2 ? 0.45 : 0.7);   // eighth notes on one pitch
  if (eff >= 4) for (let i = 0; i < 4; i++) add(i + 0.5, 0.1, D4, "shaker", 1);
  if (eff >= 6) { add(0, 0.2, D2, "kick", 0.9); add(2, 0.2, D2, "kick", 0.9); }
  if (eff >= 8) add(0, 3.6, D5, "flute", 0.8);                                                  // one long note over everything
  if (eff >= 10) { for (let i = 0; i < 4; i++) add(i, 0.4, D3, "pluck", 0.7); add(2, 1.8, A4, "flute", 0.5); }
  if (eff >= 12) { add(1, 0.2, D2, "kick", 1); add(3, 0.2, D2, "kick", 1); for (let i = 0; i < 8; i++) add(i / 2, 0.1, D4, "tick", 0.5); }
  if (eff >= 14) { for (let i = 0; i < 16; i++) add(i / 4, 0.1, D4, "shaker", i % 2 ? 0.5 : 0.8); add(0, 4, D3, "drone", 1); }
  return n;
}
