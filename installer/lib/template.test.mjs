import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderTemplate } from "./util.mjs";

const root = join(import.meta.dirname, "..", "..");

describe("wrangler.template.jsonc", () => {
  it("renders completely with exactly the values the installer supplies", () => {
    const text = readFileSync(join(root, "apps", "worker", "wrangler.template.jsonc"), "utf8");
    const out = renderTemplate(text, { WORKER_NAME: "acme-quiz", D1_NAME: "acme-quiz-db", D1_ID: "id-123" });
    expect(out).toContain('"name": "acme-quiz"');
    expect(out).toContain('"database_id": "id-123"');
    expect(out).not.toMatch(/__[A-Z0-9_]+__/);
  });

  it("declares SQLite-backed Durable Objects only and no R2 or paid-only bindings", () => {
    const text = readFileSync(join(root, "apps", "worker", "wrangler.template.jsonc"), "utf8");
    expect(text).toContain("new_sqlite_classes");
    expect(text).not.toContain("new_classes");
    expect(text).not.toMatch(/r2_buckets|queues|vectorize|containers|"kv_namespaces"/);
  });
});
