import { Loader2 } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { useLang } from "./i18n";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-surface-border bg-surface p-6 shadow-2xl backdrop-blur sm:p-8 ${className}`}>{children}</div>;
}

export function Field({ label, id, hint, ...rest }: { label: string; id: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      {hint ? <p id={`${id}-hint`} className="mb-1.5 text-xs text-ink-muted">{hint}</p> : null}
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...rest}
        className="w-full rounded-xl border border-slate-500 bg-slate-950/70 px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/40"
      />
    </div>
  );
}

export function Button({ busy, variant = "primary", children, ...rest }: { busy?: boolean; variant?: "primary" | "ghost" | "danger" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-brand text-on-brand hover:brightness-110",
    ghost: "bg-white/10 hover:bg-white/20",
    danger: "bg-red-500/80 text-white hover:bg-red-500",
  }[variant];
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {busy ? <Loader2 className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-2xl bg-red-500/15 p-3 text-sm text-red-200">{children}</p>;
}

/** Splits a list into pages (client side: the lists are small and already loaded). */
export function usePaged<T>(items: T[], size = 10) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages - 1);
  return { rows: items.slice(current * size, (current + 1) * size), page: current, pages, setPage, total: items.length };
}

/** Previous / numbered pages / next. Hidden while everything fits on one page. */
export function Pager({ page, pages, setPage }: { page: number; pages: number; setPage: (n: number) => void }) {
  const { t } = useLang();
  if (pages <= 1) return null;
  const nums: (number | "…")[] = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btn = "min-w-9 rounded-lg px-3 py-1.5 text-sm font-medium";
  return (
    <nav aria-label={t("pager.label")} className="mt-4 flex flex-wrap items-center justify-center gap-1" data-testid="pager">
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={`${btn} bg-white/10 hover:bg-white/20 disabled:opacity-40`}>{t("pager.prev")}</button>
      {nums.map((n, i) => n === "…" ? <span key={`g${i}`} className="px-1 text-ink-muted" aria-hidden>…</span> : (
        <button key={n} type="button" aria-current={n === page ? "page" : undefined} aria-label={`${t("pager.page")} ${n + 1}`} onClick={() => setPage(n)}
          className={`${btn} ${n === page ? "bg-brand text-on-brand" : "bg-white/10 hover:bg-white/20"}`}>{n + 1}</button>
      ))}
      <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className={`${btn} bg-white/10 hover:bg-white/20 disabled:opacity-40`}>{t("pager.next")}</button>
    </nav>
  );
}
