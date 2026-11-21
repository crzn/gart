import { MonitorSmartphone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PASSWORD_MIN, type SessionView } from "@gart/shared";
import { api } from "../../api";
import { errorKey, problemKeys } from "../../errors";
import { useLang } from "../../i18n";
import { useAuth } from "../../auth";
import { Button, Card, ErrorNote, Field } from "../../ui";

export function AccountTab() {
  const { t, lang } = useLang();
  const { refresh } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [sessions, setSessions] = useState<SessionView[]>([]);

  const loadSessions = useCallback(async () => {
    try {
      setSessions((await api<{ sessions: SessionView[] }>("/api/auth/sessions")).sessions);
    } catch {
      setSessions([]);
    }
  }, []);
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setDone(false);
    if (next !== again) return setErrors([t("pw.mismatch")]);
    setBusy(true);
    setErrors([]);
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
      await loadSessions();
      await refresh();
    } catch (e) {
      const probs = problemKeys(e);
      setErrors(probs.length ? probs.map((k) => t(k)) : [t(errorKey(e))]);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    } finally {
      await loadSessions();
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === "uk" ? "uk-UA" : "en-GB");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="text-xl font-bold">{t("account.password")}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t("account.passwordHint").replace("{n}", String(PASSWORD_MIN))}</p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <Field id="cur" type="password" label={t("account.current")} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Field id="new" type="password" label={t("account.new")} autoComplete="new-password" required minLength={PASSWORD_MIN} value={next} onChange={(e) => setNext(e.target.value)} />
          <Field id="again" type="password" label={t("account.repeat")} autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          {errors.length ? <ErrorNote>{errors.join(" ")}</ErrorNote> : null}
          {done ? <p role="status" className="rounded-2xl bg-emerald-500/15 p-3 text-sm text-emerald-200">{t("account.changed")}</p> : null}
          <Button type="submit" busy={busy}>{t("account.save")}</Button>
        </form>
      </Card>
      <Card>
        <h2 className="text-xl font-bold">{t("account.sessions")}</h2>
        <ul className="mt-4 divide-y divide-white/10">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <MonitorSmartphone className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{s.userAgent ?? "—"}</span>
                  {s.current ? <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">{t("account.thisDevice")}</span> : null}
                </p>
                <p className="mt-1 text-xs text-ink-muted">{t("account.lastSeen")}: {fmt(s.lastSeenAt)}</p>
              </div>
              {!s.current && (
                <Button variant="ghost" onClick={() => void revoke(s.id)} aria-label={t("account.revoke")}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
