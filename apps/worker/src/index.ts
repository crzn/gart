import { Hono } from "hono";
import { apiSecurity } from "./middleware/security";
import type { AppEnv } from "./middleware/context";
import { APP_VERSION } from "./env";
import { adminRoutes } from "./routes/admins";
import { authRoutes } from "./routes/auth";
import { brandingRoutes } from "./routes/branding";
import { updateRoutes } from "./routes/updates";
import { usageRoutes } from "./routes/usage";
import { gameRoutes } from "./routes/games";
import { mediaRoutes } from "./routes/media";
import { quizRoutes } from "./routes/quizzes";
import { setupRoutes } from "./routes/setup";
import { wsRoutes } from "./routes/ws";

export { GameRoom } from "./GameRoom";
export { RateLimiter } from "./durable/RateLimiter";
export { Updater } from "./durable/Updater";

const app = new Hono<AppEnv>();

app.use("/api/*", apiSecurity);

/** Liveness + dependency check used by the installer and the admin status card. */
app.get("/api/health", async (c) => {
  let dbOk = false;
  let schemaReady = false;
  try {
    await c.env.DB.prepare("SELECT 1").first();
    dbOk = true;
    await c.env.DB.prepare("SELECT key FROM application_settings LIMIT 1").first();
    schemaReady = true;
  } catch {
    // Errors are intentionally not echoed to clients; dbOk/schemaReady tell the story.
  }
  const status = dbOk && schemaReady ? "ok" : "degraded";
  // Public and harmless: lets the web installer (another address) see that the new site is alive and which version runs.
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({ status, version: APP_VERSION, db: { ok: dbOk, schemaReady }, time: Date.now() }, status === "ok" ? 200 : 503);
});

/** Round-trips a WebSocket through a Durable Object. Used by installer health checks. */
app.get("/api/health/ws", (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "websocket_required" }, 426);
  }
  const stub = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName("__health__"));
  return stub.fetch(c.req.raw);
});

app.route("/api/setup", setupRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/admins", adminRoutes);
app.route("/api/quizzes", quizRoutes);
app.route("/api/branding", brandingRoutes);
app.route("/api/games", gameRoutes);
app.route("/api/usage", usageRoutes);
app.route("/api/updates", updateRoutes);
app.route("/api/media", mediaRoutes);

// Live games. The route applies the client IP (normally set by the /api security middleware).
app.use("/ws/*", async (c, next) => {
  c.set("ip", c.req.header("cf-connecting-ip") ?? "unknown");
  await next();
});
app.route("/ws", wsRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  console.error("unhandled_error", err instanceof Error ? err.message : "unknown");
  return c.json({ error: "internal_error" }, 500);
});

export default app;
