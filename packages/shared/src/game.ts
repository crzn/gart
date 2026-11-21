import type { QuestionType, QuizView } from "./quiz";
import { QuizSettingsSchema, type QuizSettings } from "./settings";

/** Frozen copy of a quiz taken when a game is created. Editing the quiz never changes a running game. */
export interface SnapshotOption { id: string; text: string; imageId: string | null; correct: boolean }
export interface SnapshotQuestion {
  id: string;
  type: QuestionType;
  text: string;
  imageId: string | null;
  timeLimitSec: number | null;
  points: number | null;
  explanation: string;
  options: SnapshotOption[];
}
export interface GameSnapshot {
  quizId: string;
  title: string;
  /** Shown to everyone in the lobby. Absent in snapshots of games created before 0.10.1. */
  description?: string;
  coverImageId?: string | null;
  questions: SnapshotQuestion[];
  settings: QuizSettings;
}

export function buildGameSnapshot(quiz: QuizView): GameSnapshot {
  return {
    quizId: quiz.id,
    title: quiz.title,
    description: quiz.description,
    coverImageId: quiz.coverMediaId,
    settings: QuizSettingsSchema.parse(quiz.settings),
    questions: quiz.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      imageId: q.imageMediaId,
      timeLimitSec: null, // one time limit for the whole quiz: a question's own time (older data, older files) is ignored
      points: q.points,
      explanation: q.explanation,
      options: q.options.map((o) => ({ id: o.id, text: o.text, imageId: o.imageMediaId, correct: o.isCorrect })),
    })),
  };
}

/** Fisher-Yates with unbiased integers from a CSPRNG. Returns a new array. */
export function shuffled<T>(items: readonly T[], randomInt: (maxExclusive: number) => number = cryptoInt): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function cryptoInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  for (;;) {
    crypto.getRandomValues(buf);
    if ((buf[0] as number) < limit) return (buf[0] as number) % maxExclusive;
  }
}

/** Game limits that are not part of per-quiz settings. */
export const GAME_LIMITS = {
  /** Games a single deployment may run at the same time (Free plan budget). */
  maxActiveGames: 3,
  /** A game nobody touched for this long is cancelled and its PIN freed. */
  idleExpiryMs: 6 * 60 * 60 * 1000,
  /** Players may still reconnect and read final results this long after a game ends. */
  finishedGraceMs: 30 * 60 * 1000,
  ticketTtlMs: 60 * 1000,
  topN: 10,
  /** Sockets the room accepts: players + host + projector screens + a little slack. */
  maxScreens: 5,
} as const;
