import limitsConfig from "../../../config/cloudflare-limits.json";

/**
 * Cloudflare Free-plan resources and the application's own consumption model.
 * Three kinds of numbers must never be mixed up:
 *   estimated: this model (`estimateGame`), a forecast;
 *   measured:  counters the application recorded about itself (a lower bound);
 *   official:  figures an administrator copied from the Cloudflare dashboard.
 */

export const RESOURCE_IDS = [
  "workers.requests",
  "workers.cpuMsPerInvocation",
  "durableObjects.requests",
  "durableObjects.durationGbSeconds",
  "durableObjects.storageGb",
  "durableObjects.sqlRowsRead",
  "durableObjects.sqlRowsWritten",
  "d1.rowsRead",
  "d1.rowsWritten",
  "d1.databaseStorageGb",
  "r2.storageGb",
  "r2.classAOperations",
  "r2.classBOperations",
] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export type Period = "day" | "total" | "invocation" | "unused";
export interface ResourceDef { id: ResourceId; period: Period; limit: number | null; unit: string }

type RawLimit = { period: string; limit: number; unit: string };
const raw = limitsConfig.limits as Record<string, RawLimit>;

// Storage inside a Durable Object is limited per account (5 GB); the D1 database cap is 500 MB.
const FILE_KEY: Record<ResourceId, string | null> = {
  "workers.requests": "workers.requests",
  "workers.cpuMsPerInvocation": "workers.cpuMsPerInvocation",
  "durableObjects.requests": "durableObjects.requests",
  "durableObjects.durationGbSeconds": "durableObjects.durationGbSeconds",
  "durableObjects.storageGb": "durableObjects.storageGb",
  "durableObjects.sqlRowsRead": "durableObjects.sqlRowsRead",
  "durableObjects.sqlRowsWritten": "durableObjects.sqlRowsWritten",
  "d1.rowsRead": "d1.rowsRead",
  "d1.rowsWritten": "d1.rowsWritten",
  "d1.databaseStorageGb": "d1.databaseStorageGb",
  "r2.storageGb": null,
  "r2.classAOperations": null,
  "r2.classBOperations": null,
};

export const RESOURCES: readonly ResourceDef[] = RESOURCE_IDS.map((id) => {
  const key = FILE_KEY[id];
  const r = key ? raw[key] : undefined;
  if (!r) return { id, period: "unused" as const, limit: null, unit: "" };
  return { id, period: r.period as Period, limit: r.limit, unit: r.unit };
});
export const resourceDef = (id: ResourceId): ResourceDef => RESOURCES.find((r) => r.id === id)!;
/** Resources that are summed per UTC day. */
export const DAILY_RESOURCES = RESOURCES.filter((r) => r.period === "day").map((r) => r.id);

export const LIMITS_VERIFIED_ON: string = limitsConfig.verifiedOn;
export const COEF = limitsConfig.estimateCoefficients;
export const SAFE_MODE_MAX_PLAYERS: number = limitsConfig.safeMode.maxPlayers;

/* ------------------------------------------------------------------ thresholds and levels */

export interface Thresholds { info: number; warning: number; critical: number; full: number }
export const DEFAULT_THRESHOLDS: Thresholds = { ...limitsConfig.alertThresholds } as Thresholds;
export type Level = "ok" | "info" | "warning" | "critical" | "full";
export const LEVEL_ORDER: readonly Level[] = ["ok", "info", "warning", "critical", "full"];

export function levelFor(pct: number, t: Thresholds = DEFAULT_THRESHOLDS): Level {
  if (pct >= t.full) return "full";
  if (pct >= t.critical) return "critical";
  if (pct >= t.warning) return "warning";
  if (pct >= t.info) return "info";
  return "ok";
}
export const worseLevel = (a: Level, b: Level): Level => (LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b);

/** Thresholds must be whole percentages, strictly rising, and below the fixed 100. */
export function validateThresholds(t: Partial<Thresholds>): Thresholds | null {
  const { info, warning, critical } = t;
  if (![info, warning, critical].every((n) => typeof n === "number" && Number.isInteger(n))) return null;
  if (!(info! >= 1 && info! < warning! && warning! < critical! && critical! < 100)) return null;
  return { info: info!, warning: warning!, critical: critical!, full: 100 };
}

/* ------------------------------------------------------------------ the model */

