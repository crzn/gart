import { Plus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { canManageRole, ROLES, type AdminView, type Role } from "@gart/shared";
import { api } from "../../api";
import { errorKey, problemKeys } from "../../errors";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card, ErrorNote, Field } from "../../ui";

export function AdminsTab({ me }: { me: AdminView }) {
  const { t } = useLang();
  const [admins, setAdmins] = useState<AdminView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", displayName: "", password: "", role: "editor" as Role });
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setAdmins((await api<{ admins: AdminView[] }>("/api/admins")).admins);
      setError(null);
    } catch (e) {
      setError(t(errorKey(e)));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  const assignable = ROLES.filter((r) => canManageRole(me.role, r));

  async function create(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setFormErrors([]);
    try {
      await api("/api/admins", { method: "POST", body: { ...form, email: form.email.trim(), displayName: form.displayName.trim() } });
      setForm({ email: "", displayName: "", password: "", role: assignable[assignable.length - 1] ?? "editor" });
      await load();
    } catch (e) {
      const probs = problemKeys(e);
      setFormErrors(probs.length ? probs.map((k) => t(k)) : [t(errorKey(e))]);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/admins/${encodeURIComponent(id)}`, { method: "PATCH", body });
      setError(null);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      await load();
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-xl font-bold">{t("tab.admins")}</h2>
        {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="py-2 pr-4">{t("admins.name")}</th>
                <th className="py-2 pr-4">{t("login.email")}</th>
                <th className="py-2 pr-4">{t("admins.role")}</th>
                <th className="py-2">{t("admins.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {admins.map((a) => {
                const editable = a.id !== me.id && canManageRole(me.role, a.role);
                return (
                  <tr key={a.id}>
                    <td className="py-3 pr-4 font-medium">{a.displayName}{a.id === me.id ? ` (${t("admins.you")})` : ""}</td>
                    <td className="py-3 pr-4 text-ink-muted">{a.email}</td>
                    <td className="py-3 pr-4">
                      {editable ? (
                        <select
                          aria-label={t("admins.role")}
                          value={a.role}
                          onChange={(e) => void patch(a.id, { role: e.target.value })}
                          className="rounded-lg border border-slate-500 bg-slate-950/70 px-2 py-1"
                        >
                          {assignable.map((r) => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}
                        </select>
                      ) : t(`role.${a.role}` as MessageKey)}
                    </td>
                    <td className="py-3">
                      {editable ? (
                        <Button variant={a.disabled ? "ghost" : "danger"} onClick={() => void patch(a.id, { disabled: !a.disabled })}>
                          {a.disabled ? t("admins.enable") : t("admins.disable")}
                        </Button>
                      ) : a.disabled ? t("admins.disabled") : t("admins.active")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <h2 className="text-xl font-bold">{t("admins.add")}</h2>
        <form onSubmit={create} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field id="n-email" type="email" label={t("login.email")} autoComplete="off" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field id="n-name" label={t("admins.name")} autoComplete="off" required maxLength={60} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <Field id="n-pass" type="password" label={t("admins.tempPassword")} autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <div>
            <label htmlFor="n-role" className="mb-1.5 block text-sm font-medium">{t("admins.role")}</label>
            <select id="n-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2.5 text-sm">
              {assignable.map((r) => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 space-y-3">
            {formErrors.length ? <ErrorNote>{formErrors.join(" ")}</ErrorNote> : null}
            <Button type="submit" busy={busy}><Plus className="size-4" aria-hidden />{t("admins.create")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
