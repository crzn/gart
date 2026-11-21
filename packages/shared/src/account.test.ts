import { describe, expect, it } from "vitest";
import {
  KDF_ITERATIONS_DEFAULT, canManageRole, checkPassword, isValidDisplayName, isValidEmail,
  normalizeEmail, parseKdfIterations, roleAtLeast, UpdateAdminSchema,
} from "./account";

describe("roles", () => {
  it("owner manages everyone, admin only editors, editor nobody", () => {
    for (const r of ["owner", "admin", "editor"] as const) expect(canManageRole("owner", r)).toBe(true);
    expect(canManageRole("admin", "editor")).toBe(true);
    expect(canManageRole("admin", "admin")).toBe(false);
    expect(canManageRole("admin", "owner")).toBe(false);
    for (const r of ["owner", "admin", "editor"] as const) expect(canManageRole("editor", r)).toBe(false);
  });
  it("orders roles", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("editor", "admin")).toBe(false);
  });
});

describe("email and names", () => {
  it("normalises and validates e-mail", () => {
    expect(normalizeEmail("  Anna@Example.COM ")).toBe("anna@example.com");
    expect(isValidEmail("anna@example.com")).toBe(true);
    for (const bad of ["", "anna", "anna@", "@x.com", "a b@x.com", "a@b", "a@@b.com", `${"a".repeat(250)}@x.com`]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
  it("validates display names", () => {
    expect(isValidDisplayName("Олена Коваль")).toBe(true);
    expect(isValidDisplayName("   ")).toBe(false);
    expect(isValidDisplayName("x".repeat(81))).toBe(false);
    expect(isValidDisplayName("evil‮name")).toBe(false);
  });
});

describe("password policy", () => {
  it("accepts a long passphrase", () => {
    expect(checkPassword("correct horse battery staple")).toEqual([]);
  });
  it("flags short, common, repetitive and e-mail based passwords", () => {
    expect(checkPassword("short1")).toContain("too_short");
    expect(checkPassword("passwordpassword")).toContain("too_common");
    expect(checkPassword("aaaaaaaaaaaaaaaa")).toContain("too_common");
    expect(checkPassword("abababababababab")).toContain("too_simple");
    expect(checkPassword("xx-oleksandr-xx-1", { email: "oleksandr@corp.ua" })).toContain("contains_email");
    expect(checkPassword("x".repeat(129))).toContain("too_long");
  });
  it("counts characters, not bytes (Ukrainian passphrase of 12 letters passes the length rule)", () => {
    expect(checkPassword("щедрийвечір12")).toEqual([]);
  });
});

describe("kdf iterations", () => {
  it("falls back to the default for missing or out-of-range values", () => {
    expect(parseKdfIterations(undefined)).toBe(KDF_ITERATIONS_DEFAULT);
    expect(parseKdfIterations("abc")).toBe(KDF_ITERATIONS_DEFAULT);
    expect(parseKdfIterations("100")).toBe(KDF_ITERATIONS_DEFAULT);
    expect(parseKdfIterations("100001")).toBe(KDF_ITERATIONS_DEFAULT);
    expect(parseKdfIterations("30000")).toBe(30000);
  });
});

describe("update schema", () => {
  it("rejects empty updates", () => {
    expect(UpdateAdminSchema.safeParse({}).success).toBe(false);
    expect(UpdateAdminSchema.safeParse({ disabled: true }).success).toBe(true);
    expect(UpdateAdminSchema.safeParse({ role: "root" }).success).toBe(false);
  });
});
