// Sound for the host screen and the projector, made entirely with the Web Audio API.
// This module is loaded on demand (dynamic import) and only on those two screens: a participant's phone never downloads it.
import { waitingBar, WAITING_BPM } from "./waiting";
import { BEATS_PER_BAR, barNotes, bpmFor, midiToHz, type Mood, type Note, type Variant } from "./music";
import { PRESETS, type Fx, type PresetId } from "./presets";

export type SfxName = "join" | "tick" | "go" | "timeup" | "reveal" | "rank";

let noise: AudioBuffer | null = null;
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345; // fixed seed: the same "breath" every time, and offline renders are reproducible
  for (let i = 0; i < d.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 0xffffffff) * 2 - 1; }
  noise = buf;
  return buf;
}

export function env(ctx: BaseAudioContext, dest: AudioNode, t: number, peak: number, attack: number, hold: number, release: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  g.connect(dest);
  return g;
}

/** Folk flute (sopilka): soft sine with a touch of triangle, gentle vibrato and a breath of noise at the start. */
export function flute(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.22 * vel, 0.045, Math.max(0.02, dur - 0.1), 0.09);
  const end = t + dur + 0.2;
  const o1 = ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = hz;
  const o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = hz * 2;
  const g2 = ctx.createGain(); g2.gain.value = 0.18;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
  const depth = ctx.createGain(); depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(hz * 0.007, t + 0.25);
  lfo.connect(depth); depth.connect(o1.frequency); depth.connect(o2.frequency);
  o1.connect(g); o2.connect(g2); g2.connect(g);
  const breath = ctx.createBufferSource(); breath.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = Math.min(hz * 3, 6000); bp.Q.value = 1.2;
  const bg = ctx.createGain(); bg.gain.setValueAtTime(0.05 * vel, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  breath.connect(bp); bp.connect(bg); bg.connect(dest);
  for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end); }
  breath.start(t); breath.stop(t + 0.15);
}

/** Dulcimer (tsymbaly): bright, quickly fading plucked tone, two slightly detuned strings. */
export function pluck(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const ring = Math.min(1.4, 0.35 + dur * 0.9);
  const g = env(ctx, dest, t, 0.26 * vel, 0.004, 0, ring);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(Math.min(hz * 9, 9000), t); lp.frequency.exponentialRampToValueAtTime(Math.max(hz * 1.5, 400), t + ring);
  lp.connect(g);
  for (const [type, detune] of [["triangle", 0], ["sine", 6]] as const) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz; o.detune.value = detune;
    o.connect(lp); o.start(t); o.stop(t + ring + 0.1);
  }
}

export function bass(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.3 * vel, 0.01, Math.max(0.02, dur * 0.4), Math.max(0.1, dur * 0.6));
  const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = hz;
  o.connect(g); o.start(t); o.stop(t + dur + 0.3);
}

function drone(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.12 * vel, 0.35, Math.max(0, dur - 0.5), 0.35);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.connect(g);
  for (const detune of [-5, 5]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = detune; o.connect(lp); o.start(t); o.stop(t + dur + 0.5); }
}

export function kick(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number) {
  const g = env(ctx, dest, t, 0.55 * vel, 0.002, 0, 0.16);
  const o = ctx.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  o.connect(g); o.start(t); o.stop(t + 0.25);
}

export function shaker(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6500;
  const g = env(ctx, dest, t, 0.09 * vel, 0.002, 0.01, 0.05);
  src.connect(hp); hp.connect(g); src.start(t, 0.1, 0.1);
}

export function tick(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number, hz = 1500) {
  const g = env(ctx, dest, t, 0.16 * vel, 0.001, 0.005, 0.04);
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = hz;
  o.connect(g); o.start(t); o.stop(t + 0.08);
}

/* ---------------------------------------------------------------- voices of the other presets */

/** Warm synth pad: three detuned saws behind a slowly opening low-pass, plus a sine an octave below. */
export function pad(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.085 * vel, 0.9, Math.max(0.02, dur - 1.2), 0.9);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1700, t + Math.min(dur, 2.4)); lp.connect(g);
  for (const detune of [-11, 0, 11]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = detune; o.connect(lp); o.start(t); o.stop(t + dur + 0.9); }
  const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = hz / 2;
  const sg = ctx.createGain(); sg.gain.value = 0.5; sub.connect(sg); sg.connect(g); sub.start(t); sub.stop(t + dur + 0.9);
}

