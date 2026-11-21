/** Fixed-window limits for sensitive endpoints. Keys are built here so they stay consistent. */
export interface Limit {
  limit: number;
  windowSec: number;
}

export const LIMITS = {
  loginPerIp: { limit: 20, windowSec: 600 },
  loginPerAccount: { limit: 8, windowSec: 900 },
  setupPerIp: { limit: 15, windowSec: 3600 },
  kdfBenchPerIp: { limit: 200, windowSec: 3600 },
  passwordChangePerAdmin: { limit: 10, windowSec: 900 },
  // A whole office can sit behind one address, so the WebSocket limit must allow a full room joining and reconnecting.
  wsConnectPerIp: { limit: 600, windowSec: 600 },
  gameCreatePerAdmin: { limit: 20, windowSec: 3600 },
} as const satisfies Record<string, Limit>;

export const rlKey = {
  loginIp: (ip: string) => `login:ip:${ip}`,
  loginAccount: (emailHash: string) => `login:acct:${emailHash}`,
  setupIp: (ip: string) => `setup:ip:${ip}`,
  kdfBenchIp: (ip: string) => `kdf:ip:${ip}`,
  passwordChange: (adminId: string) => `pw:${adminId}`,
  wsConnectIp: (ip: string) => `ws:ip:${ip}`,
  gameCreate: (adminId: string) => `game:create:${adminId}`,
};

/** Pure fixed-window decision used by the Durable Object and unit tests. */
export function decide(
  state: { count: number; windowStart: number } | undefined,
  now: number,
  limit: Limit,
): { allowed: boolean; count: number; windowStart: number; retryAfterSec: number } {
  const windowMs = limit.windowSec * 1000;
  const fresh = !state || now - state.windowStart >= windowMs;
  const windowStart = fresh ? now : state.windowStart;
  const count = (fresh ? 0 : state.count) + 1;
  const allowed = count <= limit.limit;
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  return { allowed, count, windowStart, retryAfterSec };
}
