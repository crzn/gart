#!/usr/bin/env node
// Run before every publish to GitHub: versions agree, CHANGELOG is written, no secrets or private files are included.
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listFiles, readVersions, scanFiles, versionProblems } from "./lib/release-checks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versions = readVersions(root);
const problems = [
  ...versionProblems(versions, readFileSync(resolve(root, "CHANGELOG.md"), "utf8")),
  ...scanFiles(root, listFiles(root).filter((f) => f !== "apps/worker/wrangler.jsonc")),
];
if (problems.length) {
  console.error("Not ready to publish:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`Ready to publish version ${versions["package.json"]}.`);
