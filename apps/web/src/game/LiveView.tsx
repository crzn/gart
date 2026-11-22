import { Loader2, UserX } from "lucide-react";
import { Suspense, lazy, type ReactNode } from "react";
import { Avatar, Board, Distribution, OPTION_STYLE, OptionLabel, Podium, QuizIntro, TimerBar } from "./parts";
import { secondsLeft, secondsUntilStart, type GameClientState } from "./reducer";
import { useLang } from "../i18n";
import { mediaUrl } from "../image";
import { useNow } from "./useNow";

/** What the host and the projector show. `big` is for the projector; `onKick` makes the lobby list interactive. */
const QrCode = lazy(() => import("./QrCode"));

/** `fx` switches on the QR code; only the host screen and the projector pass it. */
export function LiveView({ state, big = false, onKick, joinUrl, fx = false }: { state: GameClientState; big?: boolean; onKick?: ((playerId: string) => void) | undefined; joinUrl: string; fx?: boolean }) {
  const { t } = useLang();
  const snap = state.snap;
  const now = useNow(snap?.state === "QUESTION_ACTIVE" ? 200 : 1000);
  if (!snap) return <p className="m-auto flex items-center gap-2 text-ink-muted"><Loader2 className="size-5" aria-hidden />{t("play.connecting")}</p>;
  const q = snap.question;
  const left = secondsLeft(state, now);
  const toStart = secondsUntilStart(state, now);
  const total = q && q.endsAt !== null ? Math.round((q.endsAt - q.startsAt) / 1000) : null;
  const players = snap.players ?? [];
  const h1 = big ? "text-[5.4vmin] leading-tight" : "text-2xl sm:text-3xl";

  const paused: ReactNode = snap.paused ? <p role="status" className="rounded-2xl bg-white/15 p-3 text-center font-semibold">{t("play.paused")}</p> : null;

  if (snap.state === "LOBBY") {
    const qr = fx ? (
      <div className="flex shrink-0 flex-col items-center gap-2">
        <Suspense fallback={<div style={{ width: big ? 300 : 168, height: big ? 300 : 168 }} />}><QrCode text={`${location.origin}/play/${snap.pin}`} size={big ? Math.min(460, Math.round(window.innerHeight * 0.4)) : 168} label={t("host.qr")} /></Suspense>
        <p className={`text-ink-muted ${big ? "text-[2.2vmin]" : "text-sm"}`}>{t("host.qrHint")}</p>
      </div>
    ) : null;
    const names = (
      <ul className={`flex flex-wrap justify-center gap-2 ${big ? "xl:col-span-2" : ""}`}>
        {players.map((p) => (
          <li key={p.playerId} className={`flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 ${p.connected ? "" : "opacity-50"} ${big ? "text-[3vmin]" : ""}`}>
            <Avatar id={p.avatar} size={big ? "md" : "sm"} /><span className="max-w-56 truncate">{p.nickname}</span>
            {onKick ? <button type="button" aria-label={`${t("host.kick")} ${p.nickname}`} onClick={() => onKick(p.playerId)} className="rounded-full p-1 hover:bg-red-500/40"><UserX className="size-4" aria-hidden /></button> : null}
          </li>
        ))}
      </ul>
    );
    if (big) {
      // The projector stresses the title, the picture, the players and the QR code; the PIN is plain text under the QR code.
      return (
        <div className="grid content-center items-center gap-x-[5vmin] gap-y-[3vmin] xl:grid-cols-[1fr_auto]">
          <div className="space-y-[2vmin] text-center">
            <h1 className="text-[7vmin] font-bold leading-tight">{snap.title}</h1>
            <QuizIntro cover={snap.coverImageId} description={snap.description} big />
            <p className="text-[4vmin]">{t("play.players")}: {snap.playerCount}</p>
          </div>
          <div className="flex flex-col items-center gap-[1.4vmin] text-center">
            {qr}
            <p className="text-[2.4vmin] text-ink-muted">{t("host.joinAt")} <span className="font-semibold text-ink">{joinUrl}</span></p>
            <p className="text-[2.4vmin] text-ink-muted">{t("host.pin")}: <span className="font-mono font-semibold tracking-widest text-ink" data-testid="pin">{snap.pin}</span></p>
          </div>
          {names}
        </div>
      );
    }
    return (
      <div className="space-y-6 text-center">
        <div className="space-y-4 text-center">
          <p className="text-ink-muted">{t("host.joinAt")} <span className="font-semibold text-ink">{joinUrl}</span></p>
          <p className="text-ink-muted">{t("host.pin")}</p>
          <p className="font-mono text-6xl font-black tracking-[0.25em] sm:text-7xl" data-testid="pin">{snap.pin}</p>
          <h1 className={`${h1} font-bold`}>{snap.title}</h1>
          <QuizIntro cover={snap.coverImageId} description={snap.description} />
          <p className="text-lg">{t("play.players")}: {snap.playerCount}</p>
        </div>
        {qr ? <div className="flex justify-center">{qr}</div> : null}
        {names}
      </div>
    );
  }

  if (snap.state === "QUESTION_ACTIVE" && q) {
    const connected = players.filter((p) => p.connected).length || snap.playerCount;
    return (
      <div className={big ? "flex min-h-[76vh] flex-col justify-center gap-[3vmin]" : "space-y-5"}>
        {paused}
        <div className={`flex items-center justify-between text-ink-muted ${big ? "text-[2.4vmin]" : ""}`}><span>{q.index + 1} / {q.total}</span><span>{t("host.answered")}: <b className="text-ink">{snap.answered ?? 0}</b> / {Math.max(connected, snap.answered ?? 0)}</span></div>
        {toStart > 0 && snap.settings.countdownSec > 0 ? (
          <p key={Math.ceil(toStart)} className={`py-10 text-center font-black tabular-nums ${big ? "text-[34vmin] leading-none" : "text-8xl"}`} aria-live="polite">{Math.ceil(toStart)}</p>
        ) : (
          <>
            <TimerBar left={left} total={total} />
            <h1 className={`${h1} text-center font-bold`}>{q.text}</h1>
            {q.imageId ? <img src={mediaUrl(q.imageId)} alt="" className={`mx-auto w-auto rounded-2xl object-contain ${big ? "max-h-[26vh]" : "max-h-60"}`} /> : null}
            <div className={`grid gap-3 sm:grid-cols-2 ${big ? "auto-rows-fr gap-[2vmin]" : ""}`}>
              {q.options.map((o, i) => (
                <div key={o.id} className={`${OPTION_STYLE[i % 4]!.bg} flex items-center rounded-2xl px-5 ${big ? "min-h-[20vh] px-[3vmin]" : "min-h-16"} py-3 text-white`}><OptionLabel option={o} index={i} big={big} /></div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (snap.state === "QUESTION_RESULTS" && q) {
    return (
      <div className={big ? "flex min-h-[76vh] flex-col justify-center gap-[3vmin]" : "space-y-5"}>
        <h1 className={`${h1} text-center font-bold`}>{q.text}</h1>
        {snap.results ? <Distribution options={q.options} results={snap.results} big={big} /> : <p className="text-center text-ink-muted">{t("play.counting")}</p>}
        {snap.results?.explanation ? <p className={`rounded-2xl bg-white/10 p-4 ${big ? "text-[3vmin]" : ""}`}>{snap.results.explanation}</p> : null}
        {snap.results ? <p className={`text-center text-ink-muted ${big ? "text-[2.4vmin]" : ""}`}>{t("host.answered")}: {snap.results.answered} / {snap.results.total}</p> : null}
      </div>
    );
  }

  if (snap.state === "LEADERBOARD" && snap.leaderboard) {
    return <div className="space-y-5"><h1 className={`${h1} text-center font-bold`}>{t("play.leaderboard")}</h1><Board entries={snap.leaderboard.top} big={big} /></div>;
  }

  if (snap.state === "FINISHED" && snap.final) {
    return (
      <div className={big ? "space-y-[3vmin]" : "space-y-8"}>
        <h1 className={`${h1} text-center font-bold`}>{t("play.finished")}</h1>
        <Podium top={snap.final.top.slice(0, 3)} big={big} />
        <Board entries={snap.final.top.slice(big ? 3 : 0)} big={big} />
      </div>
    );
  }
  return <p className="text-center text-ink-muted">{snap.title}</p>;
}
