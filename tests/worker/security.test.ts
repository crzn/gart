import { describe, expect, it } from "vitest";
import { fromBase64Url, timingSafeEqualText, toBase64Url } from "../../apps/worker/src/security/encoding";
import { hashPassword, parseKdfParams, verifyPassword, dummyVerify } from "../../apps/worker/src/security/password";
import { randomToken, sha256Hex, hmacHex } from "../../apps/worker/src/security/tokens";
import {
  clearedSessionCookie, parseCookies, readSessionToken, sessionCookie, sessionCookieName,
} from "../../apps/worker/src/security/cookies";
import { checkCsrf } from "../../apps/worker/src/security/csrf";
import {
  SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_TOUCH_INTERVAL_MS, isSessionValid, newSessionTimes, touchSession,
} from "../../apps/worker/src/security/sessionTimes";
import { LIMITS, decide } from "../../apps/worker/src/security/rateLimitPolicy";

const rec = (r: Awaited<ReturnType<typeof hashPassword>>) => ({ hash: r.hash, salt: r.salt, kdfParams: JSON.stringify(r.params) });

describe("encoding", () => {
  it("round-trips base64url and compares text in constant-time style", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
    expect(timingSafeEqualText("abc", "abc")).toBe(true);
    expect(timingSafeEqualText("abc", "abd")).toBe(false);
    expect(timingSafeEqualText("abc", "abcd")).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects wrong ones", async () => {
    const r = await hashPassword("correct horse battery staple", 5000);
    expect(await verifyPassword("correct horse battery staple", rec(r))).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", rec(r))).toBe(false);
    expect(await verifyPassword("", rec(r))).toBe(false);
  });

  it("uses a fresh random salt each time and stores the parameters", async () => {
    const a = await hashPassword("same password here", 5000);
    const b = await hashPassword("same password here", 5000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(a.params).toEqual({ alg: "PBKDF2-SHA256", iterations: 5000, length: 32 });
  });

  it("verifies old hashes with their own iteration count after the setting changes", async () => {
    const old = await hashPassword("legacy password value", 5000);
    const fresh = await hashPassword("legacy password value", 7000);
    expect(await verifyPassword("legacy password value", rec(old))).toBe(true);
    expect(await verifyPassword("legacy password value", rec(fresh))).toBe(true);
  });

  it("normalises Unicode so composed and decomposed forms match", async () => {
    const r = await hashPassword("pássword-longer", 5000); // a + combining acute
    expect(await verifyPassword("pássword-longer", rec(r))).toBe(true);
  });

  it("refuses out-of-range iteration counts and corrupt parameters", async () => {
    await expect(hashPassword("x".repeat(14), 100)).rejects.toThrow(RangeError);
    await expect(hashPassword("x".repeat(14), 100_001)).rejects.toThrow(RangeError);
    expect(parseKdfParams("{bad")).toBeNull();
    expect(parseKdfParams('{"alg":"MD5","iterations":5000,"length":32}')).toBeNull();
    expect(parseKdfParams('{"alg":"PBKDF2-SHA256","iterations":999999,"length":32}')).toBeNull();
    const r = await hashPassword("some password here", 5000);
    expect(await verifyPassword("some password here", { ...rec(r), kdfParams: "garbage" })).toBe(false);
  });

  it("dummyVerify completes without throwing", async () => {
    await expect(dummyVerify("whatever", 5000)).resolves.toBeUndefined();
  });
});

describe("tokens", () => {
  it("creates unique 256-bit URL-safe tokens and stable hashes", async () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hmacHex("k", "1.2.3.4")).toHaveLength(64);
    expect(await hmacHex("k", "1.2.3.4")).not.toBe(await hmacHex("k2", "1.2.3.4"));
  });
});

