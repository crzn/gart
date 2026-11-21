// The six-second Gart intro: an original sting for the start of a game or a broadcast, written in the same D "Ukrainian Dorian"
// scale as the background music. Everything is synthesised with Web Audio (bandura-like plucks, sopilka, brass, strings, timpani,
// electronic drums, bass and a generated room reverb), so there is nothing to license and nothing to download.
//
//   0-1 s  big drum hit and a bandura flourish        3-5 s  brass fanfare over an electronic beat
//   1-3 s  rising sopilka melody                      5-6 s  orchestral final hit and a short reverb tail
import { env, kick, noiseBuffer, pluck, shaker, flute, bass } from "./engine";
import { degreeToMidi, midiToHz } from "./music";

export const JINGLE_SECONDS = 6;
const hz = (degree: number) => midiToHz(degreeToMidi(degree));

/** A short room: exponentially decaying stereo noise. */
function reverbImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 98765;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = ((seed / 0xffffffff) * 2 - 1) * Math.exp(-4.2 * (i / len)) * (1 - i / len); }
  }
  return buf;
}

/** Brass: three detuned saw waves, a filter that opens as the note speaks, a slight scoop up to pitch. */
function brass(ctx: BaseAudioContext, dest: AudioNode, t: number, freq: number, dur: number, vel: number, pan: number) {
  const g = env(ctx, dest, t, 0.22 * vel, 0.035, Math.max(0.02, dur - 0.18), 0.16);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.1;
  lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(4200, t + 0.14); lp.frequency.exponentialRampToValueAtTime(2200, t + dur);
  const p = ctx.createStereoPanner(); p.pan.value = pan; lp.connect(p); p.connect(g);
  for (const detune of [-9, 0, 9]) {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = freq; o.detune.setValueAtTime(detune - 60, t); o.detune.linearRampToValueAtTime(detune, t + 0.06);
    o.connect(lp); o.start(t); o.stop(t + dur + 0.25);
  }
}

/** String section: soft saw stack with a slow swell, holds the harmony under the brass. */
function strings(ctx: BaseAudioContext, dest: AudioNode, t: number, freq: number, dur: number, vel: number, pan: number) {
  const g = env(ctx, dest, t, 0.07 * vel, 0.25, Math.max(0.02, dur - 0.3), 0.3);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
  const p = ctx.createStereoPanner(); p.pan.value = pan; lp.connect(p); p.connect(g);
  for (const detune of [-12, -4, 4, 12]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = freq; o.detune.value = detune; o.connect(lp); o.start(t); o.stop(t + dur + 0.4); }
}

/** Orchestral hit: timpani, a burst of noise and a chord, all at once. */
function hit(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number, tail: number) {
  kick(ctx, dest, t, 1.1 * vel);
  const tim = ctx.createOscillator(); tim.type = "sine"; tim.frequency.setValueAtTime(95, t); tim.frequency.exponentialRampToValueAtTime(58, t + 0.25);
  const tg = env(ctx, dest, t, 0.5 * vel, 0.004, 0.05, tail * 0.5); tim.connect(tg); tim.start(t); tim.stop(t + tail);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter(); bp.type = "highpass"; bp.frequency.value = 1500;
  const cg = env(ctx, dest, t, 0.22 * vel, 0.002, 0.04, tail * 0.7); src.connect(bp); bp.connect(cg); src.start(t, 0.3, tail);
  const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = hz(-14);
  const sg = env(ctx, dest, t, 0.45 * vel, 0.005, 0.1, tail * 0.6); sub.connect(sg); sub.start(t); sub.stop(t + tail);
}

function clap(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
  const g = env(ctx, dest, t, 0.28 * vel, 0.002, 0.03, 0.14); src.connect(bp); bp.connect(g); src.start(t, 0.5, 0.25);
}

