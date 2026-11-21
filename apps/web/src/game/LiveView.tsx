import { Loader2, UserX } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, Board, Distribution, OPTION_STYLE, OptionLabel, Podium, TimerBar } from "./parts";
import { secondsLeft, secondsUntilStart, type GameClientState } from "./reducer";
import { useLang } from "../i18n";
import { mediaUrl } from "../image";
import { useNow } from "./useNow";

/** What the host and the projector show. `big` is for the projector; `onKick` makes the lobby list interactive. */
export function LiveView({ state, big = false, onKick, joinUrl }: { state: GameClientState; big?: boolean; onKick?: ((playerId: string) => void) | undefined; joinUrl: string }) {
  const { t } = useLang();
  const snap = state.snap;
  const now = useNow(snap?.state === "QUESTION_ACTIVE" ? 200 : 1000);
  if (!snap) return <p className="m-auto flex items-center gap-2 text-ink-muted"><Loader2 className="size-5 animate-spin" aria-hidden />{t("play.connecting")}</p>;
  const q = snap.question;
  const left = secondsLeft(state, now);
  const toStart = secondsUntilStart(state, now);
  const total = q && q.endsAt !== null ? Math.round((q.endsAt - q.startsAt) / 1000) : null;
  const players = snap.players ?? [];
  const h1 = big ? "text-5xl sm:text-6xl" : "text-2xl sm:text-3xl";

  const paused: ReactNode = snap.paused ? <p role="status" className="rounded-2xl bg-white/15 p-3 text-center font-semibold">{t("play.paused")}</p> : null;

  if (snap.state === "LOBBY") {
    return (
      <div className="space-y-6 text-center">
        <p className="text-ink-muted">{t("host.joinAt")} <span className="font-semibold text-ink">{joinUrl}</span></p>
        <p className="text-ink-muted">{t("host.pin")}</p>
        <p className={`font-mono font-black tracking-[0.25em] ${big ? "text-9xl" : "text-6xl sm:text-7xl"}`} data-testid="pin">{snap.pin}</p>
        <h1 className={`${h1} font-bold`}>{snap.title}</h1>
        <p className={big ? "text-3xl" : "text-lg"}>{snap.playerCount} {t("play.players")}</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {players.map((p) => (
            <li key={p.playerId} className={`flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 ${p.connected ? "" : "opacity-50"} ${big ? "text-2xl" : ""}`}>
              <Avatar id={p.avatar} size={big ? "md" : "sm"} /><span className="max-w-40 truncate">{p.nickname}</span>
              {onKick ? <button type="button" aria-label={`${t("host.kick")} ${p.nickname}`} onClick={() => onKick(p.playerId)} className="rounded-full p-1 hover:bg-red-500/40"><UserX className="size-4" aria-hidden /></button> : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (snap.state === "QUESTION_ACTIVE" && q) {
    const connected = players.filter((p) => p.connected).length || snap.playerCount;
    return (
      <div className="space-y-5">
        {paused}
        <div className="flex items-center justify-between text-ink-muted"><span>{q.index + 1} / {q.total}</span><span>{t("host.answered")}: <b className="text-ink">{snap.answered ?? 0}</b> / {Math.max(connected, snap.answered ?? 0)}</span></div>
        {toStart > 0 ? (
          <p className={`py-10 text-center font-black tabular-nums ${big ? "text-[10rem]" : "text-8xl"}`} aria-live="polite">{Math.ceil(toStart)}</p>
        ) : (
          <>
            <TimerBar left={left} total={total} />
            <h1 className={`${h1} text-center font-bold`}>{q.text}</h1>
            {q.imageId ? <img src={mediaUrl(q.imageId)} alt="" className={`mx-auto w-auto rounded-2xl object-contain ${big ? "max-h-96" : "max-h-60"}`} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {q.options.map((o, i) => (
                <div key={o.id} className={`${OPTION_STYLE[i % 4]!.bg} flex items-center rounded-2xl px-5 ${big ? "min-h-32" : "min-h-16"} py-3 text-white`}><OptionLabel option={o} index={i} big={big} /></div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (snap.state === "QUESTION_RESULTS" && q) {
    return (
      <div className="space-y-5">
        <h1 className={`${h1} text-center font-bold`}>{q.text}</h1>
        {snap.results ? <Distribution options={q.options} results={snap.results} big={big} /> : <p className="text-center text-ink-muted">{t("play.counting")}</p>}
        {snap.results?.explanation ? <p className={`rounded-2xl bg-white/10 p-4 ${big ? "text-2xl" : ""}`}>{snap.results.explanation}</p> : null}
        {snap.results ? <p className="text-center text-ink-muted">{t("host.answered")}: {snap.results.answered} / {snap.results.total}</p> : null}
      </div>
    );
  }

  if (snap.state === "LEADERBOARD" && snap.leaderboard) {
    return <div className="space-y-5"><h1 className={`${h1} text-center font-bold`}>{t("play.leaderboard")}</h1><Board entries={snap.leaderboard.top} big={big} /></div>;
  }

  if (snap.state === "FINISHED" && snap.final) {
    return (
      <div className="space-y-8">
        <h1 className={`${h1} text-center font-bold`}>{t("play.finished")}</h1>
        <Podium top={snap.final.top.slice(0, 3)} />
        <Board entries={snap.final.top} big={big} />
      </div>
    );
  }
  return <p className="text-center text-ink-muted">{snap.title}</p>;
}
