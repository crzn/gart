#!/usr/bin/env node
// Run ONCE by the maintainer. Creates the key pair that signs release packages.
//   node scripts/generate-signing-key.mjs
// - The PRIVATE key is printed once: store it as the GitHub secret GART_SIGNING_KEY and keep a copy in a password manager.
//   It is never written to a file in this repository.
// - The PUBLIC key is written to config/release.json (commit it); every installed Gart and the bootstrap script trust only it.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSigningKeyPair } from "../packages/deploy-engine/src/package-format.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "config/release.json");
const cfg = JSON.parse(readFileSync(file, "utf8"));
if (cfg.publicKey && !process.argv.includes("--replace")) { console.error("A public key is already set in config/release.json. Replacing it makes every existing installation reject new packages. Add --replace only if you really mean it."); process.exit(1); }
const { privateJwk, publicJwk } = await generateSigningKeyPair();
cfg.publicKey = { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y };
writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log("Public key written to config/release.json (commit it).\n");
console.log("PRIVATE KEY (GitHub secret GART_SIGNING_KEY). Shown only now:\n");
console.log(JSON.stringify(privateJwk));
