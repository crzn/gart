// Sound for the host screen and the projector, made entirely with the Web Audio API.
// This module is loaded on demand (dynamic import) and only on those two screens: a participant's phone never downloads it.
import { waitingBar, WAITING_BPM } from "./waiting";
import { BEATS_PER_BAR, barNotes, bpmFor, fanfare, midiToHz, type Mood, type Note, type Variant } from "./music";

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
    }
  }
}

function masterChain(ctx: BaseAudioContext): { input: GainNode } {
  const input = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 5; comp.attack.value = 0.005; comp.release.value = 0.2;
  input.connect(comp); comp.connect(ctx.destination);
  return { input };
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
  const { input: master } = masterChain(ctx);
  let volume = 0.7, muted = false;
  const apply = () => master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.03);
  apply();

  let bus: GainNode | null = null;
  let buffer: AudioBufferSourceNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const song = { variant: "sopilka" as Variant, mood: "lobby" as Mood, bar: 0, next: 0, waiting: false, players: 0 };

  function pump() {
    while (bus && song.next < ctx.currentTime + 0.3) {
      const spb = 60 / (song.waiting ? WAITING_BPM : bpmFor(song.variant, song.mood));
      scheduleNotes(ctx, bus, song.waiting ? waitingBar(song.bar, song.players) : barNotes(song.variant, song.mood, song.bar), song.next, spb);
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
    fanfare(kind) { fx((d, t) => scheduleNotes(ctx, d, fanfare(kind), t, 0.3)); },
    dispose() { stopMusic(); try { buffer?.stop(); } catch { /* done */ } void ctx.close(); },
  };
}
