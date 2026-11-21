import { MAX_NICKNAME_LENGTH_HARD } from "./limits";

export interface NicknameRules {
  minLength: number;
  maxLength: number;
}

export const DEFAULT_NICKNAME_RULES: NicknameRules = { minLength: 2, maxLength: 20 };

export type NicknameResult =
  | { ok: true; nickname: string; key: string }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "invalid_chars" };

// Letters/digits first, then letters, digits, single spaces and . _ ' -
const ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u;

/**
 * Validates and normalises a participant nickname.
 * `key` is the case/width-insensitive form used for duplicate detection within one game.
 */
export function validateNickname(
  raw: string,
  rules: NicknameRules = DEFAULT_NICKNAME_RULES,
): NicknameResult {
  const nickname = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (nickname.length === 0) return { ok: false, reason: "empty" };

  const length = [...nickname].length;
  const max = Math.min(rules.maxLength, MAX_NICKNAME_LENGTH_HARD);
  if (length < rules.minLength) return { ok: false, reason: "too_short" };
  if (length > max) return { ok: false, reason: "too_long" };
  if (!ALLOWED.test(nickname)) return { ok: false, reason: "invalid_chars" };

  return { ok: true, nickname, key: nickname.normalize("NFKC").toLowerCase() };
}
