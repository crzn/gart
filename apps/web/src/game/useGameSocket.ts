import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@gart/shared";
import { gameReducer, initialGameState, type GameClientState } from "./reducer";

type OutMessage = ClientMessage extends infer M ? (M extends unknown ? Omit<M, "v" | "id" | "seq"> : never) : never;

interface Options {
  pin: string | null;
  /** Called on every (re)connection; returns the first frame to send, or null to stay anonymous. */
  firstFrame: () => Promise<OutMessage | null>;
  /** Errors that mean retrying is pointless. */
  fatal?: (code: string) => boolean;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const FAIL_AFTER = 6;

/** One WebSocket to a game room with automatic reconnect. The room sends a full snapshot after every (re)join. */
export function useGameSocket({ pin, firstFrame, fatal }: Options) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<GameClientState>(state);
  stateRef.current = state;
  const firstRef = useRef(firstFrame);
  firstRef.current = firstFrame;
  const fatalRef = useRef(fatal);
  fatalRef.current = fatal;
  const stopped = useRef(false);

  useEffect(() => {
    if (!pin) return;
    stopped.current = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      if (stopped.current) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/${pin}`);
      wsRef.current = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        attempt = 0;
        void firstRef.current().then((frame) => {
          if (frame && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 1, ...frame }));
          if (!frame) dispatch({ type: "conn", status: "open" });
        }).catch(() => ws.close());
        clearInterval(ping);
        // The platform answers "ping" without waking the room; it keeps idle phones connected.
        ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 25_000);
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string" || e.data === "pong") return;
        let msg: ServerMessage;
        try { msg = JSON.parse(e.data) as ServerMessage; } catch { return; }
        if (msg.t === "error" && fatalRef.current?.(msg.d.code)) stopped.current = true;
        if (msg.t === "kicked" || msg.t === "game.cancelled") stopped.current = true;
        dispatch({ type: "msg", msg, now: Date.now() });
      };
      ws.onclose = (ev) => {
        clearInterval(ping);
        // 4009: the host or projector was opened somewhere else. Reconnecting would start a tug of war.
        if (ev.code === 4009) { stopped.current = true; dispatch({ type: "fatal", code: "replaced" }); return; }
        if (stopped.current) return;
        attempt++;
        if (!opened && attempt >= FAIL_AFTER) return dispatch({ type: "conn", status: "failed" });
        dispatch({ type: "conn", status: stateRef.current.snap ? "reconnecting" : "connecting" });
        timer = setTimeout(connect, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1] ?? 8000);
      };
    };
    connect();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [pin]);

  const send = useCallback((frame: OutMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 1, ...frame }));
  }, []);

  return { state, dispatch, send };
}
