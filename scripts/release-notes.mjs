#!/usr/bin/env node
// Prints the CHANGELOG entry of a version (used for the GitHub Release text).   node scripts/release-notes.mjs 0.8.1
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) { console.error("Usage: node scripts/release-notes.mjs <version>"); process.exit(1); }
const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const start = text.indexOf(`## [${version}]`);
if (start < 0) { console.error(`CHANGELOG.md has no entry for ${version}`); process.exit(1); }
const next = text.indexOf("\n## [", start + 5);
console.log(text.slice(start, next < 0 ? undefined : next).trim());
