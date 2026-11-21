import { z } from "zod";

/* ------------------------------ roles ------------------------------ */

export const ROLES = ["owner", "admin", "editor"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

const RANK: Record<Role, number> = { owner: 3, admin: 2, editor: 1 };

/**
 * Who may create or change whom.
 *  - owner: any account, any role.
 *  - admin: editors only (cannot touch owners, other admins or promote anyone above editor).
 *  - editor: nobody.
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target === "editor";
  return false;
}

export function roleAtLeast(actor: Role, minimum: Role): boolean {
  return RANK[actor] >= RANK[minimum];
}

/* --------------------------- email / names --------------------------- */

export const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/u;

export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return e.length <= EMAIL_MAX && EMAIL_RE.test(e);
}

export function normalizeDisplayName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function isValidDisplayName(raw: string): boolean {
  const n = normalizeDisplayName(raw);
  const length = [...n].length;
  // No control or bidi-override characters.
  return length >= 1 && length <= 80 && !/[\p{C}‪-‮⁦-⁩]/u.test(n);
}

/* ----------------------------- passwords ----------------------------- */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// Small deny-list of the most common passwords that satisfy the length rule.
const COMMON = new Set([
  "123456789012", "1234567890123", "password1234", "password12345", "passwordpassword",
  "qwertyuiop12", "qwertyuiopasdf", "letmein123456", "administrator", "welcome12345",
  "iloveyou1234", "changeme1234", "admin12345678", "quizlab12345", "quizlabquizlab", "gart12345678", "gartgartgartgart",
  "123456123456", "abcdefghijkl", "1q2w3e4r5t6y", "qazwsxedcrfv",
]);

export type PasswordProblem = "too_short" | "too_long" | "too_common" | "too_simple" | "contains_email";

/** Returns the list of problems; an empty list means the password is acceptable. */
export function checkPassword(password: string, context: { email?: string } = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const chars = [...password];
  if (chars.length < PASSWORD_MIN) problems.push("too_short");
  if (chars.length > PASSWORD_MAX) problems.push("too_long");
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/u.test(password)) problems.push("too_common");
  // Fewer than 5 distinct characters (e.g. "abababababab") is not a real password.
  if (new Set(chars).size < 5) problems.push("too_simple");
  if (context.email) {
    const local = normalizeEmail(context.email).split("@")[0] ?? "";
    if (local.length >= 4 && lower.includes(local)) problems.push("contains_email");
  }
  return [...new Set(problems)];
}

/* ------------------------------ schemas ------------------------------ */

export const PasswordSchema = z.string().min(1).max(PASSWORD_MAX * 2);

export const LoginSchema = z.object({
  email: z.string().min(3).max(EMAIL_MAX),
  password: PasswordSchema,
});

export const SetupSchema = z.object({
  token: z.string().min(16).max(256),
  email: z.string().min(3).max(EMAIL_MAX),
  displayName: z.string().min(1).max(200),
  password: PasswordSchema,
});

export const CreateAdminSchema = z.object({
  email: z.string().min(3).max(EMAIL_MAX),
  displayName: z.string().min(1).max(200),
  password: PasswordSchema,
  role: z.enum(ROLES),
});

export const UpdateAdminSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    disabled: z.boolean().optional(),
    displayName: z.string().min(1).max(200).optional(),
    newPassword: PasswordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });

export const ChangePasswordSchema = z.object({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});

/** Public view of an administrator. Never includes hashes or salts. */
export interface AdminView {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface SessionView {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

/* ------------------------- password hashing params ------------------------- */

/** Cloudflare's runtime rejects PBKDF2 iteration counts above 100,000. */
export const KDF_ITERATIONS_MAX = 100_000;
export const KDF_ITERATIONS_MIN = 5_000;
export const KDF_ITERATIONS_DEFAULT = 10_000;

export function parseKdfIterations(raw: string | undefined): number {
  if (raw === undefined || raw === "") return KDF_ITERATIONS_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < KDF_ITERATIONS_MIN || n > KDF_ITERATIONS_MAX) return KDF_ITERATIONS_DEFAULT;
  return n;
}
