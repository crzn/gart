#!/usr/bin/env node
// Gart installer entry point. Shared by install.sh (macOS/Linux) and install.ps1 (Windows).
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./lib/server.mjs";
import { nodeVersionOk } from "./lib/util.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.10.0";

if (!nodeVersionOk(process.versions.node)) {
  console.error(`Node.js ${process.versions.node} is too old. Install Node.js 22.12 or newer from https://nodejs.org`);
  process.exit(1);
}

const noOpen = process.argv.includes("--no-open");
const portArg = process.argv.find((a) => a.startsWith("--port="));
const port = portArg ? Number.parseInt(portArg.slice(7), 10) : 0;

const { url, server } = await startServer({ repoRoot, port: Number.isFinite(port) ? port : 0, version });

console.log("");
console.log("  Gart installer is running (local only, nothing is sent anywhere except to Cloudflare).");
console.log("");
console.log("  Open this link in your browser:");
console.log(`  ${url}`);
console.log("");
console.log("  Press Ctrl+C to stop the installer when you are done.");
console.log("");

if (!noOpen) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening a browser is a convenience only; the link above always works.
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
