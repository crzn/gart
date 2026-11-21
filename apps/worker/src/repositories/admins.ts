import type { AdminView, Role } from "@gart/shared";

export interface AdminRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  kdf_params: string;
  role: Role;
  disabled: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, email, display_name, password_hash, password_salt, kdf_params, role, disabled, created_at, updated_at";

export function toView(row: AdminRow): AdminView {
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, disabled: row.disabled === 1, createdAt: row.created_at };
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM administrators").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countActiveOwners(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM administrators WHERE role = 'owner' AND disabled = 0")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function findAdminByEmail(db: D1Database, email: string): Promise<AdminRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM administrators WHERE email = ?`).bind(email).first<AdminRow>();
}

export function findAdminById(db: D1Database, id: string): Promise<AdminRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM administrators WHERE id = ?`).bind(id).first<AdminRow>();
}

export async function listAdmins(db: D1Database): Promise<AdminRow[]> {
  const res = await db.prepare(`SELECT ${COLUMNS} FROM administrators ORDER BY created_at, email`).all<AdminRow>();
  return res.results;
}

export interface NewAdmin {
  id: string;
  email: string;
  displayName: string;
  hash: string;
  salt: string;
  kdfParams: string;
  role: Role;
}

/**
 * Inserts the first owner only if the table is still empty, in one statement, so two concurrent
 * setup requests cannot both succeed. Returns false when an administrator already exists.
 */
export async function insertFirstOwner(db: D1Database, a: NewAdmin): Promise<boolean> {
  const res = await db
    .prepare(
      "INSERT INTO administrators (id, email, display_name, password_hash, password_salt, kdf_params, role) " +
        "SELECT ?, ?, ?, ?, ?, ?, 'owner' WHERE NOT EXISTS (SELECT 1 FROM administrators)",
    )
    .bind(a.id, a.email, a.displayName, a.hash, a.salt, a.kdfParams)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

/** Returns false if the e-mail is already taken. */
export async function insertAdmin(db: D1Database, a: NewAdmin): Promise<boolean> {
  try {
    await db
      .prepare(
        "INSERT INTO administrators (id, email, display_name, password_hash, password_salt, kdf_params, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(a.id, a.email, a.displayName, a.hash, a.salt, a.kdfParams, a.role)
      .run();
    return true;
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) return false;
    throw err;
  }
}

export async function updateAdmin(
  db: D1Database,
  id: string,
  changes: { role?: Role; disabled?: boolean; displayName?: string; hash?: string; salt?: string; kdfParams?: string },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (changes.role !== undefined) { sets.push("role = ?"); values.push(changes.role); }
  if (changes.disabled !== undefined) { sets.push("disabled = ?"); values.push(changes.disabled ? 1 : 0); }
  if (changes.displayName !== undefined) { sets.push("display_name = ?"); values.push(changes.displayName); }
  if (changes.hash !== undefined && changes.salt !== undefined && changes.kdfParams !== undefined) {
    sets.push("password_hash = ?", "password_salt = ?", "kdf_params = ?");
    values.push(changes.hash, changes.salt, changes.kdfParams);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  await db.prepare(`UPDATE administrators SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
}
