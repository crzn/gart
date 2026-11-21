#!/usr/bin/env node
// Builds the release archive gart-<version>.zip from the source tree (after the release checks pass).
//   node scripts/make-package.mjs [output-folder]
// Contains source only: no node_modules, no build output, no private files, no apps/worker/wrangler.jsonc of a real installation.
import { dirname, resolve, join } from "node:path";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { listFiles, readVersions, scanFiles, versionProblems } from "./lib/release-checks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, ".."));
const versions = readVersions(root);
const files = listFiles(root).filter((f) => f !== "apps/worker/wrangler.jsonc");
const problems = [...versionProblems(versions, readFileSync(resolve(root, "CHANGELOG.md"), "utf8")), ...scanFiles(root, files)];
if (problems.length) { console.error("Not ready to package:\n- " + problems.join("\n- ")); process.exit(1); }

const version = versions["package.json"];
const name = `gart-${version}`;
const stage = mkdtempSync(join(tmpdir(), "gart-pack-"));
try {
  for (const f of files) {
    const dest = join(stage, name, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, f), dest);
  }
  mkdirSync(outDir, { recursive: true });
  const zip = join(outDir, `${name}.zip`);
  if (existsSync(zip)) rmSync(zip);
  execFileSync("zip", ["-q", "-r", "-X", zip, name], { cwd: stage });
  console.log(`${zip} (${files.length} files)`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
