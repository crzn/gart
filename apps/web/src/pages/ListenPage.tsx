import { Download, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLang, type MessageKey } from "../i18n";
import type { AudioEngine } from "../audio/engine";
import { VARIANTS, bpmFor, type Mood, type Variant } from "../audio/music";
import { Button, Card } from "../ui";

const MOODS: Mood[] = ["lobby", "question", "hurry"];
const SFX = ["join", "tick", "go", "timeup", "reveal", "rank"] as const;

/** Listening page: the three music variants in each mood, the effects and the fanfares, and a WAV sample of each variant. */
export default function ListenPage() {
  const { t } = useLang();
  const eng = useRef<AudioEngine | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { eng.current?.dispose(); }, []);

  async function engine(): Promise<AudioEngine> {
    if (!eng.current) { const m = await import("../audio/engine"); eng.current = m.createEngine(); }
    await eng.current.resume();
    return eng.current;
  }
  async function play(variant: Variant, mood: Mood) {
    const e = await engine();
    e.playMusic(variant, mood, { restart: true });
    setPlaying(`${variant}:${mood}`);
  }
  function stop() { eng.current?.stopMusic(); setPlaying(null); }
  async function sample(variant: Variant) {
    setBusy(true);
    try {
      const m = await import("../audio/engine");
      const wav = m.encodeWav(await m.renderMusic(variant, "question", 8));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(wav); a.download = `gart-${variant}.wav`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally { setBusy(false); }
  }

  function save(wav: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(wav); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function intro(download: boolean) {
    const j = await import("../audio/jingle");
    const m = await import("../audio/engine");
    const e = await engine();
    const buf = await j.renderJingle(download ? 44100 : e.sampleRate);
    if (download) save(m.encodeWav(buf), "gart-intro.wav"); else e.playBuffer(buf);
  }
  async function waiting(players: number) {
    const e = await engine();
    e.playWaiting(players);
    setPlaying(`waiting:${players}`);
  }
  async function waitingSample() {
    setBusy(true);
    try { const m = await import("../audio/engine"); save(m.encodeWav(await m.renderWaiting(16, 0)), "gart-waiting.wav"); } finally { setBusy(false); }
  }

  return (
    <section className="w-full space-y-6" data-testid="listen">
      <div>
        <h1 className="text-2xl font-bold">{t("listen.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("listen.intro")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {VARIANTS.map((v) => (
          <Card key={v} className="space-y-3">
            <h2 className="text-lg font-semibold">{t(`sound.variant.${v}` as MessageKey)}</h2>
            <p className="text-sm text-ink-muted">{t(`listen.about.${v}` as MessageKey)}</p>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <Button key={m} variant={playing === `${v}:${m}` ? "primary" : "ghost"} onClick={() => void play(v, m)}>
                  <Play className="size-4" aria-hidden />{t(`listen.mood.${m}` as MessageKey)} <span className="text-xs opacity-70">{bpmFor(v, m)}</span>
                </Button>
              ))}
            </div>
            <Button variant="ghost" busy={busy} onClick={() => void sample(v)}><Download className="size-4" aria-hidden />{t("listen.sample")}</Button>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">{t("listen.intro6")}</h2>
          <p className="text-sm text-ink-muted">{t("listen.intro6Hint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void intro(false)}><Play className="size-4" aria-hidden />{t("listen.play")}</Button>
            <Button variant="ghost" onClick={() => void intro(true)}><Download className="size-4" aria-hidden />{t("listen.sample")}</Button>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">{t("listen.waiting")}</h2>
          <p className="text-sm text-ink-muted">{t("listen.waitingHint")}</p>
          <div className="flex flex-wrap gap-2">
            {[0, 4, 8].map((n) => <Button key={n} variant={playing === `waiting:${n}` ? "primary" : "ghost"} onClick={() => void waiting(n)}><Play className="size-4" aria-hidden />{t("listen.players")} {n}</Button>)}
            <Button variant="ghost" busy={busy} onClick={() => void waitingSample()}><Download className="size-4" aria-hidden />{t("listen.sample")}</Button>
          </div>
        </Card>
      </div>
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">{t("listen.effects")}</h2>
        <div className="flex flex-wrap gap-2">
          {SFX.map((s) => <Button key={s} variant="ghost" onClick={() => void engine().then((e) => e.sfx(s))}>{t(`listen.sfx.${s}` as MessageKey)}</Button>)}
          <Button variant="ghost" onClick={() => void engine().then((e) => e.fanfare("short"))}>{t("listen.fanfareShort")}</Button>
          <Button variant="ghost" onClick={() => void engine().then((e) => e.fanfare("podium"))}>{t("listen.fanfarePodium")}</Button>
        </div>
      </Card>
      <Button variant="danger" onClick={stop}><Square className="size-4" aria-hidden />{t("listen.stop")}</Button>
    </section>
  );
}
