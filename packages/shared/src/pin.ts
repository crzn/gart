import { PIN_LENGTH } from "./limits";

const PIN_SPACE = 10 ** PIN_LENGTH;
// Largest multiple of PIN_SPACE below 2^32, used for rejection sampling (no modulo bias).
const UNBIASED_LIMIT = Math.floor(0x1_0000_0000 / PIN_SPACE) * PIN_SPACE;

export function isValidPin(value: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(value);
}

/** Cryptographically random numeric PIN, zero-padded. */
export function generatePin(
  random: (buf: Uint32Array) => Uint32Array = (buf) => crypto.getRandomValues(buf),
): string {
  const buf = new Uint32Array(1);
  for (;;) {
    random(buf);
    const n = buf[0];
    if (n !== undefined && n < UNBIASED_LIMIT) {
      return String(n % PIN_SPACE).padStart(PIN_LENGTH, "0");
    }
  }
}
