import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, compareVersions, generateSigningKeyPair, isDestructiveMigration, sha256Hex, signManifestText, verifyPackage } from "./package-format.mjs";

async function makePackage(privateJwk, mutate = (m) => m) {
  const worker = new TextEncoder().encode("export default {}");
  const sql = new TextEncoder().encode("CREATE TABLE t (id TEXT);");
  const page = new TextEncoder().encode("<html></html>");
  const [wh, sh, ph] = [await sha256Hex(worker), await sha256Hex(sql), await sha256Hex(page)];
  const manifest = mutate({
    format: 1, name: "gart", version: "1.2.3", commit: null, notes: "n", compatibilityDate: "2026-01-15", mainModule: "index.js",
    worker: { sha256: wh, size: worker.length },
    assets: [{ path: "/index.html", sha256: ph, size: page.length, contentType: "text/html", cfHash: "0123456789abcdef0123456789abcdef" }],
    assetsConfig: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
    durableObjects: { bindings: [], migrations: [] }, d1: { binding: "DB" }, secrets: [], migrations: [{ name: "0001.sql", sha256: sh, destructive: false }],
  });
  const manifestText = JSON.stringify(manifest);
  return { format: 1, manifestText, signature: await signManifestText(privateJwk, manifestText), blobs: { [wh]: bytesToBase64(worker), [sh]: bytesToBase64(sql), [ph]: bytesToBase64(page) } };
}

describe("release package", () => {
  it("accepts a correctly signed package", async () => {
    const { privateJwk, publicJwk } = await generateSigningKeyPair();
    const m = await verifyPackage(await makePackage(privateJwk), publicJwk);
    expect(m.version).toBe("1.2.3");
  });
  it("rejects a package signed with another key", async () => {
    const a = await generateSigningKeyPair(), b = await generateSigningKeyPair();
    await expect(verifyPackage(await makePackage(a.privateJwk), b.publicJwk)).rejects.toThrow(/signature/);
  });
  it("rejects a changed manifest", async () => {
    const { privateJwk, publicJwk } = await generateSigningKeyPair();
    const pkg = await makePackage(privateJwk);
    pkg.manifestText = pkg.manifestText.replace("1.2.3", "9.9.9");
    await expect(verifyPackage(pkg, publicJwk)).rejects.toThrow(/signature/);
  });
  it("rejects a changed file", async () => {
    const { privateJwk, publicJwk } = await generateSigningKeyPair();
    const pkg = await makePackage(privateJwk);
    const key = Object.keys(pkg.blobs)[0];
    pkg.blobs[key] = bytesToBase64(new TextEncoder().encode("evil"));
    await expect(verifyPackage(pkg, publicJwk)).rejects.toThrow(/changed after signing/);
  });
  it("rejects a missing file and unsafe asset paths", async () => {
    const { privateJwk, publicJwk } = await generateSigningKeyPair();
    const pkg = await makePackage(privateJwk);
    delete pkg.blobs[Object.keys(pkg.blobs)[1]];
    await expect(verifyPackage(pkg, publicJwk)).rejects.toThrow(/missing/);
    const bad = await makePackage(privateJwk, (m) => ({ ...m, assets: m.assets.map((a) => ({ ...a, path: "/../x" })) }));
    await expect(verifyPackage(bad, publicJwk)).rejects.toThrow(/Unsafe/);
  });
  it("rejects garbage", async () => {
    const { publicJwk } = await generateSigningKeyPair();
    await expect(verifyPackage(null, publicJwk)).rejects.toThrow();
    await expect(verifyPackage({ format: 2 }, publicJwk)).rejects.toThrow(/format/);
  });
});

describe("helpers", () => {
  it("round-trips base64 including large inputs", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
  it("hashes like sha256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("compares versions numerically", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2.0")).toBe(1);
  });
  it("flags destructive migrations", () => {
    expect(isDestructiveMigration("ALTER TABLE a ADD COLUMN b TEXT;")).toBe(false);
    expect(isDestructiveMigration("DROP TABLE a;")).toBe(true);
    expect(isDestructiveMigration("ALTER TABLE a RENAME TO b;")).toBe(true);
  });
});
