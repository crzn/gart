import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Every place the version number is written. They must all agree before anything is published. */
export function readVersions(root) {
  const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8")).version;
  const grep = (p, re) => readFileSync(join(root, p), "utf8").match(re)?.[1] ?? null;
  return {
    "package.json": json("package.json"),
    "apps/web/package.json": json("apps/web/package.json"),
    "apps/worker/package.json": json("apps/worker/package.json"),
    "packages/shared/package.json": json("packages/shared/package.json"),
    "apps/worker/src/env.ts": grep("apps/worker/src/env.ts", /APP_VERSION\s*=\s*"([^"]+)"/),
    "installer/lib/jobs.mjs": grep("installer/lib/jobs.mjs", /version = "([^"]+)"/),
    "installer/install.mjs": grep("installer/install.mjs", /"(\d+\.\d+\.\d+)"/),
  };
}

export function versionProblems(versions, changelog) {
  const problems = [];
  const distinct = [...new Set(Object.values(versions))];
  if (distinct.length !== 1) problems.push(`versions differ: ${Object.entries(versions).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const v = versions["package.json"];
  if (!new RegExp(`^## \\[${v.replace(/\./g, "\\.")}\\]`, "m").test(changelog)) problems.push(`CHANGELOG.md has no entry for ${v}`);
  return problems;
}

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bghp_[A-Za-z0-9]{30,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/, "GitHub token"],
  [/\bcf(?:ut|at)_[A-Za-z0-9]{20,}\b/, "Cloudflare token"],
  [/"crv"\s*:\s*"P-256"[^{}]*"d"\s*:\s*"[\w-]{30,}"|"d"\s*:\s*"[\w-]{30,}"[^{}]*"crv"\s*:\s*"P-256"/, "private signing key (JWK)"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/, "Anthropic key"],
  [/CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{25,}/, "Cloudflare API token"],
  [/(?:WS_TICKET_SECRET|SETUP_TOKEN|KDF_ITERATIONS_SECRET)\s*[=:]\s*["']?(?!local-dev|change-me|example|<)[A-Za-z0-9_\-+/=]{24,}/, "application secret"],
];
const NEVER_PUBLISH = [/(^|\/)\.dev\.vars$/, /(^|\/)\.gart(\/|$)/, /(^|\/)\.quizlab(\/|$)/, /(^|\/)backups(\/|$)/, /(^|\/)node_modules(\/|$)/, /\.log$/];

/** Findings for a list of files (relative paths). Returns [] when clean. */
export function scanFiles(root, files) {
  const out = [];
  for (const f of files) {
    if (NEVER_PUBLISH.some((re) => re.test(f))) { out.push(`${f}: must never be published`); continue; }
    const p = join(root, f);
    if (!existsSync(p) || statSync(p).size > 2_000_000) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue; // binary
    const text = buf.toString("utf8");
    for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) out.push(`${f}: looks like a ${what}`);
  }
  return out;
}

export function listFiles(root, skip = new Set(["node_modules", "dist", ".wrangler", ".git", ".gart", ".quizlab", "backups"])) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name) || name === ".dev.vars" || name.endsWith(".log")) continue; // git-ignored, never part of a publish
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else out.push(relative(root, p).split("\\").join("/"));
    }
  };
  walk(root);
  return out.sort();
}
