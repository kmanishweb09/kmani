/**
 * Starts the simulated host harness (.local/harness/worker.mjs) in workerd via Miniflare with a D1
 * binding, applies finance migrations and returns the instance. Used by `npm run dev`, Worker tests
 * and Playwright.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";

export function splitSql(sql) {
  const out = [];
  let cur = "";
  for (const rawLine of sql.split("\n")) {
    const line = rawLine.replace(/--.*$/, "");
    if (!line.trim()) continue;
    cur += `${line}\n`;
    if (line.trimEnd().endsWith(";")) {
      out.push(cur.trim().replace(/;$/, ""));
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function applyMigrations(db, root) {
  const dir = join(root, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const stmts = splitSql(readFileSync(join(dir, f), "utf8"));
    for (const s of stmts) await db.prepare(s).run();
  }
  return files;
}

export async function startHost({ root, port, persistDir, bindings = {}, outboundService, log = false } = {}) {
  const jobSecret = bindings.FINANCE_JOB_SECRET ?? randomBytes(24).toString("hex");
  const options = {
    modules: true,
    scriptPath: join(root, ".local/harness/worker.mjs"),
    compatibilityDate: "2025-09-01",
    d1Databases: ["DB"],
    ...(persistDir ? { d1Persist: persistDir } : {}),
    ...(port !== undefined ? { port, host: "127.0.0.1" } : {}),
    ...(outboundService ? { outboundService } : {}),
    bindings: {
      FINANCE_OWNER_USER_ID: "dev-owner",
      FINANCE_JOB_SECRET: jobSecret,
      FINANCE_AI_PROVIDER: "none",
      ...bindings,
    },
  };
  if (!log) delete options.log;
  const mf = new Miniflare(options);
  const url = await mf.ready;
  const db = await mf.getD1Database("DB");
  await applyMigrations(db, root);
  return { mf, url, db, jobSecret, options };
}
