// Branding values applied at install time. Same rules as installer/lib/util.mjs (a test keeps the two in step).
const COMPANY_RE = /^[\p{L}\p{N} .,&'()-]{0,60}$/u;

/** @param {unknown} value @returns {string | null} */
export function sanitizeCompanyName(value) {
  const v = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  return COMPANY_RE.test(v) ? v : null;
}
/** @param {unknown} value */
export function isHexColor(value) { return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value); }

/** The only SQL generated from user input; inputs are validated first. @param {string} companyName @param {string} primaryColor */
export function brandingSql(companyName, primaryColor) {
  const name = sanitizeCompanyName(companyName);
  if (name === null) throw new Error("Company name contains unsupported characters or is too long.");
  if (!isHexColor(primaryColor)) throw new Error("Primary colour must look like #4f46e5.");
  const lit = (/** @type {string} */ s) => `'${s.replace(/'/g, "''")}'`;
  return (
    `UPDATE application_settings SET value_json = json_set(value_json, '$.companyName', ${lit(name)}, ` +
    `'$.primaryColor', ${lit(primaryColor.toLowerCase())}), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ` +
    `WHERE key = 'branding'`
  );
}