/** Synth lead: saw and square behind an opening filter, late vibrato. */
export function lead(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.15 * vel, 0.02, Math.max(0.02, dur - 0.12), 0.2);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 3;
  lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(3200, t + 0.25); lp.connect(g);
  const o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = hz;
  const o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = hz; o2.detune.value = 7;
  const g2 = ctx.createGain(); g2.gain.value = 0.45;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
  const depth = ctx.createGain(); depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(hz * 0.004, t + 0.4);
  lfo.connect(depth); depth.connect(o1.frequency); depth.connect(o2.frequency);
  o1.connect(lp); o2.connect(g2); g2.connect(lp);
  const end = t + dur + 0.3;
  for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end); }
}

/** Analog-sequencer pluck: a saw with a quickly closing filter. */
export function arp(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const ring = Math.min(0.28, dur + 0.1);
  const g = env(ctx, dest, t, 0.15 * vel, 0.003, 0, ring);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 4;
  lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(500, t + ring); lp.connect(g);
  const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.connect(lp); o.start(t); o.stop(t + ring + 0.1);
}

export function synbass(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.3 * vel, 0.008, Math.max(0.02, dur * 0.5), Math.max(0.08, dur * 0.5));
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2;
  lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(250, t + Math.max(0.15, dur)); lp.connect(g);
  const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.connect(lp);
  const s = ctx.createOscillator(); s.type = "sine"; s.frequency.value = hz; s.connect(g);
  for (const x of [o, s]) { x.start(t); x.stop(t + dur + 0.4); }
}

export function clap(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number) {
  for (const [dt, k] of [[0, 1], [0.011, 0.7], [0.023, 0.5]] as const) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 0.9;
    const g = env(ctx, dest, t + dt, 0.2 * vel * k, 0.002, 0.012, dt === 0.023 ? 0.14 : 0.03);
    src.connect(bp); bp.connect(g); src.start(t + dt, 0.4, 0.2);
  }
}

export function tom(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, vel: number) {
  const g = env(ctx, dest, t, 0.4 * vel, 0.002, 0.02, 0.22);
  const o = ctx.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(hz * 1.6, t); o.frequency.exponentialRampToValueAtTime(hz * 0.8, t + 0.2);
  o.connect(g); o.start(t); o.stop(t + 0.3);
}

/** Glass bell: two-operator FM with a modulation that dies away, so the tone starts bright and ends pure. */
export function bell(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const ring = Math.min(3.2, 1 + dur * 1.2);
  const g = env(ctx, dest, t, 0.19 * vel, 0.003, 0, ring);
  const car = ctx.createOscillator(); car.type = "sine"; car.frequency.value = hz;
  const mod = ctx.createOscillator(); mod.type = "sine"; mod.frequency.value = hz * 3.5;
  const mg = ctx.createGain(); mg.gain.setValueAtTime(hz * 2.2, t); mg.gain.exponentialRampToValueAtTime(0.5, t + ring * 0.6);
  mod.connect(mg); mg.connect(car.frequency); car.connect(g);
  const up = ctx.createOscillator(); up.type = "sine"; up.frequency.value = hz * 2;
  const ug = ctx.createGain(); ug.gain.value = 0.12; up.connect(ug); ug.connect(g);
  for (const o of [car, mod, up]) { o.start(t); o.stop(t + ring + 0.1); }
}

/** Music box: a sine with a bright third partial and a short ring. */
export function musicbox(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, _dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.2 * vel, 0.002, 0, 0.7);
  const a = ctx.createOscillator(); a.type = "sine"; a.frequency.value = hz; a.connect(g);
  const b = ctx.createOscillator(); b.type = "sine"; b.frequency.value = hz * 3;
  const bg = ctx.createGain(); bg.gain.setValueAtTime(0.28, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.25); b.connect(bg); bg.connect(g);
  for (const o of [a, b]) { o.start(t); o.stop(t + 0.8); }
}

