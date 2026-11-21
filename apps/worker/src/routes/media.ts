import { QUIZ_LIMITS } from "@gart/shared";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../middleware/context";
import { recordUsage } from "../repositories/usage";
import { sha256Hex, randomId } from "../security/tokens";

/** Image type by magic bytes. The declared Content-Type is never trusted. */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const mediaRoutes = new Hono<AppEnv>();

/** Public read: players and projector screens load images without signing in. IDs are 122-bit random. */
mediaRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID_PATTERN.test(id)) return c.json({ error: "not_found" }, 404);
  const etag = `"${id}"`;
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" } });
  const row = await c.env.DB.prepare("SELECT mime, data FROM uploaded_media WHERE id = ?").bind(id).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

// Everything registered below this line requires a session (Hono applies middleware in registration order).
mediaRoutes.use("*", requireAuth);

mediaRoutes.post("/", async (c) => {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared <= 0) return c.json({ error: "length_required" }, 411);
  if (declared > QUIZ_LIMITS.imageMaxBytes) return c.json({ error: "image_too_large" }, 413);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.length === 0 || buf.length > QUIZ_LIMITS.imageMaxBytes) return c.json({ error: "image_too_large" }, 413);
  const mime = sniffImage(buf);
  if (!mime) return c.json({ error: "unsupported_image" }, 415);

  const sha = await sha256Hex(buf);
  const existing = await c.env.DB.prepare("SELECT id FROM uploaded_media WHERE sha256 = ? AND bytes = ? LIMIT 1").bind(sha, buf.length).first<{ id: string }>();
  if (existing) return c.json({ id: existing.id, mime, bytes: buf.length, reused: true });

  const total = (await c.env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM uploaded_media").first<{ n: number }>())?.n ?? 0;
  if (total + buf.length > QUIZ_LIMITS.mediaTotalMaxBytes) return c.json({ error: "media_quota" }, 409);

  const id = randomId();
  await c.env.DB.prepare("INSERT INTO uploaded_media (id, mime, bytes, sha256, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, mime, buf.length, sha, buf, c.get("auth").adminId).run();
  await recordUsage(c.env.DB, { uploads: 1, upload_bytes: buf.length });
  return c.json({ id, mime, bytes: buf.length, reused: false }, 201);
});
