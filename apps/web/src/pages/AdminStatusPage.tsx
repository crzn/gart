import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLang, type MessageKey } from "../i18n";

interface Health {
  status: "ok" | "degraded";
  version: string;
  db: { ok: boolean; schemaReady: boolean };
}

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; health: Health; needsSetup: boolean | null };

async function loadStatus(): Promise<Load> {
  try {
    // /api/health answers 503 when degraded but still carries a JSON body we want to show.
    const healthRes = await fetch("/api/health", { headers: { Accept: "application/json" } });
    const health = (await healthRes.json()) as Health;

    let needsSetup: boolean | null = null;
    if (health.db.schemaReady) {
      const setupRes = await fetch("/api/setup/status", { headers: { Accept: "application/json" } });
      if (setupRes.ok) needsSetup = ((await setupRes.json()) as { needsSetup: boolean }).needsSetup;
    }
    return { state: "ready", health, needsSetup };
  } catch {
    return { state: "error" };
  }
}

function Row({ label, ok, children }: { label: string; ok: boolean | null; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        {ok === null ? null : ok ? (
          <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
        ) : (
          <CircleAlert className="size-4 text-amber-400" aria-hidden />
        )}
        {children}
      </span>
    </li>
  );
}

export function AdminStatusPage() {
  const { t } = useLang();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(() => {
    setLoad({ state: "loading" });
    void loadStatus().then(setLoad);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const label = (key: MessageKey) => t(key);

  return (
    <section className="m-auto w-full max-w-xl">
      <div className="rounded-3xl border border-surface-border bg-surface p-6 shadow-2xl backdrop-blur sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
            <p className="mt-2 text-sm text-ink-muted">{t("admin.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={load.state === "loading"}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
          >
            <RefreshCw className="size-4" aria-hidden />
            {t("admin.refresh")}
          </button>
        </div>

        <div className="mt-6" aria-live="polite">
          {load.state === "loading" && (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="size-4" aria-hidden />
              {t("admin.loading")}
            </p>
          )}
          {load.state === "error" && (
            <p role="alert" className="rounded-2xl bg-red-500/15 p-4 text-sm text-red-200">
              {t("admin.error")}
            </p>
          )}
          {load.state === "ready" && (
            <ul className="divide-y divide-white/10">
              <Row label={label("admin.version")} ok={null}>
                <span className="font-mono">{load.health.version}</span>
              </Row>
              <Row label={label("admin.database")} ok={load.health.db.ok}>
                {load.health.db.ok ? t("admin.ok") : t("admin.fail")}
              </Row>
              <Row label={label("admin.schema")} ok={load.health.db.schemaReady}>
                {load.health.db.schemaReady ? t("admin.ok") : t("admin.schemaMissing")}
              </Row>
              <Row label={label("admin.firstAdmin")} ok={load.needsSetup === null ? null : !load.needsSetup}>
                {load.needsSetup === null
                  ? t("admin.unknown")
                  : load.needsSetup
                    ? t("admin.needsSetup")
                    : t("admin.setupDone")}
              </Row>
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
