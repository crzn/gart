import { Loader2, LogOut, Pause, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AVATAR_IDS, isValidPin } from "@gart/shared";
import { Avatar, Board, Distribution, OPTION_STYLE, OptionLabel, Podium, TimerBar, Verdict } from "../game/parts";
import { secondsLeft, secondsUntilStart } from "../game/reducer";
import { useGameSocket } from "../game/useGameSocket";
import { useLang, type MessageKey } from "../i18n";
import { mediaUrl } from "../image";
import { Button, Card, ErrorNote } from "../ui";
import { useNow } from "../game/useNow";

const tokenKey = (pin: string) => `gart.player.${pin}`;
const readToken = (pin: string): string | null => { try { return localStorage.getItem(tokenKey(pin)); } catch { return null; } };
const writeToken = (pin: string, v: string | null) => { try { if (v) localStorage.setItem(tokenKey(pin), v); else localStorage.removeItem(tokenKey(pin)); } catch { /* storage unavailable */ } };

const FATAL = new Set(["game_over", "kicked"]);

export function PlayPage() {
  const { t } = useLang();
  const { pin = "" } = useParams();
  const navigate = useNavigate();
  const valid = isValidPin(pin);
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState<string>(() => AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)]!);
  const [joining, setJoining] = useState(false);

  const { state, dispatch, send } = useGameSocket({
    pin: valid ? pin : null,
    firstFrame: async () => {
      const token = readToken(pin);
      return token ? { t: "player.resume", d: { playerToken: token } } : null;
    },
    fatal: (c) => FATAL.has(c),
  });
  const now = useNow(state.snap?.state === "QUESTION_ACTIVE" ? 200 : 1000);
  const snap = state.snap;
  const me = snap?.you;

  // Remember the token so a refresh or a dropped connection resumes the same player.
  useEffect(() => { if (state.identity) { writeToken(pin, state.identity.playerToken); setJoining(false); } }, [state.identity, pin]);
  useEffect(() => {
    if (state.error === "unknown_player") { writeToken(pin, null); dispatch({ type: "clearError" }); }
    if (state.error && state.error !== "unknown_player") setJoining(false);
  }, [state.error, pin, dispatch]);
  useEffect(() => { if (state.kicked || state.cancelled) writeToken(pin, null); }, [state.kicked, state.cancelled, pin]);

  const errText = (code: string | null): string | null => (code ? (t(`ws.err.${code}` as MessageKey) as string | undefined) ?? t("ws.err.unknown") : null);

  const q = snap?.question;
  const left = secondsLeft(state, now);
  const toStart = secondsUntilStart(state, now);
  const total = useMemo(() => (q && q.endsAt !== null ? Math.round((q.endsAt - q.startsAt) / 1000) : null), [q]);

  function join(e: FormEvent) {
    e.preventDefault();
    setJoining(true);
    dispatch({ type: "clearError" });
    send({ t: "player.join", d: { nickname: nickname.trim(), avatar } });
  }

  function answer(optionId: string) {
    if (!q || state.pending || snap?.yourAnswer || snap?.paused) return;
    dispatch({ type: "pending", optionId });
    send({ t: "answer.submit", d: { questionIdx: q.index, optionId } });
  }

  if (!valid) return <Notice title={t("play.badPin")} action={<Button onClick={() => navigate("/")}>{t("play.back")}</Button>} />;
  if (state.kicked) return <Notice title={t("play.kicked")} action={<Button onClick={() => navigate("/")}>{t("play.back")}</Button>} />;
  if (state.cancelled) return <Notice title={t("play.cancelled")} action={<Button onClick={() => navigate("/")}>{t("play.back")}</Button>} />;
  if (state.conn === "failed") return <Notice title={t("play.noGame")} body={t("play.noGameHint")} action={<Button onClick={() => navigate("/")}>{t("play.back")}</Button>} />;
  if (state.error === "game_over") return <Notice title={t("play.over")} action={<Button onClick={() => navigate("/")}>{t("play.back")}</Button>} />;
  const waiting = !snap && (!state.hello || (readToken(pin) !== null && !state.error));
  if (waiting) return <p className="m-auto flex items-center gap-2 text-ink-muted"><Loader2 className="size-5 animate-spin" aria-hidden />{t("play.connecting")}</p>;

  if (!snap || !me) {
    return (
      <section className="m-auto w-full max-w-md">
        <Card>
          <p className="text-sm text-ink-muted">{t("play.game")} · {pin}</p>
          <h1 className="mt-1 text-2xl font-bold">{snap?.title ?? t("play.joinTitle")}</h1>
          <form onSubmit={join} className="mt-6 space-y-5">
            <div>
              <label htmlFor="nick" className="mb-1.5 block text-sm font-medium">{t("play.nickname")}</label>
              <input id="nick" value={nickname} maxLength={20} autoComplete="off" autoFocus required onChange={(e) => setNickname(e.target.value)}
                className="w-full rounded-2xl border border-surface-border bg-black/30 px-4 py-3 text-lg outline-none focus:border-brand" />
              <p className="mt-1.5 text-xs text-ink-muted">{t("play.nicknameHint")}</p>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t("play.avatar")}</legend>
              <div className="grid grid-cols-6 gap-2">
                {AVATAR_IDS.map((id) => (
                  <button key={id} type="button" aria-pressed={avatar === id} aria-label={id} onClick={() => setAvatar(id)}
                    className={`grid place-items-center rounded-2xl p-1 ${avatar === id ? "bg-brand ring-2 ring-accent" : "bg-white/5 hover:bg-white/15"}`}><Avatar id={id} /></button>
                ))}
              </div>
            </fieldset>
            {state.error && state.error !== "unknown_player" ? <ErrorNote>{errText(state.error)}</ErrorNote> : null}
            <Button type="submit" busy={joining && !state.error} disabled={nickname.trim().length < 2} className="w-full !py-3.5 !text-base">{t("play.join")}</Button>
          </form>
        </Card>
      </section>
    );
  }

  const header = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar id={me.avatar} />
        <div className="min-w-0"><p className="truncate font-semibold">{me.nickname}</p>{me.rank ? <p className="text-xs text-ink-muted">#{me.rank}</p> : null}</div>
      </div>
      <p className="font-mono text-xl font-bold tabular-nums">{me.points}</p>
    </div>
  );
  const banner = state.conn === "reconnecting" ? <p role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-500/20 p-3 text-sm"><WifiOff className="size-4" aria-hidden />{t("play.reconnecting")}</p> : null;
  const paused = snap.paused ? <p role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-white/15 p-3 text-sm font-medium"><Pause className="size-4" aria-hidden />{t("play.paused")}</p> : null;

  return (
    <section className="mx-auto w-full max-w-xl">
      {header}{banner}{paused}
      {snap.state === "LOBBY" && (
        <Card className="text-center">
          <Avatar id={me.avatar} size="xl" />
          <h1 className="mt-4 text-2xl font-bold">{t("play.in")}</h1>
          <p className="mt-2 text-ink-muted">{t("play.waitStart")}</p>
          <p className="mt-6 text-sm text-ink-muted">{snap.playerCount} {t("play.players")}</p>
        </Card>
      )}

      {snap.state === "QUESTION_ACTIVE" && q && (
        <div className="space-y-4">
          {snap.settings.showQuestionProgress ? <p className="text-sm text-ink-muted">{q.index + 1} / {q.total}</p> : null}
          {toStart > 0 ? (
            <Card className="text-center"><p className="text-ink-muted">{t("play.getReady")}</p><p className="mt-2 text-7xl font-black tabular-nums" aria-live="polite">{Math.ceil(toStart)}</p></Card>
          ) : (
            <>
              <TimerBar left={left} total={total} />
              <Card>
                <h1 className="text-xl font-bold sm:text-2xl">{q.text}</h1>
                {q.imageId ? <img src={mediaUrl(q.imageId)} alt="" className="mt-4 max-h-56 w-full rounded-2xl object-contain" /> : null}
              </Card>
              {snap.yourAnswer ? (
                <p role="status" className="rounded-2xl bg-white/10 p-4 text-center font-medium">{t("play.sent")}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {q.options.map((o, i) => (
                    <button key={o.id} type="button" disabled={!!state.pending || snap.paused} onClick={() => answer(o.id)}
                      className={`${OPTION_STYLE[i % 4]!.bg} min-h-20 rounded-2xl px-4 py-4 text-white shadow-lg transition active:scale-[0.98] disabled:opacity-60`}>
                      <OptionLabel option={o} index={i} />
                    </button>
                  ))}
                </div>
              )}
              {state.reject && state.reject !== "duplicate" ? <ErrorNote>{t(`play.reject.${state.reject}` as MessageKey)}</ErrorNote> : null}
            </>
          )}
        </div>
      )}

      {snap.state === "QUESTION_RESULTS" && (
        <div className="space-y-4">
          {snap.results?.you ? (
            snap.results.you.answered ? (
              <Verdict ok={snap.results.you.correct}>{snap.results.you.correct ? `${t("play.correct")} +${snap.results.you.points}` : t("play.wrong")}</Verdict>
            ) : <Verdict ok={false}>{t("play.noAnswer")}</Verdict>
          ) : <p className="flex items-center gap-2 text-ink-muted"><Loader2 className="size-4 animate-spin" aria-hidden />{t("play.counting")}</p>}
          {snap.results && q && snap.settings.showCorrectAnswer ? <Card><Distribution options={q.options} results={snap.results} /></Card> : null}
          {snap.results?.explanation ? <Card><p className="text-sm text-ink-muted">{t("play.explanation")}</p><p className="mt-1">{snap.results.explanation}</p></Card> : null}
          <p className="text-center text-sm text-ink-muted">{t("play.waitNext")}</p>
        </div>
      )}

      {snap.state === "LEADERBOARD" && snap.leaderboard && (
        <div className="space-y-4">
          <h1 className="text-xl font-bold">{t("play.leaderboard")}</h1>
          <Board entries={snap.leaderboard.top.slice(0, 5)} meId={me.playerId} />
          {snap.leaderboard.you && !snap.leaderboard.top.slice(0, 5).some((e) => e.playerId === snap.leaderboard!.you!.playerId) ? <Board entries={[snap.leaderboard.you]} meId={snap.leaderboard.you.playerId} /> : null}
        </div>
      )}

      {snap.state === "FINISHED" && (
        <div className="space-y-6">
          <h1 className="text-center text-2xl font-bold">{t("play.finished")}</h1>
          {snap.final ? <Podium top={snap.final.top.slice(0, 3)} /> : null}
          <Card className="text-center">
            <p className="text-ink-muted">{t("play.yourPlace")}</p>
            <p className="mt-1 text-5xl font-black">#{snap.final?.you?.rank ?? me.rank ?? "–"}</p>
            <p className="mt-2 font-mono text-lg">{snap.final?.you?.points ?? me.points} {t("play.pts")}</p>
          </Card>
          <Button variant="ghost" className="w-full" onClick={() => { writeToken(pin, null); window.location.assign("/"); }}><LogOut className="size-4" aria-hidden />{t("play.leave")}</Button>
        </div>
      )}
    </section>
  );
}

function Notice({ title, body, action }: { title: string; body?: string; action: React.ReactNode }) {
  return (
    <section className="m-auto w-full max-w-md"><Card className="space-y-4 text-center"><h1 className="text-xl font-bold">{title}</h1>{body ? <p className="text-sm text-ink-muted">{body}</p> : null}{action}</Card></section>
  );
}
