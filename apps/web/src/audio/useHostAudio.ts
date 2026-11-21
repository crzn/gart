import { useCallback, useEffect, useRef, useState } from "react";
import { secondsLeft, secondsUntilStart, type GameClientState } from "../game/reducer";
import { useNow } from "../game/useNow";
import { useBranding } from "../branding";
import type { AudioEngine } from "./engine";
import type { Mood, Variant } from "./music";

// Sound is used only on the host screen and the projector. This file stays small: the sound engine itself is a separate chunk
// that is downloaded when sound is switched on, never on a participant's phone.

export type Scope = "host" | "screen";
interface Prefs { on: boolean; volume: number; variant: Variant }
const DEFAULTS: Prefs = { on: false, volume: 0.7, variant: "sopilka" };
const key = (scope: Scope) => `gart.sound.${scope}`;
const VARIANT_IDS: Variant[] = ["sopilka", "tsymbaly", "hopak"];

function readPrefs(scope: Scope): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(key(scope)) ?? "null") as Partial<Prefs> | null;
    return { on: false, volume: typeof v?.volume === "number" ? Math.max(0, Math.min(1, v.volume)) : DEFAULTS.volume, variant: VARIANT_IDS.includes(v?.variant as Variant) ? (v?.variant as Variant) : DEFAULTS.variant };
  } catch { return DEFAULTS; }
}
function writePrefs(scope: Scope, p: Prefs) { try { localStorage.setItem(key(scope), JSON.stringify({ volume: p.volume, variant: p.variant })); } catch { /* storage unavailable */ } }

type Phase = "none" | "lobby" | "countdown" | "question" | "closed" | "results" | "leaderboard" | "finished";
function phaseOf(s: GameClientState, now: number): Phase {
  const snap = s.snap;
  if (!snap) return "none";
  switch (snap.state) {
    case "LOBBY": return "lobby";
    case "QUESTION_ACTIVE": return secondsUntilStart(s, now) > 0 ? "countdown" : "question";
    case "QUESTION_RESULTS": return snap.results ? "results" : "closed";
    case "LEADERBOARD": return "leaderboard";
    case "FINISHED": return "finished";
    default: return "none";
  }
}

export interface HostAudio {
  /** Sound is switched on in the Gart settings; when false nothing is offered. */
  allowed: boolean;
  on: boolean;
  loading: boolean;
  volume: number;
  variant: Variant;
  enable(): void;
  disable(): void;
  setVolume(v: number): void;
  setVariant(v: Variant): void;
}

