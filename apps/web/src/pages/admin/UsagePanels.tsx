import type { Level, ProjectedRow, ResourceId } from "@gart/shared";
import { AlertTriangle, CircleCheck, Info, OctagonAlert } from "lucide-react";
import { useLang, type MessageKey } from "../../i18n";

export const LEVEL_STYLE: Record<Level, string> = {
  ok: "bg-emerald-500/15 text-emerald-200",
  info: "bg-sky-500/20 text-sky-200",
  warning: "bg-amber-500/25 text-amber-100",
  critical: "bg-orange-600/30 text-orange-100",
  full: "bg-red-600/35 text-red-100",
};

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const a = Math.abs(n);
  if (a >= 100) return Math.round(n).toLocaleString("uk-UA");
  if (a >= 10) return n.toFixed(1);
  if (a >= 1) return n.toFixed(2);
  if (a === 0) return "0";
  return n < 0.001 ? "<0.001" : n.toFixed(3);
}
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n < 0.1 && n > 0 ? "<0.1 %" : `${n < 10 ? n.toFixed(1) : Math.round(n)} %`);

export function LevelBadge({ level }: { level: Level }) {
  const { t } = useLang();
  const Icon = level === "ok" ? CircleCheck : level === "info" ? Info : level === "warning" ? AlertTriangle : OctagonAlert;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}><Icon className="size-3" aria-hidden />{t(`usage.level.${level}` as MessageKey)}</span>;
}

export const resourceLabel = (t: ReturnType<typeof useLang>["t"], id: ResourceId | string) => t(`usage.res.${id}` as MessageKey);

/** Resources a proposed game would push toward their daily limit. Used by the dashboard and the pre-game dialog. */
export function ConcernList({ rows }: { rows: ProjectedRow[] }) {
  const { t } = useLang();
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.resource} className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{resourceLabel(t, r.resource)}</span><LevelBadge level={r.level} /></div>
          <p className="mt-1 text-ink-muted">{t("usage.pre.line")} {fmtPct(r.pctBefore)} → {fmtPct(r.pctAfter)} · +{fmt(r.add)} / {fmt(r.limit)}</p>
        </li>
      ))}
    </ul>
  );
}
