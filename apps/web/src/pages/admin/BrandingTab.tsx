import { useEffect, useState } from "react";
import { contrastRatio, DEFAULT_BRANDING, type Branding } from "@gart/shared";
import { api } from "../../api";
import { onColor, useBranding } from "../../branding";
import { mediaUrl } from "../../image";
import { LogoLockup } from "../../Logo";
import { errorKey } from "../../errors";
import { useLang } from "../../i18n";
import { Button, Card, ErrorNote, Field } from "../../ui";
import { ImageField } from "./ImageField";

const COLORS = [
  ["primaryColor", "brand.primary"], ["secondaryColor", "brand.secondary"], ["backgroundColor", "brand.background"], ["accentColor", "brand.accent"],
] as const;

export function BrandingTab() {
  const { t } = useLang();
  const { branding, reload } = useBranding();
  const [b, setB] = useState<Branding>(branding);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setB(branding), [branding]);

  const set = (patch: Partial<Branding>) => { setB({ ...b, ...patch }); setSaved(false); };
  const lowContrast = contrastRatio(b.backgroundColor, "#f8fafc") < 4.5 || contrastRatio(b.primaryColor, "#ffffff") < 3;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/branding", { method: "PUT", body: b });
      await reload();
      setSaved(true);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <h2 className="text-xl font-bold">{t("tab.branding")}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field id="bn" label={t("brand.company")} maxLength={60} value={b.companyName} onChange={(e) => set({ companyName: e.target.value })} />
          <div>
            <label htmlFor="bp" className="mb-1.5 block text-sm font-medium">{t("brand.logoPlacement")}</label>
            <select id="bp" value={b.logoPlacement} onChange={(e) => set({ logoPlacement: e.target.value as Branding["logoPlacement"] })} className="w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2.5 text-sm">
              <option value="top-left">{t("brand.left")}</option>
              <option value="top-center">{t("brand.center")}</option>
              <option value="top-right">{t("brand.right")}</option>
            </select>
          </div>
          {COLORS.map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`c-${key}`} className="mb-1.5 block text-sm font-medium">{t(label)}</label>
              <input id={`c-${key}`} type="color" value={b[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<Branding>)} className="h-11 w-full cursor-pointer rounded-xl border border-surface-border bg-transparent" />
            </div>
          ))}
          <ImageField label={t("brand.logo")} value={b.logoMediaId} maxSide={400} onChange={(id) => set({ logoMediaId: id })} />
          <ImageField label={t("brand.backgroundImage")} value={b.backgroundMediaId} maxSide={1600} onChange={(id) => set({ backgroundMediaId: id })} />
          <Field id="bw" label={t("brand.welcome")} maxLength={200} value={b.welcomeMessage} onChange={(e) => set({ welcomeMessage: e.target.value })} />
          <Field id="bf" label={t("brand.final")} maxLength={200} value={b.finalMessage} onChange={(e) => set({ finalMessage: e.target.value })} />
        </div>
        <fieldset className="mt-5 rounded-2xl border border-surface-border p-4">
          <legend className="px-2 text-sm font-medium">{t("brand.sound")}</legend>
          <div className="flex gap-4" role="radiogroup">
            {([true, false] as const).map((v) => (
              <label key={String(v)} className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="gart-sound" checked={b.soundEnabled === v} onChange={() => set({ soundEnabled: v })} />
                {v ? t("brand.soundYes") : t("brand.soundNo")}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{t("brand.soundHint")}</p>
        </fieldset>
        {lowContrast ? <p role="note" className="mt-4 rounded-2xl bg-amber-500/15 p-3 text-sm text-amber-200">{t("brand.lowContrast")}</p> : null}
        {error ? <div className="mt-4"><ErrorNote>{error}</ErrorNote></div> : null}
        {saved ? <p role="status" className="mt-4 rounded-2xl bg-emerald-500/15 p-3 text-sm text-emerald-200">{t("quiz.saved")}</p> : null}
        <div className="mt-5 flex gap-3">
          <Button onClick={() => void save()} busy={busy}>{t("quiz.save")}</Button>
          <Button variant="ghost" onClick={() => set({ ...DEFAULT_BRANDING, logoMediaId: b.logoMediaId, backgroundMediaId: b.backgroundMediaId })}>{t("brand.reset")}</Button>
        </div>
      </Card>
      <div aria-label={t("brand.preview")} className="h-fit rounded-3xl border border-surface-border p-5" style={{ background: b.backgroundColor }}>
        <p className="text-xs uppercase tracking-wide" style={{ color: "#94a3b8" }}>{t("brand.preview")}</p>
        <div className="mt-3 flex items-center gap-3" style={{ color: b.primaryColor }}>
          {b.logoMediaId ? <img src={mediaUrl(b.logoMediaId)} alt="" className="h-8 w-auto max-w-full object-contain" /> : <LogoLockup className="h-8 w-auto" />}
          {b.companyName ? <span className="border-l border-white/20 pl-3 text-base font-semibold" style={{ color: "#f8fafc" }}>{b.companyName}</span> : null}
        </div>
        <p className="mt-1 text-sm" style={{ color: "#cbd5e1" }}>{b.welcomeMessage || t("brand.welcomeSample")}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <span className="rounded-xl px-3 py-2 text-center text-sm font-semibold" style={{ background: b.primaryColor, color: onColor(b.primaryColor) }}>A</span>
          <span className="rounded-xl px-3 py-2 text-center text-sm font-semibold" style={{ background: b.secondaryColor, color: onColor(b.secondaryColor) }}>B</span>
        </div>
        <span className="mt-3 inline-block rounded-lg px-3 py-1 text-xs font-bold text-slate-900" style={{ background: b.accentColor }}>1250</span>
      </div>
    </div>
  );
}
