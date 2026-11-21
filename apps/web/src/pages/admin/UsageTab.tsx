import {
  DEFAULT_SCENARIO, RESOURCES, calculate, resourceDef, utcDay, type ResourceStatus, type Scenario, type Thresholds,
} from "@gart/shared";
import { Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../api";
import { errorKey } from "../../errors";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card, ErrorNote } from "../../ui";
import { LevelBadge, fmt, fmtPct, resourceLabel } from "./UsagePanels";

interface UsageData {
  day: string; limitsVerifiedOn: string; thresholds: Thresholds; defaultThresholds: Thresholds; safeModeMaxPlayers: number;
  status: ResourceStatus[]; history: { day: string; metrics: Record<string, number> }[]; official: { day: string; resource: string; value: number }[];
}

const HISTORY_METRICS = ["games_started", "games_finished", "players_joined", "answers", "ws_connects", "do_rows_written", "d1_rows_written", "upload_bytes"] as const;
const SCENARIO_FIELDS: { key: keyof Scenario; min: number; max: number; step?: number }[] = [
  { key: "gamesPerMonth", min: 0, max: 400 }, { key: "gamesPerBusyDay", min: 0, max: 30 }, { key: "players", min: 1, max: 120 },
  { key: "questions", min: 1, max: 50 }, { key: "durationMin", min: 1, max: 240 }, { key: "reconnects", min: 0, max: 1000 },
  { key: "messagesPerPlayerPerQuestion", min: 0, max: 20, step: 0.1 }, { key: "imageUploadsPerMonth", min: 0, max: 1000 },
  { key: "imageViewsPerGame", min: 0, max: 100000 }, { key: "retentionMonths", min: 1, max: 60 },
];

function Tag({ kind }: { kind: "estimate" | "measured" | "official" }) {
  const { t } = useLang();
  const cls = { estimate: "bg-violet-500/25 text-violet-100", measured: "bg-sky-500/25 text-sky-100", official: "bg-emerald-500/25 text-emerald-100" }[kind];
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{t(`usage.kind.${kind}` as MessageKey)}</span>;
}

