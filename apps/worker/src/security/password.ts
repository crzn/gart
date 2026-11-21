import { KDF_ITERATIONS_MAX, KDF_ITERATIONS_MIN } from "@gart/shared";
import { fromBase64Url, timingSafeEqualBytes, toBase64Url, utf8 } from "./encoding";

/**
 * Password hashing with PBKDF2-SHA-256 (Web Crypto). The iteration count is stored with every
 * hash, so it can be raised later without invalidating existing passwords (docs/DECISIONS.md D-003).
 * Cloudflare's runtime rejects counts above 100,000, and the Free plan's 10 ms CPU budget forces a
 * count far below modern recommendations; the installer calibrates it per account.
 */
export interface KdfParams {
  alg: "PBKDF2-SHA256";
  iterations: number;
  /** Length of the derived key in bytes. */
  length: 32;
}

export interface PasswordRecord {
  hash: string;
  salt: string;
  params: KdfParams;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number): Promise<PasswordRecord> {
  if (!Number.isInteger(iterations) || iterations < KDF_ITERATIONS_MIN || iterations > KDF_ITERATIONS_MAX) {
    throw new RangeError("iterations out of range");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return {
    hash: toBase64Url(hash),
    salt: toBase64Url(salt),
    params: { alg: "PBKDF2-SHA256", iterations, length: 32 },
  };
}

export function parseKdfParams(json: string): KdfParams | null {
  try {
    const p = JSON.parse(json) as Partial<KdfParams>;
    if (
      p.alg === "PBKDF2-SHA256" &&
      p.length === 32 &&
      typeof p.iterations === "number" &&
      Number.isInteger(p.iterations) &&
      p.iterations >= 1000 &&
      p.iterations <= KDF_ITERATIONS_MAX
    ) {
      return { alg: p.alg, iterations: p.iterations, length: 32 };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function verifyPassword(
  password: string,
  record: { hash: string; salt: string; kdfParams: string },
): Promise<boolean> {
  const params = parseKdfParams(record.kdfParams);
  if (!params) return false;
  const actual = await derive(password, fromBase64Url(record.salt), params.iterations);
  return timingSafeEqualBytes(actual, fromBase64Url(record.hash));
}

/** Burns about the same time as a real check so unknown accounts are not distinguishable by speed. */
export async function dummyVerify(password: string, iterations: number): Promise<void> {
  await derive(password, new Uint8Array(16), iterations);
}
