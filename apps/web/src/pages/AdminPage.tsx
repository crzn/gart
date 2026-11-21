import { BookOpenCheck, DownloadCloud, KeyRound, LogOut, Gauge, Palette, Radio, Server, Users } from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { roleAtLeast } from "@gart/shared";
import { useAuth } from "../auth";
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

type Tab = "quizzes" | "games" | "usage" | "branding" | "status" | "updates" | "account" | "admins";

export function AdminPage() {
  const { t } = useLang();
  const { state, logout } = useAuth();
  const location = useLocation();
  const [tab, setTab] = useState<Tab>("quizzes");

  if (state.status === "loading") return <p className="m-auto text-sm text-ink-muted">{t("admin.loading")}</p>;
  if (state.status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const me = state.admin;
  const tabs: { id: Tab; label: MessageKey; icon: typeof Server; show: boolean }[] = [
    { id: "quizzes", label: "tab.quizzes", icon: BookOpenCheck, show: true },
    { id: "games", label: "tab.games", icon: Radio, show: true },
    { id: "usage", label: "tab.usage", icon: Gauge, show: roleAtLeast(me.role, "admin") },
    { id: "branding", label: "tab.branding", icon: Palette, show: roleAtLeast(me.role, "admin") },
    { id: "status", label: "tab.status", icon: Server, show: true },
    { id: "updates", label: "tab.updates", icon: DownloadCloud, show: me.role === "owner" },
    { id: "account", label: "tab.account", icon: KeyRound, show: true },
    { id: "admins", label: "tab.admins", icon: Users, show: roleAtLeast(me.role, "admin") },
  ];

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t("nav.admin")} className="flex flex-wrap gap-1">
          {tabs.filter((x) => x.show).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${tab === id ? "bg-white/15" : "text-ink-muted hover:bg-white/10"}`}
            >
              <Icon className="size-4" aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink-muted">{me.displayName} · {t(`role.${me.role}` as MessageKey)}</span>
          <Button variant="ghost" onClick={() => void logout()}>
            <LogOut className="size-4" aria-hidden />
            {t("auth.logout")}
          </Button>
        </div>
      </div>
      {tab === "quizzes" && <QuizzesTab me={me} />}
      {tab === "games" && <GamesTab />}
      {tab === "usage" && <UsageTab />}
      {tab === "branding" && roleAtLeast(me.role, "admin") && <BrandingTab />}
      {tab === "status" && <AdminStatusPage />}
      {tab === "updates" && me.role === "owner" && <UpdatesTab />}
      {tab === "account" && <AccountTab />}
      {tab === "admins" && roleAtLeast(me.role, "admin") && <AdminsTab me={me} />}
    </div>
  );
}
