#!/usr/bin/env node
// Builds the single-file web installer HTML (inline script and style). The text still contains the
// placeholders __NONCE__ and __GART_CONFIG__; the bootstrap Worker fills them in after checking the signature.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "apps/installer-web");

export async function buildInstallerHtml() {
  const out = await build({ entryPoints: [join(dir, "src/main.js")], bundle: true, minify: true, format: "iife", target: "es2022", write: false, legalComments: "none" });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const css = readFileSync(join(dir, "src/style.css"), "utf8").replace(/\s*\n\s*/g, "");
  return readFileSync(join(dir, "index.html"), "utf8").replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => js);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = await buildInstallerHtml();
  const file = process.argv[2] ? resolve(process.argv[2]) : join(root, "package-out", "installer.html");
  writeFileSync(file, html);
  console.log(`${file}: ${(html.length / 1024).toFixed(0)} KB`);
}
