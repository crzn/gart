import { DurableObject } from "cloudflare:workers";
import { usageStatement } from "./repositories/usage";
import {
  COEF,
  utcDay,
  GAME_LIMITS,
  MAX_PLAYERS_PER_GAME,
  AUTO_ADVANCE_DELAY_SEC,
  isAvatarId,
  isTerminal,
  parseClientMessage,
  rankMovement,
  rankPlayers,
  scoreBreakdown,
  shuffled,
  transition,
  validateNickname,
  type ClientMessage,
  type GameEvent,
  type GameSnapshot,
  type GameState,
  type LeaderboardData,
  type LeaderboardEntry,
  type PlayerView,
  type PublicQuestion,
  type QuizSettings,
  type RankedPlayer,
  type RejectReason,
  type ResultsData,
  type ServerMessage,
  type SnapshotData,
  type WsRole,
} from "@gart/shared";
import type { Env } from "./env";
import { timingSafeEqualText } from "./security/encoding";
import { randomId, randomToken, sha256Hex } from "./security/tokens";
import { verifyTicket } from "./security/ticket";

/**
 * One GameRoom Durable Object per live game, addressed by PIN.
 *
 * Cost design (Cloudflare Free plan: 100,000 SQLite rows written per day):
 *  - An answer is ONE row (WITHOUT ROWID table keyed by question + player), so duplicates are rejected by the
 *    primary key and a full 120 x 20 game writes about 2,400 answer rows.
 *  - Scores are never stored per player; totals are derived from the answers table and cached in memory.
 *  - Lifecycle state lives in one small JSON row that is rewritten only on transitions.
 *  - Results go to D1 once, at the end, as a few bulk statements.
 *  - Timers use alarm(), never setTimeout, so the object can hibernate between events.
 */

interface PlayerRow { id: string; nick: string; avatar: string; kicked: boolean }
type AnswerRows = Map<string, { option: string; correct: boolean; pts: number }>;
interface Attachment { role: WsRole | null; playerId?: string; t: number }

interface Cur {
  idx: number;
  /** Index into the snapshot's question list (differs from idx when questions are shuffled). */
  q: number;
  optionIds: string[];
  correctId: string;
  startsAt: number;
  endsAt: number | null;
  limitMs: number;
  base: number;
  bonusPct: number;
}

type AlarmKind = "close" | "auto" | "persist" | "cleanup" | "expire";

interface Core {
  gameId: string;
  pin: string;
  hostAdminId: string;
  title: string;
  s: QuizSettings;
  qCount: number;
  state: GameState;
  paused: boolean;
  pausedAt: number | null;
  order: number[];
  cur: Cur | null;
  lastClosed: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastActivity: number;
  persisted: boolean;
  persistTries: number;
  alarms: Partial<Record<AlarmKind, number>>;
}

export interface RoomUsage { rowsRead: number; rowsWritten: number; messagesIn: number; wakes: number; connects: number }

const MAX_SOCKETS = MAX_PLAYERS_PER_GAME + 1 + GAME_LIMITS.maxScreens + 4;
const UNIDENTIFIED_TIMEOUT_MS = 30_000;
const PERSIST_BACKOFF_MS = [1_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000];
const PROGRESS_MIN_INTERVAL_MS = 250;
const RESULT_ROWS_PER_STATEMENT = 500;
const BUCKET_CAPACITY = 12;
const BUCKET_REFILL_PER_SEC = 6;

export class GameRoom extends DurableObject<Env> {
  private core: Core | null = null;
  private snapshotCache: GameSnapshot | null = null;
  private playersCache: Map<string, PlayerRow> | null = null;
  private rankCache = new Map<number, RankedPlayer[]>();
  private answeredCount: number | null = null;
  private lastProgressAt = 0;
  private qAnswers: { idx: number; rows: AnswerRows } | null = null;

