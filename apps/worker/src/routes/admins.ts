import {
  CreateAdminSchema, UpdateAdminSchema, canManageRole, checkPassword, isValidDisplayName, isValidEmail,
  normalizeDisplayName, normalizeEmail, parseKdfIterations,
} from "@gart/shared";
import { Hono } from "hono";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { countActiveOwners, findAdminById, insertAdmin, listAdmins, toView, updateAdmin } from "../repositories/admins";
import { writeAudit } from "../repositories/audit";
import { deleteSessionsForAdmin } from "../repositories/sessions";
import { hashPassword } from "../security/password";
import { randomId } from "../security/tokens";
import { readJson } from "./util";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAuth, requireRole("admin"));

adminRoutes.get("/", async (c) => c.json({ admins: (await listAdmins(c.env.DB)).map(toView) }));

adminRoutes.post("/", async (c) => {
  const actor = c.get("auth");
  const body = await readJson(c, CreateAdminSchema);
  if (!body.ok) return body.res;
  const { role, password } = body.data;

  if (!canManageRole(actor.role, role)) return c.json({ error: "forbidden" }, 403);
  const email = normalizeEmail(body.data.email);
  if (!isValidEmail(email)) return c.json({ error: "invalid_email" }, 400);
  if (!isValidDisplayName(body.data.displayName)) return c.json({ error: "invalid_display_name" }, 400);
  const problems = checkPassword(password, { email });
  if (problems.length) return c.json({ error: "weak_password", problems }, 400);

  const record = await hashPassword(password, parseKdfIterations(c.env.KDF_ITERATIONS));
  const id = randomId();
  const inserted = await insertAdmin(c.env.DB, {
    id, email, displayName: normalizeDisplayName(body.data.displayName),
    hash: record.hash, salt: record.salt, kdfParams: JSON.stringify(record.params), role,
  });
  if (!inserted) return c.json({ error: "email_taken" }, 409);

  await writeAudit(c.env.DB, { adminId: actor.adminId, action: "admin.created", entity: "administrator", entityId: id, meta: { role } });
  const created = await findAdminById(c.env.DB, id);
  return c.json({ admin: created ? toView(created) : null }, 201);
});

adminRoutes.patch("/:id", async (c) => {
  const actor = c.get("auth");
  const targetId = c.req.param("id");
  const body = await readJson(c, UpdateAdminSchema);
  if (!body.ok) return body.res;
  const change = body.data;

  const target = await findAdminById(c.env.DB, targetId);
  if (!target) return c.json({ error: "not_found" }, 404);

  const isSelf = target.id === actor.adminId;
  if (isSelf) {
    // Own role and status cannot be changed (prevents locking oneself out or self-promotion);
    // own password goes through POST /api/auth/password, which asks for the current password.
    if (change.role !== undefined || change.disabled !== undefined || change.newPassword !== undefined) {
      return c.json({ error: "forbidden_self" }, 403);
    }
  } else {
    if (!canManageRole(actor.role, target.role)) return c.json({ error: "forbidden" }, 403);
    if (change.role !== undefined && !canManageRole(actor.role, change.role)) return c.json({ error: "forbidden" }, 403);
  }

  const losesOwnerPower = target.role === "owner" && target.disabled === 0 &&
    ((change.role !== undefined && change.role !== "owner") || change.disabled === true);
  if (losesOwnerPower && (await countActiveOwners(c.env.DB)) <= 1) return c.json({ error: "last_owner" }, 409);

  const updates: Parameters<typeof updateAdmin>[2] = {};
  if (change.role !== undefined) updates.role = change.role;
  if (change.disabled !== undefined) updates.disabled = change.disabled;
  if (change.displayName !== undefined) {
    if (!isValidDisplayName(change.displayName)) return c.json({ error: "invalid_display_name" }, 400);
    updates.displayName = normalizeDisplayName(change.displayName);
  }
  if (change.newPassword !== undefined) {
    const problems = checkPassword(change.newPassword, { email: target.email });
    if (problems.length) return c.json({ error: "weak_password", problems }, 400);
    const record = await hashPassword(change.newPassword, parseKdfIterations(c.env.KDF_ITERATIONS));
    updates.hash = record.hash;
    updates.salt = record.salt;
    updates.kdfParams = JSON.stringify(record.params);
  }

  await updateAdmin(c.env.DB, target.id, updates);
  // Disabling, demoting or resetting the password ends all of that person's sessions.
  if (change.disabled === true || change.newPassword !== undefined || (change.role !== undefined && change.role !== target.role)) {
    await deleteSessionsForAdmin(c.env.DB, target.id);
  }
  await writeAudit(c.env.DB, {
    adminId: actor.adminId, action: "admin.updated", entity: "administrator", entityId: target.id,
    meta: { role: change.role, disabled: change.disabled, nameChanged: change.displayName !== undefined, passwordReset: change.newPassword !== undefined },
  });
  const updated = await findAdminById(c.env.DB, target.id);
  return c.json({ admin: updated ? toView(updated) : null });
});
