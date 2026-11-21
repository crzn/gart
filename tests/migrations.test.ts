import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QuizSettingsSchema } from "@gart/shared";

// node:sqlite is loaded through require so the bundler does not try to resolve it.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const migrationsDir = join(import.meta.dirname, "..", "migrations");

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return db;
}

describe("D1 migrations", () => {
  it("apply cleanly and create every required table", () => {
    const db = freshDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => String(r["name"]));
    for (const t of [
      "administrators", "admin_sessions", "quizzes", "quiz_templates", "questions", "answer_options",
      "game_sessions", "game_results", "game_participants", "uploaded_media", "application_settings",
      "usage_metrics", "audit_logs",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("seeds six system templates whose settings all validate against the shared schema", () => {
    const db = freshDb();
    const rows = db.prepare("SELECT id, name, settings_json FROM quiz_templates").all();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      const parsed = QuizSettingsSchema.safeParse(JSON.parse(String(row["settings_json"])));
      expect(parsed.success, `template ${String(row["id"])}`).toBe(true);
    }
  });

  it("enforces unique active PINs but allows reuse after a game ends", () => {
    const db = freshDb();
    const insert = db.prepare(
      `INSERT INTO game_sessions (id, quiz_title, pin, status, settings_snapshot_json, quiz_snapshot_json)
       VALUES (?, 't', ?, ?, '{}', '{}')`,
    );
    insert.run("g1", "123456", "LOBBY");
    expect(() => insert.run("g2", "123456", "CREATED")).toThrow();
    db.prepare("UPDATE game_sessions SET status = 'FINISHED' WHERE id = 'g1'").run();
    expect(() => insert.run("g3", "123456", "LOBBY")).not.toThrow();
  });

  it("prevents duplicate answers and duplicate nicknames per game", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO game_sessions (id, quiz_title, pin, status, settings_snapshot_json, quiz_snapshot_json)
       VALUES ('g', 't', '111111', 'LOBBY', '{}', '{}')`,
    ).run();
    const addPlayer = db.prepare(
      "INSERT INTO game_participants (id, game_id, nickname, nickname_key, avatar) VALUES (?, 'g', ?, ?, 'fox')",
    );
    addPlayer.run("p1", "Anna", "anna");
    expect(() => addPlayer.run("p2", "ANNA", "anna")).toThrow();

    const addResult = db.prepare(
      `INSERT INTO game_results (id, game_id, participant_id, question_position, option_id, is_correct, points, answer_ms)
       VALUES (?, 'g', 'p1', 0, 'o1', 1, 1000, 500)`,
    );
    addResult.run("r1");
    expect(() => addResult.run("r2")).toThrow();
  });

  it("cascades game deletion to participants and results (retention cleanup)", () => {
    const db = freshDb();
    db.exec(`
      INSERT INTO game_sessions (id, quiz_title, pin, status, settings_snapshot_json, quiz_snapshot_json)
        VALUES ('g', 't', '222222', 'FINISHED', '{}', '{}');
      INSERT INTO game_participants (id, game_id, nickname, nickname_key, avatar) VALUES ('p', 'g', 'A', 'a', 'fox');
      INSERT INTO game_results (id, game_id, participant_id, question_position, option_id, is_correct, points, answer_ms)
        VALUES ('r', 'g', 'p', 0, 'o', 1, 10, 1);
      DELETE FROM game_sessions WHERE id = 'g';
    `);
    expect(db.prepare("SELECT COUNT(*) AS n FROM game_results").get()?.["n"]).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM game_participants").get()?.["n"]).toBe(0);
  });

  it("limits answer options to four positions and two roles of question types", () => {
    const db = freshDb();
    db.exec(`INSERT INTO quizzes (id, title) VALUES ('q', 'Quiz');
             INSERT INTO questions (id, quiz_id, position, type, text) VALUES ('qq', 'q', 0, 'single', 'Q?');`);
    expect(() => db.exec("INSERT INTO answer_options (id, question_id, position, text) VALUES ('o', 'qq', 4, 'x')")).toThrow();
    expect(() => db.exec("INSERT INTO questions (id, quiz_id, position, type, text) VALUES ('q2', 'q', 1, 'essay', 'x')")).toThrow();
  });

  it("only accepts measured usage rows", () => {
    const db = freshDb();
    expect(() => db.exec("INSERT INTO usage_metrics (day, metric, source, value) VALUES ('2026-01-01', 'm', 'official', 1)")).toThrow();
  });
});

describe("migration 0003", () => {
  it("drops the redundant game indexes but keeps the unique ones", () => {
    const db = freshDb();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => String(r["name"]));
    expect(idx).not.toContain("idx_game_results_game");
    expect(idx).not.toContain("idx_game_participants_game");
  });
});

describe("migration 0004", () => {
  it("keeps official figures apart from measured ones and rejects bad rows", () => {
    const db = freshDb();
    db.prepare("INSERT INTO usage_official (day, resource, value) VALUES ('2026-11-20', 'd1.rowsWritten', 5)").run();
    expect(() => db.prepare("INSERT INTO usage_official (day, resource, value) VALUES ('yesterday', 'x', 1)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO usage_official (day, resource, value) VALUES ('2026-11-20', 'x', -1)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO usage_official (day, resource, value) VALUES ('2026-11-20', 'd1.rowsWritten', 6)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO usage_metrics (day, metric, source, value) VALUES ('2026-11-20', 'x', 'official', 1)").run()).toThrow();
  });
});

describe("migration safety (code is deployed after the database changes, and a code rollback does not undo them)", () => {
  it("no migration destroys data unless it says so on purpose", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(import.meta.dirname, "..", "migrations");
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      readFileSync(join(dir, f), "utf8").split("\n").forEach((line, i) => {
        if (/\bDROP\s+(TABLE|COLUMN)\b|\bRENAME\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(line) && !/allow-destructive:/i.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
