import type { MiddlewareHandler } from "hono";
import { checkCsrf } from "../security/csrf";
import type { AppEnv } from "./context";

const MAX_JSON_BYTES = 16 * 1024;

export const apiSecurity: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("ip", c.req.header("cf-connecting-ip") ?? "unknown");

  const csrf = checkCsrf(c.req.method, c.req.raw.headers, new URL(c.req.url));
  if (!csrf.ok) return c.json({ error: "csrf_rejected", reason: csrf.reason }, 403);

  // Image uploads have their own, larger cap enforced in the media route.
  const isUpload = c.req.method === "POST" && new URL(c.req.url).pathname === "/api/media";
  const length = Number(c.req.header("content-length") ?? "0");
  if (!isUpload && Number.isFinite(length) && length > MAX_JSON_BYTES) return c.json({ error: "payload_too_large" }, 413);

  await next();
  // Routes that opt in to caching (public images, branding) set their own Cache-Control first.
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
};