/** Marimba: a sine plus a short "knock" four times higher. */
export function marimba(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, _dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.26 * vel, 0.003, 0, 0.38);
  const a = ctx.createOscillator(); a.type = "sine"; a.frequency.value = hz; a.connect(g);
  const b = ctx.createOscillator(); b.type = "sine"; b.frequency.value = hz * 4;
  const bg = ctx.createGain(); bg.gain.setValueAtTime(0.3, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.07); b.connect(bg); bg.connect(g);
  for (const o of [a, b]) { o.start(t); o.stop(t + 0.5); }
}

/** Glockenspiel: bright, inharmonic partial, medium ring. */
export function glock(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, _dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.15 * vel, 0.002, 0, 0.55);
  const a = ctx.createOscillator(); a.type = "sine"; a.frequency.value = hz; a.connect(g);
  const b = ctx.createOscillator(); b.type = "sine"; b.frequency.value = hz * 2.76;
  const bg = ctx.createGain(); bg.gain.setValueAtTime(0.3, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.2); b.connect(bg); bg.connect(g);
  for (const o of [a, b]) { o.start(t); o.stop(t + 0.65); }
}

/** Plucked bass for the cheerful preset: a triangle with a quickly falling filter. */
export function pizz(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, _dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.3 * vel, 0.004, 0, 0.22);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
  lp.frequency.setValueAtTime(1300, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.2); lp.connect(g);
  const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = hz; o.connect(lp); o.start(t); o.stop(t + 0.35);
}

/** Choir-like pad: detuned saws through vowel-like band-pass filters, slow attack and a faint vibrato. */
export function choir(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.12 * vel, 0.9, Math.max(0.02, dur - 1.3), 1);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 4.6;
  const depth = ctx.createGain(); depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(hz * 0.005, t + 1.2); lfo.connect(depth);
  const formants: [number, number, number][] = [[620, 6, 2.2], [1050, 8, 1.6], [2500, 8, 0.6]];
  const bank = ctx.createGain(); bank.connect(g);
  for (const [f, q, gain] of formants) {
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
    const fg = ctx.createGain(); fg.gain.value = gain; bp.connect(fg); fg.connect(bank);
    for (const detune of [-8, 8]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = detune; depth.connect(o.frequency); o.connect(bp); o.start(t); o.stop(t + dur + 1); }
  }
  lfo.start(t); lfo.stop(t + dur + 1);
}

/** A swell of breathy noise that opens up and then falls away. */
export function swell(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, vel: number) {
  const g = env(ctx, dest, t, 0.2 * vel, dur * 0.8, 0, dur * 0.2 + 0.05);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2400, t + dur);
  src.connect(bp); bp.connect(g); src.start(t); src.stop(t + dur + 0.1);
}

/** A soft low thump, used in pairs for a heartbeat. */
export function heart(ctx: BaseAudioContext, dest: AudioNode, t: number, vel: number) {
  const g = env(ctx, dest, t, 0.55 * vel, 0.004, 0.01, 0.24);
  const o = ctx.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.16);
  o.connect(g); o.start(t); o.stop(t + 0.35);
}

