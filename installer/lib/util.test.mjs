import { describe, expect, it } from "vitest";
import {
  brandingSql,
  diagnose,
  extractWorkersDevUrl,
  findDatabaseByName,
  generateSecret,
  nodeVersionOk,
  parseJsonFromOutput,
  redactText,
  renderTemplate,
  sanitizeCompanyName,
  validateD1Name,
  validateWorkerName,
} from "./util.mjs";

describe("nodeVersionOk", () => {
  it("accepts >= 22.12.0 only", () => {
    expect(nodeVersionOk("v22.12.0")).toBe(true);
    expect(nodeVersionOk("22.23.5")).toBe(true);
    expect(nodeVersionOk("v24.0.0")).toBe(true);
    expect(nodeVersionOk("v22.11.9")).toBe(false);
    expect(nodeVersionOk("v20.19.0")).toBe(false);
    expect(nodeVersionOk("garbage")).toBe(false);
  });
});

describe("names", () => {
  it("validates worker and database names", () => {
    expect(validateWorkerName("gart")).toBe(true);
    expect(validateWorkerName("acme-quiz-2")).toBe(true);
    for (const bad of ["", "-x", "x-", "Quiz", "a_b", "a".repeat(41), "a b", "../x"]) {
      expect(validateWorkerName(bad), bad).toBe(false);
    }
    expect(validateD1Name("gart-db")).toBe(true);
    expect(validateD1Name("Bad Name")).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("fills placeholders and refuses to leave any unresolved", () => {
    expect(renderTemplate('{"n":"__A__","d":"__B__"}', { A: "x", B: "y" })).toBe('{"n":"x","d":"y"}');
    expect(() => renderTemplate("__A__ __MISSING__", { A: "x" })).toThrow(/MISSING/);
  });
});

describe("output parsing", () => {
  it("extracts the last workers.dev URL", () => {
    const out = "Uploaded\nDeployed gart triggers\n  https://gart.acme.workers.dev\nCurrent Version ID: x";
    expect(extractWorkersDevUrl(out)).toBe("https://gart.acme.workers.dev");
    expect(extractWorkersDevUrl("nothing here")).toBeNull();
  });

  it("parses JSON surrounded by banners", () => {
    const out = '\u001b[33m▲ WARNING\u001b[0m something\n\n[\n  { "uuid": "abc-1", "name": "db1" }\n]';
    expect(parseJsonFromOutput(out)).toEqual([{ uuid: "abc-1", name: "db1" }]);
    expect(parseJsonFromOutput('{"loggedIn":true}')).toEqual({ loggedIn: true });
    expect(parseJsonFromOutput("no json")).toBeNull();
  });

  it("finds databases by exact name", () => {
    const list = [{ uuid: "1", name: "other" }, { uuid: "2", name: "gart-db" }];
    expect(findDatabaseByName(list, "gart-db")).toEqual({ id: "2", name: "gart-db" });
    expect(findDatabaseByName(list, "gart")).toBeUndefined();
    expect(findDatabaseByName(null, "x")).toBeUndefined();
  });
});

describe("secrets", () => {
  it("generates unique 64-char hex secrets and redacts them from logs", () => {
    const a = generateSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSecret()).not.toBe(a);
    expect(redactText(`token=${a} done`, [a])).toBe("token=*** done");
  });
});

describe("branding SQL", () => {
  it("builds a safe statement and escapes quotes", () => {
    const sql = brandingSql("O'Neil & Sons (UA)", "#4F46E5");
    expect(sql).toContain("'O''Neil & Sons (UA)'");
    expect(sql).toContain("'#4f46e5'");
    expect(sql.endsWith("WHERE key = 'branding'")).toBe(true);
  });

  it("rejects injection attempts and bad colours", () => {
    expect(() => brandingSql("x'); DROP TABLE quizzes;--", "#4f46e5")).toThrow();
    expect(() => brandingSql("Acme", "red")).toThrow();
    expect(() => brandingSql("Acme", "#4f46e5'; --")).toThrow();
    expect(sanitizeCompanyName("A".repeat(61))).toBeNull();
    expect(sanitizeCompanyName("ТОВ «Приклад»")).toBeNull(); // guillemets are not allowed
    expect(sanitizeCompanyName("ТОВ Приклад")).toBe("ТОВ Приклад");
  });
});

describe("diagnose", () => {
  it("recognises the workers.dev subdomain prompt and links to onboarding", () => {
    const hints = diagnose("Would you like to register a workers.dev subdomain now?", { accountId: "abc123" });
    expect(hints).toEqual([{ code: "subdomain", link: "https://dash.cloudflare.com/abc123/workers/onboarding" }]);
  });

  it("recognises auth, network and limit problems", () => {
    expect(diagnose("You are not authenticated").map((h) => h.code)).toContain("auth");
    expect(diagnose("fetch failed: ENOTFOUND api.cloudflare.com").map((h) => h.code)).toContain("network");
    expect(diagnose("You have reached the limit of 10 databases").map((h) => h.code)).toContain("limits");
    expect(diagnose("This Worker does not exist on your account. [code: 10007]").map((h) => h.code)).toContain("workerMissing");
    expect(diagnose("all fine")).toEqual([]);
  });
});