export function scheduleJingle(ctx: BaseAudioContext, out: AudioNode) {
  const dry = ctx.createGain(), wet = ctx.createGain(), rev = ctx.createConvolver();
  rev.buffer = reverbImpulse(ctx, 1.0); wet.gain.value = 0.3; dry.gain.value = 1;
  dry.connect(out); wet.connect(rev); rev.connect(out);
  const bus = ctx.createGain(); bus.connect(dry); bus.connect(wet);
  const B = 0.5; // 120 BPM: one beat is half a second

  // 0-1 s: explosive hit, then a bandura flourish racing up the scale.
  hit(ctx, bus, 0, 1, 1.2);
  [-14, -10, -7, -5, -3, -1, 0, 2, 4, 5, 7, 9].forEach((d, i) => pluck(ctx, bus, 0.04 + i * 0.062, hz(d), 0.5, 0.95 - i * 0.02));
  strings(ctx, bus, 0, hz(-7), 1.0, 0.8, -0.3); strings(ctx, bus, 0, hz(-3), 1.0, 0.8, 0.3);

  // 1-3 s: sopilka climbs, bandura arpeggios (Dm, F, Am, Dm) underneath, a beat starts.
  const melody: [number, number, number][] = [[1, 0.25, 4], [1.25, 0.25, 5], [1.5, 0.5, 7], [2, 0.25, 6], [2.25, 0.25, 7], [2.5, 0.25, 8], [2.75, 0.25, 10]];
  for (const [t, dur, d] of melody) { flute(ctx, bus, t, hz(d), dur * 1.15, 1.25); flute(ctx, bus, t, hz(d + 7), dur * 1.1, 0.35); }
  const chords = [[0, 2, 4], [0, 2, 4], [2, 4, 6], [4, 6, 8]]; // roots: Dm Dm F Am, one per half second
  chords.forEach((c, bar) => c.forEach((d, i) => pluck(ctx, bus, 1 + bar * B + i * 0.16, hz(d - 7), 0.4, 0.55)));
  for (let t = 1; t < 3; t += B) kick(ctx, bus, t, 0.8);
  for (let t = 1.25; t < 3; t += B) shaker(ctx, bus, t, 1.3);
  for (let t = 1; t < 3; t += 0.25) bass(ctx, bus, t, hz(-14), 0.2, 0.7);

  // 3-5 s: brass fanfare on Dm, F, Am and back, with a driving electronic rhythm.
  const fanfare: [number, number, number[]][] = [[3, 0.7, [0, 2, 4, 7]], [3.75, 0.25, [2, 4, 6, 9]], [4, 0.45, [4, 6, 8, 11]], [4.5, 0.45, [0, 2, 4, 7]]];
  for (const [t, dur, ds] of fanfare) ds.forEach((d, i) => { brass(ctx, bus, t, hz(d), dur, 1, -0.4 + i * 0.27); strings(ctx, bus, t, hz(d - 7), dur, 0.8, 0); });
  for (const t of [3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75]) { kick(ctx, bus, t, 0.95); bass(ctx, bus, t, hz(fanfare.find(([ft, fd]) => t >= ft && t < ft + fd)?.[2][0] ? (t >= 4 && t < 4.5 ? -10 : t >= 3.75 && t < 4 ? -12 : -14) : -14), 0.22, 0.9); }
  for (const t of [3.5, 4.5]) clap(ctx, bus, t, 1);
  for (let t = 3; t < 5; t += 0.125) shaker(ctx, bus, t, t % 0.25 === 0 ? 0.8 : 1.4);

  // 5-6 s: the final hit, a chord that rings, and a tail that is faded out exactly at six seconds.
  hit(ctx, bus, 5, 1.2, 1.0);
  for (const d of [0, 2, 4, 7, 9]) { brass(ctx, bus, 5, hz(d), 0.75, 1.1, (d % 3 - 1) * 0.35); strings(ctx, bus, 5, hz(d - 7), 0.9, 1, 0); }
  pluck(ctx, bus, 5.02, hz(14), 1.5, 0.8); pluck(ctx, bus, 5.02, hz(11), 1.5, 0.6);
}

/** Renders the intro to a stereo buffer of exactly six seconds. */
export async function renderJingle(sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, JINGLE_SECONDS * sampleRate, sampleRate);
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.18;
  master.gain.setValueAtTime(0.9, 0); master.gain.setValueAtTime(0.9, 5.55); master.gain.linearRampToValueAtTime(0, JINGLE_SECONDS - 0.02);
  master.connect(comp); comp.connect(ctx.destination);
  scheduleJingle(ctx, master);
  return ctx.startRendering();
}
