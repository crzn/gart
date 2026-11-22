import { ArrowDown, ArrowLeft, ArrowUp, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AUTO_ADVANCE_DELAY_SEC, playabilityProblems, QUIZ_LIMITS, type QuestionView, type QuizView } from "@gart/shared";
import { api, ApiError } from "../../api";
import { errorKey } from "../../errors";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card, ErrorNote, Field } from "../../ui";
import { ImageField } from "./ImageField";
import { QuestionForm } from "./QuestionForm";

const fill = (text: string, n: number) => text.replace("{n}", String(n));
const BOOL_SETTINGS = ["randomizeQuestions", "randomizeAnswers", "leaderboardEnabled", "timerEnabled", "showCorrectAnswer", "showExplanations", "showFinalLeaderboard", "allowLateJoin", "autoAdvance", "closeWhenAllAnswered"] as const;
const NUM_SETTINGS: { key: string; min: number; max: number }[] = [
  { key: "defaultTimeLimitSec", min: 5, max: 300 },
  { key: "basePoints", min: 0, max: 10000 },
  { key: "speedBonusPercent", min: 0, max: 100 },
  { key: "countdownBeforeQuestionSec", min: 0, max: 10 },
];

/** An (i) next to a setting: hover or focus shows what it does, how it looks in the game and its default delay. */
function Help({ id, children }: { id: string; children: string }) {
  const { t } = useLang();
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label={t("set.help")} aria-describedby={id} className="rounded-full p-1 text-ink-muted hover:text-ink focus:text-ink"><Info className="size-4" aria-hidden /></button>
      <span id={id} role="tooltip" className="pointer-events-none invisible absolute right-0 top-full z-20 mt-1 w-72 max-w-[80vw] rounded-xl border-2 border-slate-300 bg-slate-950 p-3 text-left text-sm leading-relaxed text-white opacity-0 shadow-2xl group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">{children}</span>
    </span>
  );
}