export interface Scenario {
  gamesPerMonth: number;
  /** Games on the busiest day of the month. */
  gamesPerBusyDay: number;
  players: number;
  questions: number;
  durationMin: number;
  /** Times a participant reconnects, summed over the whole game. */
  reconnects: number;
  /** Messages a participant sends per question (the answer, plus the occasional retry). */
  messagesPerPlayerPerQuestion: number;
  imageUploadsPerMonth: number;
  /** Image requests served during one game. */
  imageViewsPerGame: number;
  retentionMonths: number;
  /** Share of players who answer a question. */
  answerRate: number;
  /** Share of the game the room is awake (not hibernating). 1 is the worst case. */
  awakeFraction: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  gamesPerMonth: 6, gamesPerBusyDay: 1, players: 120, questions: 20, durationMin: 30, reconnects: 20,
  messagesPerPlayerPerQuestion: 1.2, imageUploadsPerMonth: 20, imageViewsPerGame: 0, retentionMonths: 12,
  answerRate: COEF.answerRateTypical, awakeFraction: 1,
};

/** The most expensive plausible game, for the "worst case" column. */
export function worstCase(s: Scenario): Scenario {
  return {
    ...s, players: 120, questions: Math.max(s.questions, 50), durationMin: Math.max(s.durationMin, 90),
    reconnects: 120 * 3, messagesPerPlayerPerQuestion: Math.max(s.messagesPerPlayerPerQuestion, 3),
    imageViewsPerGame: Math.max(s.imageViewsPerGame, 120 * Math.max(s.questions, 50)), answerRate: 1, awakeFraction: 1,
  };
}

export type Amounts = Record<ResourceId, number>;
const zero = (): Amounts => Object.fromEntries(RESOURCE_IDS.map((id) => [id, 0])) as Amounts;
const GB = 1024 ** 3;

/** What ONE game of this shape consumes, per resource. Storage amounts are what that game leaves behind. */
export function estimateGame(s: Scenario): Amounts {
  const c = COEF;
  const players = s.players, q = s.questions;
  const answers = players * q * s.answerRate;
  const connects = players + s.reconnects;
  const incoming = players * c.wsMessagesPerPlayerJoin + answers * s.messagesPerPlayerPerQuestion + q * c.wsMessagesPerQuestionHost;
  const out = zero();
  out["workers.requests"] = c.workersRequestsPerGameFixed + connects + players * (c.workersRequestsPerPlayerJoin - 1) + s.imageViewsPerGame;
  out["durableObjects.requests"] = c.doRequestsFixed + connects + Math.ceil(incoming / c.wsMessageBillingRatio);
  out["durableObjects.durationGbSeconds"] = s.durationMin * 60 * c.doMemoryGb * s.awakeFraction;
  out["durableObjects.sqlRowsWritten"] = c.doRowsWrittenFixed + players * c.doRowsWrittenPerPlayer + answers * c.doRowsWrittenPerAnswer + q * c.doRowsWrittenPerQuestion;
  out["durableObjects.sqlRowsRead"] = c.doRowsReadFixed + c.doRowsReadPerPlayerQuestionPair * players * (q * (q + 1)) / 2 + s.reconnects * c.doRowsReadPerReconnect;
  out["durableObjects.storageGb"] = (players * c.doBytesPerPlayer + answers * c.doBytesPerAnswer) / GB;
  out["d1.rowsWritten"] = c.d1RowsWrittenFixed + players * c.d1RowsWrittenPerPlayer + answers * c.d1RowsWrittenPerAnswer;
  out["d1.rowsRead"] = c.d1RowsReadFixed + q * c.d1RowsReadPerQuestion + s.imageViewsPerGame;
  out["d1.databaseStorageGb"] = (answers * c.d1BytesPerAnswer + players * c.d1BytesPerPlayer + q * c.d1BytesPerQuestionSnapshot) / GB;
  return out;
}

export interface CalcRow {
  resource: ResourceId;
  limit: number | null;
  perGame: number;
  /** Total on the busiest day. */
  busyDay: number;
  /** Total over a month (informational: quotas are daily). */
  month: number;
  busyDayPct: number | null;
  worstDayPct: number | null;
  level: Level;
  /** Games of this shape that still fit in one empty day (daily resources) or in total (storage). */
  gamesThatFit: number | null;
}
export interface CalcResult {
  rows: CalcRow[];
  /** The resource that runs out first, and how many games fit before it does. */
  bottleneck: { resource: ResourceId; games: number } | null;
}

