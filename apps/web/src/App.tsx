import { Languages, ShieldCheck, Users } from "lucide-react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useBranding } from "./branding";
import { mediaUrl } from "./image";
import { setLang, useLang, type Lang } from "./i18n";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { JoinPage } from "./pages/JoinPage";
import { PlayPage } from "./pages/PlayPage";
import { HostPage, ScreenPage } from "./pages/HostPage";

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-white/15 text-ink" : "text-ink-muted hover:bg-white/10 hover:text-ink",
  ].join(" ");
}

function LanguageSwitcher() {
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
            "rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
            lang === code ? "bg-white text-slate-900" : "text-ink-muted hover:bg-white/10",
          ].join(" ")}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const { t } = useLang();
  const { branding } = useBranding();
  const path = useLocation().pathname;
  const projector = path.startsWith("/screen/") || path.startsWith("/play/");
  const align = { "top-left": "justify-start", "top-center": "justify-center", "top-right": "justify-end" }[branding.logoPlacement];
  return (
    <div className="app-backdrop flex min-h-dvh flex-col">
      {projector ? null : <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className={`flex w-full items-center gap-3 sm:w-auto sm:flex-1 ${align}`}>
          {branding.logoMediaId ? (
            <img src={mediaUrl(branding.logoMediaId)} alt="" className="size-10 rounded-xl object-contain" />
          ) : (
            <div className="grid size-10 place-items-center rounded-xl bg-brand shadow-lg shadow-brand/30" aria-hidden>
              <ShieldCheck className="size-5 text-white" />
            </div>
          )}
          <div>
            <p className="text-lg font-bold leading-none">{branding.companyName || t("app.name")}</p>
            <p className="mt-1 text-xs text-ink-muted">{t("app.tagline")}</p>
          </div>
        </div>
        <nav className="flex items-center gap-1" aria-label="Main">
          <NavLink to="/" end className={navClass}>
            <Users className="size-4" aria-hidden />
            {t("nav.join")}
          </NavLink>
          <NavLink to="/admin" className={navClass}>
            <ShieldCheck className="size-4" aria-hidden />
            {t("nav.admin")}
          </NavLink>
        </nav>
        <LanguageSwitcher />
      </header>}

      <main className={`mx-auto flex w-full flex-1 px-4 pb-10 sm:px-6 ${path.startsWith("/screen/") ? "max-w-7xl pt-6" : projector ? "max-w-5xl pt-4" : "max-w-5xl"}`}>
        <Routes>
          <Route path="/" element={<JoinPage />} />
          <Route path="/play/:pin" element={<PlayPage />} />
          <Route path="/host/:id" element={<HostPage />} />
          <Route path="/screen/:id" element={<ScreenPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
