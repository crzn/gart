// Pure helpers for the installer. No I/O here, so everything is unit-testable.
import { randomBytes } from "node:crypto";

export const MIN_NODE = [22, 12, 0];

export function nodeVersionOk(version, min = MIN_NODE) {
  const parts = String(version).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return false;
  for (let i = 0; i < 3; i++) {
    if (parts[i] > min[i]) return true;
    if (parts[i] < min[i]) return false;
  }
  return true;
}

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Worker names become part of the public workers.dev hostname. */
export function validateWorkerName(name) {
  return typeof name === "string" && NAME_RE.test(name);
}

export function validateD1Name(name) {
  return typeof name === "string" && /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(name);
}

export function renderTemplate(text, vars) {
  const out = text.replace(/__([A-Z0-9_]+)__/g, (match, key) => (key in vars ? String(vars[key]) : match));
  const left = out.match(/__[A-Z0-9_]+__/g);
  if (left) throw new Error(`Unresolved template placeholders: ${[...new Set(left)].join(", ")}`);
  return out;
}

export function extractWorkersDevUrl(output) {
  const matches = String(output).match(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev/gi);
  return matches ? matches[matches.length - 1] : null;
}

/** Wrangler may print banners/warnings around JSON; find and parse the JSON payload. */
export function parseJsonFromOutput(output) {
  const text = stripAnsi(String(output)).trim();
  try {
    return JSON.parse(text);
  } catch {
    // fall through to line scan
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].trimStart()[0];
    if (first === "{" || first === "[") {
      try {
        return JSON.parse(lines.slice(i).join("\n"));
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

export function findDatabaseByName(list, name) {
  if (!Array.isArray(list)) return undefined;
  const hit = list.find((d) => d && d.name === name);
  if (!hit) return undefined;
  const id = hit.uuid ?? hit.id;
  return typeof id === "string" ? { id, name: hit.name } : undefined;
}

export function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
export function stripAnsi(text) {
  return String(text).replace(ANSI_RE, "");
}

export function redactText(text, secrets) {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("***");
  return out;
}

/* ---------------- branding applied at install time ---------------- */

const COMPANY_RE = /^[\p{L}\p{N} .,&'()-]{0,60}$/u;

export function sanitizeCompanyName(value) {
  const v = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  return COMPANY_RE.test(v) ? v : null;
}

export function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Builds the only SQL the installer ever generates from user input; inputs are validated first. */
export function brandingSql(companyName, primaryColor) {
  const name = sanitizeCompanyName(companyName);
  if (name === null) throw new Error("Company name contains unsupported characters or is too long.");
  if (!isHexColor(primaryColor)) throw new Error("Primary colour must look like #4f46e5.");
  const lit = (s) => `'${s.replace(/'/g, "''")}'`;
  return (
    `UPDATE application_settings SET value_json = json_set(value_json, '$.companyName', ${lit(name)}, ` +
    `'$.primaryColor', ${lit(primaryColor.toLowerCase())}), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ` +
    `WHERE key = 'branding'`
  );
}

/* ---------------- error diagnostics ---------------- */

/** Maps raw wrangler output to actionable hints. Codes are translated by the wizard UI. */
export function diagnose(output, { accountId } = {}) {
  const text = stripAnsi(String(output));
  const hints = [];
  const add = (code, extra = {}) => hints.push({ code, ...extra });

  if (/register a workers\.dev subdomain|workers\.dev subdomain/i.test(text)) {
    add("subdomain", { link: accountId ? `https://dash.cloudflare.com/${accountId}/workers/onboarding` : "https://dash.cloudflare.com/" });
  }
  if (/not authenticated|wrangler login|authentication error|\[code: 10000\]|Invalid access token/i.test(text)) add("auth");
  if (/EADDRINUSE.*8976|callback server could not bind/i.test(text)) add("loginPort");
  if (/\[code: 10007\]|does not exist on your account/i.test(text)) add("workerMissing");
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(text)) add("network");
  if (/already exists|7502/i.test(text)) add("exists");
  if (/limit of \d+ databases|too many databases|exceeded|quota/i.test(text)) add("limits");
  if (/EACCES|EPERM/i.test(text)) add("permissions");
  return hints;
}

export function lastLines(text, n = 25) {
  return stripAnsi(String(text)).split(/\r?\n/).filter((l) => l.trim()).slice(-n);
}
