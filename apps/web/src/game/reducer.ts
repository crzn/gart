import type { PlayerView, RejectReason, ServerMessage, SnapshotData } from "@gart/shared";

/** Client-side mirror of the room, built from one snapshot plus the events that follow it. */
export interface GameClientState {
  conn: "connecting" | "open" | "reconnecting" | "failed";
  snap: SnapshotData | null;
  /** True once the room said hello; an anonymous visitor has no snapshot until they join. */
  hello: boolean;
  /** Players in the game when the room said hello (what an anonymous visitor can know). */
  helloCount: number | null;
  /** serverTime - Date.now() at the last snapshot; add it to local time to get server time. */
  offset: number;
  /** Local time the game was paused; the countdown is frozen at this moment. */
  pausedAt: number | null;
  pending: string | null;
  reject: RejectReason | null;
  error: string | null;
  kicked: boolean;
  cancelled: boolean;
  identity: { playerId: string; playerToken: string } | null;
}

export const initialGameState: GameClientState = {
  conn: "connecting", snap: null, hello: false, helloCount: null, offset: 0, pausedAt: null, pending: null, reject: null, error: null, kicked: false, cancelled: false, identity: null,
};

export type GameAction =
  | { type: "msg"; msg: ServerMessage; now: number }
  | { type: "conn"; status: GameClientState["conn"] }
  | { type: "pending"; optionId: string }
  | { type: "clearError" }
  | { type: "fatal"; code: string }
  | { type: "removePlayer"; playerId: string };

function patch(s: GameClientState, p: Partial<SnapshotData>): GameClientState {
  return s.snap ? { ...s, snap: { ...s.snap, ...p } } : s;
}

function updatePlayers(s: GameClientState, fn: (list: PlayerView[]) => PlayerView[]): GameClientState {
  return s.snap?.players ? patch(s, { players: fn(s.snap.players) }) : s;
}

export function gameReducer(s: GameClientState, a: GameAction): GameClientState {
  if (a.type === "conn") return { ...s, conn: a.status };
  if (a.type === "pending") return { ...s, pending: a.optionId, reject: null };
  if (a.type === "clearError") return { ...s, error: null, reject: null };
  if (a.type === "fatal") return { ...s, error: a.code, conn: "failed" };
  if (a.type === "removePlayer") return updatePlayers(s, (l) => l.filter((p) => p.playerId !== a.playerId));
  const m = a.msg;
  switch (m.t) {
    case "hello":
      return { ...s, conn: "open", hello: true, helloCount: m.d.playerCount ?? null };
    case "snapshot":
      return { ...s, conn: "open", snap: m.d, offset: m.d.serverTime - a.now, pausedAt: m.d.paused ? a.now : null, pending: null, error: null };
    case "joined":
      return { ...s, identity: { playerId: m.d.playerId, playerToken: m.d.playerToken } };
    case "lobby.update":
      return patch(s, { playerCount: m.d.playerCount });
    case "player.joined":
      return updatePlayers(s, (l) => [...l.filter((p) => p.playerId !== m.d.playerId), { ...m.d, connected: true }]);
    case "player.left":
      return updatePlayers(s, (l) => l.map((p) => (p.playerId === m.d.playerId ? { ...p, connected: false } : p)));
    case "player.reconnected":
      return updatePlayers(s, (l) => l.map((p) => (p.playerId === m.d.playerId ? { ...p, connected: true } : p)));
    case "question.start":
    {
      if (!s.snap) return s;
      const { results: _r, leaderboard: _l, ...rest } = s.snap;
      return { ...s, snap: { ...rest, state: "QUESTION_ACTIVE", paused: false, question: m.d, answered: 0, yourAnswer: null }, pending: null, pausedAt: null, reject: null };
    }
    case "answer.ack":
      return { ...patch(s, { yourAnswer: s.pending }), pending: null };
    case "answer.reject":
      // A duplicate means the first answer stands; keep whatever the server already accepted.
      return { ...s, pending: null, reject: m.d.reason };
    case "progress.update":
      return patch(s, { answered: m.d.answered });
    case "question.closed":
      return patch(s, { state: "QUESTION_RESULTS", answered: m.d.answered });
    case "results": {
      const gained = m.d.you?.points ?? 0;
      const you = s.snap?.you ? { ...s.snap.you, points: s.snap.you.points + gained, rank: m.d.you?.rank ?? s.snap.you.rank } : undefined;
      return patch(s, { state: "QUESTION_RESULTS", results: m.d, ...(you ? { you } : {}) });
    }
    case "leaderboard": {
      const you = s.snap?.you && m.d.you ? { ...s.snap.you, points: m.d.you.points, rank: m.d.you.rank } : s.snap?.you;
      return patch(s, { state: "LEADERBOARD", leaderboard: m.d, ...(you ? { you } : {}) });
    }
    case "game.paused":
      return { ...patch(s, { paused: true }), pausedAt: a.now };
    case "game.resumed": {
      const q = s.snap?.question;
      return { ...patch(s, { paused: false, ...(q ? { question: { ...q, endsAt: m.d.endsAt } } : {}) }), pausedAt: null };
    }
    case "game.finished": {
      const you = s.snap?.you && m.d.you ? { ...s.snap.you, points: m.d.you.points, rank: m.d.you.rank } : s.snap?.you;
      return patch(s, { state: "FINISHED", final: m.d, ...(you ? { you } : {}) });
    }
    case "kicked":
      return { ...s, kicked: true };
    case "game.cancelled":
      return { ...s, cancelled: true };
    case "error":
      return { ...s, error: m.d.code };
    default:
      return s;
  }
}

/** Seconds left on the active question, frozen while paused. Null when there is no deadline. */
export function secondsLeft(s: GameClientState, now: number): number | null {
  const q = s.snap?.question;
  if (!q || q.endsAt === null) return null;
  const at = s.pausedAt ?? now;
  return Math.max(0, (q.endsAt - (at + s.offset)) / 1000);
}

/** Seconds until the question opens (the pre-question countdown); 0 once it is open. */
export function secondsUntilStart(s: GameClientState, now: number): number {
  const q = s.snap?.question;
  if (!q) return 0;
  const at = s.pausedAt ?? now;
  return Math.max(0, (q.startsAt - (at + s.offset)) / 1000);
}
