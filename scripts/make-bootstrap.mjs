#!/usr/bin/env node
// Writes the ready-to-paste bootstrap Worker (site/bootstrap.js) with the repository and the public signing key filled in.
//   node scripts/make-bootstrap.mjs [--out site/bootstrap.js] [--repo owner/name] [--key-file key.json]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const cfg = JSON.parse(readFileSync(join(root, "config/release.json"), "utf8"));
const repo = arg("repo") ?? cfg.repo;
const key = arg("key-file") ? JSON.parse(readFileSync(resolve(arg("key-file")), "utf8")) : cfg.publicKey;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error("config/release.json: repo must look like owner/name"); process.exit(1); }
if (!key || key.kty !== "EC" || key.crv !== "P-256" || key.d) { console.error("config/release.json: publicKey must be a public ECDSA P-256 key (JWK) without the private part"); process.exit(1); }
const pub = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
const out = resolve(arg("out") ?? join(root, "site/bootstrap.js"));
const text = readFileSync(join(root, "bootstrap/bootstrap.template.js"), "utf8").replace("__REPO__", repo).replace("__PUBLIC_KEY__", JSON.stringify(pub));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`${out} (${text.length} bytes) for ${repo}`);
