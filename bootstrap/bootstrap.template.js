// Gart bootstrap Worker. Paste this whole file into a new Worker in the Cloudflare dashboard, deploy, and open its address.
// It does three small things and stores nothing:
//   1. serves the Gart installer page, after checking the maintainer's digital signature on it;
//   2. relays the installer's calls to the Cloudflare API (browsers cannot call it directly);
//   3. relays the signed Gart package from the public GitHub release page.
// Your Cloudflare token is typed into the page served by THIS Worker and goes only to Cloudflare.
const REPO = "__REPO__";
const PUBLIC_KEY = __PUBLIC_KEY__;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const download = env.DL_BASE ?? `https://github.com/${REPO}/releases/latest/download`;
    const cloudflare = env.CF_BASE ?? "https://api.cloudflare.com/client/v4";

    if (url.pathname === "/" && request.method === "GET") return installerPage(download);
    if (url.pathname === "/pkg" && request.method === "GET") return relayPackage(download);
    if (url.pathname.startsWith("/cf/")) return relayCloudflare(request, url, cloudflare);
    return new Response("Not found", { status: 404 });
  },
};

async function installerPage(download) {
  let signed;
  try {
    const res = await fetch(`${download}/gart-installer.json`, { cf: { cacheTtl: 300 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    signed = await res.json();
  } catch (e) {
    return plain(`Could not download the installer from GitHub (${e.message}). Check that the release exists and try again in a minute.`, 502);
  }
  const ok = await verify(signed.html, signed.signature);
  if (!ok) return plain("The installer page failed its signature check, so it was not served. Do not continue; report this to the Gart maintainers.", 502);
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = signed.html.replaceAll("__NONCE__", nonce).replace("__GART_CONFIG__", JSON.stringify({ key: PUBLIC_KEY, repo: REPO }).replace(/</g, "\\u003c"));
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self' https:; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}

async function verify(text, signatureB64) {
  try {
    const key = await crypto.subtle.importKey("jwk", PUBLIC_KEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, new TextEncoder().encode(text));
  } catch { return false; }
}

async function relayPackage(download) {
  const res = await fetch(`${download}/gart-package.json`, { redirect: "follow", cf: { cacheTtl: 300 } });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

const CF_PATHS = [/^\/accounts(\/|$)/, /^\/zones(\/|$)/, /^\/user\/tokens\/verify$/];
async function relayCloudflare(request, url, base) {
  // Only the installer page of this very Worker may use the relay (browsers always send this header).
  if (request.headers.get("sec-fetch-site") !== "same-origin") return plain("Forbidden", 403);
  if (!["GET", "POST", "PUT"].includes(request.method)) return plain("Method not allowed", 405);
  const path = url.pathname.slice(3);
  if (!CF_PATHS.some((re) => re.test(path))) return plain("Not allowed", 403);
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "cloudflare-workers-script-api-date"]) { const v = request.headers.get(name); if (v) headers.set(name, v); }
  const res = await fetch(base + path + url.search, { method: request.method, headers, body: request.method === "GET" ? undefined : request.body, redirect: "manual" });
  return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}

const plain = (text, status) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