export function calculate(s: Scenario, t: Thresholds = DEFAULT_THRESHOLDS): CalcResult {
  const one = estimateGame(s);
  const worst = estimateGame(worstCase(s));
  const stored = (res: ResourceId) => {
    // Results are kept for the retention period; images persist until deleted.
    const games = s.gamesPerMonth * Math.max(1, s.retentionMonths);
    const media = res === "d1.databaseStorageGb" ? (s.imageUploadsPerMonth * Math.max(1, s.retentionMonths) * COEF.avgImageBytes) / GB : 0;
    return games * one[res] + media;
  };
  let bottleneck: CalcResult["bottleneck"] = null;
  const rows: CalcRow[] = RESOURCES.map((r) => {
    const perGame = one[r.id];
    const isTotal = r.period === "total";
    const busyDay = isTotal ? stored(r.id) : perGame * s.gamesPerBusyDay;
    const month = isTotal ? stored(r.id) : perGame * s.gamesPerMonth;
    const limit = r.limit;
    const busyDayPct = limit ? (busyDay / limit) * 100 : null;
    const worstDay = isTotal ? worst[r.id] * s.gamesPerMonth * Math.max(1, s.retentionMonths) : worst[r.id] * s.gamesPerBusyDay;
    const worstDayPct = limit ? (worstDay / limit) * 100 : null;
    const fit = limit && perGame > 0 ? Math.floor(limit / perGame) : null;
    if ((r.period === "day") && fit !== null && (!bottleneck || fit < bottleneck.games)) bottleneck = { resource: r.id, games: fit };
    return { resource: r.id, limit, perGame, busyDay, month, busyDayPct, worstDayPct, level: levelFor(Math.max(busyDayPct ?? 0, 0), t), gamesThatFit: fit };
  });
  return { rows, bottleneck };
}

/* ------------------------------------------------------------------ today's position */

export interface ResourceStatus {
  resource: ResourceId;
  limit: number | null;
  measured: number | null;
  official: number | null;
  /** The larger of measured and official: the safer figure to alert on. */
  used: number;
  pct: number;
  level: Level;
}

export function statusFor(
  measured: Partial<Record<ResourceId, number>>,
  official: Partial<Record<ResourceId, number>>,
  t: Thresholds = DEFAULT_THRESHOLDS,
): ResourceStatus[] {
  return RESOURCES.filter((r) => r.period !== "unused" && r.period !== "invocation").map((r) => {
    const m = measured[r.id] ?? null, o = official[r.id] ?? null;
    const used = Math.max(m ?? 0, o ?? 0);
    const pct = r.limit ? (used / r.limit) * 100 : 0;
    return { resource: r.id, limit: r.limit, measured: m, official: o, used, pct, level: levelFor(pct, t) };
  });
}

export interface ProjectedRow { resource: ResourceId; used: number; add: number; limit: number; pctBefore: number; pctAfter: number; level: Level }
export interface Projection { rows: ProjectedRow[]; level: Level; /** Resources at warning or above after the game. */ concerns: ProjectedRow[] }

/** What today looks like if the proposed game is added to what has been used so far. */
export function projectGame(status: ResourceStatus[], perGame: Amounts, t: Thresholds = DEFAULT_THRESHOLDS): Projection {
  const rows: ProjectedRow[] = status
    .filter((s) => s.limit && DAILY_RESOURCES.includes(s.resource))
    .map((s) => {
      const add = perGame[s.resource];
      const pctAfter = ((s.used + add) / s.limit!) * 100;
      return { resource: s.resource, used: s.used, add, limit: s.limit!, pctBefore: s.pct, pctAfter, level: levelFor(pctAfter, t) };
    });
  const level = rows.reduce<Level>((acc, r) => worseLevel(acc, r.level), "ok");
  return { rows, level, concerns: rows.filter((r) => LEVEL_ORDER.indexOf(r.level) >= LEVEL_ORDER.indexOf("warning")) };
}

/** Whole games of this shape that still fit today, and the resource that stops them. */
export function additionalGames(status: ResourceStatus[], perGame: Amounts): { games: number; resource: ResourceId } | null {
  let best: { games: number; resource: ResourceId } | null = null;
  for (const s of status) {
    if (!s.limit || !DAILY_RESOURCES.includes(s.resource) || perGame[s.resource] <= 0) continue;
    const games = Math.max(0, Math.floor((s.limit - s.used) / perGame[s.resource]));
    if (!best || games < best.games) best = { games, resource: s.resource };
  }
  return best;
}

/** Day key used for every daily counter: Cloudflare resets quotas at 00:00 UTC. */
export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);
