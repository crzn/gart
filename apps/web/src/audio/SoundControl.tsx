import { Volume2, VolumeX } from "lucide-react";
import { Link } from "react-router-dom";
import { useLang, type MessageKey } from "../i18n";
import type { HostAudio } from "./useHostAudio";
import { VARIANTS } from "./music";

/** Sound switch for the host screen and the projector: browsers allow sound only after a click, so it starts off. */
export function SoundControl({ audio }: { audio: HostAudio }) {
  const { t } = useLang();
  if (!audio.allowed) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/10 px-3 py-2 text-sm" data-testid="sound-control">
      {audio.on ? (
        <>
          <button type="button" onClick={audio.disable} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 hover:bg-white/20"><VolumeX className="size-4" aria-hidden />{t("sound.off")}</button>
          <label className="inline-flex items-center gap-2"><Volume2 className="size-4" aria-hidden /><span className="sr-only">{t("sound.volume")}</span>
            <input type="range" min={0} max={1} step={0.05} value={audio.volume} onChange={(e) => audio.setVolume(Number(e.target.value))} className="w-28 accent-amber-400" />
          </label>
          <label className="inline-flex items-center gap-2"><span className="text-ink-muted">{t("sound.music")}</span>
            <select value={audio.variant} onChange={(e) => audio.setVariant(e.target.value as typeof VARIANTS[number])} className="rounded-lg border border-surface-border bg-black/20 px-2 py-1">
              {VARIANTS.map((v) => <option key={v} value={v}>{t(`sound.variant.${v}` as MessageKey)}</option>)}
            </select>
          </label>
        </>
      ) : (
        <button type="button" onClick={audio.enable} disabled={audio.loading} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-1.5 font-semibold text-slate-900 hover:brightness-110 disabled:opacity-60"><Volume2 className="size-4" aria-hidden />{t("sound.enable")}</button>
      )}
      <Link to="/listen" target="_blank" className="text-ink-muted underline underline-offset-2 hover:text-ink">{t("sound.listen")}</Link>
    </div>
  );
}
