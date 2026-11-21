import {
  SetupSchema, checkPassword, isValidDisplayName, isValidEmail, normalizeDisplayName, normalizeEmail, parseKdfIterations,
  KDF_ITERATIONS_MAX,
} from "@gart/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../middleware/context";
import { writeAudit } from "../repositories/audit";
import { countAdmins, insertFirstOwner } from "../repositories/admins";
import { hashPassword } from "../security/password";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { timingSafeEqualText } from "../security/encoding";
import { randomId } from "../security/tokens";
import { limited, readJson } from "./util";

export const setupRoutes = new Hono<AppEnv>();

/** Tells the UI and installer whether the first administrator still has to be created. */
setupRoutes.get("/status", async (c) => {
  try {
    return c.json({ needsSetup: (await countAdmins(c.env.DB)) === 0 });
  } catch {
    return c.json({ error: "schema_missing" }, 503);
  }
});

const BenchSchema = z.object({ token: z.string().min(16).max(256), iterations: z.number().int().min(1000).max(KDF_ITERATIONS_MAX) });

/**
 * Setup gate shared by the endpoints below: the one-time token must match and no administrator may
 * exist yet. After the first administrator is created these endpoints answer 409 forever, so a
 * leftover token cannot be used to take over an installed system.
 */
async function gate(c: import("hono").Context<AppEnv>, token: string): Promise<Response | null> {
  if (!c.env.SETUP_TOKEN) return c.json({ error: "setup_not_configured" }, 503);
  if (!timingSafeEqualText(token, c.env.SETUP_TOKEN)) return c.json({ error: "invalid_token" }, 403);
  if ((await countAdmins(c.env.DB)) > 0) return c.json({ error: "already_set_up" }, 409);
  return null;
}

/**
 * Used by the installer to pick a PBKDF2 iteration count that fits this account's CPU budget:
 * it derives a key at the requested count and reports success. A count that exceeds the limit makes
 * the platform abort the request, which the installer sees as a failed call.
 */
setupRoutes.post("/kdf-bench", async (c) => {
  const rl = await limited(c, rlKey.kdfBenchIp(c.get("ip")), LIMITS.kdfBenchPerIp);
  if (rl) return rl;
  const body = await readJson(c, BenchSchema);
  if (!body.ok) return body.res;
  const denied = await gate(c, body.data.token);
  if (denied) return denied;
  await hashPassword("calibration-only", body.data.iterations);
  return c.json({ ok: true, iterations: body.data.iterations });
});

setupRoutes.post("/", async (c) => {
  const rl = await limited(c, rlKey.setupIp(c.get("ip")), LIMITS.setupPerIp);
  if (rl) return rl;
  const body = await readJson(c, SetupSchema);
  if (!body.ok) return body.res;
  const { token, password } = body.data;
  const denied = await gate(c, token);
  if (denied) return denied;

  const email = normalizeEmail(body.data.email);
  if (!isValidEmail(email)) return c.json({ error: "invalid_email" }, 400);
  if (!isValidDisplayName(body.data.displayName)) return c.json({ error: "invalid_display_name" }, 400);
  const problems = checkPassword(password, { email });
  if (problems.length) return c.json({ error: "weak_password", problems }, 400);

  const record = await hashPassword(password, parseKdfIterations(c.env.KDF_ITERATIONS));
  const id = randomId();
  const created = await insertFirstOwner(c.env.DB, {
    id,
    email,
    displayName: normalizeDisplayName(body.data.displayName),
    hash: record.hash,
    salt: record.salt,
    kdfParams: JSON.stringify(record.params),
    role: "owner",
  });
  if (!created) return c.json({ error: "already_set_up" }, 409);

  await c.env.DB.prepare("UPDATE application_settings SET value_json = 'true', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = 'setup_completed'").run();
  await writeAudit(c.env.DB, { adminId: id, action: "setup.first_owner", entity: "administrator", entityId: id, meta: { iterations: record.params.iterations } });
  return c.json({ ok: true, iterations: record.params.iterations }, 201);
});
