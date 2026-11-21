import { ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { errorKey, problemKeys } from "../errors";
import { useLang } from "../i18n";
import { Button, Card, ErrorNote, Field } from "../ui";

interface Prefill { token: string; email: string; name: string }

/** The installer sends the administrator here with the one-time token in the URL fragment (never sent to a server). */
function readFragment(): Prefill {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return { token: p.get("token") ?? "", email: p.get("email") ?? "", name: p.get("name") ?? "" };
}

export function SetupPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const f = readFragment();
    setToken(f.token);
    setEmail(f.email);
    setName(f.name);
    if (f.token) window.history.replaceState(null, "", window.location.pathname);
    void api<{ needsSetup: boolean }>("/api/setup/status").then((s) => setClosed(!s.needsSetup)).catch(() => undefined);
  }, []);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      await api("/api/setup", { method: "POST", body: { token, email: email.trim(), displayName: name.trim(), password } });
      setPassword("");
      navigate("/login", { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === "already_set_up") setClosed(true);
      else if (e instanceof ApiError && e.code === "invalid_token") setError(t("setup.badLink"));
      else {
        setError(t(errorKey(e)));
        setProblems(problemKeys(e).map((k) => t(k)));
      }
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return (
      <section className="m-auto w-full max-w-md">
        <Card>
          <h1 className="text-2xl font-bold">{t("setup.doneTitle")}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t("setup.doneText")}</p>
          <Link to="/login" className="mt-6 inline-block font-semibold text-brand underline">{t("login.submit")}</Link>
        </Card>
      </section>
    );
  }

  return (
    <section className="m-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-bold">{t("setup.title")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("setup.subtitle")}</p>
        {!token ? <div className="mt-4"><ErrorNote>{t("setup.noLink")}</ErrorNote></div> : null}
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field id="name" label={t("setup.name")} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Field id="email" type="email" label={t("login.email")} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field id="password" type="password" label={t("login.password")} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-ink-muted">{t("setup.passwordHint")}</p>
          {error ? <ErrorNote>{error}{problems.length ? <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}</ErrorNote> : null}
          <Button type="submit" busy={busy} disabled={!token} className="w-full">
            <ShieldCheck className="size-4" aria-hidden />
            {t("setup.submit")}
          </Button>
        </form>
      </Card>
    </section>
  );
}