export function UsageTab() {
  const { t } = useLang();
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [off, setOff] = useState({ day: utcDay(), resource: "durableObjects.sqlRowsWritten", value: "", note: "" });
  const [th, setTh] = useState<{ info: string; warning: string; critical: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<UsageData>("/api/usage");
      setData(d);
      setTh((cur) => cur ?? { info: String(d.thresholds.info), warning: String(d.thresholds.warning), critical: String(d.thresholds.critical) });
    } catch (e) { setError(t(errorKey(e))); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const calc = useMemo(() => calculate(scenario, data?.thresholds), [scenario, data?.thresholds]);
  const flagged = data?.status.filter((s) => s.level !== "ok") ?? [];
  const dailyOptions = RESOURCES.filter((r) => r.period !== "unused" && r.period !== "invocation");

  async function saveOfficial(e: FormEvent) {
    e.preventDefault(); setError(null); setSaved(null);
    const value = Number(off.value.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return setError(t("usage.off.badValue"));
    try { await api("/api/usage/official", { method: "PUT", body: { day: off.day, resource: off.resource, value, note: off.note } }); setOff({ ...off, value: "", note: "" }); setSaved(t("usage.saved")); await load(); } catch (err) { setError(t(errorKey(err))); }
  }
  async function saveThresholds(e: FormEvent) {
    e.preventDefault(); setError(null); setSaved(null);
    if (!th) return;
    try { await api("/api/usage/thresholds", { method: "PUT", body: { info: Number(th.info), warning: Number(th.warning), critical: Number(th.critical) } }); setSaved(t("usage.saved")); await load(); } catch (err) { setError(t(errorKey(err))); }
  }

  if (!data) return <p className="text-sm text-ink-muted">{error ?? t("admin.loading")}</p>;
  const input = "w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/40";

  return (
    <div className="space-y-6">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {saved ? <p role="status" className="rounded-xl bg-emerald-500/15 p-3 text-sm text-emerald-100">{saved}</p> : null}

      <Card>
        <h2 className="text-xl font-bold">{t("usage.title")}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t("usage.intro")}</p>
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-xl bg-white/5 p-3"><Tag kind="estimate" /><p className="mt-2 text-ink-muted">{t("usage.kind.estimate.help")}</p></li>
          <li className="rounded-xl bg-white/5 p-3"><Tag kind="measured" /><p className="mt-2 text-ink-muted">{t("usage.kind.measured.help")}</p></li>
          <li className="rounded-xl bg-white/5 p-3"><Tag kind="official" /><p className="mt-2 text-ink-muted">{t("usage.kind.official.help")}</p></li>
        </ul>
        <p className="mt-3 text-xs text-ink-muted">{t("usage.limitsDate")} {data.limitsVerifiedOn}. {t("usage.reset")}</p>
      </Card>

      <Card>
        <h3 className="text-lg font-bold">{t("usage.alerts")}</h3>
        {flagged.length === 0 ? <p className="mt-2 text-sm text-emerald-200">{t("usage.noAlerts")}</p> : (
          <ul className="mt-3 space-y-2">
            {flagged.map((s) => (
              <li key={s.resource} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 p-3 text-sm"><span>{resourceLabel(t, s.resource)} · {fmtPct(s.pct)}</span><LevelBadge level={s.level} /></li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="text-lg font-bold">{t("usage.today")} <span className="text-sm font-normal text-ink-muted">({data.day} UTC)</span></h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-ink-muted"><tr><th className="py-2">{t("usage.col.resource")}</th><th className="text-right">{t("usage.col.limit")}</th><th className="text-right"><Tag kind="measured" /></th><th className="text-right"><Tag kind="official" /></th><th className="text-right">%</th><th /></tr></thead>
            <tbody>{data.status.map((s) => (
              <tr key={s.resource} className="border-t border-white/10">
                <td className="py-2">{resourceLabel(t, s.resource)}</td>
                <td className="text-right font-mono">{fmt(s.limit)} <span className="text-xs text-ink-muted">{resourceDef(s.resource).unit}</span></td>
                <td className="text-right font-mono">{fmt(s.measured)}</td>
                <td className="text-right font-mono">{fmt(s.official)}</td>
                <td className="text-right font-mono">{fmtPct(s.pct)}</td>
                <td className="pl-3"><LevelBadge level={s.level} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-muted">{t("usage.measuredNote")}</p>
        <p className="mt-1 text-xs text-ink-muted">{t("usage.cpuNote")}</p>
      </Card>

      <Card>
        <h3 className="text-lg font-bold">{t("usage.off.title")}</h3>
        <p className="mt-1 text-sm text-ink-muted">{t("usage.off.help")}</p>
        <form onSubmit={saveOfficial} className="mt-4 grid gap-3 sm:grid-cols-[9rem_1fr_9rem_1fr_auto] sm:items-end">
          <label className="text-sm">{t("usage.off.day")}<input type="date" className={input} max={utcDay()} value={off.day} onChange={(e) => setOff({ ...off, day: e.target.value })} required /></label>
          <label className="text-sm">{t("usage.col.resource")}<select className={input} value={off.resource} onChange={(e) => setOff({ ...off, resource: e.target.value })}>{dailyOptions.map((r) => <option key={r.id} value={r.id}>{resourceLabel(t, r.id)}</option>)}</select></label>
          <label className="text-sm">{t("usage.off.value")}<input inputMode="decimal" className={input} value={off.value} onChange={(e) => setOff({ ...off, value: e.target.value })} required /></label>
          <label className="text-sm">{t("usage.off.note")}<input className={input} maxLength={200} value={off.note} onChange={(e) => setOff({ ...off, note: e.target.value })} /></label>
          <Button type="submit"><Save className="size-4" aria-hidden />{t("usage.off.save")}</Button>
        </form>
        {data.official.length > 0 ? (
          <ul className="mt-4 divide-y divide-white/10 text-sm">
            {data.official.map((o) => (
              <li key={`${o.day}${o.resource}`} className="flex items-center justify-between gap-3 py-2"><span>{o.day} · {resourceLabel(t, o.resource)} · <b className="font-mono">{fmt(o.value)}</b></span>
                <Button variant="ghost" aria-label={t("usage.off.remove")} onClick={() => void api(`/api/usage/official?day=${o.day}&resource=${o.resource}`, { method: "DELETE" }).then(load)}><Trash2 className="size-4" aria-hidden /></Button></li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card>
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">{t("usage.calc.title")} <Tag kind="estimate" /></h3>
        <p className="mt-1 text-sm text-ink-muted">{t("usage.calc.help")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIO_FIELDS.map((f) => (
            <label key={f.key} className="text-sm">{t(`usage.in.${f.key}` as MessageKey)}
              <input type="number" className={input} min={f.min} max={f.max} step={f.step ?? 1} value={scenario[f.key]}
                onChange={(e) => setScenario({ ...scenario, [f.key]: Math.min(f.max, Math.max(f.min, Number(e.target.value) || 0)) })} />
            </label>
          ))}
        </div>
        {calc.bottleneck ? <p className="mt-4 rounded-xl bg-white/5 p-3 text-sm">{t("usage.calc.bottleneck")}: <b>{resourceLabel(t, calc.bottleneck.resource)}</b> — {t("usage.calc.about")} <b>{calc.bottleneck.games}</b> {t("usage.calc.gamesPerDay")}</p> : null}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="text-left text-ink-muted"><tr><th className="py-2">{t("usage.col.resource")}</th><th className="text-right">{t("usage.col.limit")}</th><th className="text-right">{t("usage.col.perGame")}</th><th className="text-right">{t("usage.col.busyDay")}</th><th className="text-right">{t("usage.col.month")}</th><th className="text-right">{t("usage.col.busyPct")}</th><th className="text-right">{t("usage.col.worstPct")}</th><th className="text-right">{t("usage.col.fit")}</th></tr></thead>
            <tbody>{calc.rows.map((r) => {
              const def = resourceDef(r.resource);
              const dim = def.period === "unused" || def.period === "invocation";
              return (
                <tr key={r.resource} className={`border-t border-white/10 ${dim ? "opacity-60" : ""}`}>
                  <td className="py-2">{resourceLabel(t, r.resource)}{def.period === "unused" ? <span className="ml-2 text-xs text-ink-muted">{t("usage.notUsed")}</span> : def.period === "invocation" ? <span className="ml-2 text-xs text-ink-muted">{t("usage.perInvocation")}</span> : null}</td>
                  <td className="text-right font-mono">{fmt(r.limit)}</td>
                  <td className="text-right font-mono">{dim ? "–" : fmt(r.perGame)}</td>
                  <td className="text-right font-mono">{dim ? "–" : fmt(r.busyDay)}</td>
                  <td className="text-right font-mono">{dim ? "–" : fmt(r.month)}</td>
                  <td className="text-right font-mono">{dim ? "–" : fmtPct(r.busyDayPct)}</td>
                  <td className="text-right font-mono">{dim ? "–" : fmtPct(r.worstDayPct)}</td>
                  <td className="text-right font-mono">{dim || def.period === "total" ? "–" : fmt(r.gamesThatFit)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-muted">{t("usage.calc.note")}</p>
      </Card>

      <Card>
        <h3 className="text-lg font-bold">{t("usage.th.title")}</h3>
        <p className="mt-1 text-sm text-ink-muted">{t("usage.th.help")}</p>
        {th ? (
          <form onSubmit={saveThresholds} className="mt-4 flex flex-wrap items-end gap-3">
            {(["info", "warning", "critical"] as const).map((k) => (
              <label key={k} className="text-sm">{t(`usage.level.${k}` as MessageKey)} (%)<input type="number" min={1} max={99} className={`${input} w-28`} value={th[k]} onChange={(e) => setTh({ ...th, [k]: e.target.value })} /></label>
            ))}
            <span className="pb-2 text-sm text-ink-muted">{t("usage.level.full")}: 100 %</span>
            <Button type="submit">{t("usage.off.save")}</Button>
          </form>
        ) : null}
      </Card>

      <Card>
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">{t("usage.history")} <Tag kind="measured" /></h3>
        {data.history.length === 0 ? <p className="mt-2 text-sm text-ink-muted">{t("usage.noHistory")}</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-left text-ink-muted"><tr><th className="py-2">{t("usage.off.day")}</th>{HISTORY_METRICS.map((m) => <th key={m} className="text-right">{t(`usage.metric.${m}` as MessageKey)}</th>)}</tr></thead>
              <tbody>{data.history.map((h) => (
                <tr key={h.day} className="border-t border-white/10"><td className="py-2">{h.day}</td>{HISTORY_METRICS.map((m) => <td key={m} className="text-right font-mono">{fmt(h.metrics[m] ?? 0)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
