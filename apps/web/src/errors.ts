import type { MessageKey } from "./i18n";
import { ApiError } from "./api";

const KNOWN = new Set([
  "invalid_credentials", "rate_limited", "network", "forbidden", "forbidden_self", "email_taken", "invalid_email",
  "invalid_display_name", "weak_password", "last_owner", "not_found", "unauthorized", "server_misconfigured",
  "limit_reached", "unknown_media", "unsupported_image", "image_too_large", "media_quota", "invalid_settings", "unknown_template", "not_playable", "invalid_order",
  "too_many_games", "invalid_thresholds", "quota_risk", "quiz_not_active", "game_over", "csrf_rejected", "invalid_request", "invalid_json", "payload_too_large",
]);

/** Maps an API failure to a translation key; unknown codes fall back to a generic message. */
export function errorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "network";
  return (KNOWN.has(code) ? `err.${code}` : "err.generic") as MessageKey;
}

export function problemKeys(e: unknown): MessageKey[] {
  if (!(e instanceof ApiError)) return [];
  return e.problems.map((p) => `pw.${p}` as MessageKey);
}