  private hosts = new Set<WebSocket>();
  private screens = new Set<WebSocket>();
  private byPlayer = new Map<string, Set<WebSocket>>();
  private buckets = new WeakMap<WebSocket, { tokens: number; last: number; strikes: number }>();
  private usage: RoomUsage = { rowsRead: 0, rowsWritten: 0, messagesIn: 0, wakes: 1, connects: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
      this.loadCore();
      this.rebuildSocketIndex();
    });
  }

  /* ------------------------------------------------------------------ storage helpers */

  private run<T extends Record<string, SqlStorageValue>>(sql: string, ...bindings: SqlStorageValue[]): { rows: T[]; written: number } {
    const cursor = this.ctx.storage.sql.exec<T>(sql, ...bindings);
    const rows = cursor.toArray();
    this.usage.rowsRead += cursor.rowsRead;
    this.usage.rowsWritten += cursor.rowsWritten;
    return { rows, written: cursor.rowsWritten };
  }

  private ensureSchema(): void {
    this.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID");
    this.run(
      `CREATE TABLE IF NOT EXISTS players (
         id TEXT PRIMARY KEY, nick TEXT NOT NULL, nick_key TEXT NOT NULL UNIQUE, avatar TEXT NOT NULL,
         token_hash TEXT NOT NULL, joined_at INTEGER NOT NULL, kicked INTEGER NOT NULL DEFAULT 0
       ) WITHOUT ROWID`,
    );
    this.run(
      `CREATE TABLE IF NOT EXISTS answers (
         q INTEGER NOT NULL, player_id TEXT NOT NULL, option_id TEXT NOT NULL, ms INTEGER NOT NULL,
         correct INTEGER NOT NULL, pts INTEGER NOT NULL, PRIMARY KEY (q, player_id)
       ) WITHOUT ROWID`,
    );
    this.run("CREATE TABLE IF NOT EXISTS used_tickets (nonce TEXT PRIMARY KEY) WITHOUT ROWID");
  }

  private loadCore(): void {
    const row = this.run<{ v: string }>("SELECT v FROM meta WHERE k = 'core'").rows[0];
    this.core = row ? (JSON.parse(row.v) as Core) : null;
  }

  private saveCore(): void {
    if (!this.core) return;
    this.run("INSERT INTO meta (k, v) VALUES ('core', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(this.core));
  }

  private get snapshot(): GameSnapshot {
    if (!this.snapshotCache) {
      const row = this.run<{ v: string }>("SELECT v FROM meta WHERE k = 'snapshot'").rows[0];
      if (!row) throw new Error("snapshot missing");
      this.snapshotCache = JSON.parse(row.v) as GameSnapshot;
    }
    return this.snapshotCache;
  }

  private get players(): Map<string, PlayerRow> {
    if (!this.playersCache) {
      const rows = this.run<{ id: string; nick: string; avatar: string; kicked: number }>("SELECT id, nick, avatar, kicked FROM players").rows;
      this.playersCache = new Map(rows.map((r) => [r.id, { id: r.id, nick: r.nick, avatar: r.avatar, kicked: r.kicked === 1 }]));
    }
    return this.playersCache;
  }

  private activePlayers(): PlayerRow[] {
    return [...this.players.values()].filter((p) => !p.kicked);
  }

  /* ------------------------------------------------------------------ scheduling */

  private schedule(kind: AlarmKind, at: number): void {
    if (this.core) this.core.alarms[kind] = at;
  }

  private unschedule(kind: AlarmKind): void {
    if (this.core) delete this.core.alarms[kind];
  }

  private async armNext(): Promise<void> {
    const times = Object.values(this.core?.alarms ?? {});
    if (times.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...times));
  }

  /* ------------------------------------------------------------------ RPC (called by the Worker) */

  async init(p: { gameId: string; pin: string; hostAdminId: string; snapshot: GameSnapshot }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.core && this.core.gameId === p.gameId) return { ok: true };
    if (this.core && !isTerminal(this.core.state)) return { ok: false, error: "pin_in_use" };
    await this.wipe();
    const now = Date.now();
    this.core = {
      gameId: p.gameId, pin: p.pin, hostAdminId: p.hostAdminId, title: p.snapshot.title, s: p.snapshot.settings,
      qCount: p.snapshot.questions.length, state: "LOBBY", paused: false, pausedAt: null, order: [], cur: null, lastClosed: -1,
      startedAt: null, finishedAt: null, lastActivity: now, persisted: false, persistTries: 0, alarms: {},
    };
    this.snapshotCache = p.snapshot;
    this.run("INSERT INTO meta (k, v) VALUES ('snapshot', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(p.snapshot));
    this.schedule("expire", now + GAME_LIMITS.idleExpiryMs);
    this.saveCore();
    await this.armNext();
    return { ok: true };
  }

  /** Ends the game from the HTTP API (host lost their connection). */
  async cancel(): Promise<{ ok: boolean }> {
    if (!this.core || isTerminal(this.core.state)) return { ok: false };
    await this.finish("END");
    return { ok: true };
  }

  async usageStats(): Promise<RoomUsage> {
    return { ...this.usage };
  }

  private async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1001, "game reset"); } catch { /* already closed */ }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.core = null;
    this.snapshotCache = null;
    this.playersCache = null;
    this.rankCache.clear();
    this.qAnswers = null;
    this.answeredCount = null;
    this.hosts.clear();
    this.screens.clear();
    this.byPlayer.clear();
    this.ensureSchema();
  }

  /* ------------------------------------------------------------------ connections */

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Installer health check: no game involved, just prove the Durable Object + WebSocket path works.
    if (url.pathname === "/api/health/ws") {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ v: 1, t: "hello", d: { serverTime: Date.now(), role: "anon", state: "CREATED", paused: false } } satisfies ServerMessage));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!this.core) return new Response("Unknown game", { status: 404 });
    if (request.headers.get("x-gart-game") !== this.core.gameId) return new Response("Game mismatch", { status: 404 });

    this.sweepUnidentified();
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response("Room is full", { status: 503 });

    this.usage.connects++;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: null, t: Date.now() } satisfies Attachment);
    this.send(server, { v: 1, t: "hello", d: { serverTime: Date.now(), role: "anon", state: this.core.state, paused: this.core.paused, playerCount: this.activePlayers().length } });
    return new Response(null, { status: 101, webSocket: client });
  }

  private sweepUnidentified(): void {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && att.role === null && now - att.t > UNIDENTIFIED_TIMEOUT_MS) {
        try { ws.close(4008, "identify timeout"); } catch { /* gone */ }
      }
    }
  }

  private rebuildSocketIndex(): void {
    this.hosts.clear();
    this.screens.clear();
    this.byPlayer.clear();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      this.indexSocket(ws, att);
    }
  }

  private indexSocket(ws: WebSocket, att: Attachment): void {
    if (att.role === "host") this.hosts.add(ws);
    else if (att.role === "screen") this.screens.add(ws);
    else if (att.role === "player" && att.playerId) {
      const set = this.byPlayer.get(att.playerId) ?? new Set<WebSocket>();
      set.add(ws);
      this.byPlayer.set(att.playerId, set);
    }
  }

  private unindexSocket(ws: WebSocket): Attachment | null {
    const att = ws.deserializeAttachment() as Attachment | null;
    this.hosts.delete(ws);
    this.screens.delete(ws);
    if (att?.playerId) {
      const set = this.byPlayer.get(att.playerId);
      set?.delete(ws);
      if (set && set.size === 0) this.byPlayer.delete(att.playerId);
    }
    return att;
  }

  private controllers(): WebSocket[] {
    return [...this.hosts, ...this.screens];
  }

  private allIdentified(): WebSocket[] {
    const out = [...this.hosts, ...this.screens];
    for (const set of this.byPlayer.values()) for (const ws of set) out.push(ws);
    return out;
  }

  private send(ws: WebSocket, msg: ServerMessage | string): void {
    try {
      ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
    } catch {
      // Socket already closed; the close handler cleans up.
    }
  }

  private sendMany(sockets: Iterable<WebSocket>, msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const ws of sockets) this.send(ws, text);
  }

  /* ------------------------------------------------------------------ message handling */

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.core) return void ws.close(1011, "no game");
    this.usage.messagesIn++;
    if (typeof message !== "string") return void ws.close(1003, "text only");
    if (!this.takeToken(ws)) return;

    const parsed = parseClientMessage(message);
    if (!parsed.ok) {
      if (parsed.error === "too_large") return void ws.close(1009, "too large");
      return this.send(ws, { v: 1, t: "error", d: { code: parsed.error } });
    }
    await this.dispatch(ws, parsed.message);
  }

  private takeToken(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: BUCKET_CAPACITY, last: now, strikes: 0 };
    b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + ((now - b.last) / 1000) * BUCKET_REFILL_PER_SEC);
    b.last = now;
    this.buckets.set(ws, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    b.strikes++;
    if (b.strikes > 40) ws.close(1008, "rate limited");
    else this.send(ws, { v: 1, t: "error", d: { code: "rate_limited" } });
    return false;
  }

  private err(ws: WebSocket, code: string): void {
    this.send(ws, { v: 1, t: "error", d: { code } });
  }

  private async dispatch(ws: WebSocket, msg: ClientMessage): Promise<void> {
    const att = (ws.deserializeAttachment() as Attachment | null) ?? { role: null, t: Date.now() };

    switch (msg.t) {
      case "player.join": return this.onJoin(ws, att, msg.d);
      case "player.resume": return this.onResume(ws, att, msg.d.playerToken);
      case "host.auth": return this.onTicket(ws, att, "host", msg.d.ticket);
      case "screen.attach": return this.onTicket(ws, att, "screen", msg.d.ticket);
      case "answer.submit": return this.onAnswer(ws, att, msg.d);
      default: break;
    }

    // Everything else is a host command.
    if (att.role !== "host") return this.err(ws, "forbidden");
    this.core!.lastActivity = Date.now();
    switch (msg.t) {
      case "host.start": return this.hostStart(ws);
      case "host.closeQuestion": return this.hostTransition(ws, "CLOSE_QUESTION");
      case "host.showLeaderboard": return this.hostTransition(ws, "SHOW_LEADERBOARD");
      case "host.next": return this.hostTransition(ws, "NEXT");
      case "host.end": return void (await this.finish("END"));
      case "host.pause": return this.hostPause(ws);
      case "host.resume": return this.hostResume(ws);
      case "host.kick": return this.hostKick(ws, msg.d.playerId);
      default: return this.err(ws, "invalid_message");
    }
  }

  /* ------------------------------------------------------------------ identification */

  private async onJoin(ws: WebSocket, att: Attachment, d: { nickname: string; avatar: string }): Promise<void> {
    const core = this.core!;
    if (att.role !== null) return this.err(ws, "already_identified");
    if (isTerminal(core.state)) return this.err(ws, "game_over");
    if (core.state !== "LOBBY" && !core.s.allowLateJoin) return this.err(ws, "game_started");
    if (!isAvatarId(d.avatar)) return this.err(ws, "invalid_avatar");

    const nick = validateNickname(d.nickname, { minLength: core.s.nicknameMinLength, maxLength: core.s.nicknameMaxLength });
    if (!nick.ok) return this.err(ws, `nickname_${nick.reason}`);
    if (this.activePlayers().length >= Math.min(core.s.maxParticipants, MAX_PLAYERS_PER_GAME)) return this.err(ws, "game_full");

    const id = randomId();
    const secret = randomToken(24);
    const hash = await sha256Hex(secret);
    // Nickname uniqueness is enforced by the UNIQUE index, so two simultaneous joins cannot both win.
    // A kicked player's name stays reserved so they cannot rejoin under it.
    try {
      this.run("INSERT INTO players (id, nick, nick_key, avatar, token_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?)", id, nick.nickname, nick.key, d.avatar, hash, Date.now());
    } catch {
      return this.err(ws, "nickname_taken");
    }
    this.players.set(id, { id, nick: nick.nickname, avatar: d.avatar, kicked: false });
    this.rankCache.clear();
    core.lastActivity = Date.now();

    const next: Attachment = { role: "player", playerId: id, t: Date.now() };
    ws.serializeAttachment(next);
    this.indexSocket(ws, next);

    this.send(ws, { v: 1, t: "joined", d: { playerId: id, playerToken: `${id}.${secret}`, nickname: nick.nickname, avatar: d.avatar } });
    this.send(ws, { v: 1, t: "snapshot", d: this.snapshotFor(next) });
    this.sendMany(this.controllers(), { v: 1, t: "player.joined", d: { playerId: id, nickname: nick.nickname, avatar: d.avatar } });
    this.sendMany(this.controllers(), { v: 1, t: "lobby.update", d: { playerCount: this.activePlayers().length } });
  }

  private async onResume(ws: WebSocket, att: Attachment, token: string): Promise<void> {
    const core = this.core!;
    if (att.role !== null) return this.err(ws, "already_identified");
    if (!core.s.allowReconnect) return this.err(ws, "reconnect_disabled");
    const dot = token.indexOf(".");
    const id = dot > 0 ? token.slice(0, dot) : "";
    const secret = dot > 0 ? token.slice(dot + 1) : "";
    const player = this.players.get(id);
    const row = player ? this.run<{ token_hash: string }>("SELECT token_hash FROM players WHERE id = ?", id).rows[0] : undefined;
    if (!player || !row || !timingSafeEqualText(row.token_hash, await sha256Hex(secret))) return this.err(ws, "unknown_player");
    if (player.kicked) return this.err(ws, "kicked");

    // One live connection per player: a newer one replaces the older.
    for (const old of [...(this.byPlayer.get(id) ?? [])]) {
      this.unindexSocket(old);
      try { old.close(4009, "replaced"); } catch { /* gone */ }
    }
    const next: Attachment = { role: "player", playerId: id, t: Date.now() };
    ws.serializeAttachment(next);
    this.indexSocket(ws, next);
    this.send(ws, { v: 1, t: "joined", d: { playerId: id, playerToken: token, nickname: player.nick, avatar: player.avatar } });
    this.send(ws, { v: 1, t: "snapshot", d: this.snapshotFor(next) });
    this.sendMany(this.controllers(), { v: 1, t: "player.reconnected", d: { playerId: id } });
  }

  private async onTicket(ws: WebSocket, att: Attachment, role: "host" | "screen", ticket: string): Promise<void> {
    const core = this.core!;
    if (att.role !== null) return this.err(ws, "already_identified");
    const payload = await verifyTicket(this.env.WS_TICKET_SECRET, ticket, Date.now());
    if (!payload || payload.g !== core.gameId || payload.r !== role) {
      this.err(ws, "invalid_ticket");
      return void ws.close(4001, "invalid ticket");
    }
    if (this.run("INSERT INTO used_tickets (nonce) VALUES (?) ON CONFLICT DO NOTHING", payload.n).written === 0) {
      this.err(ws, "ticket_used");
      return void ws.close(4001, "ticket used");
    }
    if (role === "host") {
      for (const old of [...this.hosts]) {
        this.unindexSocket(old);
        try { old.close(4009, "replaced"); } catch { /* gone */ }
      }
    } else if (this.screens.size >= GAME_LIMITS.maxScreens) {
      this.err(ws, "too_many_screens");
      return void ws.close(1008, "too many screens");
    }
    const next: Attachment = { role, t: Date.now() };
    ws.serializeAttachment(next);
    this.indexSocket(ws, next);
    core.lastActivity = Date.now();
    this.send(ws, { v: 1, t: "snapshot", d: this.snapshotFor(next) });
  }

  /* ------------------------------------------------------------------ views */

  private publicQuestion(cur: Cur): PublicQuestion {
    const q = this.snapshot.questions[cur.q]!;
    const byId = new Map(q.options.map((o) => [o.id, o]));
    return {
      index: cur.idx,
      total: this.core!.qCount,
      text: q.text,
      ...(q.imageId ? { imageId: q.imageId } : {}),
      options: cur.optionIds.map((id) => {
        const o = byId.get(id)!;
        return { id, text: o.text, ...(o.imageId ? { imageId: o.imageId } : {}) };
      }),
      startsAt: cur.startsAt,
      endsAt: cur.endsAt,
    };
  }

  /** Standings after question `through` (-1 = nobody has scored yet). Cached; only the live question changes. */
  private rankings(through: number): RankedPlayer[] {
    const hit = this.rankCache.get(through);
    if (hit) return hit;
    const sums = new Map<string, { pts: number; ms: number }>();
    if (through >= 0) {
      for (const r of this.run<{ player_id: string; pts: number; ms: number }>(
        "SELECT player_id, SUM(pts) AS pts, SUM(CASE WHEN correct = 1 THEN ms ELSE 0 END) AS ms FROM answers WHERE q <= ? GROUP BY player_id",
        through,
      ).rows) sums.set(r.player_id, { pts: r.pts, ms: r.ms });
    }
    const ranked = rankPlayers(
      this.activePlayers().map((p) => ({ playerId: p.id, nickname: p.nick, points: sums.get(p.id)?.pts ?? 0, totalAnswerMs: sums.get(p.id)?.ms ?? 0 })),
    );
    this.rankCache.set(through, ranked);
    return ranked;
  }

  private entries(through: number): LeaderboardEntry[] {
    const now = this.rankings(through);
    const prev = through >= 1 ? new Map(this.rankings(through - 1).map((r) => [r.playerId, r.rank])) : new Map<string, number>();
    return now.map((r) => ({
      playerId: r.playerId,
      nickname: r.nickname,
      avatar: this.players.get(r.playerId)?.avatar ?? "",
      points: r.points,
      rank: r.rank,
      movement: rankMovement(prev.get(r.playerId), r.rank),
    }));
  }

  private leaderboardData(through: number, playerId?: string): LeaderboardData {
    const all = this.entries(through);
    const you = playerId ? all.find((e) => e.playerId === playerId) : undefined;
    return { top: all.slice(0, GAME_LIMITS.topN), ...(you ? { you } : {}), total: all.length };
  }

  private questionAnswers(idx: number): AnswerRows {
    if (this.qAnswers?.idx !== idx) {
      const rows: AnswerRows = new Map();
      for (const r of this.run<{ player_id: string; option_id: string; correct: number; pts: number }>("SELECT player_id, option_id, correct, pts FROM answers WHERE q = ?", idx).rows) {
        rows.set(r.player_id, { option: r.option_id, correct: r.correct === 1, pts: r.pts });
      }
      this.qAnswers = { idx, rows };
    }
    return this.qAnswers!.rows;
  }

  private resultsData(playerId?: string): ResultsData {
    const core = this.core!;
    const cur = core.cur!;
    const rows = this.questionAnswers(cur.idx);
    const distribution: Record<string, number> = Object.fromEntries(cur.optionIds.map((id) => [id, 0]));
    for (const r of rows.values()) distribution[r.option] = (distribution[r.option] ?? 0) + 1;
    const q = this.snapshot.questions[cur.q]!;
    const out: ResultsData = {
      questionIdx: cur.idx,
      distribution,
      answered: rows.size,
      total: this.activePlayers().length,
      ...(core.s.showCorrectAnswer ? { correctOptionId: cur.correctId } : {}),
      ...(core.s.showExplanations && q.explanation ? { explanation: q.explanation } : {}),
    };
    if (playerId) {
      const mine = rows.get(playerId);
      const rank = this.rankings(cur.idx).find((r) => r.playerId === playerId)?.rank ?? 0;
      const prev = cur.idx >= 1 ? this.rankings(cur.idx - 1).find((r) => r.playerId === playerId)?.rank : undefined;
      out.you = { correct: mine?.correct ?? false, points: mine?.pts ?? 0, rank, movement: rankMovement(prev, rank), answered: mine !== undefined };
    }
    return out;
  }

  private answeredNow(): number {
    if (this.answeredCount === null) {
      this.answeredCount = this.run<{ n: number }>("SELECT COUNT(*) AS n FROM answers WHERE q = ?", this.core!.cur?.idx ?? -1).rows[0]?.n ?? 0;
    }
    return this.answeredCount;
  }

  private playerViews(): PlayerView[] {
    return this.activePlayers().map((p) => ({ playerId: p.id, nickname: p.nick, avatar: p.avatar, connected: this.byPlayer.has(p.id) }));
  }

  /** Everything a client needs to draw the current screen, used on join, reconnect and host/projector attach. */
  private snapshotFor(att: Attachment): SnapshotData {
    const core = this.core!;
    const role = att.role ?? "screen";
    const playerId = att.role === "player" ? att.playerId : undefined;
    const data: SnapshotData = {
      serverTime: Date.now(),
      role,
      state: core.state,
      paused: core.paused,
      title: core.title,
      ...(this.snapshot.description ? { description: this.snapshot.description } : {}),
      ...(this.snapshot.coverImageId ? { coverImageId: this.snapshot.coverImageId } : {}),
      pin: core.pin,
      playerCount: this.activePlayers().length,
      settings: {
        showQuestionProgress: core.s.showQuestionProgress,
        countdownSec: core.s.countdownBeforeQuestionSec,
        showCorrectAnswer: core.s.showCorrectAnswer,
        leaderboardEnabled: core.s.leaderboardEnabled,
      },
    };
    if (role !== "player") data.players = this.playerViews();
    if (playerId) {
      const p = this.players.get(playerId);
      if (p) {
        const through = core.state === "QUESTION_ACTIVE" ? (core.cur?.idx ?? 0) - 1 : core.lastClosed;
        const me = this.rankings(through).find((r) => r.playerId === playerId);
        data.you = { playerId, nickname: p.nick, avatar: p.avatar, points: me?.points ?? 0, rank: through >= 0 ? (me?.rank ?? null) : null };
      }
    }
    const cur = core.cur;
    if (core.state === "QUESTION_ACTIVE" && cur) {
      data.question = this.publicQuestion(cur);
      data.answered = this.answeredNow();
      if (playerId) data.yourAnswer = this.questionAnswers(cur.idx).get(playerId)?.option ?? null;
    } else if ((core.state === "QUESTION_RESULTS" || core.state === "LEADERBOARD") && cur) {
      data.results = this.resultsData(playerId);
      if (core.state === "LEADERBOARD") data.leaderboard = this.leaderboardData(cur.idx, playerId);
    } else if (core.state === "FINISHED") {
      data.final = this.leaderboardData(core.lastClosed, playerId);
    }
    return data;
  }

  /* ------------------------------------------------------------------ answering */

  private onAnswer(ws: WebSocket, att: Attachment, d: { questionIdx: number; optionId: string }): void {
    const core = this.core!;
    const reject = (reason: RejectReason) => this.send(ws, { v: 1, t: "answer.reject", d: { questionIdx: d.questionIdx, reason } });
    if (att.role !== "player" || !att.playerId) return this.err(ws, "forbidden");
    const cur = core.cur;
    if (core.state !== "QUESTION_ACTIVE" || !cur) return reject("not_active");
    if (core.paused) return reject("paused");
    if (d.questionIdx !== cur.idx) return reject("wrong_question");

    const now = Date.now();
    if (now < cur.startsAt) return reject("not_active");
    if (cur.endsAt !== null && now > cur.endsAt) return reject("closed");
    if (!cur.optionIds.includes(d.optionId)) return reject("invalid_option");

    const correct = d.optionId === cur.correctId;
    const elapsed = Math.max(0, now - cur.startsAt);
    const { total } = scoreBreakdown({ correct, basePoints: cur.base, speedBonusPercent: cur.bonusPct, elapsedMs: elapsed, limitMs: cur.limitMs });

    const { written } = this.run(
      "INSERT INTO answers (q, player_id, option_id, ms, correct, pts) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
      cur.idx, att.playerId, d.optionId, elapsed, correct ? 1 : 0, total,
    );
    if (written === 0) return reject("duplicate");

    this.answeredCount = this.answeredNow() + 1;
    this.rankCache.delete(cur.idx);
    this.qAnswers = null;
    this.send(ws, { v: 1, t: "answer.ack", d: { questionIdx: cur.idx } });

    const players = this.activePlayers().length;
    if (this.answeredCount >= players || now - this.lastProgressAt >= PROGRESS_MIN_INTERVAL_MS) {
      this.lastProgressAt = now;
      this.sendMany(this.controllers(), { v: 1, t: "progress.update", d: { answered: this.answeredCount, total: players } });
    }
    if (core.s.closeWhenAllAnswered && this.answeredCount >= players) void this.closeQuestion();
  }

  /* ------------------------------------------------------------------ host commands */

  /** Validates a host command against the state machine without changing anything. */
  private check(ws: WebSocket, event: GameEvent): GameState | null {
    const core = this.core!;
    const r = transition(core.state, event, {
      hasNextQuestion: (core.cur?.idx ?? -1) + 1 < core.qCount,
      questionCount: core.qCount,
      leaderboardEnabled: core.s.leaderboardEnabled,
    });
    if (!r.ok) {
      this.err(ws, r.reason);
      return null;
    }
    return r.next;
  }

  private async hostStart(ws: WebSocket): Promise<void> {
    const core = this.core!;
    if (core.state === "LOBBY" && this.activePlayers().length === 0) return this.err(ws, "no_players");
    if (!this.check(ws, "START")) return;
    core.startedAt = Date.now();
    core.order = core.s.randomizeQuestions ? shuffled([...Array(core.qCount).keys()]) : [...Array(core.qCount).keys()];
    this.startQuestion(0);
    this.saveCore();
    await this.armNext();
  }

  private async hostTransition(ws: WebSocket, event: "CLOSE_QUESTION" | "SHOW_LEADERBOARD" | "NEXT"): Promise<void> {
    const core = this.core!;
    if (event === "CLOSE_QUESTION") {
      if (core.state !== "QUESTION_ACTIVE") return this.err(ws, "invalid_transition");
      return this.closeQuestion();
    }
    const next = this.check(ws, event);
    if (!next) return;
    this.unschedule("auto");
    if (next === "LEADERBOARD") {
      core.state = next;
      return this.enterLeaderboard();
    }
    if (next === "QUESTION_ACTIVE") {
      this.startQuestion((core.cur?.idx ?? -1) + 1);
      this.saveCore();
      return this.armNext();
    }
    await this.finish("NEXT");
  }

  private hostPause(ws: WebSocket): Promise<void> | void {
    const core = this.core!;
    if (core.state !== "QUESTION_ACTIVE") return this.err(ws, "invalid_transition");
    if (core.paused) return;
    core.paused = true;
    core.pausedAt = Date.now();
    this.unschedule("close");
    this.saveCore();
    this.sendMany(this.allIdentified(), { v: 1, t: "game.paused", d: {} });
    return this.armNext();
  }

  private hostResume(ws: WebSocket): Promise<void> | void {
    const core = this.core!;
    const cur = core.cur;
    if (!core.paused || !cur || core.pausedAt === null) return this.err(ws, "invalid_transition");
    // Shift the whole window by the pause length so elapsed time (and the speed bonus) ignores the pause.
    const shift = Date.now() - core.pausedAt;
    cur.startsAt += shift;
    if (cur.endsAt !== null) {
      cur.endsAt += shift;
      this.schedule("close", cur.endsAt);
    }
    core.paused = false;
    core.pausedAt = null;
    this.saveCore();
    this.sendMany(this.allIdentified(), { v: 1, t: "game.resumed", d: { endsAt: cur.endsAt } });
    return this.armNext();
  }

  private hostKick(ws: WebSocket, playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.kicked) return this.err(ws, "unknown_player");
    this.run("UPDATE players SET kicked = 1 WHERE id = ?", playerId);
    p.kicked = true;
    this.rankCache.clear();
    this.qAnswers = null;
    this.answeredCount = null;
    for (const sock of [...(this.byPlayer.get(playerId) ?? [])]) {
      this.send(sock, { v: 1, t: "kicked", d: {} });
      this.unindexSocket(sock);
      try { sock.close(4003, "kicked"); } catch { /* gone */ }
    }
    this.sendMany(this.controllers(), { v: 1, t: "player.left", d: { playerId } });
    this.sendMany(this.controllers(), { v: 1, t: "lobby.update", d: { playerCount: this.activePlayers().length } });
    if (this.core!.state === "QUESTION_ACTIVE" && this.core!.s.closeWhenAllAnswered && this.answeredNow() >= this.activePlayers().length) void this.closeQuestion();
  }

  /* ------------------------------------------------------------------ lifecycle */

  private startQuestion(idx: number): void {
    const core = this.core!;
    const now = Date.now();
    const sIdx = core.order[idx]!;
    const q = this.snapshot.questions[sIdx]!;
    const ids = q.options.map((o) => o.id);
    const optionIds = core.s.randomizeAnswers && q.type === "single" ? shuffled(ids) : ids;
    const limitSec = core.s.timerEnabled ? (q.timeLimitSec ?? core.s.defaultTimeLimitSec) : 0;
    const startsAt = now + core.s.countdownBeforeQuestionSec * 1000;
    const endsAt = core.s.timerEnabled ? startsAt + limitSec * 1000 : null;
    core.cur = {
      idx, q: sIdx, optionIds, correctId: q.options.find((o) => o.correct)!.id, startsAt, endsAt,
      limitMs: limitSec * 1000, base: q.points ?? core.s.basePoints, bonusPct: core.s.timerEnabled ? core.s.speedBonusPercent : 0,
    };
    core.state = "QUESTION_ACTIVE";
    core.paused = false;
    core.pausedAt = null;
    core.lastActivity = now;
    this.answeredCount = 0;
    this.qAnswers = null;
    this.lastProgressAt = 0;
    if (endsAt !== null) this.schedule("close", endsAt);
    else this.unschedule("close");
    this.unschedule("auto");
    this.sendMany(this.allIdentified(), { v: 1, t: "question.start", d: this.publicQuestion(core.cur) });
  }

  private async closeQuestion(): Promise<void> {
    const core = this.core!;
    const cur = core.cur;
    if (core.state !== "QUESTION_ACTIVE" || !cur) return;
    core.state = "QUESTION_RESULTS";
    core.lastClosed = cur.idx;
    this.unschedule("close");
    this.rankCache.delete(cur.idx);
    this.qAnswers = null;
    if (core.s.autoAdvance) this.schedule("auto", Date.now() + AUTO_ADVANCE_DELAY_SEC * 1000);
    this.saveCore();

    const total = this.activePlayers().length;
    const answered = this.questionAnswers(cur.idx).size;
    this.sendMany(this.allIdentified(), { v: 1, t: "question.closed", d: { questionIdx: cur.idx, answered, total } });
    this.sendMany(this.controllers(), { v: 1, t: "results", d: this.resultsData() });
    for (const [playerId, sockets] of this.byPlayer) this.sendMany(sockets, { v: 1, t: "results", d: this.resultsData(playerId) });
    await this.armNext();
  }

  private enterLeaderboard(): Promise<void> {
    const core = this.core!;
    const cur = core.cur!;
    if (core.s.autoAdvance) this.schedule("auto", Date.now() + AUTO_ADVANCE_DELAY_SEC * 1000);
    this.saveCore();
    this.sendMany(this.controllers(), { v: 1, t: "leaderboard", d: this.leaderboardData(cur.idx) });
    for (const [playerId, sockets] of this.byPlayer) this.sendMany(sockets, { v: 1, t: "leaderboard", d: this.leaderboardData(cur.idx, playerId) });
    return this.armNext();
  }

  private async finish(event: "END" | "NEXT"): Promise<void> {
    const core = this.core!;
    if (isTerminal(core.state)) return;
    // The question that was live when the host ended the game still counts: close it first.
    if (core.state === "QUESTION_ACTIVE" && event === "END") await this.closeQuestion();
    const r = transition(core.state, event, {
      hasNextQuestion: false, questionCount: core.qCount, leaderboardEnabled: core.s.leaderboardEnabled,
    });
    if (!r.ok) return;
    const now = Date.now();
    core.state = r.next;
    core.finishedAt = now;
    core.paused = false;
    for (const k of ["close", "auto", "expire"] as const) this.unschedule(k);
    this.schedule("persist", now + 500);
    this.saveCore();

    if (core.state === "CANCELLED") {
      this.sendMany(this.allIdentified(), { v: 1, t: "game.cancelled", d: {} });
    } else {
      const through = core.lastClosed;
      this.sendMany(this.controllers(), { v: 1, t: "game.finished", d: this.leaderboardData(through) });
      for (const [playerId, sockets] of this.byPlayer) this.sendMany(sockets, { v: 1, t: "game.finished", d: this.leaderboardData(through, playerId) });
    }
    await this.armNext();
  }

  /* ------------------------------------------------------------------ persistence to D1 */

  private async persist(): Promise<boolean> {
    const core = this.core!;
    const db = this.env.DB;
    const through = core.lastClosed;
    const ranked = this.rankings(through);
    const correctCounts = new Map<string, number>();
    const results: { p: string; q: number; o: string; c: number; s: number; m: number }[] = [];
    if (through >= 0) {
      for (const r of this.run<{ q: number; player_id: string; option_id: string; ms: number; correct: number; pts: number }>(
        "SELECT q, player_id, option_id, ms, correct, pts FROM answers WHERE q <= ? ORDER BY q, player_id", through,
      ).rows) {
        if (this.players.get(r.player_id)?.kicked) continue;
        if (r.correct === 1) correctCounts.set(r.player_id, (correctCounts.get(r.player_id) ?? 0) + 1);
        // Positions refer to the quiz as authored, so results stay meaningful when questions were shuffled.
        results.push({ p: r.player_id, q: core.order[r.q] ?? r.q, o: r.option_id, c: r.correct, s: r.pts, m: r.ms });
      }
    }
    const participants = ranked.map((r) => ({
      id: r.playerId, n: r.nickname, k: this.nickKey(r.playerId), a: this.players.get(r.playerId)?.avatar ?? "", r: r.rank, p: r.points, c: correctCounts.get(r.playerId) ?? 0,
    }));
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

    const statements = [
      db.prepare("UPDATE game_sessions SET status = ?, started_at = ?, finished_at = ? WHERE id = ?").bind(core.state, iso(core.startedAt), iso(core.finishedAt), core.gameId),
      db.prepare("DELETE FROM game_participants WHERE game_id = ?").bind(core.gameId),
      db.prepare(
        `INSERT INTO game_participants (id, game_id, nickname, nickname_key, avatar, final_rank, total_points, correct_count)
         SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.n'), json_extract(value, '$.k'), json_extract(value, '$.a'),
                json_extract(value, '$.r'), json_extract(value, '$.p'), json_extract(value, '$.c')
         FROM json_each(?)`,
      ).bind(core.gameId, JSON.stringify(participants)),
    ];
    // Bulk insert through json_each keeps this to a handful of statements (D1 Free allows 50 per invocation).
    for (let i = 0; i < results.length; i += RESULT_ROWS_PER_STATEMENT) {
      statements.push(
        db.prepare(
          `INSERT INTO game_results (id, game_id, participant_id, question_position, option_id, is_correct, points, answer_ms)
           SELECT lower(hex(randomblob(16))), ?, json_extract(value, '$.p'), json_extract(value, '$.q'), json_extract(value, '$.o'),
                  json_extract(value, '$.c'), json_extract(value, '$.s'), json_extract(value, '$.m')
           FROM json_each(?)`,
        ).bind(core.gameId, JSON.stringify(results.slice(i, i + RESULT_ROWS_PER_STATEMENT))),
      );
    }
    // The game's own counters join the same batch, so they are saved exactly once and only if the results were.
    const seconds = core.startedAt && core.finishedAt ? Math.max(0, Math.round((core.finishedAt - core.startedAt) / 1000)) : 0;
    const counters = usageStatement(db, {
      games_finished: 1, players_joined: participants.length, answers: results.length, questions_served: through + 1,
      ws_connects: this.usage.connects, ws_messages_in: this.usage.messagesIn, do_rows_written: this.usage.rowsWritten, do_rows_read: this.usage.rowsRead,
      d1_rows_written: participants.length * COEF.d1RowsWrittenPerPlayer + results.length * COEF.d1RowsWrittenPerAnswer + COEF.d1RowsWrittenFixed,
      game_seconds: seconds,
    }, utcDay(new Date(core.finishedAt ?? Date.now())));
    if (counters) statements.push(counters);
    try {
      await db.batch(statements);
      return true;
    } catch (error) {
      console.error("persist_failed", error instanceof Error ? error.message : "unknown");
      return false;
    }
  }

  private nickKey(playerId: string): string {
    const nick = this.players.get(playerId)?.nick ?? playerId;
    return nick.normalize("NFKC").toLowerCase();
  }

  /* ------------------------------------------------------------------ alarms */

  override async alarm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    const due = (Object.entries(core.alarms) as [AlarmKind, number][]).filter(([, at]) => at <= now).map(([k]) => k);
    for (const kind of due) {
      delete core.alarms[kind];
      switch (kind) {
        case "close":
          if (core.state === "QUESTION_ACTIVE" && !core.paused) await this.closeQuestion();
          break;
        case "auto":
          await this.autoAdvance();
          break;
        case "persist":
          if (await this.persist()) {
            core.persisted = true;
            this.schedule("cleanup", now + GAME_LIMITS.finishedGraceMs);
          } else {
            const wait = PERSIST_BACKOFF_MS[Math.min(core.persistTries, PERSIST_BACKOFF_MS.length - 1)]!;
            core.persistTries++;
            this.schedule("persist", now + wait);
          }
          break;
        case "cleanup":
          if (core.persisted) return void (await this.wipe());
          break;
        case "expire":
          if (now - core.lastActivity >= GAME_LIMITS.idleExpiryMs) await this.finish("END");
          else this.schedule("expire", core.lastActivity + GAME_LIMITS.idleExpiryMs);
          break;
      }
    }
    this.saveCore();
    await this.armNext();
  }

  private async autoAdvance(): Promise<void> {
    const core = this.core!;
    if (core.state === "QUESTION_RESULTS" && core.s.leaderboardEnabled && (core.cur?.idx ?? -1) + 1 < core.qCount) {
      core.state = "LEADERBOARD";
      await this.enterLeaderboard();
    } else if (core.state === "QUESTION_RESULTS" || core.state === "LEADERBOARD") {
      if ((core.cur?.idx ?? -1) + 1 < core.qCount) {
        this.startQuestion((core.cur?.idx ?? -1) + 1);
        this.saveCore();
      } else {
        await this.finish("NEXT");
      }
    }
  }

  /* ------------------------------------------------------------------ socket lifecycle */

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const att = this.unindexSocket(ws);
    // 1005/1006/1015 are reserved and must not be sent in a close frame.
    const safe = code >= 1000 && code <= 4999 && ![1005, 1006, 1015].includes(code) ? code : 1000;
    try { ws.close(safe, reason); } catch { /* already closed */ }
    this.afterDisconnect(att);
  }

  override webSocketError(ws: WebSocket): void {
    this.afterDisconnect(this.unindexSocket(ws));
  }

  private afterDisconnect(att: Attachment | null): void {
    if (att?.role === "player" && att.playerId && !this.byPlayer.has(att.playerId) && !this.players.get(att.playerId)?.kicked) {
      this.sendMany(this.controllers(), { v: 1, t: "player.left", d: { playerId: att.playerId } });
    }
  }
}
