import { BookOpenCheck, ChevronDown, DownloadCloud, KeyRound, LogOut, Gauge, Palette, Radio, Server, Settings, ShieldCheck, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { roleAtLeast } from "@gart/shared";
import { useAuth } from "../auth";
import { BrandLogo } from "../Logo";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { useLang, type MessageKey } from "../i18n";
import { AccountTab } from "./admin/AccountTab";
import { AdminsTab } from "./admin/AdminsTab";
import { BrandingTab } from "./admin/BrandingTab";
import { PrivacyTab } from "./admin/PrivacyTab";
import { GamesTab } from "./admin/GamesTab";
import { QuizzesTab } from "./admin/QuizzesTab";
import { UpdatesTab } from "./admin/UpdatesTab";
import { UsageTab } from "./admin/UsageTab";
import { AdminStatusPage } from "./AdminStatusPage";

type Tab = "quizzes" | "games" | "settings" | "account";
type Sub = "status" | "updates" | "admins" | "usage" | "branding" | "privacy";

/** Everything about "me" in one menu: language and sign out. */
function UserMenu({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="true" aria-expanded={open} data-testid="user-menu" onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
        <span className="hidden max-w-40 truncate sm:inline">{name}</span>
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-2xl border border-slate-600 bg-slate-900 p-4 text-sm shadow-2xl">
          <div><p className="font-semibold">{name}</p><p className="text-ink-muted">{role}</p></div>
          <LanguageSwitcher />
          <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10">
            <LogOut className="size-4" aria-hidden />{t("auth.logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AdminPage() {
  const { t } = useLang();
  const { state, logout } = useAuth();
  const location = useLocation();
  const [tab, setTab] = useState<Tab>("quizzes");
  const [sub, setSub] = useState<Sub>("status");

  if (state.status === "loading") return <p className="m-auto text-sm text-ink-muted">{t("admin.loading")}</p>;
  if (state.status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const me = state.admin;
  const canSettings = roleAtLeast(me.role, "admin");
  const tabs: { id: Tab; label: MessageKey; icon: typeof Server; show: boolean }[] = [
    { id: "quizzes", label: "tab.quizzes", icon: BookOpenCheck, show: true },
    { id: "games", label: "tab.games", icon: Radio, show: true },
    { id: "settings", label: "tab.settings", icon: Settings, show: canSettings },
    { id: "account", label: "tab.account", icon: KeyRound, show: true },
  ];
  const subs: { id: Sub; label: MessageKey; icon: typeof Server; show: boolean }[] = [
    { id: "status", label: "tab.status", icon: Server, show: true },
    { id: "updates", label: "tab.updates", icon: DownloadCloud, show: me.role === "owner" },
    { id: "admins", label: "tab.admins", icon: Users, show: true },
    { id: "usage", label: "tab.usage", icon: Gauge, show: true },
    { id: "branding", label: "tab.branding", icon: Palette, show: true },
    { id: "privacy", label: "tab.privacy", icon: ShieldCheck, show: true },
  ];
  const pill = (active: boolean) => `inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${active ? "bg-white/15" : "text-ink-muted hover:bg-white/10"}`;

  return (
    <div className="w-full">
      <header className="mb-6 flex items-center gap-3 border-b border-surface-border pb-3">
        <div className="shrink-0"><BrandLogo size="sm" /></div>
        <div role="tablist" aria-label={t("nav.admin")} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.filter((x) => x.show).map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`${pill(tab === id)} shrink-0`}>
              <Icon className="size-4" aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
        <UserMenu name={me.displayName} role={t(`role.${me.role}` as MessageKey)} onLogout={() => void logout()} />
      </header>
      {tab === "settings" && canSettings ? (
        <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
          <div role="tablist" aria-orientation="vertical" aria-label={t("tab.settings")} className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {subs.filter((x) => x.show).map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" type="button" aria-selected={sub === id} onClick={() => setSub(id)} className={`${pill(sub === id)} shrink-0 md:w-full`}>
                <Icon className="size-4" aria-hidden />
                {t(label)}
              </button>
            ))}
          </div>
          <div className="min-w-0">
            {sub === "status" && <AdminStatusPage />}
            {sub === "updates" && me.role === "owner" && <UpdatesTab />}
            {sub === "admins" && <AdminsTab me={me} />}
            {sub === "usage" && <UsageTab />}
            {sub === "branding" && <BrandingTab />}
            {sub === "privacy" && <PrivacyTab />}
          </div>
        </div>
      ) : null}
      {tab === "quizzes" && <QuizzesTab me={me} />}
      {tab === "games" && <GamesTab />}
      {tab === "account" && <AccountTab />}
    </div>
  );
}
