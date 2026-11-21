// Gart release package: one JSON file that holds everything needed to install or update.
//
//   { format: 1, manifestText: "<JSON text>", signature: "<base64 ECDSA P-256 / SHA-256 over manifestText>",
//     blobs: { "<sha256 hex>": "<base64 of the file>" } }
//
// manifestText is signed as exact text, so nobody has to agree on a canonical JSON form.
// Only WebCrypto is used, so the same code runs in Node, in a Worker and in the browser.

/**
 * @typedef {{ path: string, sha256: string, size: number, contentType: string, cfHash: string }} AssetEntry
 * @typedef {{ name: string, sha256: string, destructive: boolean }} MigrationEntry
 * @typedef {{
 *   format: 1, name: "gart", version: string, commit: string | null, notes: string,
 *   compatibilityDate: string, mainModule: string, worker: { sha256: string, size: number },
 *   assets: AssetEntry[], assetsConfig: { not_found_handling: string, run_worker_first: string[] },
 *   durableObjects: { bindings: { name: string, class_name: string }[], migrations: { tag: string, new_sqlite_classes: string[] }[] },
 *   d1: { binding: string }, secrets: string[], migrations: MigrationEntry[]
 * }} Manifest
 * @typedef {{ format: 1, manifestText: string, signature: string, blobs: Record<string, string> }} GartPackage
 */

const enc = new TextEncoder();
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SIGN = { name: "ECDSA", hash: "SHA-256" };

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @param {string} b64 */
export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
/** @param {Uint8Array | string} data */
export async function sha256Hex(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", /** @type {BufferSource} */ (bytes)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function generateSigningKeyPair() {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  return { privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey), publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}

/** @param {JsonWebKey} privateJwk @param {string} manifestText */
export async function signManifestText(privateJwk, manifestText) {
  const key = await crypto.subtle.importKey("jwk", privateJwk, ECDSA, false, ["sign"]);
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign(SIGN, key, enc.encode(manifestText))));
}

export class PackageError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = "PackageError"; }
}

/**
 * Verifies the signature and every file hash, then returns the manifest. Throws PackageError on any problem:
 * nothing from a package may be used before this succeeds.
 * @param {unknown} pkg @param {JsonWebKey} publicJwk
 * @returns {Promise<Manifest>}
 */
export async function verifyPackage(pkg, publicJwk) {
  if (!pkg || typeof pkg !== "object") throw new PackageError("The package is not valid JSON.");
  const p = /** @type {Partial<GartPackage>} */ (pkg);
  if (p.format !== 1 || typeof p.manifestText !== "string" || typeof p.signature !== "string" || !p.blobs || typeof p.blobs !== "object")
    throw new PackageError("The package has an unknown format.");
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", publicJwk, ECDSA, false, ["verify"]);
    ok = await crypto.subtle.verify(SIGN, key, /** @type {BufferSource} */ (base64ToBytes(p.signature)), enc.encode(p.manifestText));
  } catch {
    ok = false;
  }
  if (!ok) throw new PackageError("The package signature is not valid. Do not install it.");
  /** @type {Manifest} */
  let manifest;
  try { manifest = JSON.parse(p.manifestText); } catch { throw new PackageError("The manifest is not valid JSON."); }
  if (manifest.format !== 1 || manifest.name !== "gart") throw new PackageError("This is not a Gart package.");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new PackageError("The package version is not valid.");
  const wanted = [manifest.worker.sha256, ...manifest.assets.map((a) => a.sha256), ...manifest.migrations.map((m) => m.sha256)];
  for (const hash of new Set(wanted)) {
    const b64 = p.blobs[hash];
    if (typeof b64 !== "string") throw new PackageError(`A file listed in the manifest is missing (${hash.slice(0, 8)}).`);
    if ((await sha256Hex(base64ToBytes(b64))) !== hash) throw new PackageError(`A file was changed after signing (${hash.slice(0, 8)}).`);
  }
  for (const a of manifest.assets) if (!a.path.startsWith("/") || a.path.includes("..")) throw new PackageError(`Unsafe asset path: ${a.path}`);
  return manifest;
}

/** Returns the bytes of a verified blob. @param {GartPackage} pkg @param {string} sha256 */
export function blobBytes(pkg, sha256) {
  const b64 = pkg.blobs[sha256];
  if (b64 === undefined) throw new PackageError("File missing from the package.");
  return base64ToBytes(b64);
}

/** Compares "1.2.3" style versions. Returns -1, 0 or 1. @param {string} a @param {string} b */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX)|ALTER\s+TABLE\s+\S+\s+(DROP|RENAME)|DELETE\s+FROM|TRUNCATE)\b/i;
/** True if a migration contains statements that remove or rename data (the update screen warns about these). @param {string} sql */
export function isDestructiveMigration(sql) {
  return DESTRUCTIVE.test(sql);
}
