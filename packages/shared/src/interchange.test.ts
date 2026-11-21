import { describe, expect, it } from "vitest";
import { GartQuizFileSchema, buildTemplate, checkQuizFile } from "./interchange";

const good = () => JSON.parse(buildTemplate());

describe("gart.json exchange file", () => {
  it("the downloadable template is itself a valid quiz", () => {
    const r = checkQuizFile(good());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.questions).toHaveLength(2);
  });
  it("ignores comment keys that start with an underscore", () => expect(GartQuizFileSchema.safeParse({ ...good(), _note: "x" }).success).toBe(true));
  it("fills defaults", () => {
    const r = checkQuizFile({ format: "gart.quiz", version: 1, quiz: { title: "T" }, questions: [{ type: "truefalse", text: "Q", options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] }] });
    expect(r.ok && r.file.quiz.language).toBe("uk");
  });
  it("rejects another format or version", () => {
    expect(checkQuizFile({ ...good(), format: "other" }).ok).toBe(false);
    expect(checkQuizFile({ ...good(), version: 2 }).ok).toBe(false);
  });
  it("explains what is wrong and where", () => {
    const d = good(); d.questions[1].options[1].isCorrect = true; d.questions.push({ ...d.questions[0], text: "" });
    const r = checkQuizFile(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.some((p) => p.path === "questions[2].options" && p.message === "exactly_one_correct")).toBe(true);
      expect(r.problems.some((p) => p.path === "questions[3].text")).toBe(true);
    }
  });
  it("needs at least one question and at most fifty", () => {
    expect(checkQuizFile({ ...good(), questions: [] }).ok).toBe(false);
    expect(checkQuizFile({ ...good(), questions: Array.from({ length: 51 }, () => good().questions[0]) }).ok).toBe(false);
  });
});
