#!/usr/bin/env node
// Mirrors this working tree into a git clone for publishing: node scripts/sync-to-clone.mjs <clone-dir>
// Files that exist only in the clone and belong to the installation (not the source) are protected and never deleted:
// apps/worker/wrangler.jsonc holds the company's Cloudflare resource ids.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles } from "./lib/release-checks.mjs";

const PROTECTED = new Set(["apps/worker/wrangler.jsonc", ".git"]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clone = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(join(clone, ".git"))) { console.error("Usage: node scripts/sync-to-clone.mjs <path to a git clone>"); process.exit(1); }
if (clone === root) { console.error("The clone must be a different directory."); process.exit(1); }

const wanted = new Set(listFiles(root).filter((f) => f !== "apps/worker/wrangler.jsonc"));
const inClone = [];
const walk = (dir) => { for (const n of readdirSync(dir)) { if (n === ".git") continue; const p = join(dir, n); statSync(p).isDirectory() ? walk(p) : inClone.push(relative(clone, p).split("\\").join("/")); } };
walk(clone);
let removed = 0, copied = 0;
for (const f of inClone) if (!wanted.has(f) && !PROTECTED.has(f)) { rmSync(join(clone, f)); removed++; }
for (const f of wanted) { mkdirSync(dirname(join(clone, f)), { recursive: true }); cpSync(join(root, f), join(clone, f)); copied++; }
console.log(`Synced ${copied} files, removed ${removed}. Protected: ${[...PROTECTED].filter((p) => p !== ".git").join(", ")}`);
