import { QuizSettingsSchema, type OptionView, type QuestionInput, type QuestionView, type QuizSummary, type QuizView } from "@gart/shared";
import { randomId } from "../security/tokens";

interface QuizRow {
  id: string; title: string; description: string; cover_media_id: string | null; category: string; tags_json: string;
  difficulty: string | null; language: string; template_id: string | null; settings_json: string; status: string;
  created_by: string | null; created_at: string; updated_at: string; question_count?: number;
}

const now = () => new Date().toISOString();

function summary(r: QuizRow): QuizSummary {
  return {
    id: r.id, title: r.title, description: r.description, category: r.category, status: r.status as QuizSummary["status"],
    language: r.language, difficulty: r.difficulty, questionCount: r.question_count ?? 0, coverMediaId: r.cover_media_id,
    createdBy: r.created_by, updatedAt: r.updated_at,
  };
}

export async function listQuizzes(db: D1Database): Promise<QuizSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) AS question_count
       FROM quizzes q ORDER BY q.updated_at DESC LIMIT 500`,
    )
    .all<QuizRow>();
  return results.map(summary);
}

export async function countQuizzes(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>())?.n ?? 0;
}

export async function getQuizRow(db: D1Database, id: string): Promise<QuizRow | null> {
  return db.prepare("SELECT * FROM quizzes WHERE id = ?").bind(id).first<QuizRow>();
}

export async function getQuiz(db: D1Database, id: string): Promise<QuizView | null> {
  const row = await db
    .prepare("SELECT q.*, (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) AS question_count FROM quizzes q WHERE q.id = ?")
    .bind(id).first<QuizRow>();
  if (!row) return null;
  const [qs, os] = await db.batch([
    db.prepare("SELECT * FROM questions WHERE quiz_id = ? ORDER BY position").bind(id),
    db.prepare(
      `SELECT o.* FROM answer_options o JOIN questions q ON q.id = o.question_id WHERE q.quiz_id = ? ORDER BY o.question_id, o.position`,
    ).bind(id),
  ]);
  const options = new Map<string, OptionView[]>();
  for (const o of (os?.results ?? []) as { id: string; question_id: string; text: string; image_media_id: string | null; is_correct: number }[]) {
    const list = options.get(o.question_id) ?? [];
    list.push({ id: o.id, text: o.text, imageMediaId: o.image_media_id, isCorrect: o.is_correct === 1 });
    options.set(o.question_id, list);
  }
  const questions: QuestionView[] = ((qs?.results ?? []) as {
    id: string; position: number; type: QuestionView["type"]; text: string; image_media_id: string | null;
    time_limit_s: number | null; points: number | null; explanation: string;
  }[]).map((q) => ({
    id: q.id, position: q.position, type: q.type, text: q.text, imageMediaId: q.image_media_id, timeLimitSec: q.time_limit_s,
    points: q.points, explanation: q.explanation, options: options.get(q.id) ?? [],
  }));
  return {
    ...summary(row), tags: safeJson<string[]>(row.tags_json, []), settings: safeJson<Record<string, unknown>>(row.settings_json, {}),
    templateId: row.template_id, createdAt: row.created_at, questions,
  };
}

function safeJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export async function insertQuiz(
  db: D1Database,
  q: { id: string; title: string; description: string; templateId: string | null; settings: Record<string, unknown>; createdBy: string; language: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO quizzes (id, title, description, template_id, settings_json, language, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(q.id, q.title, q.description, q.templateId, JSON.stringify(q.settings), q.language, q.createdBy)
    .run();
}

export async function getTemplates(db: D1Database) {
  const { results } = await db.prepare("SELECT id, name, description, settings_json, is_system FROM quiz_templates ORDER BY is_system DESC, name").all<{
    id: string; name: string; description: string; settings_json: string; is_system: number;
  }>();
  return results.map((t) => ({ id: t.id, name: t.name, description: t.description, isSystem: t.is_system === 1, settings: safeJson<Record<string, unknown>>(t.settings_json, {}) }));
}

export async function getTemplateSettings(db: D1Database, id: string): Promise<Record<string, unknown> | null> {
  const r = await db.prepare("SELECT settings_json FROM quiz_templates WHERE id = ?").bind(id).first<{ settings_json: string }>();
  return r ? safeJson(r.settings_json, {}) : null;
}

export interface QuizPatch {
  title?: string | undefined; description?: string | undefined; category?: string | undefined; tags?: string[] | undefined;
  difficulty?: string | null | undefined; language?: string | undefined; coverMediaId?: string | null | undefined;
  status?: string | undefined; settings?: Record<string, unknown> | undefined;
}

export async function updateQuiz(db: D1Database, id: string, p: QuizPatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if (p.title !== undefined) add("title", p.title);
  if (p.description !== undefined) add("description", p.description);
  if (p.category !== undefined) add("category", p.category);
  if (p.tags !== undefined) add("tags_json", JSON.stringify(p.tags));
  if (p.difficulty !== undefined) add("difficulty", p.difficulty);
  if (p.language !== undefined) add("language", p.language);
  if (p.coverMediaId !== undefined) add("cover_media_id", p.coverMediaId);
  if (p.status !== undefined) add("status", p.status);
  if (p.settings !== undefined) add("settings_json", JSON.stringify(p.settings));
  add("updated_at", now());
  await db.prepare(`UPDATE quizzes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
}

