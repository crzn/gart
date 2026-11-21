import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api";
import { errorKey } from "../../errors";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card, ErrorNote, Field } from "../../ui";

interface Release { version: string; title: string; notes: string; publishedAt: string }
interface Run {
  target: string; from: string; kind: "update" | "rollback"; phase: "running" | "confirm" | "done" | "failed";
  steps: { step: string; status: string; detail?: string }[]; destructive?: string[]; error?: { code: string; message: string }; bookmark?: string | null;
}
interface View {
  current: string;
  connection: { accountName: string; workerName: string; databaseName: string } | null;
  run: Run | null;
  releases: { checkedAt: number; list: Release[]; error?: string; detail?: string } | null;
}

/** The first version that carries the updater itself: earlier ones cannot be restored from here. */
const FIRST_WITH_UPDATER = [0, 8, 2];
const parts = (v: string) => v.split(".").map(Number);
const cmp = (a: string, b: string) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };
const canRestore = (v: string) => { const p = parts(v); for (let i = 0; i < 3; i++) { const d = (p[i] ?? 0) - (FIRST_WITH_UPDATER[i] ?? 0); if (d) return d > 0; } return true; };

export function UpdatesTab() {
  const { t, lang } = useLang();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [worker, setWorker] = useState(() => (location.hostname.endsWith(".workers.dev") ? (location.hostname.split(".")[0] ?? "") : ""));

  const load = useCallback(async () => {
    try { setView(await api<View>("/api/updates")); setError(null); } catch (e) { if (!(e instanceof ApiError && e.status === 0)) setError(t(errorKey(e))); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  // While an update runs the site is replaced underneath us; a failed poll during the switch is normal, so it is ignored.
  const running = view?.run?.phase === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => { void api<View>("/api/updates").then(setView).catch(() => undefined); }, 2000);
    return () => clearInterval(id);
  }, [running]);

  async function act(fn: () => Promise<View>) {
    setBusy(true); setError(null);
    try { setView(await fn()); } catch (e) { setError(t(errorKey(e))); } finally { setBusy(false); }
  }
  const connect = (ev: FormEvent) => { ev.preventDefault(); void act(async () => { const v = await api<View>("/api/updates/connect", { method: "POST", body: { token: token.trim(), workerName: worker.trim() } }); setToken(""); return v; }); };
  const check = () => act(() => api<View>("/api/updates/check", { method: "POST", body: {} }));
  const start = (version: string, acknowledge = false) => act(() => api<View>("/api/updates/start", { method: "POST", body: { version, acknowledge } }));
  const disconnect = () => act(() => api<View>("/api/updates/connection", { method: "DELETE" }));

  if (!view) return <p className="text-sm text-ink-muted">{error ?? t("admin.loading")}</p>;

  const list = view.releases?.list ?? [];
  const latest = list[0];
  const newer = latest && cmp(latest.version, view.current) > 0 ? latest : null;
  const older = list.filter((r) => cmp(r.version, view.current) < 0 && canRestore(r.version));
  const run = view.run;
  const fill = (key: MessageKey, vars: Record<string, string>) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), t(key));

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="text-xl font-bold">{t("upd.title")}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t("upd.intro")}</p>
        <p className="mt-4 text-sm">{t("upd.current")}: <b className="font-mono">{view.current}</b></p>
        {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}
      </Card>

      {!view.connection ? (
        <Card>
          <h3 className="text-lg font-semibold">{t("upd.connectH")}</h3>
          <p className="mt-1 text-sm text-ink-muted">{t("upd.connectP")}</p>
          <p className="mt-3 text-sm font-medium">{t("upd.how")}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            {(["upd.s1", "upd.s2", "upd.s3", "upd.s4"] as const).map((k) => <li key={k}>{t(k)}</li>)}
          </ol>
          <form onSubmit={connect} className="mt-4 grid gap-4 sm:max-w-md">
            <Field id="upd-worker" label={t("upd.worker")} hint={t("upd.workerHint")} value={worker} onChange={(e) => setWorker(e.target.value)} autoComplete="off" required />
            <Field id="upd-token" type="password" label={t("upd.token")} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
            <div><Button type="submit" busy={busy}>{t("upd.connect")}</Button></div>
          </form>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">{fill("upd.connectedTo", { account: view.connection.accountName, worker: view.connection.workerName, db: view.connection.databaseName })}</p>
              <div className="flex gap-2">
                <Button variant="ghost" busy={busy && !running} disabled={running} onClick={() => void check()}><RefreshCw className="size-4" aria-hidden />{t("upd.check")}</Button>
                <Button variant="ghost" disabled={running || busy} onClick={() => void disconnect()}>{t("upd.disconnect")}</Button>
              </div>
            </div>
            {view.releases ? <p className="mt-2 text-xs text-ink-muted">{fill("upd.checkedAt", { time: new Date(view.releases.checkedAt).toLocaleString(lang === "uk" ? "uk-UA" : "en-GB") })}</p> : null}
            {view.releases?.error ? <div className="mt-3"><ErrorNote>{t(errorKey(new ApiError(502, view.releases.error)))}</ErrorNote>{view.releases.detail ? <p className="mt-1 break-all text-xs text-ink-muted">{view.releases.detail}</p> : null}</div> : null}
          </Card>

          {run ? (
            <Card>
              <ul className="space-y-1.5 text-sm" aria-live="polite">
                {run.steps.map((s) => (
                  <li key={s.step} className="flex items-center gap-2">
                    {s.status === "running" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : s.status === "failed" ? <CircleAlert className="size-4 text-red-400" aria-hidden /> : <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />}
                    <span>{t(`upd.step.${s.step}` as MessageKey)}</span>
                    <span className="text-ink-muted">· {t(`upd.status.${s.status}` as MessageKey)}</span>
                  </li>
                ))}
              </ul>
              {run.phase === "running" ? <p className="mt-3 text-sm text-ink-muted">{t("upd.running")}</p> : null}
              {run.phase === "done" ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-sm font-medium text-emerald-300">{fill("upd.done", { version: run.target })}</p>
                  <Button onClick={() => location.reload()}>{t("upd.reload")}</Button>
                </div>
              ) : null}
              {run.phase === "done" && run.bookmark ? <p className="mt-2 break-all text-xs text-ink-muted">{fill("upd.bookmark", { bookmark: run.bookmark })}</p> : null}
              {run.phase === "failed" ? (
                <div className="mt-3 grid gap-2">
                  <ErrorNote>{run.error?.message ?? t("err.generic")}</ErrorNote>
                  <p className="text-xs text-ink-muted">{t("upd.failed")}</p>
                </div>
              ) : null}
              {run.phase === "confirm" ? (
                <div className="mt-3 grid gap-2">
                  <p className="font-medium text-amber-300">{t("upd.confirmH")}</p>
                  <p className="text-sm text-ink-muted">{fill("upd.confirmP", { list: (run.destructive ?? []).join(", ") })}</p>
                  <div><Button busy={busy} onClick={() => void start(run.target, true)}>{t("upd.confirmBtn")}</Button></div>
                </div>
              ) : null}
            </Card>
          ) : null}

          {!running && view.releases ? (
            <Card>
              {list.length === 0 ? <p className="text-sm text-ink-muted">{t("upd.noReleases")}</p> : newer ? (
                <div>
                  <h3 className="text-lg font-semibold">{fill("upd.available", { version: newer.version })}</h3>
                  {newer.notes ? (<><p className="mt-2 text-sm font-medium">{t("upd.notes")}</p><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-xs text-ink-muted">{newer.notes}</pre></>) : null}
                  <div className="mt-4"><Button busy={busy} onClick={() => void start(newer.version)}>{fill("upd.install", { version: newer.version })}</Button></div>
                </div>
              ) : <p className="text-sm font-medium text-emerald-300">{t("upd.upToDate")}</p>}
            </Card>
          ) : null}

          {!running && older.length > 0 ? (
            <Card>
              <h3 className="text-lg font-semibold">{t("upd.rollbackH")}</h3>
              <p className="mt-1 text-sm text-ink-muted">{t("upd.rollbackP")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {older.map((r) => <Button key={r.version} variant="ghost" busy={busy} onClick={() => void start(r.version)}>{fill("upd.rollbackBtn", { version: r.version })}</Button>)}
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
