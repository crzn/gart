import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readVersions, scanFiles, versionProblems } from "./release-checks.mjs";

const repoRoot = join(import.meta.dirname, "..", "..");

describe("version consistency", () => {
  it("every place that writes the version agrees, and the CHANGELOG has the entry", async () => {
    const { readFileSync } = await import("node:fs");
    const v = readVersions(repoRoot);
    expect(versionProblems(v, readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8"))).toEqual([]);
  });
  it("reports differing versions and a missing entry", () => {
    const p = versionProblems({ a: "1.0.0", b: "1.0.1", "package.json": "1.0.0" }, "## [0.9.0]");
    expect(p.join(" ")).toMatch(/differ/);
    expect(p.join(" ")).toMatch(/no entry for 1\.0\.0/);
  });
});

describe("scanFiles", () => {
  const withFiles = (files) => {
    const root = mkdtempSync(join(tmpdir(), "gart-scan-"));
    for (const [name, text] of Object.entries(files)) { mkdirSync(join(root, name, ".."), { recursive: true }); writeFileSync(join(root, name), text); }
    return root;
  };
  it("flags tokens, keys and private files", () => {
    const root = withFiles({
      "a.txt": "x ghp_" + "a".repeat(36),
      "b.txt": "-----BEGIN " + "PRIVATE KEY-----\nabc",
      "c.txt": "CLOUDFLARE_API_TOKEN=" + "A1".repeat(20),
      "d.txt": "WS_TICKET_SECRET=" + "q".repeat(40),
      "apps/worker/.dev.vars": "anything",
    });
    const found = scanFiles(root, ["a.txt", "b.txt", "c.txt", "d.txt", "apps/worker/.dev.vars"]);
    expect(found).toHaveLength(5);
    rmSync(root, { recursive: true, force: true });
  });
  it("flags a private signing key but not the public half", () => {
    const priv = '{"kty":"EC","x":"' + "a".repeat(43) + '","y":"' + "b".repeat(43) + '","crv":"P-256","d":"' + "c".repeat(43) + '"}';
    const pub = '{"kty":"EC","x":"' + "a".repeat(43) + '","y":"' + "b".repeat(43) + '","crv":"P-256"}';
    const root = withFiles({ "k.json": priv, "p.json": pub });
    expect(scanFiles(root, ["k.json"])).toHaveLength(1);
    expect(scanFiles(root, ["p.json"])).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
  it("accepts the example config and ordinary text", () => {
    const root = withFiles({ "e.txt": "WS_TICKET_SECRET=local-dev-ticket-secret-0123456789abcdef", "f.txt": "hello world" });
    expect(scanFiles(root, ["e.txt", "f.txt"])).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
  it("the repository itself is clean", async () => {
    const { listFiles } = await import("./release-checks.mjs");
    expect(scanFiles(repoRoot, listFiles(repoRoot).filter((f) => f !== "apps/worker/wrangler.jsonc" && !f.endsWith("release-checks.test.mjs")))).toEqual([]);
  });
});
