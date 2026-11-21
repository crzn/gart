import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { MAX_ANSWER_OPTIONS, QUIZ_LIMITS, type QuestionType, type QuestionView } from "@gart/shared";
import { api } from "../../api";
import { errorKey } from "../../errors";
import { useLang } from "../../i18n";
import { Button, ErrorNote, Field } from "../../ui";
import { ImageField } from "./ImageField";

interface Draft {
  type: QuestionType; text: string; imageMediaId: string | null; timeLimitSec: string; points: string; explanation: string;
  options: { text: string; imageMediaId: string | null; isCorrect: boolean }[];
}

function toDraft(q: QuestionView | null, trueLabel: string, falseLabel: string): Draft {
  if (!q) return { type: "single", text: "", imageMediaId: null, timeLimitSec: "", points: "", explanation: "", options: [{ text: "", imageMediaId: null, isCorrect: true }, { text: "", imageMediaId: null, isCorrect: false }] };
  return {
    type: q.type, text: q.text, imageMediaId: q.imageMediaId, timeLimitSec: q.timeLimitSec?.toString() ?? "", points: q.points?.toString() ?? "", explanation: q.explanation,
    options: q.options.length ? q.options.map((o) => ({ text: o.text, imageMediaId: o.imageMediaId, isCorrect: o.isCorrect })) : [{ text: trueLabel, imageMediaId: null, isCorrect: true }, { text: falseLabel, imageMediaId: null, isCorrect: false }],
  };
}

export function QuestionForm({ quizId, question, onSaved, onCancel }: { quizId: string; question: QuestionView | null; onSaved(): void; onCancel(): void }) {
  const { t } = useLang();
  const [d, setD] = useState<Draft>(() => toDraft(question, t("q.true"), t("q.false")));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setOpt = (i: number, patch: Partial<Draft["options"][number]>) => set({ options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  function changeType(type: QuestionType) {
    if (type === "truefalse") set({ type, options: [{ text: t("q.true"), imageMediaId: null, isCorrect: true }, { text: t("q.false"), imageMediaId: null, isCorrect: false }] });
    else set({ type, options: d.options.length >= 2 ? d.options : toDraft(null, "", "").options });
  }
  const markCorrect = (i: number) => set({ options: d.options.map((o, j) => ({ ...o, isCorrect: j === i })) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.options.length) return;
    const next = [...d.options];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ options: next });
  };

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      type: d.type, text: d.text, imageMediaId: d.imageMediaId, explanation: d.explanation,
      timeLimitSec: d.timeLimitSec.trim() === "" ? null : Number(d.timeLimitSec),
      points: d.points.trim() === "" ? null : Number(d.points),
      options: d.options,
    };
    try {
      if (question) await api(`/api/quizzes/${quizId}/questions/${question.id}`, { method: "PUT", body });
      else await api(`/api/quizzes/${quizId}/questions`, { method: "POST", body });
      onSaved();
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="qtype" className="mb-1.5 block text-sm font-medium">{t("q.type")}</label>
          <select id="qtype" value={d.type} onChange={(e) => changeType(e.target.value as QuestionType)} className="w-full rounded-xl border border-surface-border bg-black/20 px-3 py-2.5 text-sm">
            <option value="single">{t("q.single")}</option>
            <option value="truefalse">{t("q.truefalse")}</option>
          </select>
        </div>
        <ImageField label={t("q.image")} value={d.imageMediaId} onChange={(id) => set({ imageMediaId: id })} />
      </div>
      <div>
        <label htmlFor="qtext" className="mb-1.5 block text-sm font-medium">{t("q.text")} <span className="text-ink-muted">({d.text.length}/{QUIZ_LIMITS.questionTextMax})</span></label>
        <textarea id="qtext" required maxLength={QUIZ_LIMITS.questionTextMax} rows={2} value={d.text} onChange={(e) => set({ text: e.target.value })} className="w-full rounded-xl border border-surface-border bg-black/20 px-3 py-2.5 text-sm" />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("q.options")}</legend>
        <ul className="space-y-3">
          {d.options.map((o, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/5 p-3">
              <input type="radio" name="correct" checked={o.isCorrect} onChange={() => markCorrect(i)} aria-label={t("q.markCorrect")} className="size-4 accent-emerald-400" />
              <input
                aria-label={`${t("q.option")} ${i + 1}`} required maxLength={QUIZ_LIMITS.optionTextMax} value={o.text} readOnly={d.type === "truefalse"}
                onChange={(e) => setOpt(i, { text: e.target.value })}
                className="min-w-0 flex-1 rounded-xl border border-surface-border bg-black/20 px-3 py-2 text-sm"
              />
              {d.type === "single" && (
                <>
                  <button type="button" onClick={() => move(i, -1)} aria-label={t("q.up")} className="rounded-lg p-2 hover:bg-white/10"><ArrowUp className="size-4" aria-hidden /></button>
                  <button type="button" onClick={() => move(i, 1)} aria-label={t("q.down")} className="rounded-lg p-2 hover:bg-white/10"><ArrowDown className="size-4" aria-hidden /></button>
                  {d.options.length > 2 && <button type="button" onClick={() => { const next = d.options.filter((_, j) => j !== i); if (!next.some((x) => x.isCorrect) && next[0]) next[0] = { ...next[0], isCorrect: true }; set({ options: next }); }} aria-label={t("q.removeOption")} className="rounded-lg p-2 hover:bg-white/10"><Trash2 className="size-4" aria-hidden /></button>}
                </>
              )}
            </li>
          ))}
        </ul>
        {d.type === "single" && d.options.length < MAX_ANSWER_OPTIONS && (
          <button type="button" onClick={() => set({ options: [...d.options, { text: "", imageMediaId: null, isCorrect: false }] })} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20"><Plus className="size-4" aria-hidden />{t("q.addOption")}</button>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="qtime" type="number" min={5} max={300} label={t("q.time")} placeholder={t("q.byDefault")} value={d.timeLimitSec} onChange={(e) => set({ timeLimitSec: e.target.value })} />
        <Field id="qpts" type="number" min={0} max={10000} label={t("q.points")} placeholder={t("q.byDefault")} value={d.points} onChange={(e) => set({ points: e.target.value })} />
      </div>
      <div>
        <label htmlFor="qexp" className="mb-1.5 block text-sm font-medium">{t("q.explanation")}</label>
        <textarea id="qexp" maxLength={QUIZ_LIMITS.explanationMax} rows={2} value={d.explanation} onChange={(e) => set({ explanation: e.target.value })} className="w-full rounded-xl border border-surface-border bg-black/20 px-3 py-2.5 text-sm" />
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-3">
        <Button type="submit" busy={busy}>{t("q.save")}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("q.cancel")}</Button>
      </div>
    </form>
  );
}
