import { localDate } from "../../shared/dates";
import { BRIEF_TZ, compileAndStore, type RankContext } from "../briefCompiler";
import { newId, parseJsonColumn } from "../db";
import { getResearch } from "../research";
import { acquireLease, isDue, missingEnv, redact, refreshSource, type RefreshOutcome, releaseLease } from "../sources/collect";
import { loadSourceStates, SOURCES } from "../sources/registry";
import type { D1Database, FinanceEnv } from "../types";

/**
 * Bounded, idempotent maintenance jobs. Each run records a finance_jobs row keyed by an idempotency
 * key (a repeated scheduler call with the same key replays the stored result instead of re-running),
 * and each job holds a lease so overlapping invocations cannot stampede upstream sources.
 */

export const JOB_TYPES = ["refresh_sources", "compile_briefs", "cleanup"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface MaintenanceOptions {
  jobs?: string[];
  requestedBy?: "scheduler" | "maintenance" | "owner" | "owner_session";
  idempotencyKey?: string;
  /** "manual" ignores refresh intervals (still respects backoff); used by the owner's Refresh button. */
  refreshMode?: "scheduled" | "manual";
}

export interface MaintenanceReport {
  ok: boolean;
  jobs: Array<{ job: string; status: string; jobId?: string; replayed?: boolean; detail?: unknown }>;
}

export interface MaintenanceDeps {
  env: FinanceEnv;
  db: D1Database | undefined;
  now: Date;
  fetcher: typeof fetch;
  log: (e: { level: "info" | "warn" | "error"; message: string; data?: Record<string, unknown> }) => void;
}

/** Desk focus used for public (non-personalised) briefs: FIG is the strongest-covered sector. */
export const PUBLIC_RANK_CONTEXT: RankContext = { followedSectors: new Set(["fig"]), watchedDeals: new Set(), watchedCompanies: new Set(), personalised: false };

const REFRESH_BUDGET_MS = 50_000;

async function jobRefresh(deps: MaintenanceDeps & { db: D1Database }, mode: "scheduled" | "manual"): Promise<{ status: string; detail: unknown }> {
  const holder = newId("h");
  if (!(await acquireLease(deps.db, "job:refresh_sources", holder, 4 * 60_000, deps.now))) return { status: "skipped", detail: { reason: "Another source refresh is already running." } };
  try {
    const states = await loadSourceStates(deps.db);
    const outcomes: RefreshOutcome[] = [];
    const started = Date.now();
    for (const def of SOURCES) {
      if (!def.connector) continue;
      if (missingEnv(def, deps.env).length) {
        outcomes.push({ sourceId: def.id, status: "not_configured", httpStatus: null, fetched: 0, inserted: 0, updated: 0, duplicates: 0, reviewItems: 0, message: `Set ${missingEnv(def, deps.env).join(", ")}.`, retryAt: null, firstLiveSuccess: false });
        continue;
      }
      if (mode === "scheduled" && !isDue(def, states.get(def.id), deps.now)) continue;
      if (Date.now() - started > REFRESH_BUDGET_MS) {
        outcomes.push({ sourceId: def.id, status: "backoff", httpStatus: null, fetched: 0, inserted: 0, updated: 0, duplicates: 0, reviewItems: 0, message: "Time budget for this run used up; will run next time.", retryAt: null, firstLiveSuccess: false });
        continue;
      }
      outcomes.push(await refreshSource(def.id, deps, mode));
    }
    const failed = outcomes.filter((o) => ["failed", "access_unavailable", "rate_limited"].includes(o.status)).length;
    const attempted = outcomes.filter((o) => ["working", "not_modified", "failed", "access_unavailable", "rate_limited"].includes(o.status)).length;
    const status = attempted > 0 && failed === attempted ? "failed" : failed > 0 ? "partial" : "succeeded";
    return { status, detail: { sources: outcomes } };
  } finally {
    await releaseLease(deps.db, "job:refresh_sources", holder);
  }
}

/** Target 07:30 Asia/Kolkata. Compiles the public daily brief once per date; the weekly on Sundays. */
async function jobBriefs(deps: MaintenanceDeps & { db: D1Database }): Promise<{ status: string; detail: unknown }> {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: BRIEF_TZ, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(deps.now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (hh * 60 + mm < 7 * 60 + 30) return { status: "skipped", detail: { reason: "Before 07:30 IST; the daily brief is compiled at or after 07:30." } };
  const today = localDate(deps.now, BRIEF_TZ);
  const holder = newId("h");
  if (!(await acquireLease(deps.db, "job:compile_briefs", holder, 2 * 60_000, deps.now))) return { status: "skipped", detail: { reason: "Another brief compile is running." } };
  try {
    const view = await getResearch(deps.db);
    const results: Record<string, unknown> = {};
    const kinds: Array<"daily" | "weekly"> = weekday === "Sun" ? ["daily", "weekly"] : ["daily"];
    for (const kind of kinds) {
      const exists = await deps.db.prepare("SELECT id FROM finance_briefs WHERE scope = 'public' AND user_key = '' AND kind = ? AND brief_date = ? LIMIT 1").bind(kind, today).first<{ id: string }>();
      if (exists) {
        results[kind] = { status: "exists", id: exists.id };
        continue;
      }
      const r = await compileAndStore({ db: deps.db, view, now: deps.now, kind, scope: "public", userKey: "", ctx: PUBLIC_RANK_CONTEXT, reason: "scheduled" });
      results[kind] = r.ok ? { status: "compiled", id: r.id } : { status: "no_material", message: r.message };
    }
    return { status: "succeeded", detail: results };
  } finally {
    await releaseLease(deps.db, "job:compile_briefs", holder);
  }
}

async function jobCleanup(deps: MaintenanceDeps & { db: D1Database }): Promise<{ status: string; detail: unknown }> {
  const iso = (days: number) => new Date(deps.now.getTime() - days * 86_400_000).toISOString();
  const db = deps.db;
  const res = await db.batch([
    db.prepare("DELETE FROM finance_rate_limits WHERE window_start < ?").bind(iso(2)),
    db.prepare("DELETE FROM finance_idempotency WHERE created_at < ?").bind(iso(7)),
    db.prepare("DELETE FROM finance_leases WHERE expires_at < ?").bind(deps.now.toISOString()),
    db.prepare("DELETE FROM finance_jobs WHERE started_at < ?").bind(iso(90)),
    // Unreviewed leads older than a year are dropped with their documents; anything referenced by
    // the review queue or a published change stays.
    db.prepare(
      "DELETE FROM finance_feed_items WHERE discovered_at < ? AND verification IN ('lead', 'linked', 'rejected') AND document_id NOT IN (SELECT json_extract(evidence_json, '$.documentId') FROM finance_review_queue WHERE json_extract(evidence_json, '$.documentId') IS NOT NULL)",
    ).bind(iso(365)),
    db.prepare(
      "DELETE FROM finance_source_documents WHERE retrieved_at < ? AND id NOT IN (SELECT document_id FROM finance_feed_items) AND id NOT IN (SELECT json_extract(evidence_json, '$.documentId') FROM finance_review_queue WHERE json_extract(evidence_json, '$.documentId') IS NOT NULL)",
    ).bind(iso(365)),
  ]);
  const names = ["rateLimits", "idempotency", "leases", "jobs", "feedItems", "documents"];
  return { status: "succeeded", detail: Object.fromEntries(res.map((r, i) => [names[i], r.meta.changes ?? 0])) };
}

export async function runMaintenanceJobs(deps: MaintenanceDeps, options: MaintenanceOptions = {}): Promise<MaintenanceReport> {
  const db = deps.db;
  if (!db) return { ok: false, jobs: [{ job: "*", status: "no_database", detail: "The DB binding is not available." }] };
  const requested = options.jobs?.length ? options.jobs : [...JOB_TYPES];
  const unknown = requested.filter((j) => !(JOB_TYPES as readonly string[]).includes(j));
  if (unknown.length) return { ok: false, jobs: unknown.map((j) => ({ job: j, status: "unknown_job" })) };
  const requestedBy = options.requestedBy ?? "scheduler";
  const report: MaintenanceReport = { ok: true, jobs: [] };
  for (const job of requested as JobType[]) {
    const key = options.idempotencyKey ? `${options.idempotencyKey}:${job}`.slice(0, 200) : `${requestedBy}:${job}:${deps.now.toISOString().slice(0, 16)}`;
    const id = newId("j_");
    const startedAt = deps.now.toISOString();
    const claimed = await db
      .prepare("INSERT INTO finance_jobs (id, job_type, idempotency_key, requested_by, status, started_at) VALUES (?, ?, ?, ?, 'running', ?) ON CONFLICT(idempotency_key) DO NOTHING")
      .bind(id, job, key, requestedBy, startedAt)
      .run();
    if (!claimed.meta.changes) {
      const prev = await db.prepare("SELECT id, status, result_json, error FROM finance_jobs WHERE idempotency_key = ?").bind(key).first<{ id: string; status: string; result_json: string | null; error: string | null }>();
      report.jobs.push({ job, status: prev?.status === "running" ? "in_progress" : (prev?.status ?? "unknown"), jobId: prev?.id, replayed: true, detail: prev?.error ?? parseJsonColumn(prev?.result_json ?? null, null) });
      continue;
    }
    try {
      const withDb = { ...deps, db };
      const r = job === "refresh_sources" ? await jobRefresh(withDb, options.refreshMode ?? "scheduled") : job === "compile_briefs" ? await jobBriefs(withDb) : await jobCleanup(withDb);
      await db.prepare("UPDATE finance_jobs SET status = ?, finished_at = ?, result_json = ? WHERE id = ?").bind(r.status, new Date().toISOString(), JSON.stringify(r.detail).slice(0, 20_000), id).run();
      if (r.status === "failed") report.ok = false;
      report.jobs.push({ job, status: r.status, jobId: id, detail: r.detail });
    } catch (e) {
      const message = redact(e instanceof Error ? e.message : "Job failed", deps.env);
      await db.prepare("UPDATE finance_jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").bind(new Date().toISOString(), message, id).run();
      deps.log({ level: "error", message: "maintenance job failed", data: { job, error: message } });
      report.ok = false;
      report.jobs.push({ job, status: "failed", jobId: id, detail: message });
    }
  }
  return report;
}
