import { describe, expect, it } from "vitest";
import { csvCell, safeFileName } from "./csv";

describe("csvCell", () => {
  it("quotes and escapes", () => expect(csvCell('a "b", c')).toBe('"a ""b"", c"'));
  it("neutralises spreadsheet formulas", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(csvCell(bad)).toBe(`"'${bad}"`);
  });
  it("keeps numbers", () => expect(csvCell(120)).toBe('"120"'));
});

describe("safeFileName", () => {
  it("transliterates Ukrainian", () => expect(safeFileName("Безпека на роботі", "x")).toBe("bezpeka_na_roboti"));
  it("falls back when nothing is left", () => expect(safeFileName("???", "game")).toBe("game"));
});