export function QuizEditor({ id, onClose }: { id: string; onClose(): void }) {
  const { t } = useLang();
  const [quiz, setQuiz] = useState<QuizView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuestionView | "new" | null>(null);
  const [meta, setMeta] = useState({ title: "", description: "", category: "", tags: "" });

  const load = useCallback(async () => {
    try {
      const { quiz: q } = await api<{ quiz: QuizView }>(`/api/quizzes/${id}`);
      setQuiz(q);
      setMeta({ title: q.title, description: q.description, category: q.category, tags: q.tags.join(", ") });
    } catch (e) {
      setError(t(errorKey(e)));
    }
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>, ok?: string) {
    setError(null);
    setNotice(null);
    try {
      const { quiz: q } = await api<{ quiz: QuizView }>(`/api/quizzes/${id}`, { method: "PATCH", body });
      setQuiz(q);
      if (ok) setNotice(ok);
    } catch (e) {
      if (e instanceof ApiError && e.code === "not_playable") setError(t("quiz.notPlayable"));
      else setError(t(errorKey(e)));
    }
  }

  async function reorder(index: number, dir: -1 | 1) {
    if (!quiz) return;
    const order = quiz.questions.map((q) => q.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j]!, order[index]!];
    try {
      const { quiz: q } = await api<{ quiz: QuizView }>(`/api/quizzes/${id}/questions/reorder`, { method: "POST", body: { order } });
      setQuiz(q);
    } catch (e) { setError(t(errorKey(e))); }
  }

  async function removeQuestion(qid: string) {
    if (!window.confirm(t("q.confirmDelete"))) return;
    try {
      const { quiz: q } = await api<{ quiz: QuizView }>(`/api/quizzes/${id}/questions/${qid}`, { method: "DELETE" });
      setQuiz(q);
    } catch (e) { setError(t(errorKey(e))); }
  }

  if (!quiz) return <p className="text-sm text-ink-muted">{error ?? t("admin.loading")}</p>;
  const problems = playabilityProblems(quiz.questions);
  const settings = quiz.settings as Record<string, number | boolean>;
  const saveMeta = () => patch({
    title: meta.title, description: meta.description, category: meta.category,
    tags: meta.tags.split(",").map((x) => x.trim()).filter(Boolean),
  }, t("quiz.saved"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onClose}><ArrowLeft className="size-4" aria-hidden />{t("quiz.back")}</Button>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink-muted">{t("quiz.status")}:</span>
          <select aria-label={t("quiz.status")} value={quiz.status} onChange={(e) => void patch({ status: e.target.value })} className="rounded-lg border border-slate-500 bg-slate-950/70 px-2 py-1.5">
            {(["draft", "active", "archived"] as const).map((s) => <option key={s} value={s}>{t(`status.${s}` as MessageKey)}</option>)}
          </select>
        </div>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {notice ? <p role="status" className="rounded-2xl bg-emerald-500/15 p-3 text-sm text-emerald-200">{notice}</p> : null}

      <Card>
        <h2 className="text-xl font-bold">{t("quiz.details")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="mt" label={t("quiz.title")} maxLength={QUIZ_LIMITS.titleMax} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          <Field id="mc" hint={t("quiz.categoryHint")} label={t("quiz.category")} maxLength={QUIZ_LIMITS.categoryMax} value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })} />
          <div className="sm:col-span-2">
            <label htmlFor="md" className="mb-1.5 block text-sm font-medium">{t("quiz.description")}</label>
            <p id="md-hint" className="mb-1.5 text-xs text-ink-muted">{t("quiz.descriptionHint")}</p>
            <textarea id="md" aria-describedby="md-hint" rows={2} maxLength={QUIZ_LIMITS.descriptionMax} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} className="w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2.5 text-sm" />
          </div>
          <Field id="mg" label={t("quiz.tags")} value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} />
          <div>
            <label htmlFor="mdf" className="mb-1.5 block text-sm font-medium">{t("quiz.difficulty")}</label>
            <select id="mdf" value={quiz.difficulty ?? ""} onChange={(e) => void patch({ difficulty: e.target.value || null })} className="w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2.5 text-sm">
              <option value="">—</option>
              {(["easy", "medium", "hard"] as const).map((x) => <option key={x} value={x}>{t(`diff.${x}` as MessageKey)}</option>)}
            </select>
          </div>
          <ImageField label={t("quiz.cover")} value={quiz.coverMediaId} onChange={(m) => void patch({ coverMediaId: m })} />
        </div>
        <div className="mt-5"><Button onClick={() => void saveMeta()}>{t("quiz.save")}</Button></div>
      </Card>

      <Card>
        <h2 className="text-xl font-bold">{t("quiz.questions")} ({quiz.questions.length}/{QUIZ_LIMITS.questionsPerQuiz})</h2>
        {problems.length > 0 && quiz.status !== "draft" ? <p className="mt-3 text-sm text-amber-300">{t("quiz.notPlayable")}</p> : null}
        {editing ? (
          <div className="mt-5">
            <QuestionForm quizId={id} question={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
          </div>
        ) : (
          <>
            <ol className="mt-4 divide-y divide-white/10">
              {quiz.questions.map((q, i) => (
                <li key={q.id} className="flex items-center gap-3 py-3">
                  <span className="w-6 shrink-0 text-sm text-ink-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{q.text}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{t(q.type === "single" ? "q.single" : "q.truefalse")} · {q.options.length} {t("q.optionsShort")}
                      {q.points !== null ? <b className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200" title={t("q.overrides")}>{fill(t("q.ownPoints"), q.points)}</b> : null}</p>
                  </div>
                  <button type="button" onClick={() => void reorder(i, -1)} disabled={i === 0} aria-label={t("q.up")} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"><ArrowUp className="size-4" aria-hidden /></button>
                  <button type="button" onClick={() => void reorder(i, 1)} disabled={i === quiz.questions.length - 1} aria-label={t("q.down")} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"><ArrowDown className="size-4" aria-hidden /></button>
                  <button type="button" onClick={() => setEditing(q)} aria-label={t("q.edit")} className="rounded-lg p-2 hover:bg-white/10"><Pencil className="size-4" aria-hidden /></button>
                  <button type="button" onClick={() => void removeQuestion(q.id)} aria-label={t("q.delete")} className="rounded-lg p-2 hover:bg-white/10"><Trash2 className="size-4" aria-hidden /></button>
                </li>
              ))}
            </ol>
            {quiz.questions.length === 0 ? <p className="mt-4 text-sm text-ink-muted">{t("q.empty")}</p> : null}
            <div className="mt-4"><Button onClick={() => setEditing("new")} disabled={quiz.questions.length >= QUIZ_LIMITS.questionsPerQuiz}><Plus className="size-4" aria-hidden />{t("q.add")}</Button></div>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-xl font-bold">{t("quiz.settings")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {NUM_SETTINGS.map(({ key, min, max }) => (
            <div key={key} className="relative">
              <div className="absolute right-0 top-0"><Help id={`h-${key}`}>{fill(t(`set.${key}.help` as MessageKey), Number(settings[key]))}</Help></div>
              <Field id={`s-${key}`} type="number" min={min} max={max} label={t(`set.${key}` as MessageKey)} defaultValue={Number(settings[key])}
                onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== settings[key]) void patch({ settings: { [key]: v } }, t("quiz.saved")); }} />
            </div>
          ))}
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {BOOL_SETTINGS.map((key) => (
            <li key={key}>
              <div className="flex items-center gap-1 rounded-xl bg-white/5 pr-2">
                <label className="flex flex-1 cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                  <input type="checkbox" checked={settings[key] === true} onChange={(e) => void patch({ settings: { [key]: e.target.checked } }, t("quiz.saved"))} className="size-4 shrink-0 accent-indigo-400" />
                  {fill(t(`set.${key}` as MessageKey), key === "autoAdvance" ? AUTO_ADVANCE_DELAY_SEC : 0)}
                </label>
                <Help id={`h-${key}`}>{fill(t(`set.${key}.help` as MessageKey), key === "autoAdvance" ? AUTO_ADVANCE_DELAY_SEC : key === "timerEnabled" ? Number(settings.defaultTimeLimitSec) : 0)}</Help>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
