import { z } from "zod";
import { MAX_ANSWER_OPTIONS, MIN_ANSWER_OPTIONS } from "./limits";

/** Product limits for authored content. Shared by the Worker (enforcement) and the editor (hints). */
export const QUIZ_LIMITS = {
  titleMax: 100,
  descriptionMax: 500,
  categoryMax: 40,
  tagMax: 24,
  tagsMax: 10,
  questionTextMax: 300,
  optionTextMax: 120,
  explanationMax: 500,
  questionsPerQuiz: 50,
  quizzesTotal: 200,
  imageMaxBytes: 200 * 1024,
  mediaTotalMaxBytes: 150 * 1024 * 1024,
} as const;

export const QUESTION_TYPES = ["single", "truefalse"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUIZ_STATUSES = ["draft", "active", "archived"] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

const mediaId = z.string().min(8).max(64).nullable();
const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const OptionInputSchema = z.object({
  text: trimmed(QUIZ_LIMITS.optionTextMax),
  imageMediaId: mediaId.default(null),
  isCorrect: z.boolean(),
});

export const QuestionInputSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    text: trimmed(QUIZ_LIMITS.questionTextMax),
    imageMediaId: mediaId.default(null),
    timeLimitSec: z.number().int().min(5).max(300).nullable().default(null),
    points: z.number().int().min(0).max(10_000).nullable().default(null),
    explanation: z.string().trim().max(QUIZ_LIMITS.explanationMax).default(""),
    options: z.array(OptionInputSchema).min(MIN_ANSWER_OPTIONS).max(MAX_ANSWER_OPTIONS),
  })
  .superRefine((q, ctx) => {
    if (q.options.filter((o) => o.isCorrect).length !== 1) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "exactly_one_correct" });
    }
    if (q.type === "truefalse" && q.options.length !== 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "truefalse_needs_two" });
    }
    const keys = q.options.map((o) => o.text.trim().toLowerCase());
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "duplicate_options" });
    }
  });
export type QuestionInput = z.infer<typeof QuestionInputSchema>;

export const TagsSchema = z.array(z.string().trim().min(1).max(QUIZ_LIMITS.tagMax)).max(QUIZ_LIMITS.tagsMax);

export const CreateQuizSchema = z.object({
  title: trimmed(QUIZ_LIMITS.titleMax),
  description: z.string().trim().max(QUIZ_LIMITS.descriptionMax).default(""),
  templateId: z.string().min(1).max(64).nullable().default(null),
});

export const UpdateQuizSchema = z
  .object({
    title: trimmed(QUIZ_LIMITS.titleMax),
    description: z.string().trim().max(QUIZ_LIMITS.descriptionMax),
    category: z.string().trim().max(QUIZ_LIMITS.categoryMax),
    tags: TagsSchema,
    difficulty: z.enum(["easy", "medium", "hard"]).nullable(),
    language: z.enum(["uk", "en"]),
    coverMediaId: mediaId,
    status: z.enum(QUIZ_STATUSES),
    /** Partial settings; merged over the stored ones and validated as a whole. */
    settings: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });

export const ReorderSchema = z.object({ order: z.array(z.string().min(1).max(64)).min(1).max(QUIZ_LIMITS.questionsPerQuiz) });

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const color = z.string().regex(HEX_COLOR);

export const BrandingSchema = z.object({
  companyName: z.string().trim().max(60),
  primaryColor: color,
  secondaryColor: color,
  backgroundColor: color,
  accentColor: color,
  logoPlacement: z.enum(["top-left", "top-center", "top-right"]),
  logoMediaId: mediaId,
  backgroundMediaId: mediaId,
  welcomeMessage: z.string().trim().max(200),
  finalMessage: z.string().trim().max(200),
  /** Gart-wide sound: the intro and the join sound on the host screen and the projector. */
  soundEnabled: z.boolean().default(true),
});
export type Branding = z.infer<typeof BrandingSchema>;

export const DEFAULT_BRANDING: Branding = {
  companyName: "",
  primaryColor: "#4f46e5",
  secondaryColor: "#0ea5e9",
  backgroundColor: "#0f172a",
  accentColor: "#f59e0b",
  logoPlacement: "top-left",
  logoMediaId: null,
  backgroundMediaId: null,
  welcomeMessage: "",
  finalMessage: "",
  soundEnabled: true,
};

/* ------------------------------ views ------------------------------ */

export interface OptionView { id: string; text: string; imageMediaId: string | null; isCorrect: boolean }
export interface QuestionView {
  id: string; position: number; type: QuestionType; text: string; imageMediaId: string | null;
  timeLimitSec: number | null; points: number | null; explanation: string; options: OptionView[];
}
export interface QuizSummary {
  id: string; title: string; description: string; category: string; status: QuizStatus; language: string;
  difficulty: string | null; questionCount: number; coverMediaId: string | null; createdBy: string | null; updatedAt: string;
}
export interface QuizView extends QuizSummary {
  tags: string[]; settings: Record<string, unknown>; templateId: string | null; createdAt: string; questions: QuestionView[];
}

/* --------------------------- relative luminance --------------------------- */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Reasons a quiz cannot be set to "active" (playable). Empty = ready. */
export function playabilityProblems(questions: { options: { isCorrect: boolean }[] }[]): string[] {
  const problems: string[] = [];
  if (questions.length === 0) problems.push("no_questions");
  questions.forEach((q, i) => {
    if (q.options.length < MIN_ANSWER_OPTIONS || q.options.filter((o) => o.isCorrect).length !== 1) problems.push(`question_${i + 1}_invalid`);
  });
  return problems;
}
