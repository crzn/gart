import { describe, expect, it } from "vitest";
import * as local from "../../../installer/lib/util.mjs";
import { brandingSql, isHexColor, sanitizeCompanyName } from "./branding.mjs";

describe("branding rules stay identical to the local installer", () => {
  const names = ["Acme Corp", "  Acme   Corp ", "Ґалерея №1", "a".repeat(61), "<script>", "O'Neil & Sons (UA)", ""];
  it("company names", () => { for (const n of names) expect(sanitizeCompanyName(n)).toBe(local.sanitizeCompanyName(n)); });
  it("colours", () => { for (const c of ["#4f46e5", "#4F46E5", "red", "#12345", "#1234567", 5]) expect(isHexColor(c)).toBe(local.isHexColor(c)); });
  it("SQL", () => { expect(brandingSql("O'Neil", "#ABCDEF")).toBe(local.brandingSql("O'Neil", "#ABCDEF")); });
  it("refuses bad input", () => { expect(() => brandingSql("<x>", "#000000")).toThrow(); expect(() => brandingSql("A", "nope")).toThrow(); });
});
