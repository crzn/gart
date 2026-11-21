import { Copy, FilePlus2, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { QuizSettingsSchema, roleAtLeast, type AdminView, type ProjectedRow, type QuizSummary } from "@gart/shared";
import { api, ApiError } from "../../api";
import { errorKey } from "../../errors";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card, ErrorNote, Field } from "../../ui";
import { QuizEditor } from "./QuizEditor";
import { ConcernList } from "./UsagePanels";

interface Template { id: string; name: string; description: string; settings: Record<string, unknown> }

type Translate = (key: MessageKey) => string;

/** Localised template text; falls back to the stored (English) text for templates added later. */
function tplText(t: Translate, id: string, field: "name" | "desc", fallback: string): string {
  return (t(`tpl.${id}.${field}` as MessageKey) as string | undefined) ?? fallback;
}

/** Plain-language list of what a template sets, built from its real settings so it cannot drift. */
function tplSummary(t: Translate, raw: Record<string, unknown>): string[] {
  const s = QuizSettingsSchema.parse(raw);
  const n = (key: MessageKey, v: number) => t(key).replace("{n}", String(v));
  return [
    n("tpl.time", s.defaultTimeLimitSec), n("tpl.points", s.basePoints),
    s.speedBonusPercent > 0 ? n("tpl.bonus", s.speedBonusPercent) : t("tpl.noBonus"),
    ...(s.randomizeQuestions ? [t("tpl.shuffleQ")] : []), ...(s.randomizeAnswers ? [t("tpl.shuffleA")] : []),
    s.leaderboardEnabled ? t("tpl.board") : t("tpl.noBoard"),
    s.showExplanations ? t("tpl.expl") : t("tpl.noExpl"),
    ...(s.allowLateJoin ? [t("tpl.late")] : []), ...(s.autoAdvance ? [t("tpl.auto")] : []),
  ];
}