/** Plays notes whose time is given in beats, starting at `t0`. */
export function scheduleNotes(ctx: BaseAudioContext, dest: AudioNode, notes: Note[], t0: number, secondsPerBeat: number) {
  for (const n of notes) {
    const t = t0 + n.beat * secondsPerBeat, dur = n.dur * secondsPerBeat, hz = midiToHz(n.midi);
    switch (n.voice) {
      case "flute": flute(ctx, dest, t, hz, dur, n.vel); break;
      case "pluck": pluck(ctx, dest, t, hz, dur, n.vel); break;
      case "bass": bass(ctx, dest, t, hz, dur, n.vel); break;
      case "drone": drone(ctx, dest, t, hz, dur, n.vel); break;
      case "kick": kick(ctx, dest, t, n.vel); break;
      case "shaker": shaker(ctx, dest, t, n.vel); break;
      case "tick": tick(ctx, dest, t, n.vel, 1100); break;
      case "pad": pad(ctx, dest, t, hz, dur, n.vel); break;
      case "lead": lead(ctx, dest, t, hz, dur, n.vel); break;
      case "arp": arp(ctx, dest, t, hz, dur, n.vel); break;
      case "synbass": synbass(ctx, dest, t, hz, dur, n.vel); break;
      case "clap": clap(ctx, dest, t, n.vel); break;
      case "tom": tom(ctx, dest, t, hz, n.vel); break;
      case "bell": bell(ctx, dest, t, hz, dur, n.vel); break;
      case "musicbox": musicbox(ctx, dest, t, hz, dur, n.vel); break;
      case "marimba": marimba(ctx, dest, t, hz, dur, n.vel); break;
      case "glock": glock(ctx, dest, t, hz, dur, n.vel); break;
      case "pizz": pizz(ctx, dest, t, hz, dur, n.vel); break;
      case "choir": choir(ctx, dest, t, hz, dur, n.vel); break;
      case "swell": swell(ctx, dest, t, dur, n.vel); break;
      case "heart": heart(ctx, dest, t, n.vel); break;
    }
  }
}

/** A short hall: exponentially decaying stereo noise of the given length. */
function hallImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds)), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 424242;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = ((seed / 0xffffffff) * 2 - 1) * Math.exp(-5 * (i / len)); }
  }
  return buf;
}

/** Everything goes through a compressor. A preset can add a tape-like echo and a hall; with none, the sound is dry. */
function masterChain(ctx: BaseAudioContext, fx: Fx | null = null): { input: GainNode; setFx(fx: Fx | null): void } {
  const input = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 5; comp.attack.value = 0.005; comp.release.value = 0.2;
  comp.connect(ctx.destination);
  input.connect(comp);
  const delay = ctx.createDelay(2), feedback = ctx.createGain(), tone = ctx.createBiquadFilter(), echo = ctx.createGain();
  tone.type = "lowpass"; tone.frequency.value = 2600;
  input.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(echo); echo.connect(comp);
  const hall = ctx.createConvolver(), hallMix = ctx.createGain();
  input.connect(hall); hall.connect(hallMix); hallMix.connect(comp);
  echo.gain.value = 0; hallMix.gain.value = 0; feedback.gain.value = 0;
  const setFx = (f: Fx | null) => {
    const t = ctx.currentTime;
    echo.gain.setTargetAtTime(f?.delayMix ?? 0, t, 0.05);
    hallMix.gain.setTargetAtTime(f?.reverbMix ?? 0, t, 0.05);
    feedback.gain.setTargetAtTime(f?.delayFeedback ?? 0, t, 0.05);
    if (f) { delay.delayTime.setTargetAtTime(f.delaySec, t, 0.05); hall.buffer = hallImpulse(ctx, f.reverbSec); }
  };
  setFx(fx);
  return { input, setFx };
}

/** Renders a few bars of a variant to a buffer (used by the "save a sample" button and by tests). */
export async function renderMusic(variant: Variant, mood: Mood, bars: number, sampleRate = 22050): Promise<AudioBuffer> {
  const spb = 60 / bpmFor(variant, mood);
  const seconds = bars * BEATS_PER_BAR * spb + 1.5;
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const { input } = masterChain(ctx);
  input.gain.value = 0.8;
  for (let b = 0; b < bars; b++) scheduleNotes(ctx, input, barNotes(variant, mood, b), b * BEATS_PER_BAR * spb, spb);
  return ctx.startRendering();
}

/** Renders the waiting theme from the first bar (used by the listening page and by tests). */
export async function renderWaiting(bars: number, players: number, sampleRate = 22050): Promise<AudioBuffer> {
  const spb = 60 / WAITING_BPM;
  const ctx = new OfflineAudioContext(1, Math.ceil((bars * BEATS_PER_BAR * spb + 1.5) * sampleRate), sampleRate);
  const { input } = masterChain(ctx);
  input.gain.value = 0.8;
  for (let b = 0; b < bars; b++) scheduleNotes(ctx, input, waitingBar(b, players), b * BEATS_PER_BAR * spb, spb);
  return ctx.startRendering();
}

