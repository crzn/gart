import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { errorKey } from "../errors";
import { useLang } from "../i18n";
import { Button, Card, ErrorNote, Field } from "../ui";

export function LoginPage() {
  const { t } = useLang();
  const { state, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "authenticated") {
    const to = (location.state as { from?: string } | null)?.from ?? "/admin";
    return <Navigate to={to} replace />;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      setPassword("");
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-bold">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("login.subtitle")}</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field id="email" type="email" label={t("login.email")} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field id="password" type="password" label={t("login.password")} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button type="submit" busy={busy} className="w-full">
            <LogIn className="size-4" aria-hidden />
            {t("login.submit")}
          </Button>
        </form>
      </Card>
    </section>
  );
}
