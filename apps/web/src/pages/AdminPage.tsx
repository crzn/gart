import { BookOpenCheck, DownloadCloud, KeyRound, LogOut, Gauge, Palette, Radio, Server, Settings, Users, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { roleAtLeast, type Branding } from "@gart/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { useBranding } from "../branding";
import { useLang, type MessageKey } from "../i18n";
import { Button } from "../ui";
import { AccountTab } from "./admin/AccountTab";
import { AdminsTab } from "./admin/AdminsTab";
import { BrandingTab } from "./admin/BrandingTab";
import { GamesTab } from "./admin/GamesTab";
import { QuizzesTab } from "./admin/QuizzesTab";
import { UpdatesTab } from "./admin/UpdatesTab";
import { UsageTab } from "./admin/UsageTab";
import { AdminStatusPage } from "./AdminStatusPage";

type Tab = "quizzes" | "games" | "settings" | "account";
type Sub = "status" | "updates" | "admins" | "usage" | "branding";

/** The Gart-wide sound switch: every signed-in user sees whether sound is on, and may change it. */
function SoundIndicator() {
  const { t } = useLang();
  const { branding, set } = useBranding();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const { branding: b } = await api<{ branding: Branding }>("/api/branding/sound", { method: "PUT", body: { soundEnabled: !branding.soundEnabled } });
      set(b);
    } catch { /* the indicator stays as it was */ } finally { setBusy(false); }
  }
  const on = branding.soundEnabled;
  return (
    <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={on} data-testid="gart-sound" title={t("brand.soundHint")}
      className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-60">
      {on ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
      {t("sound.gart")}: {on ? t("sound.gartOn") : t("sound.gartOff")}
    </button>
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
  ];
  const pill = (active: boolean) => `inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${active ? "bg-white/15" : "text-ink-muted hover:bg-white/10"}`;

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t("nav.admin")} className="flex flex-wrap gap-1">
          {tabs.filter((x) => x.show).map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={pill(tab === id)}>
              <Icon className="size-4" aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <SoundIndicator />
          <span className="text-ink-muted">{me.displayName} · {t(`role.${me.role}` as MessageKey)}</span>
          <Button variant="ghost" onClick={() => void logout()}>
            <LogOut className="size-4" aria-hidden />
            {t("auth.logout")}
          </Button>
        </div>
      </div>
      {tab === "settings" && canSettings ? (
        <div role="tablist" aria-label={t("tab.settings")} className="mb-6 flex flex-wrap gap-1 border-b border-surface-border pb-3">
          {subs.filter((x) => x.show).map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" type="button" aria-selected={sub === id} onClick={() => setSub(id)} className={pill(sub === id)}>
              <Icon className="size-4" aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "quizzes" && <QuizzesTab me={me} />}
      {tab === "games" && <GamesTab />}
      {tab === "settings" && canSettings && sub === "status" && <AdminStatusPage />}
      {tab === "settings" && canSettings && sub === "updates" && me.role === "owner" && <UpdatesTab />}
      {tab === "settings" && canSettings && sub === "admins" && <AdminsTab me={me} />}
      {tab === "settings" && canSettings && sub === "usage" && <UsageTab />}
      {tab === "settings" && canSettings && sub === "branding" && <BrandingTab />}
      {tab === "account" && <AccountTab />}
    </div>
  );
}
