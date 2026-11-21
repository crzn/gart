#!/usr/bin/env node
// Builds the signed release package gart-package-<version>.json (see packages/deploy-engine/src/package-format.mjs).
//   node scripts/build-package.mjs [--out <folder>] [--unsigned]
// The private signing key (JWK JSON) comes from the GART_SIGNING_KEY environment variable. Never commit it.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isDestructiveMigration, sha256Hex, signManifestText } from "../packages/deploy-engine/src/package-format.mjs";
import { readVersions } from "./lib/release-checks.mjs";
import { buildInstallerHtml } from "./build-installer-web.mjs";

const { createHash: blake3 } = createRequire(import.meta.url)("blake3-wasm");
/** The hash Cloudflare expects for a static asset: first 32 hex characters of BLAKE3(base64(content) + extension), exactly as wrangler computes it. */
const cloudflareAssetHash = (bytes, path) => blake3().update(Buffer.from(bytes).toString("base64")).update(extname(path).slice(1)).digest("hex").slice(0, 32);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const unsigned = process.argv.includes("--unsigned");
const outDir = resolve(arg("out") ?? join(root, "package-out"));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".map": "application/json" };

/** wrangler.template.jsonc has only whole-line // comments. */
function readTemplate() {
  const text = readFileSync(join(root, "apps/worker/wrangler.template.jsonc"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  return JSON.parse(text);
}
function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function changelogSection(version) {
  const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const start = text.indexOf(`## [${version}]`);
  if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${version}`);
  const next = text.indexOf("\n## [", start + 5);
  return text.slice(start, next < 0 ? undefined : next).trim();
}

const version = readVersions(root)["package.json"];
const template = readTemplate();

console.log("Building the web app...");
execFileSync("npm", ["run", "build", "-w", "apps/web"], { cwd: root, stdio: "ignore", shell: process.platform === "win32" });
console.log("Bundling the Worker...");
const tmp = mkdtempSync(join(tmpdir(), "gart-bundle-"));
let workerBytes;
try {
  execFileSync(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run", "--minify", "--outdir", tmp, "-c", "wrangler.dev.jsonc"], { cwd: join(root, "apps/worker"), stdio: "ignore", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
  workerBytes = readFileSync(join(tmp, "index.js"));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const blobs = {};
const put = async (bytes) => { const h = await sha256Hex(bytes); blobs[h] = Buffer.from(bytes).toString("base64"); return h; };

const workerSha = await put(workerBytes);
const distDir = join(root, "apps/web/dist");
const assets = [];
for (const file of walk(distDir).sort()) {
  if (extname(file) === ".map") continue;
  const bytes = readFileSync(file);
  const path = "/" + relative(distDir, file).split("\\").join("/");
  assets.push({ path, sha256: await put(bytes), size: bytes.length, contentType: path.endsWith("_headers") ? "text/plain; charset=utf-8" : (TYPES[extname(file)] ?? "application/octet-stream"), cfHash: await cloudflareAssetHash(bytes, path) });
}
const migrations = [];
for (const name of readdirSync(join(root, "migrations")).filter((n) => n.endsWith(".sql")).sort()) {
  const bytes = readFileSync(join(root, "migrations", name));
  migrations.push({ name, sha256: await put(bytes), destructive: isDestructiveMigration(bytes.toString("utf8")) });
}

const manifest = {
  format: 1, name: "gart", version, commit: process.env.GITHUB_SHA ?? null, notes: changelogSection(version),
  compatibilityDate: template.compatibility_date, mainModule: "index.js", worker: { sha256: workerSha, size: workerBytes.length },
  assets, assetsConfig: { not_found_handling: template.assets.not_found_handling, run_worker_first: template.assets.run_worker_first },
  durableObjects: { bindings: template.durable_objects.bindings, migrations: template.migrations },
  d1: { binding: template.d1_databases[0].binding }, secrets: ["SESSION_SECRET", "WS_TICKET_SECRET"], migrations,
};
const manifestText = JSON.stringify(manifest);
let signature = "";
if (!unsigned) {
  if (!process.env.GART_SIGNING_KEY) { console.error("Set GART_SIGNING_KEY (private JWK) or pass --unsigned for a local test package."); process.exit(1); }
  signature = await signManifestText(JSON.parse(process.env.GART_SIGNING_KEY), manifestText);
}
mkdirSync(outDir, { recursive: true });
// The web installer page is signed on its own: the tiny bootstrap Worker checks it before serving it.
const installerHtml = await buildInstallerHtml();
const installerSignature = unsigned ? "" : await signManifestText(JSON.parse(process.env.GART_SIGNING_KEY), installerHtml);
writeFileSync(join(outDir, `gart-installer-${version}.json`), JSON.stringify({ format: 1, version, html: installerHtml, signature: installerSignature }));
const file = join(outDir, `gart-package-${version}.json`);
writeFileSync(file, JSON.stringify({ format: 1, manifestText, signature, blobs }));
console.log(`${file}: ${(statSync(file).size / 1024).toFixed(0)} KB, ${assets.length} assets, ${migrations.length} migrations${unsigned ? " (UNSIGNED, test only)" : ", signed"}`);
