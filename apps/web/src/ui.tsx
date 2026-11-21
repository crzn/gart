import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

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
        className="w-full rounded-xl border border-surface-border bg-black/20 px-3 py-2.5 text-sm outline-none transition focus:border-brand"
      />
    </div>
  );
}

export function Button({ busy, variant = "primary", children, ...rest }: { busy?: boolean; variant?: "primary" | "ghost" | "danger" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-brand text-white hover:brightness-110",
    ghost: "bg-white/10 hover:bg-white/20",
    danger: "bg-red-500/80 text-white hover:bg-red-500",
  }[variant];
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-2xl bg-red-500/15 p-3 text-sm text-red-200">{children}</p>;
}
