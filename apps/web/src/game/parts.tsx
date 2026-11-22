import type { ReactNode } from "react";
import { Circle, Diamond, Square, Triangle, Check, X, ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { LeaderboardEntry, PublicOption, ResultsData } from "@gart/shared";
import { mediaUrl } from "../image";
import { BrandLogo } from "../Logo";

const EMOJI: Record<string, string> = {
  fox: "🦊", owl: "🦉", bear: "🐻", wolf: "🐺", lynx: "🐱", otter: "🦦", panda: "🐼", koala: "🐨",
  tiger: "🐯", eagle: "🦅", whale: "🐋", dolphin: "🐬", falcon: "🐦", hedgehog: "🦔", badger: "🦡", raven: "🐦‍⬛",
  rabbit: "🐰", deer: "🦌", seal: "🦭", heron: "🦆", bison: "🦬", gecko: "🦎", crane: "🦩", swan: "🦢",
};

export function Avatar({ id, size = "md" }: { id: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const cls = { sm: "size-8 text-lg", md: "size-11 text-2xl", lg: "size-16 text-4xl", xl: "size-24 text-6xl" }[size];
  return <span aria-hidden className={`inline-grid shrink-0 place-items-center rounded-full bg-white/15 ${cls}`}>{EMOJI[id] ?? "🙂"}</span>;
}

/** Muted answer colours (no red or green: those are kept for the verdict) always come with a shape, so colour is never the only cue. */
export const OPTION_STYLE = [
  { bg: "bg-[#6d28d9]", ring: "ring-violet-300", Icon: Triangle },
  { bg: "bg-[#0369a1]", ring: "ring-sky-300", Icon: Diamond },
  { bg: "bg-[#a16207]", ring: "ring-amber-300", Icon: Circle },
  { bg: "bg-[#be185d]", ring: "ring-pink-300", Icon: Square },
] as const;

export function OptionLabel({ option, index, big = false }: { option: PublicOption; index: number; big?: boolean }) {
  const st = OPTION_STYLE[index % 4]!;
  return (
    <span className={`flex min-w-0 items-center gap-3 text-left`}>
      <st.Icon aria-hidden className={`${big ? "size-[3.2vmin]" : "size-6"} shrink-0 fill-current`} />
      {option.imageId ? <img src={mediaUrl(option.imageId)} alt="" className={`${big ? "h-[9vmin]" : "h-14"} rounded-lg object-contain`} /> : null}
      <span className={`${big ? "text-[3.4vmin] leading-tight" : "text-lg"} min-w-0 break-words font-semibold`}>{option.text}</span>
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
  // Before anyone has moved (the first ranking) a column of dashes says nothing, so it is left out.
  const moved = entries.some((e) => e.movement !== 0);
  return (
    <ol className={big && entries.length > 3 ? "grid grid-cols-2 gap-x-[2vmin] gap-y-[1.2vmin]" : big ? "space-y-[1.2vmin]" : "space-y-2"}>
      {entries.map((e) => (
        <li key={e.playerId} className={`flex items-center gap-3 rounded-2xl px-4 ${big ? "py-[1.2vmin] text-[3vmin]" : "py-2"} ${e.playerId === meId ? "bg-brand/40 ring-2 ring-accent" : "bg-white/10"}`}>
          <span className="w-8 text-center font-bold tabular-nums">{e.rank}</span>
          <Avatar id={e.avatar} size={big ? "lg" : "sm"} />
          <span className="min-w-0 flex-1 truncate font-medium">{e.nickname}</span>
          {moved ? <Movement value={e.movement} /> : null}
          <span className="w-20 text-right font-mono font-bold tabular-nums">{e.points}</span>
        </li>
      ))}
    </ol>
  );
}

export function Podium({ top, big = false }: { top: LeaderboardEntry[]; big?: boolean }) {
  const order = [top[1], top[0], top[2]];
  const heights = big ? ["h-[15vmin]", "h-[22vmin]", "h-[10vmin]"] : ["h-24", "h-36", "h-16"];
  const medals = ["bg-gradient-to-b from-slate-200 to-slate-400", "bg-gradient-to-b from-amber-200 to-amber-400", "bg-gradient-to-b from-orange-400 to-amber-700"]; // silver, gold, bronze
  return (
    <div className="flex items-end justify-center gap-3" aria-hidden={top.length === 0}>
      {order.map((e, i) => e ? (
        <div key={e.playerId} className={`flex flex-col items-center gap-1 text-center ${big ? "w-[26vmin]" : "w-28 sm:w-36"}`}>
          <Avatar id={e.avatar} size={big ? "xl" : "lg"} />
          <p className={`w-full truncate font-semibold ${big ? "text-[3vmin]" : "text-sm"}`}>{e.nickname}</p>
          <p className={`font-mono text-ink-muted ${big ? "text-[2.6vmin]" : "text-sm"}`}>{e.points}</p>
          <div className={`${heights[i]} grid w-full place-items-center rounded-t-2xl ${medals[i]} ${big ? "text-[6vmin]" : "text-3xl"} font-black text-slate-900 shadow-lg`}>{e.rank}</div>
        </div>
      ) : <div key={i} className={big ? "w-[26vmin]" : "w-28 sm:w-36"} />)}
    </div>
  );
}

/** Bars of how many players chose each option; the correct one is marked when the quiz shows it. */
export function Distribution({ options, results, big = false }: { options: PublicOption[]; results: ResultsData; big?: boolean }) {
  const max = Math.max(1, ...Object.values(results.distribution));
  return (
    <ul className={big ? "space-y-[2.4vmin]" : "space-y-3"}>
      {options.map((o, i) => {
        const n = results.distribution[o.id] ?? 0;
        const ok = results.correctOptionId === o.id;
        const dim = results.correctOptionId && !ok;
        const st = OPTION_STYLE[i % 4]!;
        return (
          <li key={o.id} className={`flex items-center gap-3 ${dim ? "opacity-50" : ""}`}>
            <span className={`grid ${big ? "size-[8vmin]" : "size-10"} shrink-0 place-items-center rounded-xl ${st.bg}`}><st.Icon aria-hidden className="size-5 fill-current" /></span>
            <div className="min-w-0 flex-1">
              <div className={`flex items-center gap-2 ${big ? "text-[3.2vmin]" : "text-base"}`}>
                <span className={`font-medium ${big ? "truncate" : "break-words"}`}>{o.text}</span>
                {ok ? <Check className="size-5 shrink-0 text-emerald-300" aria-label="✓" /> : null}
              </div>
              <div className={`mt-1 overflow-hidden ${big ? "h-[2.6vmin]" : "h-4"} rounded-full bg-white/10`}><div className={`h-full rounded-full ${ok ? "bg-emerald-400" : "bg-white/50"}`} style={{ width: `${(n / max) * 100}%` }} /></div>
            </div>
            <span className={`text-right font-mono font-bold tabular-nums ${big ? "w-[8vmin] text-[4vmin]" : "w-10"}`}>{n}</span>
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
export function QuizIntro({ cover, description, big = false, compact = false }: { cover?: string | undefined; description?: string | undefined; big?: boolean; compact?: boolean }) {
  if (!cover && !description) return null;
  return (
    <div className={`mx-auto flex w-full flex-col items-center gap-3 ${big ? "max-w-3xl" : "max-w-md"}`}>
      {cover ? <img src={mediaUrl(cover)} alt="" className={`w-full rounded-2xl object-cover ${big ? "max-h-[22vh]" : compact ? "max-h-32" : "max-h-48"}`} /> : null}
      {description ? <p className={`text-center text-ink-muted ${big ? "text-[2.6vmin]" : "text-sm"}`}>{description}</p> : null}
    </div>
  );
}

/** The logo: a header on the projector and a signature on the player's waiting screen. */
export function BrandBar({ big = false }: { big?: boolean }) {
  return (
    <div className="flex items-center justify-center" data-testid="brand-bar">
      <BrandLogo big={big} />
    </div>
  );
}
