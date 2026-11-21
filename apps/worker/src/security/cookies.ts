export const SESSION_COOKIE_SECURE = "__Host-ql_session";
export const SESSION_COOKIE_PLAIN = "ql_session";

export function isSecureRequest(url: URL): boolean {
  return url.protocol === "https:";
}

/** `__Host-` cookies require Secure, which browsers refuse on plain http (local development). */
export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN;
}

export function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}

export function readSessionToken(header: string | null | undefined, secure: boolean): string | null {
  const v = parseCookies(header).get(sessionCookieName(secure));
  return v && /^[A-Za-z0-9_-]{20,128}$/.test(v) ? v : null;
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  return [
    `${sessionCookieName(secure)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
  ].join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie("", 0, secure);
}
