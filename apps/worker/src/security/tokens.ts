import { toBase64Url, toHex, utf8 } from "./encoding";

/** Opaque random token (default 256 bits), URL-safe. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** Keyed hash used to store IP addresses without keeping them readable. */
export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(text))));
}
