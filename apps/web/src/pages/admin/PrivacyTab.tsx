import { useEffect, useState } from "react";
import { DEFAULT_PRIVACY, RETENTION_CHOICES, type Privacy } from "@gart/shared";
import { api } from "../../api";
import { errorKey } from "../../errors";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card, ErrorNote, Field } from "../../ui";

export function PrivacyTab() {
  const { t } = useLang();
  const [p, setP] = useState<Privacy>(DEFAULT_PRIVACY);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ privacy: Privacy }>("/api/privacy").then((r) => setP(r.privacy)).catch(() => undefined); }, []);
  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try { const r = await api<{ privacy: Privacy }>("/api/privacy", { method: "PUT", body: p }); setP(r.privacy); setSaved(true); }
    catch (e) { setError(t(errorKey(e))); } finally { setBusy(false); }
  }
  return (
    <Card className="space-y-5">
      <div><h2 className="text-xl font-bold">{t("priv.admin.title")}</h2><p className="mt-1 text-sm text-ink-muted">{t("priv.admin.hint")}</p></div>
      <div>
        <label htmlFor="pr-ret" className="mb-1.5 block text-sm font-medium">{t("priv.admin.retention")}</label>
        <select id="pr-ret" value={p.retentionDays} onChange={(e) => setP({ ...p, retentionDays: Number(e.target.value) })} className="w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2.5 text-sm">
          {RETENTION_CHOICES.map((d) => <option key={d} value={d}>{t(`priv.admin.d${d}` as MessageKey)}</option>)}
        </select>
      </div>
      <Field id="pr-contact" label={t("priv.admin.contact")} maxLength={200} value={p.contact} onChange={(e) => setP({ ...p, contact: e.target.value })} />
      <div>
        <label htmlFor="pr-note" className="mb-1.5 block text-sm font-medium">{t("priv.admin.note")}</label>
        <textarea id="pr-note" rows={4} maxLength={2000} value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} className="w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2.5 text-sm" />
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} busy={busy}>{t("quiz.save")}</Button>
        <a href="/privacy" target="_blank" rel="noreferrer" className="text-sm underline underline-offset-2">{t("priv.admin.view")}</a>
        {saved ? <span role="status" className="text-sm text-emerald-300">{t("priv.admin.saved")}</span> : null}
      </div>
    </Card>
  );
}
