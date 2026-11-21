import { ArrowRight, Flag, MonitorPlay, Pause, Play, Square, Trophy, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { errorKey } from "../errors";
import { LiveView } from "../game/LiveView";
import { useGameSocket } from "../game/useGameSocket";
import { useLang, type MessageKey } from "../i18n";
import { Button, Card, ErrorNote } from "../ui";

interface GameInfo { id: string; pin: string; title: string; status: string }

/** Loads the game, then connects with a single-use ticket (a fresh one on every reconnect). */
function useControlledGame(id: string, role: "host" | "screen") {
  const [game, setGame] = useState<GameInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    api<{ game: GameInfo }>(`/api/games/${id}`).then((r) => { if (alive) setGame(r.game); }).catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [id]);
  const socket = useGameSocket({
    pin: game && !["CANCELLED"].includes(game.status) ? game.pin : null,
    firstFrame: async () => {
      const { ticket } = await api<{ ticket: string }>(`/api/games/${id}/ticket`, { method: "POST", body: { role } });
      return role === "host" ? { t: "host.auth", d: { ticket } } : { t: "screen.attach", d: { ticket } };
    },
  });
  return { game, error, ...socket };
}

export function HostPage() {
  const { t } = useLang();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state: auth } = useAuth();
  const { game, error, state, dispatch, send } = useControlledGame(id, "host");
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (auth.status === "anonymous") return <Navigate to="/login" replace state={{ from: `/host/${id}` }} />;
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace state={{ from: `/host/${id}` }} />;
  if (error) return <Notice title={t(errorKey(error))} />;
  if (!game) return <p className="m-auto text-sm text-ink-muted">{t("admin.loading")}</p>;
  if (game.status === "CANCELLED") return <Notice title={t("host.cancelled")} />;
  if (state.error === "replaced") return <Notice title={t("host.replaced")} />;
  if (state.conn === "failed") return <Notice title={t("play.noGame")} />;

  const snap = state.snap;
  const joinUrl = `${location.host}`;
  const q = snap?.question;
  const last = q ? q.index + 1 >= q.total : false;
  const s = snap?.state;
  const kick = (playerId: string) => { send({ t: "host.kick", d: { playerId } }); dispatch({ type: "removePlayer", playerId }); };
  const errText = state.error ? ((t(`ws.err.${state.error}` as MessageKey) as string | undefined) ?? t("ws.err.unknown")) : null;

  return (
    <section className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">{game.title} · PIN {game.pin}{state.conn === "reconnecting" ? ` · ${t("play.reconnecting")}` : ""}</p>
        <a href={`/screen/${id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20"><MonitorPlay className="size-4" aria-hidden />{t("host.projector")}</a>
      </div>
      <Card><LiveView state={state} joinUrl={joinUrl} onKick={s === "LOBBY" ? kick : undefined} /></Card>
      {errText ? <ErrorNote>{errText}</ErrorNote> : null}
      {snap ? (
        <div className="flex flex-wrap items-center gap-3">
          {s === "LOBBY" && <>
            <Button onClick={() => send({ t: "host.start" })} disabled={snap.playerCount < 1}><Play className="size-4" aria-hidden />{t("host.start")}</Button>
            {snap.playerCount < 1 ? <span className="text-sm text-ink-muted">{t("host.needPlayer")}</span> : null}
            <Button variant="danger" onClick={() => { if (window.confirm(t("host.confirmCancel"))) void api(`/api/games/${id}/cancel`, { method: "POST" }).then(() => navigate("/admin")); }}><XCircle className="size-4" aria-hidden />{t("host.cancel")}</Button>
          </>}
          {s === "QUESTION_ACTIVE" && <>
            <Button onClick={() => send({ t: "host.closeQuestion" })}><Square className="size-4" aria-hidden />{t("host.close")}</Button>
            {snap.paused ? <Button variant="ghost" onClick={() => send({ t: "host.resume" })}><Play className="size-4" aria-hidden />{t("host.resume")}</Button> : <Button variant="ghost" onClick={() => send({ t: "host.pause" })}><Pause className="size-4" aria-hidden />{t("host.pause")}</Button>}
          </>}
          {s === "QUESTION_RESULTS" && <>
            {snap.settings.leaderboardEnabled ? <Button onClick={() => send({ t: "host.showLeaderboard" })}><Trophy className="size-4" aria-hidden />{t("host.leaderboard")}</Button> : null}
            <Button variant={snap.settings.leaderboardEnabled ? "ghost" : "primary"} onClick={() => send({ t: "host.next" })}>{last ? <Flag className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}{last ? t("host.finish") : t("host.next")}</Button>
          </>}
          {s === "LEADERBOARD" && <Button onClick={() => send({ t: "host.next" })}>{last ? <Flag className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}{last ? t("host.finish") : t("host.next")}</Button>}
          {s === "FINISHED" && <Link to="/admin" className="inline-flex items-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white">{t("host.toAdmin")}</Link>}
          {(s === "QUESTION_ACTIVE" || s === "QUESTION_RESULTS" || s === "LEADERBOARD") && (
            confirmEnd
              ? <Button variant="danger" onClick={() => { send({ t: "host.end" }); setConfirmEnd(false); }}>{t("host.confirmEnd")}</Button>
              : <Button variant="ghost" onClick={() => setConfirmEnd(true)}>{t("host.end")}</Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ScreenPage() {
  const { t } = useLang();
  const { id = "" } = useParams();
  const { state: auth } = useAuth();
  const { game, error, state } = useControlledGame(id, "screen");
  if (auth.status === "anonymous" || (error instanceof ApiError && error.status === 401)) return <Navigate to="/login" replace state={{ from: `/screen/${id}` }} />;
  if (error) return <Notice title={t(errorKey(error))} />;
  if (!game) return <p className="m-auto text-sm text-ink-muted">{t("admin.loading")}</p>;
  if (state.error === "replaced") return <Notice title={t("host.replaced")} />;
  return (
    <section className="w-full" data-testid="screen">
      {state.snap && state.snap.state !== "LOBBY" ? <p className="mb-4 text-right text-xl text-ink-muted">{t("host.joinAt")} {location.host} · PIN <b className="font-mono text-ink">{game.pin}</b></p> : null}
      <LiveView state={state} big joinUrl={location.host} />
    </section>
  );
}

function Notice({ title }: { title: string }) {
  return <section className="m-auto w-full max-w-md"><Card className="space-y-4 text-center"><h1 className="text-xl font-bold">{title}</h1><Link to="/admin" className="inline-block rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/20">{"←"}</Link></Card></section>;
}
