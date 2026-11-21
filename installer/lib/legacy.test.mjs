import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adoptLegacyStateDir, readState } from "./jobs.mjs";

describe("adoptLegacyStateDir", () => {
  it("moves the pre-rename .quizlab state so an existing install keeps its worker name", () => {
    const root = mkdtempSync(join(tmpdir(), "gart-legacy-"));
    mkdirSync(join(root, ".quizlab"));
    writeFileSync(join(root, ".quizlab", "install.json"), JSON.stringify({ workerName: "legacy-worker", d1Name: "legacy-worker-db" }));
    expect(adoptLegacyStateDir(root)).toBe(true);
    expect(existsSync(join(root, ".quizlab"))).toBe(false);
    expect(readState(root)).toMatchObject({ workerName: "legacy-worker", d1Name: "legacy-worker-db" });
    rmSync(root, { recursive: true, force: true });
  });
  it("does nothing when the new folder already exists or there is no old one", () => {
    const root = mkdtempSync(join(tmpdir(), "gart-legacy-"));
    expect(adoptLegacyStateDir(root)).toBe(false);
    mkdirSync(join(root, ".gart")); mkdirSync(join(root, ".quizlab"));
    writeFileSync(join(root, ".gart", "install.json"), "{}");
    expect(adoptLegacyStateDir(root)).toBe(false);
    expect(existsSync(join(root, ".quizlab"))).toBe(true);
    expect(readFileSync(join(root, ".gart", "install.json"), "utf8")).toBe("{}");
    rmSync(root, { recursive: true, force: true });
  });
});