export function QuizzesTab({ me }: { me: AdminView }) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [quota, setQuota] = useState<{ quizId: string; forecast: GameForecastView; safe: boolean } | null>(null);

  async function startGame(quizId: string, extra: { safeMode?: boolean; acknowledgeQuota?: boolean } = {}) {
    setError(null);
    try {
      const r = await api<{ game: { id: string } }>("/api/games", { method: "POST", body: { quizId, ...extra } });
      setQuota(null);
      navigate(`/host/${r.game.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "quota_risk") setQuota({ quizId, forecast: (e.payload as { forecast: GameForecastView }).forecast, safe: false });
      else setError(t(errorKey(e)));
    }
  }
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [q, tp] = await Promise.all([api<{ quizzes: QuizSummary[] }>("/api/quizzes"), api<{ templates: Template[] }>("/api/quizzes/templates")]);
      setQuizzes(q.quizzes);
      setTemplates(tp.templates);
    } catch (e) {
      setError(t(errorKey(e)));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function create(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { quiz } = await api<{ quiz: { id: string } }>("/api/quizzes", { method: "POST", body: { title, templateId: templateId || null } });
      setTitle("");
      setTemplateId("");
      setOpenId(quiz.id);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); } catch (e) { setError(t(errorKey(e))); }
    await load();
  }

  if (openId) return <QuizEditor id={openId} onClose={() => { setOpenId(null); void load(); }} />;

  const canDelete = (q: QuizSummary) => roleAtLeast(me.role, "admin") || q.createdBy === me.id;
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(lang === "uk" ? "uk-UA" : "en-GB");

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-xl font-bold">{t("quiz.new")}</h2>
        <form onSubmit={create} className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field id="qt" label={t("quiz.title")} required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <label htmlFor="qtpl" className="mb-1.5 block text-sm font-medium">{t("quiz.template")}</label>
            <select id="qtpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full rounded-xl border border-surface-border bg-black/20 px-3 py-2.5 text-sm">
              <option value="">{t("quiz.noTemplate")}</option>
              {templates.map((x) => <option key={x.id} value={x.id}>{tplText(t, x.id, "name", x.name)}</option>)}
            </select>
          </div>
          <Button type="submit" busy={busy}><FilePlus2 className="size-4" aria-hidden />{t("quiz.create")}</Button>
        </form>
        <p className="mt-3 text-sm text-ink-muted">{t("quiz.templateHint")}</p>
        {(() => {
          const x = templates.find((tp) => tp.id === templateId);
          if (!x) return null;
          return (
            <div className="mt-3 rounded-2xl bg-white/5 p-4 text-sm">
              <p>{tplText(t, x.id, "desc", x.description)}</p>
              <p className="mt-3 font-medium">{t("tpl.sets")}:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">{tplSummary(t, x.settings).map((line) => <li key={line}>{line}</li>)}</ul>
              <p className="mt-3 text-ink-muted">{t("tpl.canChange")}</p>
            </div>
          );
        })()}
        {error ? <div className="mt-4"><ErrorNote>{error}</ErrorNote></div> : null}
      </Card>
      <Card>
        <h2 className="text-xl font-bold">{t("quiz.list")}</h2>
        {quizzes === null ? <p className="mt-4 text-sm text-ink-muted">{t("admin.loading")}</p> : quizzes.length === 0 ? <p className="mt-4 text-sm text-ink-muted">{t("quiz.empty")}</p> : (
          <ul className="mt-4 divide-y divide-white/10">
            {quizzes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <button type="button" onClick={() => setOpenId(q.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium hover:underline">{q.title}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {t(`status.${q.status}` as MessageKey)} · {q.questionCount} {t("quiz.questionsShort")} · {fmt(q.updatedAt)}
                  </p>
                </button>
                <div className="flex gap-2">
                  {q.status === "active" ? <Button aria-label={t("quiz.play")} onClick={() => void startGame(q.id)}><Play className="size-4" aria-hidden />{t("quiz.play")}</Button> : null}
                  <Button variant="ghost" aria-label={t("quiz.duplicate")} onClick={() => void act(() => api(`/api/quizzes/${q.id}/duplicate`, { method: "POST", body: {} }))}><Copy className="size-4" aria-hidden /></Button>
                  {canDelete(q) ? (
                    <Button variant="ghost" aria-label={t("quiz.delete")} onClick={() => { if (window.confirm(t("quiz.confirmDelete"))) void act(() => api(`/api/quizzes/${q.id}`, { method: "DELETE" })); }}><Trash2 className="size-4" aria-hidden /></Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {quota ? (
        <div role="dialog" aria-modal="true" aria-labelledby="quota-title" className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-surface-border bg-surface p-6">
            <h2 id="quota-title" className="text-xl font-bold">{t("usage.pre.title")}</h2>
            <p className="text-sm text-ink-muted">{t("usage.pre.intro")}</p>
            <ConcernList rows={quota.forecast.projection.concerns} />
            {quota.forecast.additional ? <p className="text-sm">{t("usage.pre.fit")}: <b>{quota.forecast.additional.games}</b></p> : null}
            <label className="flex items-start gap-3 rounded-xl bg-white/5 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={quota.safe} onChange={(e) => setQuota({ ...quota, safe: e.target.checked })} />
              <span><b>{t("usage.pre.safe")}</b><br /><span className="text-ink-muted">{t("usage.pre.safeHelp").replace("{n}", String(quota.forecast.safeMode.maxPlayers))}</span></span>
            </label>
            <p className="text-xs text-ink-muted">{t("usage.pre.noPaid")}</p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="ghost" onClick={() => setQuota(null)}>{t("usage.pre.cancel")}</Button>
              <Button onClick={() => void startGame(quota.quizId, { acknowledgeQuota: true, safeMode: quota.safe })}>{t("usage.pre.go")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface GameForecastView { projection: { concerns: ProjectedRow[] }; additional: { games: number } | null; safeMode: { maxPlayers: number } }
