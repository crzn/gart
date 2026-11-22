import { ArrowRight, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { roleAtLeast } from "@gart/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { errorKey } from "../errors";
import { saveGuest } from "../guest";
import { LogoMark } from "../Logo";
import { useLang, type MessageKey } from "../i18n";
import { mediaUrl } from "../image";
import { Button, Card, ErrorNote } from "../ui";

type Difficulty = "easy" | "medium" | "hard";
interface ShowcaseQuiz {
  id: string; title: string; description: string; category: string; tags: string[]; difficulty: Difficulty | null;
  language: string; coverMediaId: string | null; questionCount: number;
}
interface ShowcaseReply { quizzes: ShowcaseQuiz[]; guestMaxPlayers: number }

const LEVELS: ("all" | Difficulty)[] = ["all", "easy", "medium", "hard"];

/** The showcase: every quiz that is ready to play. A visitor starts a game limited to a few players; a signed-in editor has no limit. */
export function ShowcasePage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { state: auth } = useAuth();
  const [data, setData] = useState<ShowcaseReply | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [level, setLevel] = useState<"all" | Difficulty>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<unknown>(null);
  const signedIn = auth.status === "authenticated" && roleAtLeast(auth.admin.role, "editor");

  useEffect(() => {
    api<ShowcaseReply>("/api/showcase").then(setData).catch(setError);
  }, []);

  const shown = (data?.quizzes ?? []).filter((q) => level === "all" || q.difficulty === level);

  async function launch(q: ShowcaseQuiz) {
    setBusy(q.id);
    setLaunchError(null);
    try {
      if (signedIn) {
        const r = await api<{ game: { id: string } }>("/api/games", { method: "POST", body: { quizId: q.id } });
        navigate(`/host/${r.game.id}`);
      } else {
        const r = await api<{ game: { id: string; pin: string; title: string }; hostToken: string; maxPlayers: number }>(`/api/showcase/${q.id}/start`, { method: "POST" });
        saveGuest({ id: r.game.id, pin: r.game.pin, title: r.game.title, hostToken: r.hostToken, maxPlayers: r.maxPlayers });
        navigate(`/host/${r.game.id}`);
      }
    } catch (e) {
      setLaunchError(e);
      setBusy(null);
    }
  }

  return (
    <section className="w-full space-y-6" data-testid="showcase">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold sm:text-4xl">{t("showcase.title")}</h1>
        <p className="max-w-2xl text-ink-muted">{t("showcase.subtitle")}</p>
      </div>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        {signedIn ? (
          <p className="text-sm" data-testid="showcase-unlimited">{t("showcase.unlimited")}</p>
        ) : (
          <p className="text-sm" data-testid="showcase-limit">{(t("showcase.guestLimit") as string).replace("{n}", String(data?.guestMaxPlayers ?? 10))}</p>
        )}
      </Card>

      {data && data.quizzes.length > 0 && (
        <div className="space-y-3" role="group" aria-label={t("showcase.filters")}>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}
                className={`rounded-full px-3 py-1 text-sm ${level === l ? "bg-accent text-slate-900" : "bg-white/10 hover:bg-white/20"}`}>
                {t(`showcase.level.${l}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {error ? <ErrorNote>{t(errorKey(error))}</ErrorNote> : null}
      {launchError ? <ErrorNote>{t(errorKey(launchError))}</ErrorNote> : null}
      {!data && !error ? <p className="text-ink-muted">{t("admin.loading")}</p> : null}
      {data && data.quizzes.length === 0 ? <Card><p className="text-ink-muted">{t("showcase.empty")}</p></Card> : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="showcase-list">
        {shown.map((q) => (
          <li key={q.id}>
            <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-surface-border bg-surface shadow-xl" data-testid="showcase-card">
              {q.coverMediaId ? (
                <img src={mediaUrl(q.coverMediaId)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
              ) : (
                <div className="grid aspect-video place-items-center bg-gradient-to-br from-brand/30 to-slate-900"><LogoMark className="size-16 opacity-70" /></div>
              )}
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {q.difficulty && <span className="rounded-full bg-white/10 px-2.5 py-1">{t(`showcase.level.${q.difficulty}` as MessageKey)}</span>}
                  {q.category && <span className="text-ink-muted">{q.category}</span>}
                  <span className="ml-auto text-ink-muted">{(t("showcase.questions") as string).replace("{n}", String(q.questionCount))} · {q.language.toUpperCase()}</span>
                </div>
                <h2 className="text-lg font-semibold leading-snug">{q.title}</h2>
                {q.description && <p className="line-clamp-3 text-sm text-ink-muted">{q.description}</p>}
                <div className="mt-auto pt-2">
                  <Button className="w-full" busy={busy === q.id} disabled={busy !== null && busy !== q.id} onClick={() => void launch(q)}>
                    <Play className="size-4" aria-hidden />{t("showcase.launch")}<ArrowRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
