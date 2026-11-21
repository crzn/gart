// Encrypts a small secret (the Cloudflare API token kept for updates) so it never sits in storage as plain text.
// Key: SHA-256 of the installation's SESSION_SECRET plus a purpose label. AES-GCM with a fresh random IV per message.
const enc = new TextEncoder();

async function key(secret: string, purpose: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}|${purpose}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

export async function seal(secret: string, purpose: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret, purpose), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64(out);
}

/** Returns null if the box was tampered with or the key differs. */
export async function open(secret: string, purpose: string, boxed: string): Promise<string | null> {
  try {
    const all = fromBase64(boxed);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await key(secret, purpose), all.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
