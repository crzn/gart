import { GAME_LIMITS, isValidPin } from "@gart/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/context";
import { LIMITS, rlKey } from "../security/rateLimitPolicy";
import { rateLimitHit } from "../services/rateLimit";
import { loadBranding } from "./branding";
import { ACTIVE_STATUSES } from "./games";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * The join link (/play/<PIN>). Messengers and social networks read a link's preview from the page's head without running
 * its scripts, so the Worker serves the normal join page with the quiz title, description and cover added as Open Graph tags.
 * A mistyped or finished game gets the plain page. Only what the join page already shows publicly goes into the tags.
 */
export const shareRoutes = new Hono<AppEnv>();

shareRoutes.get("/:pin", async (c) => {
  const plain = () => c.env.ASSETS.fetch(c.req.raw);
  const pin = c.req.param("pin");
  if (!isValidPin(pin)) return plain();
  const rl = await rateLimitHit(c.env, rlKey.pinLookupIp(c.get("ip")), LIMITS.pinLookupPerIp);
  if (!rl.allowed) return plain();
  const page = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.url)));
  if (!page.ok) return plain();

  const since = new Date(Date.now() - GAME_LIMITS.finishedGraceMs).toISOString();
  const game = await c.env.DB.prepare(
    `SELECT quiz_title, quiz_snapshot_json FROM game_sessions
     WHERE pin = ? AND (status IN (${ACTIVE_STATUSES}) OR (status IN ('FINISHED','CANCELLED') AND finished_at > ?)) LIMIT 1`,
  ).bind(pin, since).first<{ quiz_title: string; quiz_snapshot_json: string }>();
  if (!game) return plain();

  let snap: { description?: string; coverImageId?: string | null } = {};
  try { snap = JSON.parse(game.quiz_snapshot_json) as typeof snap; } catch { /* the title alone is enough */ }
  const branding = await loadBranding(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const imageId = snap.coverImageId || branding.logoMediaId;
  const title = clip(game.quiz_title, 90);
  const description = clip(snap.description?.trim() || branding.tagline || "", 200);
  const tags = [
    ["og:type", "website"],
    ["og:site_name", branding.companyName || "Gart"],
    ["og:title", title],
    ["og:description", description],
    ["og:url", `${origin}/play/${pin}`],
    ["og:locale", "uk_UA"],
    ...(imageId ? [["og:image", `${origin}/api/media/${imageId}`]] : []),
  ].map(([k, v]) => `<meta property="${k}" content="${esc(v ?? "")}" />`);
  tags.push(`<meta name="twitter:card" content="${imageId ? "summary_large_image" : "summary"}" />`, `<meta name="description" content="${esc(description)}" />`);

  const html = (await page.text())
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
  const headers = new Headers(page.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("content-encoding");
  headers.set("Cache-Control", "no-cache");
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, { status: 200, headers });
});
