import { spawn } from "node:child_process";
import { redactText, stripAnsi } from "./util.mjs";

export const IS_WINDOWS = process.platform === "win32";
export const NPM = IS_WINDOWS ? "npm.cmd" : "npm";

/**
 * Runs a child process, streams cleaned output lines to `onLine`, and always resolves
 * (never rejects) with { code, output }. Secrets listed in `redact` never reach the log.
 * `shell` is only enabled for npm on Windows, where .cmd files require it; all arguments
 * passed that way are fixed strings, never user input.
 */
export function run(command, args, { cwd, env, input, onLine, shell = false, redact = [] } = {}) {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: -1, output: String(err instanceof Error ? err.message : err) });
      return;
    }

    const handle = (chunk) => {
      const text = redactText(stripAnsi(chunk.toString()), redact);
      output += text;
      if (onLine) {
        for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line);
      }
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", (err) => resolve({ code: -1, output: output + String(err.message) }));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));

    // Swallow EPIPE if the process exits before reading stdin.
    child.stdin.on("error", () => {});
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}
