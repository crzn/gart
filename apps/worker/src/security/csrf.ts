/**
 * CSRF defence for state-changing API calls (defence in depth on top of SameSite=Strict):
 *  1. a custom header the browser will not attach to cross-site form posts and which forces a CORS
 *     preflight for cross-origin scripts, and
 *  2. an Origin check when the browser sends one, and
 *  3. Sec-Fetch-Site must not say "cross-site".
 */
export const CSRF_HEADER = "x-gart-csrf";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfResult = { ok: true } | { ok: false; reason: "missing_header" | "bad_origin" | "cross_site" };

export function checkCsrf(method: string, headers: Headers, requestUrl: URL): CsrfResult {
  if (SAFE.has(method.toUpperCase())) return { ok: true };
  if (headers.get(CSRF_HEADER) !== "1") return { ok: false, reason: "missing_header" };
  const origin = headers.get("origin");
  if (origin !== null && origin !== requestUrl.origin) return { ok: false, reason: "bad_origin" };
  if (headers.get("sec-fetch-site") === "cross-site") return { ok: false, reason: "cross_site" };
  return { ok: true };
}
