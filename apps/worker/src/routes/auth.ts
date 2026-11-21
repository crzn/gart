import {
  ChangePasswordSchema, LoginSchema, checkPassword, normalizeEmail, parseKdfIterations, type AdminView,
} from "@gart/shared";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { findAdminByEmail, findAdminById, toView, updateAdmin } from "../repositories/admins";
import { writeAudit } from "../repositories/audit";
import {
  createSession, deleteExpiredSessions, deleteSessionById, deleteSessionsForAdmin, findSessionByTokenHash, listSessions,
} from "../repositories/sessions";
import { clearedSessionCookie, isSecureRequest, readSessionToken, sessionCookie } from "../security/cookies";
import { dummyVerify, hashPassword, verifyPassword } from "../security/password";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { SESSION_IDLE_MS, newSessionTimes } from "../security/sessionTimes";
import { hmacHex, randomId, randomToken, sha256Hex } from "../security/tokens";
import { rateLimitReset } from "../services/rateLimit";
import { limited, readJson, userAgentOf } from "./util";

export const authRoutes = new Hono<AppEnv>();

function meView(a: { adminId: string; email: string; displayName: string; role: AdminView["role"] }) {
  return { id: a.adminId, email: a.email, displayName: a.displayName, role: a.role };
}

authRoutes.post("/login", async (c) => {
  if (!c.env.SESSION_SECRET || c.env.SESSION_SECRET.length < 32) return c.json({ error: "server_misconfigured" }, 503);

  const ipLimited = await limited(c, rlKey.loginIp(c.get("ip")), LIMITS.loginPerIp);
  if (ipLimited) return ipLimited;
  const body = await readJson(c, LoginSchema);
  if (!body.ok) return body.res;

  const email = normalizeEmail(body.data.email);
  const accountKey = rlKey.loginAccount(await sha256Hex(email));
  const accountLimited = await limited(c, accountKey, LIMITS.loginPerAccount);
  if (accountLimited) return accountLimited;

  const admin = await findAdminByEmail(c.env.DB, email);
  const iterations = parseKdfIterations(c.env.KDF_ITERATIONS);
  let ok = false;
  if (admin) {
    ok = await verifyPassword(body.data.password, { hash: admin.password_hash, salt: admin.password_salt, kdfParams: admin.kdf_params });
  } else {
    await dummyVerify(body.data.password, iterations);
  }
  // Same answer for unknown account, wrong password and disabled account.
  if (!admin || !ok || admin.disabled === 1) return c.json({ error: "invalid_credentials" }, 401);

  await rateLimitReset(c.env, accountKey);

  const now = Date.now();
  const token = randomToken();
  const times = newSessionTimes(now);
  await deleteExpiredSessions(c.env.DB, now);
  await createSession(c.env.DB, {
    id: randomId(),
    adminId: admin.id,
    tokenHash: await sha256Hex(token),
    times,
    ipHash: await hmacHex(c.env.SESSION_SECRET, c.get("ip")),
    userAgent: userAgentOf(c),
  });
  await writeAudit(c.env.DB, { adminId: admin.id, action: "auth.login", entity: "administrator", entityId: admin.id });

  const secure = isSecureRequest(new URL(c.req.url));
  c.header("Set-Cookie", sessionCookie(token, SESSION_IDLE_MS / 1000, secure));
  return c.json({ admin: toView(admin) });
});

authRoutes.post("/logout", async (c) => {
  const secure = isSecureRequest(new URL(c.req.url));
  const token = readSessionToken(c.req.header("cookie"), secure);
  if (token) {
    const session = await findSessionByTokenHash(c.env.DB, await sha256Hex(token));
    if (session) {
      await deleteSessionById(c.env.DB, session.sessionId);
      await writeAudit(c.env.DB, { adminId: session.adminId, action: "auth.logout" });
    }
  }
  c.header("Set-Cookie", clearedSessionCookie(secure));
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, (c) => c.json({ admin: meView(c.get("auth")) }));

authRoutes.post("/password", requireAuth, async (c) => {
  const auth = c.get("auth");
  const rl = await limited(c, rlKey.passwordChange(auth.adminId), LIMITS.passwordChangePerAdmin);
  if (rl) return rl;
  const body = await readJson(c, ChangePasswordSchema);
  if (!body.ok) return body.res;

  const admin = await findAdminById(c.env.DB, auth.adminId);
  if (!admin) return c.json({ error: "unauthorized" }, 401);
  const valid = await verifyPassword(body.data.currentPassword, { hash: admin.password_hash, salt: admin.password_salt, kdfParams: admin.kdf_params });
  if (!valid) return c.json({ error: "invalid_credentials" }, 403);

  const problems = checkPassword(body.data.newPassword, { email: admin.email });
  if (problems.length) return c.json({ error: "weak_password", problems }, 400);
  if (body.data.newPassword === body.data.currentPassword) return c.json({ error: "weak_password", problems: ["same_as_current"] }, 400);

  const record = await hashPassword(body.data.newPassword, parseKdfIterations(c.env.KDF_ITERATIONS));
  await updateAdmin(c.env.DB, admin.id, { hash: record.hash, salt: record.salt, kdfParams: JSON.stringify(record.params) });
  // Changing the password signs out every other device.
  await deleteSessionsForAdmin(c.env.DB, admin.id, auth.sessionId);
  await writeAudit(c.env.DB, { adminId: admin.id, action: "auth.password_changed", entity: "administrator", entityId: admin.id });
  return c.json({ ok: true });
});

authRoutes.get("/sessions", requireAuth, async (c) => {
  const auth = c.get("auth");
  return c.json({ sessions: await listSessions(c.env.DB, auth.adminId, auth.sessionId) });
});

authRoutes.delete("/sessions/:id", requireAuth, async (c) => {
  const auth = c.get("auth");
  const removed = await deleteSessionById(c.env.DB, c.req.param("id"), auth.adminId);
  if (!removed) return c.json({ error: "not_found" }, 404);
  await writeAudit(c.env.DB, { adminId: auth.adminId, action: "auth.session_revoked", entity: "session", entityId: c.req.param("id") });
  return c.json({ ok: true });
});
