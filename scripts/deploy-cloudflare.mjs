#!/usr/bin/env node
// Deploy used by Cloudflare Workers Builds (and runnable by hand): apply database migrations, then publish the Worker.
// Order matters: new code may need the new tables, so a failed migration stops everything before the code changes.
// Secrets are never passed here: the ones set by the installer stay in place across deploys.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderTemplate } from "../installer/lib/util.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = join(root, "apps", "worker", "wrangler.jsonc");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

function fail(message) {
  console.error(`\nDeploy stopped: ${message}`);
  process.exit(1);
}
function wr(args, label) {
  console.log(`\n> ${label}`);
  const r = spawnSync(process.execPath, [wrangler, ...args], { cwd: join(root, "apps", "worker"), stdio: "inherit", env: process.env });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status ?? "signal"}). Nothing further was changed.`);
}

// The Cloudflare resource names/ids come from build variables (Settings -> Builds -> Variables), so the repository
// never contains anything specific to one installation. A local wrangler.jsonc (made by the desktop installer) wins.
if (!existsSync(config)) {
  const { GART_WORKER_NAME: workerName, GART_D1_NAME: d1Name, GART_D1_ID: d1Id } = process.env;
  const missing = ["GART_WORKER_NAME", "GART_D1_NAME", "GART_D1_ID"].filter((k) => !process.env[k]);
  if (missing.length) fail(`build variable(s) ${missing.join(", ")} not set. Add them in Cloudflare: Workers & Pages -> your Worker -> Settings -> Builds -> Variables (see the update guide).`);
  const safe = /^[A-Za-z0-9._-]+$/;
  if (![workerName, d1Name, d1Id].every((v) => safe.test(v))) fail("a GART_* build variable contains characters that are not allowed (letters, digits, dot, dash, underscore only).");
  const template = readFileSync(join(root, "apps", "worker", "wrangler.template.jsonc"), "utf8");
  writeFileSync(config, renderTemplate(template, { WORKER_NAME: workerName, D1_NAME: d1Name, D1_ID: d1Id }));
  console.log(`Generated wrangler config for Worker "${workerName}" from build variables.`);
}
if (!existsSync(join(root, "apps", "web", "dist", "index.html"))) fail("the web app is not built. Run `npm run build` first (the build command should be `npm ci && npm run check`).");
if (!existsSync(wrangler)) fail("dependencies are not installed. Run `npm ci` first.");

console.log(`Gart ${version}: applying database migrations, then deploying.`);
wr(["d1", "migrations", "apply", "DB", "--remote", "--force", "-c", config], "wrangler d1 migrations apply DB --remote");
wr(["deploy", "-c", config], "wrangler deploy");
console.log(`\nGart ${version} is deployed.`);
