import { Download, Play, Trophy, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { errorKey } from "../../errors";
import { csvCell, safeFileName } from "../../game/csv";
import { Avatar } from "../../game/parts";
import { useLang, type MessageKey } from "../../i18n";
import { Button, Card, ErrorNote } from "../../ui";

interface Game { id: string; title: string; pin: string; status: string; createdAt: string; startedAt: string | null; finishedAt: string | null; participants?: number }
interface Person { id: string; nickname: string; avatar: string; final_rank: number; total_points: number; correct_count: number }
interface QStat { q: number; answered: number; correct: number; avgMs: number }

const LIVE = ["CREATED", "LOBBY", "QUESTION_ACTIVE", "QUESTION_RESULTS", "LEADERBOARD"];

export function GamesTab() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ game: Game; people: Person[]; questions: QStat[] } | null>(null);

  const load = useCallback(async () => {
    try { setGames((await api<{ games: Game[] }>("/api/games")).games); } catch (e) { setError(t(errorKey(e))); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function show(g: Game) {
    setError(null);
    try {
      const r = await api<{ game: Game; participants: Person[]; questions: QStat[] }>(`/api/games/${g.id}/results`);
      setOpen({ game: r.game, people: r.participants, questions: r.questions });
    } catch (e) { setError(t(errorKey(e))); }
  }

  function exportCsv() {
    if (!open) return;
    const rows = [["rank", "nickname", "points", "correct"], ...open.people.map((p) => [p.final_rank, p.nickname, p.total_points, p.correct_count])];
    const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safeFileName(open.game.title, "game")}-${open.game.pin}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === "uk" ? "uk-UA" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "–");

  if (open) {
    const answers = open.questions;
    return (
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-bold">{open.game.title}</h2><p className="text-sm text-ink-muted">PIN {open.game.pin} · {fmt(open.game.startedAt ?? open.game.createdAt)} · {open.people.length} {t("play.players")}</p></div>
            <div className="flex gap-2"><Button variant="ghost" onClick={exportCsv} disabled={open.people.length === 0}><Download className="size-4" aria-hidden />CSV</Button><Button variant="ghost" onClick={() => setOpen(null)}>{t("games.back")}</Button></div>
          </div>
          {open.people.length === 0 ? <p className="mt-4 text-sm text-ink-muted">{t("games.noResults")}</p> : (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-ink-muted"><tr><th className="py-2">#</th><th>{t("play.nickname")}</th><th className="text-right">{t("play.pts")}</th><th className="text-right">{t("games.correct")}</th></tr></thead>
              <tbody>{open.people.map((p) => (
                <tr key={p.id} className="border-t border-white/10"><td className="py-2">{p.final_rank}</td><td><span className="inline-flex items-center gap-2"><Avatar id={p.avatar} size="sm" />{p.nickname}</span></td><td className="text-right font-mono">{p.total_points}</td><td className="text-right font-mono">{p.correct_count}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
        {answers.length > 0 ? (
          <Card>
            <h3 className="font-bold">{t("games.perQuestion")}</h3>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-ink-muted"><tr><th className="py-2">#</th><th className="text-right">{t("games.answered")}</th><th className="text-right">{t("games.correctPct")}</th><th className="text-right">{t("games.avgTime")}</th></tr></thead>
              <tbody>{answers.map((a) => (
                <tr key={a.q} className="border-t border-white/10"><td className="py-2">{a.q + 1}</td><td className="text-right font-mono">{a.answered}</td><td className="text-right font-mono">{a.answered ? Math.round((a.correct / a.answered) * 100) : 0}%</td><td className="text-right font-mono">{(a.avgMs / 1000).toFixed(1)} s</td></tr>
              ))}</tbody>
            </table>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <Card>
      <h2 className="text-xl font-bold">{t("games.title")}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t("games.hint")}</p>
      {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}
      {games === null ? <p className="mt-4 text-sm text-ink-muted">{t("admin.loading")}</p> : games.length === 0 ? <p className="mt-4 text-sm text-ink-muted">{t("games.empty")}</p> : (
        <ul className="mt-4 divide-y divide-white/10">
          {games.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{g.title}</p>
                <p className="mt-1 text-xs text-ink-muted">PIN {g.pin} · {t(`games.status.${g.status}` as MessageKey)} · {fmt(g.createdAt)} · {g.participants ?? 0} {t("play.players")}</p>
              </div>
              <div className="flex gap-2">
                {LIVE.includes(g.status) ? (<>
                  <Button onClick={() => navigate(`/host/${g.id}`)}><Play className="size-4" aria-hidden />{t("games.open")}</Button>
                  <Button variant="ghost" aria-label={t("host.cancel")} onClick={() => { if (window.confirm(t("host.confirmCancel"))) void api(`/api/games/${g.id}/cancel`, { method: "POST" }).then(load).catch((e) => setError(t(errorKey(e)))); }}><XCircle className="size-4" aria-hidden /></Button>
                </>) : g.status === "FINISHED" ? <Button variant="ghost" onClick={() => void show(g)}><Trophy className="size-4" aria-hidden />{t("games.results")}</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
