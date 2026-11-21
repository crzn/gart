import { fromBase64Url, toBase64Url, utf8 } from "./encoding";
import { randomToken } from "./tokens";

/**
 * Short-lived WebSocket tickets for the host and the projector.
 * Format: base64url(JSON payload) "." base64url(HMAC-SHA256 of the payload part).
 * The Durable Object verifies the signature itself, checks expiry and the game id, and burns the
 * nonce so a ticket works once.
 */
export type TicketRole = "host" | "screen";

export interface TicketPayload {
  /** Game id the ticket is valid for. */
  g: string;
  r: TicketRole;
  /** Administrator who asked for it. */
  a: string;
  /** Expiry, epoch ms. */
  e: number;
  /** Single-use nonce. */
  n: string;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signTicket(secret: string, data: Omit<TicketPayload, "n">): Promise<string> {
  const payload: TicketPayload = { ...data, n: randomToken(16) };
  const body = toBase64Url(utf8(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), utf8(body)));
  return `${body}.${toBase64Url(mac)}`;
}

/** Returns the payload when the signature and expiry are valid, otherwise null. */
export async function verifyTicket(secret: string, ticket: string, now: number): Promise<TicketPayload | null> {
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];
  let macBytes: Uint8Array<ArrayBuffer>;
  let payload: unknown;
  try {
    macBytes = fromBase64Url(mac);
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  // crypto.subtle.verify compares in constant time.
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), macBytes, utf8(body)))) return null;
  const p = payload as Partial<TicketPayload>;
  if (typeof p.g !== "string" || typeof p.a !== "string" || typeof p.n !== "string" || typeof p.e !== "number") return null;
  if (p.r !== "host" && p.r !== "screen") return null;
  if (p.e < now) return null;
  return p as TicketPayload;
}
