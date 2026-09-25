import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../migrations/schema.finance";

// node:sqlite (SQLite, like D1) loaded via require so the bundler does not try to resolve it.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { all(...a: unknown[]): Array<Record<string, unknown>> } } };

const MIGRATION = readFileSync("migrations/0001_finance_init.sql", "utf8");
type Db = InstanceType<typeof DatabaseSync>;

function describeSchema(db: Db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'finance_%' ORDER BY name").all().map((r) => String(r.name));
  return Object.fromEntries(
    tables.map((t) => [
      t,
      {
        // An INTEGER PRIMARY KEY is the rowid alias and can never be NULL, whether or not NOT NULL is spelled out.
        columns: db
          .prepare(`PRAGMA table_info(${t})`)
          .all()
          .map((c) => ({ name: c.name, type: String(c.type).toUpperCase(), notnull: c.pk && String(c.type).toUpperCase() === "INTEGER" ? 1 : c.notnull, pk: c.pk, dflt: c.dflt_value === null ? null : String(c.dflt_value).replace(/^'(.*)'$/, "$1") })),
        // A column UNIQUE constraint (SQLite autoindex) and drizzle-kit's named `<table>_<col>_unique` index are
        // the same constraint; both are normalised to "unique(<cols>)". Primary-key indexes are covered by table_info.
        indexes: db
          .prepare(`PRAGMA index_list(${t})`)
          .all()
          .filter((i) => i.origin !== "pk")
          .map((i) => {
            const cols = db.prepare(`PRAGMA index_info("${String(i.name)}")`).all().map((c) => c.name);
            const constraint = String(i.name).startsWith("sqlite_autoindex") || String(i.name).endsWith("_unique");
            return { name: constraint ? `unique(${cols.join(",")})` : i.name, unique: i.unique, partial: i.partial, cols };
          })
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      },
    ]),
  );
}

describe("finance migration", () => {
  it("is additive and idempotent: applying twice keeps existing host tables and data", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT); INSERT INTO users VALUES ('u1', 'Existing host row');");
    db.exec(MIGRATION);
    db.exec("INSERT INTO finance_notes (id, user_id, title, body, template, created_at, updated_at) VALUES ('n1', 'owner', 't', 'b', 'blank', 'x', 'x')");
    db.exec(MIGRATION);
    expect(db.prepare("SELECT name FROM users").all()).toEqual([{ name: "Existing host row" }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM finance_notes").all()[0]?.n).toBe(1);
    const names = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all();
    for (const n of names) if (n.name !== "users") expect(String(n.name)).toMatch(/^finance_/);
    expect(MIGRATION).not.toMatch(/\bDROP\b|\bALTER TABLE (?!finance_)/i);
  });

  it("the Drizzle schema mirror matches the SQL migration column for column", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(MIGRATION);
    const actual = describeSchema(db);
    // Every export of the schema module is a table.
    const tables = Object.values(schema) as unknown as SQLiteTable[];
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual(Object.keys(actual).sort());
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const cols = actual[cfg.name]?.columns ?? [];
      expect(cfg.columns.map((c) => c.name).sort(), cfg.name).toEqual(cols.map((c) => String(c.name)).sort());
      for (const c of cfg.columns) {
        const sqlCol = cols.find((x) => x.name === c.name);
        expect(Boolean(sqlCol?.notnull) || Boolean(sqlCol?.pk), `${cfg.name}.${c.name} notnull`).toBe(c.notNull);
      }
      expect(cfg.indexes.map((i) => i.config.name).sort(), `${cfg.name} indexes`).toEqual((actual[cfg.name]?.indexes ?? []).map((i) => String(i.name)).filter((n) => !n.startsWith("unique(")).sort());
    }
  });

  it("drizzle-kit generates SQL from the mirror that produces the same schema", () => {
    const out = mkdtempSync(join(tmpdir(), "finance-drizzle-"));
    try {
      execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "generate", "--dialect", "sqlite", "--schema", "migrations/schema.finance.ts", "--out", out], { stdio: "pipe", timeout: 120_000 });
      const file = readdirSync(out).find((f) => f.endsWith(".sql")) as string;
      const generated = readFileSync(join(out, file), "utf8").replace(/--> statement-breakpoint/g, "");
      const a = new DatabaseSync(":memory:");
      a.exec(MIGRATION);
      const b = new DatabaseSync(":memory:");
      b.exec(generated);
      expect(describeSchema(b)).toEqual(describeSchema(a));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
