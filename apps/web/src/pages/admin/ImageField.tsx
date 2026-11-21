import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { errorKey } from "../../errors";
import { useLang } from "../../i18n";
import { mediaUrl, uploadImage } from "../../image";

export function ImageField({ label, value, onChange, maxSide }: { label: string; value: string | null; onChange(id: string | null): void; maxSide?: number }) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadImage(file, maxSide));
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        {value ? <img src={mediaUrl(value)} alt="" className="size-16 rounded-lg border border-surface-border object-cover" /> : <div className="grid size-16 place-items-center rounded-lg border border-dashed border-surface-border text-ink-muted"><ImagePlus className="size-5" aria-hidden /></div>}
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50">
          {busy ? t("image.uploading") : value ? t("image.replace") : t("image.add")}
        </button>
        {value ? (
          <button type="button" onClick={() => onChange(null)} aria-label={t("image.remove")} className="rounded-lg p-2 hover:bg-white/10"><X className="size-4" aria-hidden /></button>
        ) : null}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
