import { z } from "zod";
import { MAX_ANSWER_OPTIONS, MIN_ANSWER_OPTIONS } from "./limits";
import { QUIZ_LIMITS, QuestionInputSchema, TagsSchema } from "./quiz";

/**
 * The quiz exchange file ("gart.json"): one quiz per file, written by a person or by an AI assistant and imported in the
 * Quizzes tab. Keys that start with an underscore are comments for the author and are ignored on import.
 */
export const GART_FILE_FORMAT = "gart.quiz";
export const GART_FILE_VERSION = 1;
export const IMPORT_MAX_FILES = 5;
export const IMPORT_MAX_BYTES = 512 * 1024;

export const GartQuizFileSchema = z.object({
  format: z.literal(GART_FILE_FORMAT),
  version: z.literal(GART_FILE_VERSION),
  quiz: z.object({
    title: z.string().trim().min(1).max(QUIZ_LIMITS.titleMax),
    description: z.string().trim().max(QUIZ_LIMITS.descriptionMax).default(""),
    category: z.string().trim().max(QUIZ_LIMITS.categoryMax).default(""),
    tags: TagsSchema.default([]),
    difficulty: z.enum(["easy", "medium", "hard"]).nullable().default(null),
    language: z.enum(["uk", "en"]).default("uk"),
  }),
  /** Optional game settings; anything left out takes the default. */
  settings: z.record(z.string(), z.unknown()).default({}),
  questions: z.array(QuestionInputSchema).min(1).max(QUIZ_LIMITS.questionsPerQuiz),
});
export type GartQuizFile = z.infer<typeof GartQuizFileSchema>;

export interface ImportProblem { path: string; message: string }

const pathOf = (p: PropertyKey[]): string => p.map((x, i) => (typeof x === "number" ? `[${x + 1}]` : i ? `.${String(x)}` : String(x))).join("");

/** Checks one parsed file. Problems are listed with a readable path (questions[2].options) and a short code. */
export function checkQuizFile(raw: unknown): { ok: true; file: GartQuizFile } | { ok: false; problems: ImportProblem[] } {
  const r = GartQuizFileSchema.safeParse(raw);
  if (r.success) return { ok: true, file: r.data };
  const seen = new Set<string>();
  const problems: ImportProblem[] = [];
  for (const issue of r.error.issues) {
    const path = pathOf(issue.path);
    const message = issue.code === "custom" ? issue.message : issue.code === "invalid_type" && issue.input === undefined ? "required" : issue.code;
    const key = `${path}|${message}`;
    if (!seen.has(key) && problems.length < 20) { seen.add(key); problems.push({ path, message }); }
  }
  return { ok: false, problems };
}

/** The template that is offered for download. The comments are written for an AI assistant. */
export function buildTemplate(): string {
  const L = QUIZ_LIMITS;
  const doc = {
    _about: "Gart quiz file. Fill it in and import it in Gart: Quizzes > Import. Keys that start with an underscore are comments: keep or delete them, they are ignored.",
    _instructions_for_ai: [
      "Return ONE valid JSON document that follows this template, and nothing else (no Markdown, no code fence, no text before or after).",
      `Keep "format": "${GART_FILE_FORMAT}" and "version": ${GART_FILE_VERSION} exactly as they are.`,
      "Write the quiz in the language the user asks for, and set quiz.language to \"uk\" (Ukrainian) or \"en\" (English) to match it.",
      `At most ${L.questionsPerQuiz} questions. Question text up to ${L.questionTextMax} characters, each answer up to ${L.optionTextMax}, explanation up to ${L.explanationMax}, title up to ${L.titleMax}, description up to ${L.descriptionMax}, category up to ${L.categoryMax}, up to ${L.tagsMax} tags of up to ${L.tagMax} characters.`,
      `Every question has from ${MIN_ANSWER_OPTIONS} to ${MAX_ANSWER_OPTIONS} answers and EXACTLY ONE answer with "isCorrect": true. Answers of one question must differ from each other. Put the correct answer in a different position from question to question.`,
      "Question types: \"single\" (one correct answer out of 2 to 6) and \"truefalse\" (exactly two answers: True and False, in the quiz language).",
      "There is no time per question: the time limit is one setting for the whole quiz (settings.defaultTimeLimitSec, default 15 seconds). points (0 to 10000) is optional and should normally be null: a value REPLACES the quiz base points for that question. Set it only when the user asks for specific points for a question.",
      "explanation is optional and is shown to players after the question: one or two sentences saying why the answer is right.",
      "Do not put images, links or HTML in the text. Do not invent facts: every question must have one clearly correct answer that can be checked.",
      "settings is optional. Leave it as {} unless the user asks for something specific. Allowed keys: randomizeQuestions, randomizeAnswers (true/false), defaultTimeLimitSec (5-300), basePoints (0-10000), speedBonusPercent (0-100), showExplanations, showCorrectAnswer, leaderboardEnabled, allowLateJoin, autoAdvance (true/false).",
      "One file is one quiz. For several quizzes, make several files (Gart imports up to 5 files at once).",
    ],
    format: GART_FILE_FORMAT,
    version: GART_FILE_VERSION,
    quiz: {
      title: "Example: Ukrainian geography",
      description: "A short quiz about rivers and cities.",
      category: "Geography",
      tags: ["geography", "ukraine"],
      difficulty: "easy",
      language: "en",
      _difficulty: "easy, medium, hard or null",
    },
    settings: {},
    questions: [
      {
        type: "single",
        text: "Which river flows through Kyiv?",
        points: null,
        explanation: "The Dnipro divides Kyiv into the right and the left bank.",
        options: [
          { text: "Dnipro", isCorrect: true },
          { text: "Dniester", isCorrect: false },
          { text: "Danube", isCorrect: false },
          { text: "Southern Buh", isCorrect: false },
        ],
      },
      {
        type: "truefalse",
        text: "Lviv is in the west of Ukraine.",
        points: null,
        explanation: "",
        options: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: false },
        ],
      },
    ],
  };
  return JSON.stringify(doc, null, 2) + "\n";
}
