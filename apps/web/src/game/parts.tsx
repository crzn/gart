import type { ReactNode } from "react";
import { Circle, Diamond, Square, Triangle, Check, X, ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { LeaderboardEntry, PublicOption, ResultsData } from "@gart/shared";
import { mediaUrl } from "../image";
import { useBranding } from "../branding";

const EMOJI: Record<string, string> = {
  fox: "🦊", owl: "🦉", bear: "🐻", wolf: "🐺", lynx: "🐱", otter: "🦦", panda: "🐼", koala: "🐨",
  tiger: "🐯", eagle: "🦅", whale: "🐋", dolphin: "🐬", falcon: "🐦", hedgehog: "🦔", badger: "🦡", raven: "🐦‍⬛",
  rabbit: "🐰", deer: "🦌", seal: "🦭", heron: "🦆", bison: "🦬", gecko: "🦎", crane: "🦩", swan: "🦢",
};

export function Avatar({ id, size = "md" }: { id: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const cls = { sm: "size-8 text-lg", md: "size-11 text-2xl", lg: "size-16 text-4xl", xl: "size-24 text-6xl" }[size];
  return <span aria-hidden className={`inline-grid shrink-0 place-items-center rounded-full bg-white/15 ${cls}`}>{EMOJI[id] ?? "🙂"}</span>;
}

/** Answer colours always come with a shape, so colour is never the only cue. */
export const OPTION_STYLE = [
  { bg: "bg-red-600", ring: "ring-red-300", Icon: Triangle },
  { bg: "bg-blue-600", ring: "ring-blue-300", Icon: Diamond },
  { bg: "bg-amber-600", ring: "ring-amber-300", Icon: Circle },
  { bg: "bg-emerald-600", ring: "ring-emerald-300", Icon: Square },
] as const;

export function OptionLabel({ option, index, big = false }: { option: PublicOption; index: number; big?: boolean }) {
  const st = OPTION_STYLE[index % 4]!;
  return (
    <span className="flex min-w-0 items-center gap-3 text-left">
      <st.Icon aria-hidden className={`${big ? "size-9" : "size-6"} shrink-0 fill-current`} />
      {option.imageId ? <img src={mediaUrl(option.imageId)} alt="" className={`${big ? "h-24" : "h-14"} rounded-lg object-contain`} /> : null}
      <span className={`${big ? "text-3xl" : "text-lg"} min-w-0 break-words font-semibold`}>{option.text}</span>
    </span>
  );
}

export function TimerBar({ left, total }: { left: number | null; total: number | null }) {
  if (left === null || !total) return null;
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  return (
    <div className="flex items-center gap-3" role="timer" aria-label={`${Math.ceil(left)} s`}>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/15">
        <div className={`h-full rounded-full ${left <= 5 ? "bg-red-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-10 text-right font-mono text-lg font-bold tabular-nums ${left <= 5 ? "text-red-300" : ""}`}>{Math.ceil(left)}</span>
    </div>
  );
}

export function Movement({ value }: { value: number }) {
  if (value > 0) return <span className="inline-flex items-center text-xs text-emerald-300"><ArrowUp className="size-3" aria-hidden />{value}</span>;
  if (value < 0) return <span className="inline-flex items-center text-xs text-red-300"><ArrowDown className="size-3" aria-hidden />{-value}</span>;
  return <Minus className="size-3 text-ink-muted" aria-hidden />;
}

/** The ranking table. */
export function Board({ entries, meId, big = false }: { entries: LeaderboardEntry[]; meId?: string; big?: boolean }) {
  return (
    <ol className="space-y-2">
      {entries.map((e) => (
        <li key={e.playerId} className={`flex items-center gap-3 rounded-2xl px-4 ${big ? "py-3 text-2xl" : "py-2"} ${e.playerId === meId ? "bg-brand/40 ring-2 ring-accent" : "bg-white/10"}`}>
          <span className="w-8 text-center font-bold tabular-nums">{e.rank}</span>
          <Avatar id={e.avatar} size={big ? "md" : "sm"} />
          <span className="min-w-0 flex-1 truncate font-medium">{e.nickname}</span>
          <Movement value={e.movement} />
          <span className="w-20 text-right font-mono font-bold tabular-nums">{e.points}</span>
        </li>
      ))}
    </ol>
  );
}

export function Podium({ top }: { top: LeaderboardEntry[] }) {
  const order = [top[1], top[0], top[2]];
  const heights = ["h-24", "h-36", "h-16"];
  const medals = ["bg-gradient-to-b from-slate-200 to-slate-400", "bg-gradient-to-b from-amber-200 to-amber-400", "bg-gradient-to-b from-orange-400 to-amber-700"]; // silver, gold, bronze
  return (
    <div className="flex items-end justify-center gap-3" aria-hidden={top.length === 0}>
      {order.map((e, i) => e ? (
        <div key={e.playerId} className={`flex w-28 flex-col items-center gap-1 text-center sm:w-36`}>
          <Avatar id={e.avatar} size="lg" />
          <p className="w-full truncate text-sm font-semibold">{e.nickname}</p>
          <p className="font-mono text-sm text-ink-muted">{e.points}</p>
          <div className={`${heights[i]} grid w-full place-items-center rounded-t-2xl ${medals[i]} text-3xl font-black text-slate-900 shadow-lg`}>{e.rank}</div>
        </div>
      ) : <div key={i} className="w-28 sm:w-36" />)}
    </div>
  );
}

/** Bars of how many players chose each option; the correct one is marked when the quiz shows it. */
export function Distribution({ options, results, big = false }: { options: PublicOption[]; results: ResultsData; big?: boolean }) {
  const max = Math.max(1, ...Object.values(results.distribution));
  return (
    <ul className="space-y-3">
      {options.map((o, i) => {
        const n = results.distribution[o.id] ?? 0;
        const ok = results.correctOptionId === o.id;
        const dim = results.correctOptionId && !ok;
        const st = OPTION_STYLE[i % 4]!;
        return (
          <li key={o.id} className={`flex items-center gap-3 ${dim ? "opacity-50" : ""}`}>
            <span className={`grid ${big ? "size-14" : "size-10"} shrink-0 place-items-center rounded-xl ${st.bg}`}><st.Icon aria-hidden className="size-5 fill-current" /></span>
            <div className="min-w-0 flex-1">
              <div className={`flex items-center gap-2 ${big ? "text-2xl" : "text-base"}`}>
                <span className="truncate font-medium">{o.text}</span>
                {ok ? <Check className="size-5 shrink-0 text-emerald-300" aria-label="✓" /> : null}
              </div>
              <div className="mt-1 h-4 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${ok ? "bg-emerald-400" : "bg-white/50"}`} style={{ width: `${(n / max) * 100}%` }} /></div>
            </div>
            <span className={`w-10 text-right font-mono font-bold tabular-nums ${big ? "text-3xl" : ""}`}>{n}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl p-4 text-xl font-bold ${ok ? "bg-emerald-500/25 text-emerald-100" : "bg-red-500/25 text-red-100"}`}>
      {ok ? <Check className="size-7" aria-hidden /> : <X className="size-7" aria-hidden />}
      {children}
    </div>
  );
}

/** The quiz's cover and its description: what the game is about, shown to everyone before it starts. */
export function QuizIntro({ cover, description, big = false }: { cover?: string | undefined; description?: string | undefined; big?: boolean }) {
  if (!cover && !description) return null;
  return (
    <div className={`mx-auto flex w-full flex-col items-center gap-3 ${big ? "max-w-3xl" : "max-w-md"}`}>
      {cover ? <img src={mediaUrl(cover)} alt="" className={`w-full rounded-2xl object-cover ${big ? "max-h-72" : "max-h-48"}`} /> : null}
      {description ? <p className={`text-center text-ink-muted ${big ? "text-2xl" : "text-sm"}`}>{description}</p> : null}
    </div>
  );
}

/** The company's logo, name and slogan: a header on the projector and a signature on the player's waiting screen. */
export function BrandBar({ big = false }: { big?: boolean }) {
  const { branding: b } = useBranding();
  if (!b.logoMediaId && !b.companyName && !b.tagline) return null;
  return (
    <div className={`flex items-center justify-center gap-4 ${big ? "" : "flex-col text-center"}`} data-testid="brand-bar">
      {b.logoMediaId ? <img src={mediaUrl(b.logoMediaId)} alt="" className={`${big ? "h-16" : "h-12"} w-auto max-w-[40%] object-contain`} /> : null}
      {b.companyName || b.tagline ? (
        <div className={big ? "text-left" : ""}>
          {b.companyName ? <p className={`font-bold leading-tight ${big ? "text-3xl" : "text-lg"}`}>{b.companyName}</p> : null}
          {b.tagline ? <p className={`text-ink-muted ${big ? "text-xl" : "text-sm"}`}>{b.tagline}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
