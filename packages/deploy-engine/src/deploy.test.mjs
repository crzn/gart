import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeCloudflare } from "../../../tests/fakes/fake-cloudflare.mjs";
import { CloudflareClient, CloudflareError } from "./cloudflare.mjs";
import { deploy, durableObjectMigrations, migrationScript } from "./deploy.mjs";
import { generateSigningKeyPair, verifyPackage } from "./package-format.mjs";

let fake, dir, pkg, manifest;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "gart-engine-"));
  const { privateJwk, publicJwk } = await generateSigningKeyPair();
  execFileSync(process.execPath, ["scripts/build-package.mjs", "--out", dir], { cwd: join(import.meta.dirname, "..", "..", ".."), env: { ...process.env, GART_SIGNING_KEY: JSON.stringify(privateJwk) }, stdio: "ignore" });
  const file = join(dir, "gart-package-" + JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "package.json"), "utf8")).version + ".json");
  pkg = JSON.parse(readFileSync(file, "utf8"));
  manifest = await verifyPackage(pkg, publicJwk);
  fake = await startFakeCloudflare();
}, 180_000);
afterAll(async () => { await fake?.close(); rmSync(dir, { recursive: true, force: true }); });

const client = (token) => new CloudflareClient({ base: fake.url, token: token ?? fake.token });

describe("deploy engine against a fake Cloudflare API", () => {
  it("rejects a wrong token with a readable error", async () => {
    await expect(client("nope").listAccounts()).rejects.toBeInstanceOf(CloudflareError);
  });

  it("installs: database, all migrations, assets in buckets, Worker with secrets, address", async () => {
    const steps = [];
    const r = await deploy({ client: client(), accountId: "acc1", pkg, manifest, workerName: "gart", databaseName: "gart-db", mode: "install", hostname: "quiz.example.com", companyName: "Acme Corp", primaryColor: "#112233", onProgress: (p) => steps.push(`${p.step}:${p.status}`) });
    expect(steps).toContain("worker:done");
    expect(r.setupToken).toMatch(/^[0-9a-f]{48}$/);
    expect(r.migrationsApplied).toEqual(manifest.migrations.map((m) => m.name));
    const w = fake.state.workers.get("gart");
    expect(w.secretNames.sort()).toEqual(["SESSION_SECRET", "SETUP_TOKEN", "WS_TICKET_SECRET"]);
    expect(w.metadata.migrations.new_tag).toBe("v3");
    expect(w.metadata.migrations.steps).toEqual([{ new_sqlite_classes: ["GameRoom"] }, { new_sqlite_classes: ["RateLimiter"] }, { new_sqlite_classes: ["Updater"] }]);
    expect(w.metadata.assets.config.run_worker_first).toEqual(["/api/*", "/ws/*", "/play/*"]);
    expect(w.workersDev).toBe(true);
    expect(w.domain).toBe("quiz.example.com");
    const db = fake.state.databases.get(r.databaseId).db;
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'administrators'").all()).toHaveLength(1);
    const brand = JSON.parse(db.prepare("SELECT value_json FROM application_settings WHERE key = 'branding'").get().value_json);
    expect(brand.companyName).toBe("Acme Corp");
    expect(brand.primaryColor).toBe("#112233");
    expect(db.prepare("SELECT count(*) AS n FROM d1_migrations").get().n).toBe(manifest.migrations.length);
    expect(fake.state.log.filter((l) => l.includes("assets/upload")).length).toBeGreaterThan(1); // several buckets
  });

  it("refuses to install over an existing Worker name", async () => {
    await expect(deploy({ client: client(), accountId: "acc1", pkg, manifest, workerName: "gart", databaseName: "gart-db", mode: "install" })).rejects.toThrow(/already exists/);
  });

  it("updates: keeps secrets, applies only new migrations, records a recovery bookmark, no new Durable Object migration", async () => {
    const r = await deploy({ client: client(), accountId: "acc1", pkg, manifest, workerName: "gart", databaseName: "gart-db", mode: "update" });
    expect(r.setupToken).toBeNull();
    expect(r.migrationsApplied).toEqual([]);
    expect(r.bookmark).toMatch(/^0000/);
    const w = fake.state.workers.get("gart");
    expect(w.metadata.keep_bindings).toContain("secret_text");
    expect(w.metadata.migrations).toBeUndefined();
    expect(w.secretNames).toContain("SESSION_SECRET");
  });

  it("an update does not touch the workers.dev address setting", async () => {
    const before = fake.state.workers.get("gart").workersDev;
    const steps = [];
    await deploy({ client: client(), accountId: "acc1", pkg, manifest, workerName: "gart", databaseName: "gart-db", mode: "update", onProgress: (p) => steps.push(`${p.step}:${p.status}`) });
    expect(fake.state.workers.get("gart").workersDev).toBe(before);
    expect(steps).toContain("address:skipped");
  });

  it("finds the database a Worker is bound to", async () => {
    const found = await client().getWorkerDatabase("acc1", "gart");
    expect(found?.name).toBe("gart-db");
  });

  it("a failing migration stops the update with a clear error", async () => {
    const db = [...fake.state.databases.values()][0].db;
    const last = manifest.migrations[manifest.migrations.length - 1].name;
    db.exec(`DELETE FROM d1_migrations WHERE name = '${last}'`);
    // the migration already ran, so re-running it must fail loudly instead of pretending success
    await expect(deploy({ client: client(), accountId: "acc1", pkg, manifest, workerName: "gart", databaseName: "gart-db", mode: "update" })).rejects.toThrow(/SQL error/);
    db.exec(`INSERT INTO d1_migrations (name) VALUES ('${last}')`);
  });

  it("refuses to update a Worker that does not exist", async () => {
    await expect(deploy({ client: client(), accountId: "acc1", pkg, manifest, workerName: "other", databaseName: "gart-db", mode: "update" })).rejects.toThrow(/no Worker named/);
  });

  it("builds Durable Object migration payloads like wrangler does", () => {
    const all = [{ tag: "v1", new_sqlite_classes: ["A"] }, { tag: "v2", new_sqlite_classes: ["B"] }, { tag: "v3", new_sqlite_classes: ["C"] }];
    expect(durableObjectMigrations(all, null)).toEqual({ new_tag: "v3", steps: [{ new_sqlite_classes: ["A"] }, { new_sqlite_classes: ["B"] }, { new_sqlite_classes: ["C"] }] });
    expect(durableObjectMigrations(all, "v1")).toEqual({ old_tag: "v1", new_tag: "v3", steps: [{ new_sqlite_classes: ["B"] }, { new_sqlite_classes: ["C"] }] });
    expect(durableObjectMigrations(all, "v3")).toBeUndefined();
    expect(durableObjectMigrations([], null)).toBeUndefined();
  });

  it("migration script records itself and escapes names", () => {
    expect(migrationScript("a'b.sql", "SELECT 1;")).toContain("values ('a''b.sql')");
  });
});
