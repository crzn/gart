import { roleAtLeast, type Role } from "@gart/shared";
import type { MiddlewareHandler } from "hono";
import { findSessionByTokenHash, touchSessionRow } from "../repositories/sessions";
import { isSecureRequest, readSessionToken } from "../security/cookies";
import { isSessionValid, touchSession } from "../security/sessionTimes";
import { sha256Hex } from "../security/tokens";
import type { AppEnv } from "./context";

/** Loads the session from the cookie. Rejects with 401 when missing, expired or the account is disabled. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionToken(c.req.header("cookie"), isSecureRequest(new URL(c.req.url)));
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const session = await findSessionByTokenHash(c.env.DB, await sha256Hex(token));
  const now = Date.now();
  if (!session || session.disabled || !isSessionValid(session.times, now)) return c.json({ error: "unauthorized" }, 401);

  const refreshed = touchSession(session.times, now);
  if (refreshed) await touchSessionRow(c.env.DB, session.sessionId, refreshed);

  c.set("auth", {
    sessionId: session.sessionId,
    adminId: session.adminId,
    email: session.email,
    displayName: session.displayName,
    role: session.role,
  });
  await next();
};

export function requireRole(minimum: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roleAtLeast(c.get("auth").role, minimum)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}