export async function deleteQuiz(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM quizzes WHERE id = ?").bind(id).run();
}

const touch = (db: D1Database, quizId: string) => db.prepare("UPDATE quizzes SET updated_at = ? WHERE id = ?").bind(now(), quizId);

function optionStatements(db: D1Database, questionId: string, q: QuestionInput) {
  return q.options.map((o, i) =>
    db.prepare("INSERT INTO answer_options (id, question_id, position, text, image_media_id, is_correct) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(randomId(), questionId, i, o.text, o.imageMediaId, o.isCorrect ? 1 : 0));
}

export async function countQuestions(db: D1Database, quizId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ?").bind(quizId).first<{ n: number }>())?.n ?? 0;
}

/** Appends a question. Position comes from a sub-select so two concurrent appends cannot collide silently. */
export async function appendQuestion(db: D1Database, quizId: string, q: QuestionInput): Promise<string> {
  const id = randomId();
  await db.batch([
    db.prepare(
      `INSERT INTO questions (id, quiz_id, position, type, text, image_media_id, time_limit_s, points, explanation)
       VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM questions WHERE quiz_id = ?), ?, ?, ?, ?, ?, ?)`,
    ).bind(id, quizId, quizId, q.type, q.text, q.imageMediaId, q.timeLimitSec, q.points, q.explanation),
    ...optionStatements(db, id, q),
    touch(db, quizId),
  ]);
  return id;
}

export async function replaceQuestion(db: D1Database, quizId: string, questionId: string, q: QuestionInput): Promise<boolean> {
  const exists = await db.prepare("SELECT 1 AS x FROM questions WHERE id = ? AND quiz_id = ?").bind(questionId, quizId).first();
  if (!exists) return false;
  await db.batch([
    db.prepare("DELETE FROM answer_options WHERE question_id = ?").bind(questionId),
    db.prepare(
      "UPDATE questions SET type = ?, text = ?, image_media_id = ?, time_limit_s = ?, points = ?, explanation = ?, updated_at = ? WHERE id = ?",
    ).bind(q.type, q.text, q.imageMediaId, q.timeLimitSec, q.points, q.explanation, now(), questionId),
    ...optionStatements(db, questionId, q),
    touch(db, quizId),
  ]);
  return true;
}

async function questionIds(db: D1Database, quizId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT id FROM questions WHERE quiz_id = ? ORDER BY position").bind(quizId).all<{ id: string }>();
  return results.map((r) => r.id);
}

/** Two-phase renumbering: shift everything out of range first so UNIQUE(quiz_id, position) never trips. */
function renumber(db: D1Database, quizId: string, order: string[]) {
  return [
    db.prepare("UPDATE questions SET position = position + 1000 WHERE quiz_id = ?").bind(quizId),
    ...order.map((qid, i) => db.prepare("UPDATE questions SET position = ? WHERE id = ? AND quiz_id = ?").bind(i, qid, quizId)),
    touch(db, quizId),
  ];
}

export async function deleteQuestion(db: D1Database, quizId: string, questionId: string): Promise<boolean> {
  const ids = await questionIds(db, quizId);
  if (!ids.includes(questionId)) return false;
  await db.batch([
    db.prepare("DELETE FROM questions WHERE id = ? AND quiz_id = ?").bind(questionId, quizId),
    ...renumber(db, quizId, ids.filter((x) => x !== questionId)),
  ]);
  return true;
}

/** Returns false when `order` is not exactly a permutation of the quiz's questions. */
export async function reorderQuestions(db: D1Database, quizId: string, order: string[]): Promise<boolean> {
  const ids = await questionIds(db, quizId);
  if (order.length !== ids.length || new Set(order).size !== order.length || !order.every((x) => ids.includes(x))) return false;
  await db.batch(renumber(db, quizId, order));
  return true;
}

export async function duplicateQuiz(db: D1Database, source: QuizView, newId: string, createdBy: string, title: string): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO quizzes (id, title, description, cover_media_id, category, tags_json, difficulty, language, template_id, settings_json, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    ).bind(newId, title, source.description, source.coverMediaId, source.category, JSON.stringify(source.tags), source.difficulty, source.language, source.templateId, JSON.stringify(source.settings), createdBy),
  ];
  for (const q of source.questions) {
    const qid = randomId();
    stmts.push(
      db.prepare("INSERT INTO questions (id, quiz_id, position, type, text, image_media_id, time_limit_s, points, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(qid, newId, q.position, q.type, q.text, q.imageMediaId, q.timeLimitSec, q.points, q.explanation),
      ...q.options.map((o, i) =>
        db.prepare("INSERT INTO answer_options (id, question_id, position, text, image_media_id, is_correct) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(randomId(), qid, i, o.text, o.imageMediaId, o.isCorrect ? 1 : 0)),
    );
  }
  await db.batch(stmts);
}

export async function mediaExists(db: D1Database, ids: (string | null | undefined)[]): Promise<boolean> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return true;
  const { results } = await db.prepare(`SELECT id FROM uploaded_media WHERE id IN (${wanted.map(() => "?").join(",")})`).bind(...wanted).all();
  return results.length === wanted.length;
}

/** Fills defaults and strips unknown keys. Returns null if the combined settings are invalid. */
export function normalizeSettings(raw: Record<string, unknown>): Record<string, unknown> | null {
  const r = QuizSettingsSchema.safeParse(raw);
  return r.success ? r.data : null;
}
