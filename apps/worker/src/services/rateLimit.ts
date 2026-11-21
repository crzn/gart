import type { Env } from "../env";
import type { Limit } from "../security/rateLimitPolicy";

function limiter(env: Env) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName("global"));
}

export async function rateLimitHit(env: Env, key: string, limit: Limit): Promise<{ allowed: boolean; retryAfterSec: number }> {
  return limiter(env).hit(key, limit.limit, limit.windowSec);
}

export async function rateLimitReset(env: Env, key: string): Promise<void> {
  await limiter(env).reset(key);
}
