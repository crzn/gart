import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { contrastRatio, DEFAULT_BRANDING, type Branding } from "@gart/shared";
import { api } from "./api";

interface Ctx { branding: Branding; reload(): Promise<void>; set(b: Branding): void }
const BrandingCtx = createContext<Ctx | null>(null);

/** Text colour (near-black or white) that reads best on top of the given colour. */
export function onColor(hex: string): string {
  return contrastRatio(hex, "#0b0b0c") >= contrastRatio(hex, "#ffffff") ? "#0b0b0c" : "#ffffff";
}

function apply(b: Branding): void {
  const s = document.documentElement.style;
  s.setProperty("--brand", b.primaryColor);
  s.setProperty("--brand-2", b.secondaryColor);
  s.setProperty("--bg", b.backgroundColor);
  s.setProperty("--accent", b.accentColor);
  s.setProperty("--on-brand", onColor(b.primaryColor));
  s.setProperty("--bg-image", b.backgroundMediaId ? `url(/api/media/${encodeURIComponent(b.backgroundMediaId)})` : "none");
  document.title = b.companyName ? `${b.companyName} · Гарт` : "Гарт";
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const reload = useCallback(async () => {
    try {
      const { branding: b } = await api<{ branding: Branding }>("/api/branding");
      setBranding(b);
      apply(b);
    } catch {
      // Defaults stay in place if the branding cannot be loaded.
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const set = useCallback((b: Branding) => { setBranding(b); apply(b); }, []);
  const value = useMemo(() => ({ branding, reload, set }), [branding, reload, set]);
  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}

export function useBranding(): Ctx {
  const v = useContext(BrandingCtx);
  if (!v) throw new Error("useBranding outside BrandingProvider");
  return v;
}