export function useHostAudio(state: GameClientState, scope: Scope): HostAudio {
  // Two switches. The Gart setting "Sound" (Branding tab) turns the intro and the join sound on or off for everything.
  // The quiz setting "Music and sound effects" only controls the music and the other effects.
  const { branding } = useBranding();
  const allowed = branding.soundEnabled;
  const quizSound = state.snap?.settings.soundEnabled === true;
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(scope));
  const [loading, setLoading] = useState(false);
  const engine = useRef<AudioEngine | null>(null);
  const [ready, setReady] = useState(false);
  const now = useNow(200);
  const phase = phaseOf(state, now);
  const left = Math.ceil(secondsLeft(state, now) ?? 99);
  const toStart = Math.ceil(secondsUntilStart(state, now));
  const players = state.snap?.players?.length ?? state.snap?.playerCount ?? 0;
  const live = allowed && prefs.on && ready;
  const musicLive = live && quizSound;

  const enable = useCallback(() => {
    setLoading(true);
    void import("./engine").then(async (m) => {
      const e = engine.current ?? m.createEngine();
      engine.current = e;
      await e.resume(); // allowed here: this runs from the click on the "Enable sound" button
      e.setVolume(prefs.volume);
      setReady(true);
      setPrefs((p) => ({ ...p, on: true }));
    }).catch(() => setPrefs((p) => ({ ...p, on: false }))).finally(() => setLoading(false));
  }, [prefs.volume]);
  const disable = useCallback(() => { engine.current?.stopMusic(); engine.current?.stopBuffer(); setPrefs((p) => ({ ...p, on: false })); }, []);
  const setVolume = useCallback((volume: number) => { engine.current?.setVolume(volume); setPrefs((p) => { const n = { ...p, volume }; writePrefs(scope, n); return n; }); }, [scope]);
  const setVariant = useCallback((variant: Variant) => setPrefs((p) => { const n = { ...p, variant }; writePrefs(scope, n); return n; }), [scope]);
  useEffect(() => () => { engine.current?.dispose(); engine.current = null; }, []);

  // The intro and the join sound follow the Gart setting; music and effects follow the game, if the quiz allows them.
  const introBuf = useRef<AudioBuffer | null>(null);
  useEffect(() => {
    if (!live || introBuf.current) return;
    void import("./jingle").then((j) => j.renderJingle(engine.current?.sampleRate ?? 44100)).then((b) => { introBuf.current = b; }).catch(() => undefined);
  }, [live]);
  const mood = useRef<Mood>("lobby");
  const lastPhase = useRef<Phase>("none");
  const playersNow = useRef(players);
  playersNow.current = players;
  useEffect(() => {
    const e = engine.current;
    if (!e || !live) { e?.stopMusic(); lastPhase.current = "none"; return; }
    const fresh = lastPhase.current !== phase;
    const first = lastPhase.current === "none";
    lastPhase.current = phase;
    const music = (m: Mood, restart = true) => { mood.current = m; e.playMusic(prefs.variant, m, { restart }); };
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (phase === "lobby") {
      if (first && fresh) {
        // The six-second intro, then the waiting theme builds. The intro is not a quiz setting.
        let tries = 0;
        const play = () => {
          if (introBuf.current) e.playBuffer(introBuf.current);
          else if (++tries < 40) timers.push(setTimeout(play, 150)); // the buffer is still being rendered
        };
        play();
        if (quizSound) timers.push(setTimeout(() => e.playWaiting(playersNow.current), 5500)); else e.stopMusic();
      } else if (quizSound && fresh) e.playWaiting(playersNow.current);
      else if (!quizSound) e.stopMusic();
    } else if (!quizSound) e.stopMusic();
    else if (phase === "countdown") { if (fresh) e.stopMusic(); }
    else if (phase === "question") { if (fresh) { e.sfx("go"); music("question"); } }
    else if (phase === "closed") { if (fresh) { e.stopMusic(); e.sfx("timeup"); } }
    else if (phase === "results") { if (fresh) e.sfx("reveal"); }
    else if (phase === "leaderboard") { if (fresh) { e.stopMusic(); e.fanfare("short"); e.sfx("rank"); timers.push(setTimeout(() => e.playWaiting(playersNow.current), 1500)); } }
    else if (phase === "finished") { if (fresh) { e.stopMusic(); e.fanfare("podium"); timers.push(setTimeout(() => e.playWaiting(playersNow.current), 3500)); } }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [phase, live, quizSound, prefs.variant]);
  // The last five seconds: faster music with a tick.
  useEffect(() => {
    const e = engine.current;
    if (!e || !musicLive || phase !== "question") return;
    if (left <= 5 && left > 0 && mood.current !== "hurry") { mood.current = "hurry"; e.playMusic(prefs.variant, "hurry", { restart: false }); }
  }, [left, phase, musicLive, prefs.variant]);
  useEffect(() => { if (musicLive && phase === "countdown" && toStart > 0) engine.current?.sfx("tick"); }, [toStart, phase, musicLive]);
  const seen = useRef(players);
  useEffect(() => {
    if (live && phase === "lobby" && players > seen.current) engine.current?.sfx("join");
    engine.current?.setWaitingPlayers(players);
    seen.current = players;
  }, [players, phase, live]);

  return { allowed, on: prefs.on && ready, loading, volume: prefs.volume, variant: prefs.variant, enable, disable, setVolume, setVariant };
}