/** A preset's music in one mood, or a demo of all of it: lobby, question and hurry music, then both fanfares. Used by the listening page and by tests. */
export async function renderPresetDemo(id: PresetId, sampleRate = 22050, variant?: Variant): Promise<AudioBuffer> {
  const p = PRESETS[id];
  const parts: { mood: Mood; bars: number }[] = [{ mood: "lobby", bars: 4 }, { mood: "question", bars: 8 }, { mood: "hurry", bars: 4 }];
  let seconds = 1;
  for (const part of parts) seconds += part.bars * BEATS_PER_BAR * (60 / p.bpm(part.mood, variant));
  seconds += 4 + 5;
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const { input } = masterChain(ctx, p.fx);
  input.gain.value = 0.8;
  let t = 0.1;
  for (const part of parts) {
    const spb = 60 / p.bpm(part.mood, variant);
    for (let b = 0; b < part.bars; b++) scheduleNotes(ctx, input, p.bar(part.mood, b, variant), t + b * BEATS_PER_BAR * spb, spb);
    t += part.bars * BEATS_PER_BAR * spb;
  }
  for (const kind of ["short", "podium"] as const) {
    const f = p.fanfare(kind);
    scheduleNotes(ctx, input, f.notes, t + 0.3, f.spb);
    t += 4;
  }
  return ctx.startRendering();
}

/** A preset's waiting theme from the first bar. */
export async function renderPresetWaiting(id: PresetId, bars: number, players: number, sampleRate = 22050): Promise<AudioBuffer> {
  const p = PRESETS[id];
  const spb = 60 / p.waitingBpm;
  const ctx = new OfflineAudioContext(1, Math.ceil((bars * BEATS_PER_BAR * spb + 2) * sampleRate), sampleRate);
  const { input } = masterChain(ctx, p.fx);
  input.gain.value = 0.8;
  for (let b = 0; b < bars; b++) scheduleNotes(ctx, input, p.waitingBar(b, players), b * BEATS_PER_BAR * spb, spb);
  return ctx.startRendering();
}

/** A preset's opening sting (the Carpathians use the original intro in jingle.ts). */
export async function renderPresetIntro(id: PresetId, sampleRate = 22050): Promise<AudioBuffer | null> {
  const p = PRESETS[id];
  if (!p.intro) return null;
  const ctx = new OfflineAudioContext(1, Math.ceil(p.intro.seconds * sampleRate), sampleRate);
  const { input } = masterChain(ctx, p.fx);
  input.gain.value = 0.8;
  scheduleNotes(ctx, input, p.intro.notes, 0.05, p.intro.spb);
  return ctx.startRendering();
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const ch = buffer.numberOfChannels, n = buffer.length, bytes = n * ch * 2;
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  const out = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + bytes, true); str(8, "WAVEfmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, bytes, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, chans[c]?.[i] ?? 0)) * 0x7fff, true);
  return new Blob([out], { type: "audio/wav" });
}

export interface AudioEngine {
  readonly sampleRate: number;
  resume(): Promise<void>;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  /** Switches the whole sound to a preset (music, waiting theme, effects, fanfares). The original sound is "carpathians". */
  setPreset(id: PresetId): void;
  /** Starts (or switches to) background music. A new mood of the same variant takes effect at the next bar. */
  playMusic(variant: Variant, mood: Mood, opts?: { restart?: boolean }): void;
  /** The lobby waiting theme: a monotone pulse that builds while players join. */
  playWaiting(players: number): void;
  setWaitingPlayers(n: number): void;
  /** Plays a pre-rendered buffer (the intro jingle). */
  playBuffer(buf: AudioBuffer): void;
  /** Cuts off a buffer started with playBuffer. */
  stopBuffer(): void;
  stopMusic(): void;
  sfx(name: SfxName): void;
  fanfare(kind: "short" | "podium"): void;
  dispose(): void;
}

