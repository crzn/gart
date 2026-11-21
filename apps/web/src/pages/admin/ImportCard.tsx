import { Download, FileJson, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { IMPORT_MAX_BYTES, IMPORT_MAX_FILES, buildTemplate, checkQuizFile, type ImportProblem } from "@gart/shared";
import { api, ApiError } from "../../api";
import { errorKey } from "../../errors";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card } from "../../ui";

interface Result { name: string; ok: boolean; title?: string; count?: number; error?: string; problems?: ImportProblem[] }

/** Import of quiz files (gart.json) and the downloadable template for AI assistants. */
export function ImportCard({ onImported }: { onImported(): void }) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const template = buildTemplate();

  function downloadTemplate() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([template], { type: "application/json" }));
    a.download = "gart-template.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function importOne(file: File): Promise<Result> {
    if (file.size > IMPORT_MAX_BYTES) return { name: file.name, ok: false, error: t("imp.tooBig") };
    let doc: unknown;
    try { doc = JSON.parse(await file.text()); } catch { return { name: file.name, ok: false, error: t("imp.notJson") }; }
    const checked = checkQuizFile(doc);
    if (!checked.ok) return { name: file.name, ok: false, problems: checked.problems };
    try {
      const r = await api<{ quiz: { title: string; questionCount: number } }>("/api/quizzes/import", { method: "POST", body: doc });
      return { name: file.name, ok: true, title: r.quiz.title, count: r.quiz.questionCount };
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_quiz_file") return { name: file.name, ok: false, problems: (e.payload as { problems: ImportProblem[] }).problems };
      return { name: file.name, ok: false, error: t(errorKey(e)) };
    }
  }

  async function run(files: File[]) {
    setNote(files.length > IMPORT_MAX_FILES ? t("imp.tooMany").replace("{n}", String(IMPORT_MAX_FILES)) : null);
    const chosen = files.slice(0, IMPORT_MAX_FILES);
    if (chosen.length === 0) return;
    setBusy(true);
    setResults([]);
    const out: Result[] = [];
    for (const f of chosen) { out.push(await importOne(f)); setResults([...out]); }
    setBusy(false);
    if (input.current) input.current.value = "";
    if (out.some((r) => r.ok)) onImported();
  }

  const label = (p: ImportProblem) => {
    const known = t(`imp.p.${p.message}` as MessageKey) as string | undefined;
    return `${p.path || t("imp.file")}: ${known ?? p.message}`;
  };

  return (
    <Card>
      <h2 className="text-xl font-bold">{t("imp.title")}</h2>
      <p className="mt-2 text-sm text-ink-muted">{t("imp.intro").replace("{n}", String(IMPORT_MAX_FILES))}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input ref={input} type="file" accept=".json,application/json" multiple hidden data-testid="import-input" onChange={(e) => void run([...(e.target.files ?? [])])} />
        <Button busy={busy} onClick={() => input.current?.click()}><Upload className="size-4" aria-hidden />{t("imp.choose")}</Button>
        <Button variant="ghost" onClick={downloadTemplate}><Download className="size-4" aria-hidden />{t("imp.download")}</Button>
      </div>
      <details className="mt-4 rounded-2xl bg-white/5 p-4 text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-2 font-medium"><FileJson className="size-4" aria-hidden />{t("imp.show")}</summary>
        <p className="mt-3 text-ink-muted">{t("imp.aiHint")}</p>
        <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-black/30 p-3 text-xs" data-testid="import-template">{template}</pre>
      </details>
      {note ? <p role="note" className="mt-4 rounded-2xl bg-amber-500/15 p-3 text-sm text-amber-200">{note}</p> : null}
      {results.length ? (
        <ul className="mt-4 space-y-2" data-testid="import-results">
          {results.map((r, i) => (
            <li key={i} className={`rounded-2xl p-3 text-sm ${r.ok ? "bg-emerald-500/15 text-emerald-100" : "bg-rose-500/15 text-rose-100"}`}>
              <p className="font-medium">{r.name}: {r.ok ? t("imp.done").replace("{title}", r.title ?? "").replace("{n}", String(r.count ?? 0)) : r.error ?? t("imp.failed")}</p>
              {r.problems ? <ul className="mt-1 list-disc pl-5 text-xs">{r.problems.map((p, j) => <li key={j}>{label(p)}</li>)}</ul> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