describe("cookies", () => {
  it("uses the __Host- prefix only over https", () => {
    expect(sessionCookieName(true)).toBe("__Host-ql_session");
    expect(sessionCookieName(false)).toBe("ql_session");
  });

  it("sets HttpOnly, SameSite=Strict and Secure on https", () => {
    const c = sessionCookie("tok", 3600, true);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Secure");
    expect(c).toContain("Path=/");
    expect(c).not.toContain("Domain");
    expect(sessionCookie("tok", 3600, false)).not.toContain("Secure");
    expect(clearedSessionCookie(true)).toContain("Max-Age=0");
  });

  it("parses cookies and ignores malformed or implausible tokens", () => {
    expect(parseCookies("a=1; b=2").get("b")).toBe("2");
    const good = randomToken();
    expect(readSessionToken(`x=1; ql_session=${good}`, false)).toBe(good);
    expect(readSessionToken(`ql_session=${good}`, true)).toBeNull(); // wrong cookie name for https
    expect(readSessionToken("ql_session=short", false)).toBeNull();
    expect(readSessionToken("ql_session=has space and <script>", false)).toBeNull();
    expect(readSessionToken(null, false)).toBeNull();
  });
});

describe("csrf", () => {
  const url = new URL("https://quiz.example.workers.dev/api/auth/login");
  const h = (o: Record<string, string>) => new Headers(o);
  it("lets safe methods through", () => {
    expect(checkCsrf("GET", h({}), url).ok).toBe(true);
  });
  it("requires the custom header on state-changing methods", () => {
    expect(checkCsrf("POST", h({}), url)).toEqual({ ok: false, reason: "missing_header" });
    expect(checkCsrf("DELETE", h({ "x-gart-csrf": "0" }), url).ok).toBe(false);
    expect(checkCsrf("POST", h({ "x-gart-csrf": "1" }), url).ok).toBe(true);
  });
  it("rejects a foreign Origin or a cross-site fetch", () => {
    expect(checkCsrf("POST", h({ "x-gart-csrf": "1", origin: "https://evil.example" }), url)).toEqual({ ok: false, reason: "bad_origin" });
    expect(checkCsrf("POST", h({ "x-gart-csrf": "1", origin: url.origin }), url).ok).toBe(true);
    expect(checkCsrf("POST", h({ "x-gart-csrf": "1", "sec-fetch-site": "cross-site" }), url)).toEqual({ ok: false, reason: "cross_site" });
  });
});

describe("session lifetime", () => {
  const t0 = 1_000_000_000_000;
  it("expires after the idle timeout and never lives past the absolute cap", () => {
    const s = newSessionTimes(t0);
    expect(isSessionValid(s, t0 + SESSION_IDLE_MS - 1)).toBe(true);
    expect(isSessionValid(s, t0 + SESSION_IDLE_MS)).toBe(false);
    const old = { createdAt: t0, lastSeenAt: t0 + SESSION_ABSOLUTE_MS - 1000, expiresAt: t0 + SESSION_ABSOLUTE_MS + 5000 };
    expect(isSessionValid(old, t0 + SESSION_ABSOLUTE_MS + 1)).toBe(false);
  });
  it("writes activity back only after the touch interval and respects the absolute cap", () => {
    const s = newSessionTimes(t0);
    expect(touchSession(s, t0 + SESSION_TOUCH_INTERVAL_MS - 1)).toBeNull();
    const next = touchSession(s, t0 + SESSION_TOUCH_INTERVAL_MS);
    expect(next?.expiresAt).toBe(t0 + SESSION_TOUCH_INTERVAL_MS + SESSION_IDLE_MS);
    const near = { createdAt: t0, lastSeenAt: t0 + SESSION_ABSOLUTE_MS - SESSION_IDLE_MS, expiresAt: t0 + SESSION_ABSOLUTE_MS };
    const capped = touchSession(near, t0 + SESSION_ABSOLUTE_MS - 1000);
    expect(capped?.expiresAt).toBe(t0 + SESSION_ABSOLUTE_MS);
  });
});

describe("rate limit decision", () => {
  const limit = { limit: 3, windowSec: 60 };
  it("allows up to the limit, then blocks with a retry time, then recovers", () => {
    let st: { count: number; windowStart: number } | undefined;
    const now = 5_000_000;
    for (let i = 1; i <= 3; i++) {
      const r = decide(st, now + i, limit);
      expect(r.allowed).toBe(true);
      st = { count: r.count, windowStart: r.windowStart };
    }
    const blocked = decide(st, now + 10_000, limit);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    const later = decide({ count: blocked.count, windowStart: blocked.windowStart }, now + 61_000, limit);
    expect(later.allowed).toBe(true);
    expect(later.count).toBe(1);
  });
  it("login limits are tighter per account than per IP", () => {
    expect(LIMITS.loginPerAccount.limit).toBeLessThan(LIMITS.loginPerIp.limit);
  });
});
