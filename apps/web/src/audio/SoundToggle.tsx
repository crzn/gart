import { Volume2, VolumeX } from "lucide-react";
import { useLang } from "../i18n";
import type { GameSound } from "./useGameSound";

/** The sound switch. "sm" is the presenter's screen and the projector; "lg" is the big round one in the top-right corner of a phone. */
export function SoundToggle({ sound, size = "sm" }: { sound: GameSound; size?: "sm" | "lg" }) {
  const { t } = useLang();
  const label = t(sound.on ? "sound.off" : "sound.enable");
  if (size === "lg") {
    return (
      <button type="button" onClick={sound.on ? sound.disable : sound.enable} disabled={sound.loading} aria-pressed={sound.on} aria-label={label} title={label} data-testid="sound-toggle"
        className={`grid size-14 shrink-0 place-items-center rounded-full border-2 transition disabled:opacity-60 ${sound.on ? "border-accent bg-accent/20 text-accent" : "border-slate-500 bg-white/10 text-ink-muted hover:bg-white/20"}`}>
        {sound.on ? <Volume2 className="size-7" aria-hidden /> : <VolumeX className="size-7" aria-hidden />}
      </button>
    );
  }
  return (
    <div className="inline-flex" data-testid="sound-control">
      <button type="button" onClick={sound.on ? sound.disable : sound.enable} disabled={sound.loading} aria-pressed={sound.on} data-testid="sound-toggle"
        className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${sound.on ? "bg-white/10 hover:bg-white/20" : "bg-accent text-slate-900 hover:brightness-110"}`}>
        {sound.on ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}{label}
      </button>
    </div>
  );
}
