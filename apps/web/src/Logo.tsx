import { Link } from "react-router-dom";
import { useBranding } from "./branding";
import { useLang } from "./i18n";
import { mediaUrl } from "./image";

/** "ГАРТ" in Unbounded Black, converted to outlines so no web font has to be loaded (the CSP only allows our own fonts). */
const WORDMARK_PATH =
  "M660 -750V-520H318V0H60V-750Z " +
  "M1351 -750 1680 0H1405L1354 -126H1004L953 0H678L1007 -750ZM1270 -331 1179 -555 1088 -331Z " +
  "M2174 -750Q2276 -750 2348.5 -716.5Q2421 -683 2459 -621.5Q2497 -560 2497 -477Q2497 -394 2459 -332.5Q2421 -271 2348.5 -237.5Q2276 -204 2174 -204H1995V0H1737V-750ZM1995 -405H2157Q2195 -405 2216 -424Q2237 -443 2237 -477Q2237 -512 2216 -530.5Q2195 -549 2157 -549H1995Z " +
  "M2535 -750H3333V-520H3063V0H2805V-520H2535Z";

function Chevrons() {
  return (
    <>
      <path d="M12 88 L50 62 L88 88" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="13" />
      <path d="M12 62 L50 36 L88 62" fill="none" stroke="currentColor" strokeOpacity="0.7" strokeWidth="13" />
      <path d="M12 36 L50 10 L88 36" fill="none" stroke="currentColor" strokeWidth="13" />
    </>
  );
}

/** The mark alone: three rising chevrons (rank stripes and learning levels). Takes its colour from the text colour. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Гарт" style={{ color: "var(--brand)" }}>
      <Chevrons />
    </svg>
  );
}

/** The full logo: chevrons plus the ГАРТ wordmark. */
export function LogoLockup({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 395 100" className={className} role="img" aria-label="Гарт" style={{ color: "var(--brand)" }}>
      <Chevrons />
      <path d={WORDMARK_PATH} fill="currentColor" transform="translate(124 81) scale(0.0827) translate(-60 0)" />
    </svg>
  );
}

/**
 * The brand shown in headers and on the projector. By default the Гарт logo; an uploaded custom logo
 * (Settings → Branding) replaces it. The optional company name sits next to either one.
 */
export function BrandLogo({ size = "md", big = false, to, newTab = false }: { size?: "sm" | "md"; big?: boolean; to?: string | undefined; newTab?: boolean }) {
  const { branding: b } = useBranding();
  const { t } = useLang();
  const h = big ? "h-[7vmin]" : size === "sm" ? "h-8" : "h-10";
  const body = (
    <div className="flex items-center gap-3">
      {b.logoMediaId
        ? <img src={mediaUrl(b.logoMediaId)} alt={b.companyName || "Гарт"} className={`${h} w-auto max-w-[60vw] object-contain`} />
        : <LogoLockup className={`${h} w-auto`} />}
      {b.companyName ? (
        <span className={`border-l border-surface-border pl-3 font-semibold ${big ? "text-[3.2vmin]" : "text-base"}`}>{b.companyName}</span>
      ) : null}
    </div>
  );
  // A link to the showcase: on every screen where the logo is shown to an administrator or an editor.
  if (!to) return body;
  return (
    <Link to={to} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener" : undefined} aria-label={t("showcase.title")} className="rounded-xl hover:opacity-90">
      {body}
    </Link>
  );
}
