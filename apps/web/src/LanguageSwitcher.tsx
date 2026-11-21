import { Languages } from "lucide-react";
import { setLang, useLang, type Lang } from "./i18n";

export function LanguageSwitcher() {
  const { lang, t } = useLang();
  const options: Lang[] = ["uk", "en"];
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={t("lang.label")}>
      <Languages className="size-4 text-ink-muted" aria-hidden />
      {options.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={[
            "rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
            lang === code ? "bg-white text-slate-900" : "text-ink-muted hover:bg-white/10",
          ].join(" ")}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
