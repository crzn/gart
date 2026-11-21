import { describe, expect, it } from "vitest";
import { BrandingSchema, DEFAULT_BRANDING, QuestionInputSchema, contrastRatio, playabilityProblems } from "./quiz";

const opt = (text: string, isCorrect = false) => ({ text, isCorrect, imageMediaId: null });
const base = { type: "single" as const, text: "Q?", options: [opt("A", true), opt("B")] };

describe("QuestionInputSchema", () => {
  it("accepts a valid question and fills defaults", () => {
    const q = QuestionInputSchema.parse(base);
    expect(q.timeLimitSec).toBeNull();
    expect(q.explanation).toBe("");
  });
  it("trims text", () => expect(QuestionInputSchema.parse({ ...base, text: "  Q?  " }).text).toBe("Q?"));
  it("needs exactly one correct option", () => {
    expect(QuestionInputSchema.safeParse({ ...base, options: [opt("A"), opt("B")] }).success).toBe(false);
    expect(QuestionInputSchema.safeParse({ ...base, options: [opt("A", true), opt("B", true)] }).success).toBe(false);
  });
  it("limits options to 2..4", () => {
    expect(QuestionInputSchema.safeParse({ ...base, options: [opt("A", true)] }).success).toBe(false);
    expect(QuestionInputSchema.safeParse({ ...base, options: ["A", "B", "C", "D", "E"].map((x, i) => opt(x, i === 0)) }).success).toBe(false);
  });
  it("rejects duplicate options ignoring case", () => {
    expect(QuestionInputSchema.safeParse({ ...base, options: [opt("Yes", true), opt("yes")] }).success).toBe(false);
  });
  it("true/false needs exactly two options", () => {
    expect(QuestionInputSchema.safeParse({ ...base, type: "truefalse", options: [opt("A", true), opt("B"), opt("C")] }).success).toBe(false);
    expect(QuestionInputSchema.safeParse({ ...base, type: "truefalse" }).success).toBe(true);
  });
  it("bounds time and points", () => {
    expect(QuestionInputSchema.safeParse({ ...base, timeLimitSec: 4 }).success).toBe(false);
    expect(QuestionInputSchema.safeParse({ ...base, timeLimitSec: 301 }).success).toBe(false);
    expect(QuestionInputSchema.safeParse({ ...base, points: 10001 }).success).toBe(false);
    expect(QuestionInputSchema.safeParse({ ...base, points: 0, timeLimitSec: 5 }).success).toBe(true);
  });
});

describe("BrandingSchema", () => {
  it("accepts the defaults", () => expect(BrandingSchema.safeParse(DEFAULT_BRANDING).success).toBe(true));
  it.each(["#fff", "red", "#12345g", "#1234567", "url(x)", "#112233;color:red"])("refuses colour %s", (c) => {
    expect(BrandingSchema.safeParse({ ...DEFAULT_BRANDING, primaryColor: c }).success).toBe(false);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for identical colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#4f46e5", "#4f46e5")).toBeCloseTo(1, 5);
  });
  it("is symmetric", () => expect(contrastRatio("#112233", "#ffeedd")).toBeCloseTo(contrastRatio("#ffeedd", "#112233"), 8));
});

describe("playabilityProblems", () => {
  it("flags an empty quiz", () => expect(playabilityProblems([])).toContain("no_questions"));
  it("flags a question without one correct option", () => {
    expect(playabilityProblems([{ options: [{ isCorrect: false }, { isCorrect: false }] }])).toEqual(["question_1_invalid"]);
  });
  it("passes a valid quiz", () => expect(playabilityProblems([{ options: [{ isCorrect: true }, { isCorrect: false }] }])).toEqual([]));
});
