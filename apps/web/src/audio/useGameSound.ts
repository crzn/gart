import { useCallback, useEffect, useRef, useState } from "react";
import { secondsLeft, secondsUntilStart, type GameClientState } from "../game/reducer";
import { useNow } from "../game/useNow";
import type { AudioEngine } from "./engine";
import type { Mood } from "./music";

// The game sound, on every screen that plays it: the host's screen, the projector and the players' phones.
// It is off until someone clicks it on (browsers allow sound only after a click), and the choice is never remembered.
// There is one sound scheme (Carpathians) and one music variant, so nobody has to choose anything.
// The sound engine is a separate chunk, downloaded only when sound is switched on.

const VARIANT = "sopilka";
const VOLUME = 0.7;

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

export interface GameSound {
  on: boolean;
  loading: boolean;
  enable(): void;
  disable(): void;
}

export function useGameSound(state: GameClientState): GameSound {
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const engine = useRef<AudioEngine | null>(null);
  const now = useNow(200);
  const phase = phaseOf(state, now);
  const left = Math.ceil(secondsLeft(state, now) ?? 99);
  const toStart = Math.ceil(secondsUntilStart(state, now));
  const players = state.snap?.players?.length ?? state.snap?.playerCount ?? 0;

  const enable = useCallback(() => {
    setLoading(true);
    void import("./engine").then(async (m) => {
      const e = engine.current ?? m.createEngine();
      engine.current = e;
      await e.resume(); // allowed here: this runs from the click
      e.setVolume(VOLUME);
      setOn(true);
    }).catch(() => setOn(false)).finally(() => setLoading(false));
  }, []);
  const disable = useCallback(() => {
    engine.current?.stopMusic();
    engine.current?.stopBuffer();
    setOn(false);
  }, []);
  useEffect(() => () => { engine.current?.dispose(); engine.current = null; }, []);

  // The six-second intro is rendered once, when sound is first switched on.
  const introBuf = useRef<AudioBuffer | null>(null);
  useEffect(() => {
    if (!on || introBuf.current) return;
    void import("./jingle").then((j) => j.renderJingle(engine.current?.sampleRate ?? 44100)).then((b) => { introBuf.current = b; }).catch(() => undefined);
  }, [on]);

  const mood = useRef<Mood>("lobby");
  const lastPhase = useRef<Phase>("none");
  const playersNow = useRef(players);
  playersNow.current = players;
  useEffect(() => {
    const e = engine.current;
    if (!e || !on) { e?.stopMusic(); lastPhase.current = "none"; return; }
    const fresh = lastPhase.current !== phase;
    const first = lastPhase.current === "none";
    lastPhase.current = phase;
    const music = (m: Mood, restart = true) => { mood.current = m; e.playMusic(VARIANT, m, { restart }); };
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (phase === "lobby") {
      if (first && fresh) {
        // The six-second intro, then the waiting theme builds.
        let tries = 0;
        const play = () => {
          if (introBuf.current) e.playBuffer(introBuf.current);
          else if (++tries < 40) timers.push(setTimeout(play, 150)); // the buffer is still being rendered
        };
        play();
        timers.push(setTimeout(() => e.playWaiting(playersNow.current), 5500));
      } else if (fresh) e.playWaiting(playersNow.current);
    }
    else if (phase === "countdown") { if (fresh) e.stopMusic(); }
    else if (phase === "question") { if (fresh) { e.sfx("go"); music("question"); } }
    else if (phase === "closed") { if (fresh) { e.stopMusic(); e.sfx("timeup"); } }
    else if (phase === "results") { if (fresh) e.sfx("reveal"); }
    else if (phase === "leaderboard") { if (fresh) { e.stopMusic(); e.fanfare("short"); e.sfx("rank"); timers.push(setTimeout(() => e.playWaiting(playersNow.current), 1500)); } }
    else if (phase === "finished") { if (fresh) { e.stopMusic(); e.fanfare("podium"); timers.push(setTimeout(() => e.playWaiting(playersNow.current), 3500)); } }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [phase, on]);

  // The last five seconds: faster music with a tick.
  useEffect(() => {
    const e = engine.current;
    if (!e || !on || phase !== "question") return;
    if (left <= 5 && left > 0 && mood.current !== "hurry") { mood.current = "hurry"; e.playMusic(VARIANT, "hurry", { restart: false }); }
  }, [left, phase, on]);
  useEffect(() => { if (on && phase === "countdown" && toStart > 0) engine.current?.sfx("tick"); }, [toStart, phase, on]);

  const seen = useRef(players);
  useEffect(() => {
    if (on && phase === "lobby" && players > seen.current) engine.current?.sfx("join");
    engine.current?.setWaitingPlayers(players);
    seen.current = players;
  }, [players, phase, on]);

  return { on, loading, enable, disable };
}
