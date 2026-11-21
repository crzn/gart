#!/usr/bin/env node
// Builds the GitHub Pages microsite into site-out/: the page plus the ready-to-paste bootstrap Worker.
import { copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site-out");
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, [join(root, "scripts/make-bootstrap.mjs"), "--out", join(out, "bootstrap.js")], { stdio: "inherit" });
copyFileSync(join(root, "site/index.html"), join(out, "index.html"));
console.log(`Site built in ${out}`);