export function createEngine(): AudioEngine {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const { input: master, setFx } = masterChain(ctx);
  let volume = 0.7, muted = false;
  const apply = () => master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.03);
  apply();

  let bus: GainNode | null = null;
  let buffer: AudioBufferSourceNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const song = { preset: "carpathians" as PresetId, variant: "sopilka" as Variant, mood: "lobby" as Mood, bar: 0, next: 0, waiting: false, players: 0 };

  function pump() {
    while (bus && song.next < ctx.currentTime + 0.3) {
      const preset = PRESETS[song.preset];
      const spb = 60 / (song.waiting ? preset.waitingBpm : preset.bpm(song.mood, song.variant));
      scheduleNotes(ctx, bus, song.waiting ? preset.waitingBar(song.bar, song.players) : preset.bar(song.mood, song.bar, song.variant), song.next, spb);
      song.bar++;
      song.next += BEATS_PER_BAR * spb;
    }
  }
  function stopMusic() {
    if (timer) { clearInterval(timer); timer = null; }
    if (bus) {
      const old = bus;
      old.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.setValueAtTime(old.gain.value, ctx.currentTime);
      old.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
      setTimeout(() => old.disconnect(), 400);
      bus = null;
    }
  }
  const fx = (fn: (dest: AudioNode, t: number) => void) => { if (ctx.state === "running") fn(master, ctx.currentTime + 0.01); };

  return {
    sampleRate: ctx.sampleRate,
    resume: () => ctx.resume(),
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); apply(); },
    setMuted(m) { muted = m; apply(); },
    setPreset(id) {
      if (String(song.preset) === id) return;
      song.preset = id;
      setFx(PRESETS[id].fx);
      if (bus) { const was = song.waiting, mood = song.mood, players = song.players; stopMusic(); if (was) this.playWaiting(players); else this.playMusic(song.variant, mood, { restart: true }); }
    },
    playMusic(variant, mood, opts) {
      const restart = opts?.restart || !bus || song.variant !== variant;
      song.variant = variant; song.mood = mood;
      if (!restart && !song.waiting) return;
      song.waiting = false;
      stopMusic();
      bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(master);
      song.bar = 0; song.next = ctx.currentTime + 0.08;
      pump();
      timer = setInterval(pump, 40);
    },
    stopMusic,
    playWaiting(players) {
      stopMusic();
      song.waiting = true; song.players = players;
      bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(master);
      song.bar = 0; song.next = ctx.currentTime + 0.08;
      pump();
      timer = setInterval(pump, 40);
    },
    setWaitingPlayers(n) { song.players = n; },
    playBuffer(buf) {
      if (ctx.state !== "running") return;
      try { buffer?.stop(); } catch { /* already finished */ }
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(master); src.start(ctx.currentTime + 0.02);
      buffer = src;
    },
    stopBuffer() { try { buffer?.stop(); } catch { /* already finished */ } buffer = null; },
    sfx(name) {
      const custom = PRESETS[song.preset].sfx;
      if (custom) { fx((d, t) => scheduleNotes(ctx, d, custom(name), t, 1)); return; }
      fx((d, t) => {
        switch (name) {
          case "join": tick(ctx, d, t, 0.9, 880); tick(ctx, d, t + 0.09, 0.9, 1320); break;
          case "tick": tick(ctx, d, t, 1, 1500); break;
          case "go": scheduleNotes(ctx, d, [0, 4, 7].map((deg, i) => ({ beat: i * 0.1, dur: 0.18, midi: 74 + deg * 1.7 | 0, voice: "pluck" as const, vel: 0.9 })), t, 1); break;
          case "timeup": {
            const g = env(ctx, d, t, 0.2, 0.01, 0.25, 0.25);
            const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.5);
            const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 0.6); break;
          }
          case "reveal": for (const [m, v] of [[81, 0.8], [88, 0.4], [93, 0.25]] as const) pluck(ctx, d, t, midiToHz(m), 1.2, v); break;
          case "rank": {
            const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
            const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2; bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
            const g = env(ctx, d, t, 0.22, 0.05, 0.1, 0.18); src.connect(bp); bp.connect(g); src.start(t, 0.2, 0.4); break;
          }
        }
      });
    },
    fanfare(kind) { const f = PRESETS[song.preset].fanfare(kind); fx((d, t) => scheduleNotes(ctx, d, f.notes, t, f.spb)); },
    dispose() { stopMusic(); try { buffer?.stop(); } catch { /* done */ } void ctx.close(); },
  };
}
