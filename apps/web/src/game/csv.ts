const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ё: "io",
};

/** ASCII-only file name: some browsers drop a download name that has non-Latin letters. */
export function safeFileName(title: string, fallback: string): string {
  const latin = [...title.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");
  return latin.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || fallback;
}

/** Spreadsheet-safe CSV: a leading = + - @ would be run as a formula by Excel, so it is neutralised. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
