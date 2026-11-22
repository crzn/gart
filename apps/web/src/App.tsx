import { ShieldCheck, Users } from "lucide-react";
import { Suspense, lazy } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useBranding } from "./branding";
import { BrandLogo } from "./Logo";
import { useLang } from "./i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { JoinPage } from "./pages/JoinPage";
import { PlayPage } from "./pages/PlayPage";
import { HostPage, ScreenPage } from "./pages/HostPage";
import { PrivacyPage } from "./pages/PrivacyPage";

/** AGPL-3.0 section 13: everyone who uses the site over a network can get the source code it runs. */
const SOURCE_URL = "https://github.com/crzn/gart";

const ListenPage = lazy(() => import("./pages/ListenPage"));

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium",
    isActive ? "bg-white/15 text-ink" : "text-ink-muted hover:bg-white/10 hover:text-ink",
  ].join(" ");
}

export function App() {
  const { t } = useLang();
  const { branding } = useBranding();
  const path = useLocation().pathname;
  const projector = path.startsWith("/screen/") || path.startsWith("/play/");
  const admin = path === "/admin";
  const align = { "top-left": "justify-start", "top-center": "justify-center", "top-right": "justify-end" }[branding.logoPlacement];
  return (
    <div className="app-backdrop flex min-h-dvh flex-col">
      {projector || admin ? null : <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className={`flex w-full items-center gap-3 sm:w-auto sm:flex-1 ${align}`}>
          <BrandLogo />
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

      <main className={`mx-auto flex w-full flex-1 pb-10 ${path.startsWith("/screen/") ? "max-w-none px-[3vw] pt-4" : `px-4 sm:px-6 ${projector ? "max-w-5xl pt-4" : admin || path.startsWith("/host/") ? "max-w-6xl pt-4" : "max-w-5xl"}`}`}>
        <Routes>
          <Route path="/" element={<JoinPage />} />
          <Route path="/play/:pin" element={<PlayPage />} />
          <Route path="/host/:id" element={<HostPage />} />
          <Route path="/screen/:id" element={<ScreenPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/listen" element={<Suspense fallback={null}><ListenPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {projector ? null : (
        <footer className={`mx-auto w-full ${admin ? "max-w-6xl" : "max-w-5xl"} px-4 pb-6 text-center text-xs text-ink-muted sm:px-6`}>
          {t("footer.text")}{" "}
          <NavLink to="/privacy" className="underline underline-offset-2 hover:text-ink">{t("priv.link")}</NavLink>{" · "}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">{t("footer.source")}</a>
        </footer>
      )}
    </div>
  );
}
