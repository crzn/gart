import { z } from "zod";
import { MAX_PLAYERS_PER_GAME } from "./limits";

/** With automatic advance on, the correct answer and the ranking each stay on screen this long. */
export const AUTO_ADVANCE_DELAY_SEC = 3;

/**
 * Per-quiz game settings. Every field has a default, so `QuizSettingsSchema.parse({})`
 * yields a complete, valid configuration and templates only store what they change.
 *
 * Note: when `timerEnabled` is false there is no time limit, the host closes each
 * question manually and the speed bonus does not apply.
 */
export const QuizSettingsSchema = z
  .object({
    nicknameMinLength: z.number().int().min(1).max(24).default(2),
    nicknameMaxLength: z.number().int().min(1).max(24).default(20),
    randomizeQuestions: z.boolean().default(false),
    randomizeAnswers: z.boolean().default(true),
    leaderboardEnabled: z.boolean().default(true),
    timerEnabled: z.boolean().default(true),
    defaultTimeLimitSec: z.number().int().min(5).max(300).default(15),
    basePoints: z.number().int().min(0).max(10_000).default(1000),
    /** Max speed bonus as % of basePoints. 0 = no speed bonus. */
    speedBonusPercent: z.number().int().min(0).max(100).default(50),
    showCorrectAnswer: z.boolean().default(true),
    showExplanations: z.boolean().default(true),
    showFinalLeaderboard: z.boolean().default(true),
    allowLateJoin: z.boolean().default(false),
    allowReconnect: z.boolean().default(true),
    maxParticipants: z.number().int().min(1).max(MAX_PLAYERS_PER_GAME).default(MAX_PLAYERS_PER_GAME),
    /** Close a question as soon as every joined player has answered. */
    closeWhenAllAnswered: z.boolean().default(true),
    autoAdvance: z.boolean().default(false),
    showQuestionProgress: z.boolean().default(true),
    countdownBeforeQuestionSec: z.number().int().min(0).max(10).default(3),
  })
  .refine((s) => s.nicknameMinLength <= s.nicknameMaxLength, {
    message: "nicknameMinLength must not exceed nicknameMaxLength",
    path: ["nicknameMinLength"],
  });

export type QuizSettings = z.infer<typeof QuizSettingsSchema>;

export function defaultQuizSettings(): QuizSettings {
  return QuizSettingsSchema.parse({});
}
