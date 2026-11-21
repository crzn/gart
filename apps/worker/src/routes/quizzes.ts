import { CreateQuizSchema, QUIZ_LIMITS, QuestionInputSchema, ReorderSchema, UpdateQuizSchema, playabilityProblems, roleAtLeast } from "@gart/shared";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { writeAudit } from "../repositories/audit";
import {
  appendQuestion, countQuestions, countQuizzes, deleteQuestion, deleteQuiz, duplicateQuiz, getQuiz, getQuizRow, getTemplateSettings,
  getTemplates, insertQuiz, listQuizzes, mediaExists, normalizeSettings, reorderQuestions, replaceQuestion, updateQuiz,
} from "../repositories/quizzes";
import { randomId } from "../security/tokens";
import { readJson } from "./util";

export const quizRoutes = new Hono<AppEnv>();
quizRoutes.use("*", requireAuth);

quizRoutes.get("/templates", async (c) => c.json({ templates: await getTemplates(c.env.DB) }));
quizRoutes.get("/", async (c) => c.json({ quizzes: await listQuizzes(c.env.DB) }));

quizRoutes.post("/", async (c) => {
  const actor = c.get("auth");
  const body = await readJson(c, CreateQuizSchema);
  if (!body.ok) return body.res;
  if ((await countQuizzes(c.env.DB)) >= QUIZ_LIMITS.quizzesTotal) return c.json({ error: "limit_reached" }, 409);

  let base: Record<string, unknown> = {};
  if (body.data.templateId) {
    const t = await getTemplateSettings(c.env.DB, body.data.templateId);
    if (!t) return c.json({ error: "unknown_template" }, 400);
    base = t;
  }
  const settings = normalizeSettings(base);
  if (!settings) return c.json({ error: "invalid_settings" }, 400);

  const id = randomId();
  await insertQuiz(c.env.DB, { id, title: body.data.title, description: body.data.description, templateId: body.data.templateId, settings, createdBy: actor.adminId, language: "uk" });
  await writeAudit(c.env.DB, { adminId: actor.adminId, action: "quiz.created", entity: "quiz", entityId: id });
  return c.json({ quiz: await getQuiz(c.env.DB, id) }, 201);
});

quizRoutes.get("/:id", async (c) => {
  const quiz = await getQuiz(c.env.DB, c.req.param("id"));
  return quiz ? c.json({ quiz }) : c.json({ error: "not_found" }, 404);
});

quizRoutes.patch("/:id", async (c) => {
  const actor = c.get("auth");
  const id = c.req.param("id");
  const body = await readJson(c, UpdateQuizSchema);
  if (!body.ok) return body.res;
  const row = await getQuizRow(c.env.DB, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const p = body.data;

  if (!(await mediaExists(c.env.DB, [p.coverMediaId]))) return c.json({ error: "unknown_media" }, 400);

  let settings: Record<string, unknown> | undefined;
  if (p.settings) {
    const merged = normalizeSettings({ ...(JSON.parse(row.settings_json) as Record<string, unknown>), ...p.settings });
    if (!merged) return c.json({ error: "invalid_settings" }, 400);
    settings = merged;
  }
  if (p.status === "active" && row.status !== "active") {
    const quiz = await getQuiz(c.env.DB, id);
    const problems = playabilityProblems(quiz?.questions ?? []);
    if (problems.length) return c.json({ error: "not_playable", problems }, 409);
  }
  await updateQuiz(c.env.DB, id, { ...p, ...(settings ? { settings } : {}) });
  if (p.status && p.status !== row.status) {
    await writeAudit(c.env.DB, { adminId: actor.adminId, action: "quiz.status", entity: "quiz", entityId: id, meta: { from: row.status, to: p.status } });
  }
  return c.json({ quiz: await getQuiz(c.env.DB, id) });
});

quizRoutes.delete("/:id", async (c) => {
  const actor = c.get("auth");
  const id = c.req.param("id");
  const row = await getQuizRow(c.env.DB, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  // Editors may only delete what they created; administrators and owners may delete any quiz.
  if (!roleAtLeast(actor.role, "admin") && row.created_by !== actor.adminId) return c.json({ error: "forbidden" }, 403);
  await deleteQuiz(c.env.DB, id);
  await writeAudit(c.env.DB, { adminId: actor.adminId, action: "quiz.deleted", entity: "quiz", entityId: id, meta: { title: row.title } });
  return c.json({ ok: true });
});

quizRoutes.post("/:id/duplicate", async (c) => {
  const actor = c.get("auth");
  const source = await getQuiz(c.env.DB, c.req.param("id"));
  if (!source) return c.json({ error: "not_found" }, 404);
  if ((await countQuizzes(c.env.DB)) >= QUIZ_LIMITS.quizzesTotal) return c.json({ error: "limit_reached" }, 409);
  const id = randomId();
  const title = `${source.title} (copy)`.slice(0, QUIZ_LIMITS.titleMax);
  await duplicateQuiz(c.env.DB, source, id, actor.adminId, title);
  await writeAudit(c.env.DB, { adminId: actor.adminId, action: "quiz.duplicated", entity: "quiz", entityId: id, meta: { from: source.id } });
  return c.json({ quiz: await getQuiz(c.env.DB, id) }, 201);
});

/* ------------------------------ questions ------------------------------ */

quizRoutes.post("/:id/questions", async (c) => {
  const quizId = c.req.param("id");
  if (!(await getQuizRow(c.env.DB, quizId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c, QuestionInputSchema);
  if (!body.ok) return body.res;
  if ((await countQuestions(c.env.DB, quizId)) >= QUIZ_LIMITS.questionsPerQuiz) return c.json({ error: "limit_reached" }, 409);
  const q = body.data;
  if (!(await mediaExists(c.env.DB, [q.imageMediaId, ...q.options.map((o) => o.imageMediaId)]))) return c.json({ error: "unknown_media" }, 400);
  const id = await appendQuestion(c.env.DB, quizId, q);
  return c.json({ quiz: await getQuiz(c.env.DB, quizId), questionId: id }, 201);
});

// Registered before "/:id/questions/:qid" so "reorder" is not treated as a question id.
quizRoutes.post("/:id/questions/reorder", async (c) => {
  const quizId = c.req.param("id");
  if (!(await getQuizRow(c.env.DB, quizId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c, ReorderSchema);
  if (!body.ok) return body.res;
  if (!(await reorderQuestions(c.env.DB, quizId, body.data.order))) return c.json({ error: "invalid_order" }, 400);
  return c.json({ quiz: await getQuiz(c.env.DB, quizId) });
});

quizRoutes.put("/:id/questions/:qid", async (c) => {
  const quizId = c.req.param("id");
  const body = await readJson(c, QuestionInputSchema);
  if (!body.ok) return body.res;
  const q = body.data;
  if (!(await mediaExists(c.env.DB, [q.imageMediaId, ...q.options.map((o) => o.imageMediaId)]))) return c.json({ error: "unknown_media" }, 400);
  if (!(await replaceQuestion(c.env.DB, quizId, c.req.param("qid"), q))) return c.json({ error: "not_found" }, 404);
  return c.json({ quiz: await getQuiz(c.env.DB, quizId) });
});

quizRoutes.delete("/:id/questions/:qid", async (c) => {
  const quizId = c.req.param("id");
  if (!(await deleteQuestion(c.env.DB, quizId, c.req.param("qid")))) return c.json({ error: "not_found" }, 404);
  return c.json({ quiz: await getQuiz(c.env.DB, quizId) });
});
