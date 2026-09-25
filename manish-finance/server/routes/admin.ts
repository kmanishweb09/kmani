import { z } from "zod";
import type { EventView } from "../../shared/api";
import type { CompiledClaim } from "../../shared/archive/compile";
import { localDate } from "../../shared/dates";
import { DEFAULT_PREFERENCES } from "../../shared/defaults";
import { DEAL_STATUSES, SECTOR_SLUGS } from "../../shared/labels";
import { DOCUMENT_TYPES, EVENT_TYPES, type SourceDocument } from "../../shared/schemas/research";
import { requireOwner } from "../auth";
import { BRIEF_TZ, compileAndStore, type RankContext } from "../briefCompiler";
import { idempotencyKey, idempotent, newId, parseJsonColumn, requireDb } from "../db";
import { loadRuntimeDocument } from "../feedStore";
import { HttpError, privateJson, readJson, sha256Hex, validationError } from "../http";
import { PUBLIC_RANK_CONTEXT, runMaintenanceJobs } from "../jobs/runner";
import { getResearch } from "../research";
import type { Router } from "../router";
import { refreshSource } from "../sources/collect";
import { canonicalizeUrl, checkPublicLink, FetchGuardError } from "../sources/fetchGuard";
import { dealEventTypeFor, linkEntities, sectorsFor } from "../sources/link";
import { getSource, loadSourceStates, sourceStatusView } from "../sources/registry";
import type { D1Database, RequestContext } from "../types";
import { loadPrefs } from "./private";
import { sourceViews } from "./status";

/**
 * Owner administration: connector diagnostics, source enable/disable and tests, the review queue
 * (the only path by which collected material changes published research), manual source links,
 * company corrections, on-demand brief compilation and the protected maintenance endpoint.
 */

const MAX_BODY = 32 * 1024;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw validationError(r.error.issues);
  return r.data;
}

const zLink = z
  .string()
  .max(2000)
  .superRefine((v, ctx) => {
    try {
      checkPublicLink(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof FetchGuardError ? e.message : "Enter a valid https URL." });
    }
  });
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

const zManualSource = z.object({
  url: zLink,
  publisher: z.string().trim().min(2).max(120),
  title: z.string().trim().min(3).max(300),
  publishedDate: zDate.nullish(),
  eventDate: zDate.nullish(),
  excerpt: z.string().trim().max(300).nullish(),
  documentType: z.enum(DOCUMENT_TYPES).nullish(),
  dealId: z.string().max(80).nullish(),
  eventType: z.enum(EVENT_TYPES).default("subsequent"),
  statusAfter: z.enum(DEAL_STATUSES).nullish(),
});

const zDecision = z.object({ decision: z.enum(["publish", "reject"]), note: z.string().trim().max(400).nullish() });

const CORRECTABLE = ["displayName", "website", "irUrl", "aliases", "subsector"] as const;
const zCorrection = z.object({
  companyId: z.string().min(2).max(80),
  field: z.enum(CORRECTABLE),
  next: z.union([z.string().trim().min(1).max(300), z.array(z.string().trim().min(2).max(120)).min(1).max(20)]),
  note: z.string().trim().min(3).max(400),
  evidence: z.object({
    url: zLink,
    publisher: z.string().trim().min(2).max(120),
    title: z.string().trim().min(3).max(300),
    publishedDate: zDate.nullish(),
    excerpt: z.string().trim().max(300).nullish(),
    documentType: z.enum(DOCUMENT_TYPES).nullish(),
  }),
});

const zCompile = z.object({ kind: z.enum(["daily", "weekly"]).default("daily"), scope: z.enum(["private", "public"]).default("private") });
const zJobs = z.object({ jobs: z.array(z.string().max(40)).max(5).optional() });

interface ReviewRow {
  id: string;
  kind: string;
  subject_type: string | null;
  subject_id: string | null;
  field: string | null;
  proposal_json: string;
  evidence_json: string;
  origin: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

function reviewView(r: ReviewRow) {
  return {
    id: r.id,
    kind: r.kind,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    field: r.field,
    proposal: parseJsonColumn<Record<string, unknown>>(r.proposal_json, {}),
    evidence: parseJsonColumn<Record<string, unknown>>(r.evidence_json, {}),
    origin: r.origin,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
  };
}

function deps(c: RequestContext, db: D1Database) {
  return { env: c.env, db, now: c.now, fetcher: c.options.fetcher, log: c.options.log ?? (() => undefined) };
}

function defaultDocType(eventType: string): SourceDocument["documentType"] {
  if (eventType === "regulatory_approval" || eventType === "regulatory_decision") return "regulatory_order";
  if (eventType === "court_approval") return "court_order";
  if (eventType === "open_offer" || eventType === "shareholder_approval") return "exchange_filing";
  return "press_release";
}

async function publishReviewItem(c: RequestContext, db: D1Database, row: ReviewRow, note: string | null): Promise<{ changeId: string }> {
  const proposal = parseJsonColumn<{ dealId?: string; event?: { type?: string; feedType?: string; date?: string; title?: string; statusAfter?: string | null } }>(row.proposal_json, {});
  const evidence = parseJsonColumn<{ documentId?: string }>(row.evidence_json, {});
  if (row.kind !== "feed_lead" && row.kind !== "deal_event" && row.kind !== "ai_extraction") throw new HttpError(422, "UNSUPPORTED_REVIEW_KIND", "This review item cannot be published automatically.");
  const view = await getResearch(db);
  const deal = proposal.dealId ? view.dealById.get(proposal.dealId) : undefined;
  if (!deal) throw new HttpError(409, "DEAL_NOT_FOUND", "The proposed deal is no longer in the research view.");
  const doc = evidence.documentId ? await loadRuntimeDocument(db, evidence.documentId) : null;
  if (!doc) throw new HttpError(409, "EVIDENCE_MISSING", "The source document for this item is no longer stored.");
  const e = proposal.event ?? {};
  const type = row.kind === "feed_lead" ? dealEventTypeFor(e.feedType ?? "") : (EVENT_TYPES as readonly string[]).includes(e.type ?? "") ? (e.type as EventView["type"]) : "subsequent";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") ? (e.date as string) : localDate(c.now, BRIEF_TZ);
  const statusAfter = row.kind === "deal_event" && e.statusAfter && (DEAL_STATUSES as readonly string[]).includes(e.statusAfter) ? (e.statusAfter as EventView["statusAfter"]) : null;
  const today = localDate(c.now, BRIEF_TZ);
  const claimId = `ev-p-${row.id}`;
  const claim: CompiledClaim = {
    id: claimId,
    subject: { type: "deal", id: deal.id },
    field: "event",
    label: "Deal event",
    display: (e.title ?? doc.title).slice(0, 200),
    documentId: doc.id,
    locator: null,
    excerpt: null,
    status: "human_reviewed",
    checkedAt: today,
    method: "owner_entry",
    note: `Published by the site owner from the review queue${note ? `: ${note}` : "."}`,
  };
  const event: EventView = {
    id: `pe-${row.id}`,
    type,
    date: { date, precision: "day" },
    publishedDate: doc.publishedDate?.date ?? null,
    title: (e.title ?? doc.title).slice(0, 200),
    detail:
      row.kind === "feed_lead"
        ? `Source-linked item from ${doc.publisher}. Published after owner review; deal terms and status were not changed by this item.`
        : row.kind === "ai_extraction"
          ? `Proposed by AI extraction from ${doc.publisher}; checked and published by the site owner.`
          : null,
    jurisdiction: null,
    authority: null,
    statusAfter,
    ev: [claimId],
    origin: "published_update",
  };
  // Claim the item first so a concurrent decision cannot publish it twice.
  const claimed = await db.prepare("UPDATE finance_review_queue SET status = 'published', decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'").bind(c.now.toISOString(), note, row.id).run();
  if (!claimed.meta.changes) throw new HttpError(409, "ALREADY_DECIDED", "This review item was already decided.");
  const changeId = `pc_${newId()}`;
  try {
    await db.batch([
      db
        .prepare("INSERT INTO finance_published_changes (id, entity_type, entity_id, change_type, payload_json, evidence_json, note, review_item_id, published_at) VALUES (?, 'deal', ?, 'event_append', ?, ?, ?, ?, ?)")
        .bind(changeId, deal.id, JSON.stringify({ event }), JSON.stringify({ documents: [doc], claims: [claim] }), note, row.id, c.now.toISOString()),
      db.prepare("UPDATE finance_feed_items SET verification = 'reviewed' WHERE document_id = ?").bind(doc.id),
    ]);
  } catch (err) {
    await db.prepare("UPDATE finance_review_queue SET status = 'pending', decided_at = NULL, decision_note = NULL WHERE id = ?").bind(row.id).run();
    throw err;
  }
  return { changeId };
}

async function rejectReviewItem(c: RequestContext, db: D1Database, row: ReviewRow, note: string | null): Promise<void> {
  const claimed = await db.prepare("UPDATE finance_review_queue SET status = 'rejected', decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'").bind(c.now.toISOString(), note, row.id).run();
  if (!claimed.meta.changes) throw new HttpError(409, "ALREADY_DECIDED", "This review item was already decided.");
  const docId = parseJsonColumn<{ documentId?: string }>(row.evidence_json, {}).documentId;
  if (!docId) return;
  if (row.kind === "deal_event") {
    await db.prepare("UPDATE finance_feed_items SET verification = 'rejected' WHERE document_id = ?").bind(docId).run();
    return;
  }
  // A rejected feed lead only removes the proposed deal link; the headline stays a lead.
  const feed = await db.prepare("SELECT entities_json FROM finance_feed_items WHERE document_id = ?").bind(docId).first<{ entities_json: string }>();
  if (!feed) return;
  const entities = parseJsonColumn<Array<{ type: string; id: string; confidence: string }>>(feed.entities_json, []).filter((x) => !(x.type === "deal" && x.id === row.subject_id));
  const verification = entities.some((x) => x.confidence === "exact_alias") ? "linked" : "lead";
  await db.prepare("UPDATE finance_feed_items SET entities_json = ?, verification = ? WHERE document_id = ? AND verification != 'reviewed'").bind(JSON.stringify(entities), verification, docId).run();
}

async function rankContextFor(db: D1Database, userId: string): Promise<RankContext> {
  const { prefs } = await loadPrefs(db, userId);
  const watches = (await db.prepare("SELECT kind, entity_id FROM finance_watches WHERE user_id = ? AND (following = 1 OR saved = 1)").bind(userId).all<{ kind: string; entity_id: string }>()).results ?? [];
  const followed = prefs.followedSectors.length ? prefs.followedSectors : [prefs.highlightSector ?? DEFAULT_PREFERENCES.highlightSector];
  return {
    followedSectors: new Set([...followed, ...watches.filter((w) => w.kind === "sector").map((w) => w.entity_id)].filter((s) => (SECTOR_SLUGS as readonly string[]).includes(s))),
    watchedDeals: new Set(watches.filter((w) => w.kind === "deal").map((w) => w.entity_id)),
    watchedCompanies: new Set(watches.filter((w) => w.kind === "company").map((w) => w.entity_id)),
    personalised: true,
  };
}

export function registerAdminRoutes(r: Router): void {
  r.add({
    method: "GET",
    pattern: "/api/finance/admin/sources",
    access: "owner",
    handler: async (c) => {
      const db = requireDb(c);
      const items = await sourceViews(c, true);
      const jobs = (await db.prepare("SELECT id, job_type, requested_by, status, started_at, finished_at, error, result_json FROM finance_jobs ORDER BY started_at DESC LIMIT 20").all<Record<string, string | null>>()).results ?? [];
      const pending = (await db.prepare("SELECT COUNT(*) AS n FROM finance_review_queue WHERE status = 'pending'").first<{ n: number }>())?.n ?? 0;
      return privateJson({
        items,
        jobs: jobs.map((j) => ({ id: j.id, jobType: j.job_type, requestedBy: j.requested_by, status: j.status, startedAt: j.started_at, finishedAt: j.finished_at, error: j.error, result: parseJsonColumn(j.result_json ?? null, null) })),
        reviewPending: pending,
      });
    },
  });

  r.add({
    method: "PATCH",
    pattern: "/api/finance/admin/sources/:id",
    access: "owner",
    handler: async (c) => {
      const db = requireDb(c);
      const def = getSource(c.params.id ?? "");
      if (!def || !def.connector) throw new HttpError(404, "NOT_FOUND", "No automated connector with that ID.");
      const body = parse(z.object({ enabled: z.boolean() }), await readJson(c.request, MAX_BODY));
      await db
        .prepare("INSERT INTO finance_source_state (source_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at")
        .bind(def.id, body.enabled ? 1 : 0, c.now.toISOString())
        .run();
      const states = await loadSourceStates(db);
      return privateJson({ source: sourceStatusView(def, states.get(def.id), c.env, c.now, true) });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/sources/:id/test",
    access: "owner",
    handler: async (c) => {
      const db = requireDb(c);
      const def = getSource(c.params.id ?? "");
      if (!def || !def.connector) throw new HttpError(404, "NOT_FOUND", "No automated connector with that ID.");
      idempotencyKey(c, false);
      const outcome = await refreshSource(def.id, deps(c, db), "test");
      const states = await loadSourceStates(db);
      return privateJson({ outcome, source: sourceStatusView(def, states.get(def.id), c.env, c.now, true) });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/refresh",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const db = requireDb(c);
      // Presses within two minutes of the owner's last refresh replay that run instead of starting another.
      // (A sliding window, not fixed buckets, so two quick presses never straddle a boundary; truly
      // simultaneous presses are serialised by the refresh lease.)
      return idempotent(c, userId, "admin.refresh", {}, async () => {
        const recent = await db
          .prepare("SELECT id, status, result_json, error FROM finance_jobs WHERE job_type = 'refresh_sources' AND requested_by = 'owner' AND started_at > ? ORDER BY started_at DESC LIMIT 1")
          .bind(new Date(c.now.getTime() - 120_000).toISOString())
          .first<{ id: string; status: string; result_json: string | null; error: string | null }>();
        if (recent) {
          const status = recent.status === "running" ? "in_progress" : recent.status;
          return { status: 200, body: { ok: status !== "failed", jobs: [{ job: "refresh_sources", status, jobId: recent.id, replayed: true, detail: recent.error ?? parseJsonColumn(recent.result_json, null) }] } };
        }
        const report = await runMaintenanceJobs(deps(c, db), { jobs: ["refresh_sources"], requestedBy: "owner", refreshMode: "manual", idempotencyKey: `owner-refresh:${newId()}` });
        return { status: 200, body: report };
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/jobs/run",
    access: "owner_or_maintenance",
    bodyLimit: 4096,
    handler: async (c) => {
      const db = requireDb(c);
      const hasBody = Number(c.request.headers.get("Content-Length") ?? "0") > 0 || (c.request.headers.get("Content-Type") ?? "").startsWith("application/json");
      const body = hasBody ? parse(zJobs, await readJson(c.request, 4096)) : {};
      const key = idempotencyKey(c, false);
      const report = await runMaintenanceJobs(deps(c, db), { ...(body.jobs ? { jobs: body.jobs } : {}), requestedBy: c.maintenance ? "scheduler" : "owner", ...(key ? { idempotencyKey: `ext:${key}` } : {}) });
      return privateJson(report, report.jobs.some((j) => j.status === "unknown_job") ? 400 : 200);
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/admin/review",
    access: "owner",
    handler: async (c) => {
      const db = requireDb(c);
      const status = c.url.searchParams.get("status") ?? "pending";
      if (!["pending", "published", "rejected", "all"].includes(status)) throw new HttpError(400, "INVALID_STATUS", "status must be pending, published, rejected or all.");
      const rows =
        status === "all"
          ? await db.prepare("SELECT * FROM finance_review_queue ORDER BY created_at DESC LIMIT 200").all<ReviewRow>()
          : await db.prepare("SELECT * FROM finance_review_queue WHERE status = ? ORDER BY created_at DESC LIMIT 200").bind(status).all<ReviewRow>();
      return privateJson({ items: (rows.results ?? []).map(reviewView) });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/review/:id/decision",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zDecision, await readJson(c.request, MAX_BODY));
      const id = c.params.id ?? "";
      return idempotent(c, userId, `admin.review.${id}`, body, async () => {
        const row = await db.prepare("SELECT * FROM finance_review_queue WHERE id = ?").bind(id).first<ReviewRow>();
        if (!row) throw new HttpError(404, "NOT_FOUND", "Review item not found.");
        if (row.status !== "pending") throw new HttpError(409, "ALREADY_DECIDED", `This item was already ${row.status}.`);
        if (body.decision === "publish") {
          const { changeId } = await publishReviewItem(c, db, row, body.note ?? null);
          return { status: 200, body: { id, status: "published", changeId } };
        }
        await rejectReviewItem(c, db, row, body.note ?? null);
        return { status: 200, body: { id, status: "rejected" } };
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/manual-source",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zManualSource, await readJson(c.request, MAX_BODY));
      const view = await getResearch(db);
      const deal = body.dealId ? view.dealById.get(body.dealId) : undefined;
      if (body.dealId && !deal) throw validationError([{ path: ["dealId"], message: "No deal with this ID." }]);
      if (body.statusAfter && !deal) throw validationError([{ path: ["statusAfter"], message: "A status change needs a deal." }]);
      return idempotent(c, userId, "admin.manual-source", body, async () => {
        const url = canonicalizeUrl(body.url);
        const dedupeKey = `owner-manual:url:${url}`;
        const docId = `d_${await sha256Hex(dedupeKey, 24)}`;
        const nowIso = c.now.toISOString();
        const docType = body.documentType ?? defaultDocType(body.eventType);
        const contentHash = await sha256Hex(`${body.title}|${body.publishedDate ?? ""}|${body.excerpt ?? ""}`, 32);
        await db
          .prepare(
            "INSERT INTO finance_source_documents (id, source_id, provider_item_id, canonical_url, title, published_at, published_date, retrieved_at, content_hash, excerpt, locator, version, dedupe_key, publisher, document_type) VALUES (?, 'owner-manual', NULL, ?, ?, NULL, ?, ?, ?, ?, 'Recorded by the site owner', 1, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING",
          )
          .bind(docId, url, body.title, body.publishedDate ?? null, nowIso, contentHash, body.excerpt ?? null, dedupeKey, body.publisher, docType)
          .run();
        const linked = linkEntities(`${body.title} ${body.excerpt ?? ""}`, view);
        const entities = deal ? [{ type: "deal" as const, id: deal.id, name: deal.title, confidence: "exact_alias" as const }, ...linked.filter((x) => !(x.type === "deal" && x.id === deal.id))] : linked;
        const date = body.eventDate ?? body.publishedDate ?? null;
        await db
          .prepare(
            "INSERT INTO finance_feed_items (id, document_id, source_id, title, url, event_type, event_date, published_at, published_date, discovered_at, sectors_json, entities_json, verification, newly_discovered, cluster_key, excerpt) VALUES (?, ?, 'owner-manual', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(document_id) DO NOTHING",
          )
          .bind(`f_${await sha256Hex(dedupeKey, 24)}`, docId, body.title, url, body.eventType, body.eventDate ?? null, body.publishedDate ?? null, nowIso, JSON.stringify(sectorsFor(entities, view, [])), JSON.stringify(entities), deal ? "linked" : "lead", `manual|${docId}`, body.excerpt ?? null)
          .run();
        let reviewItemId: string | null = null;
        if (deal) {
          const dedupe = `manual:${docId}:${deal.id}:${body.eventType}`;
          reviewItemId = `rv_${await sha256Hex(dedupe, 24)}`;
          await db
            .prepare("INSERT INTO finance_review_queue (id, kind, subject_type, subject_id, field, proposal_json, evidence_json, origin, status, dedupe_key, created_at) VALUES (?, 'deal_event', 'deal', ?, 'events', ?, ?, 'manual:owner', 'pending', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING")
            .bind(
              reviewItemId,
              deal.id,
              JSON.stringify({ dealId: deal.id, dealTitle: deal.title, event: { type: body.eventType, date: date ?? localDate(c.now, BRIEF_TZ), title: body.title.slice(0, 200), statusAfter: body.statusAfter ?? null } }),
              JSON.stringify({ documentId: docId, url, title: body.title, publisher: body.publisher, publishedDate: body.publishedDate ?? null, excerpt: body.excerpt ?? null }),
              dedupe,
              nowIso,
            )
            .run();
        }
        return { status: 201, body: { documentId: docId, reviewItemId } };
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/corrections",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zCorrection, await readJson(c.request, MAX_BODY));
      const view = await getResearch(db);
      const company = view.companyById.get(body.companyId);
      if (!company) throw validationError([{ path: ["companyId"], message: "No company with this ID." }]);
      let next: string | string[] = body.next;
      if (body.field === "aliases") {
        if (!Array.isArray(next)) next = String(next).split(",").map((s) => s.trim()).filter((s) => s.length >= 2);
        if (!next.length) throw validationError([{ path: ["next"], message: "Enter at least one alias." }]);
      } else {
        if (Array.isArray(next)) throw validationError([{ path: ["next"], message: "Enter a single value." }]);
        if (body.field === "website" || body.field === "irUrl") {
          try {
            checkPublicLink(next);
          } catch (e) {
            throw validationError([{ path: ["next"], message: e instanceof Error ? e.message : "Enter a valid https URL." }]);
          }
        } else if (next.length < 2 || next.length > 120) throw validationError([{ path: ["next"], message: "Enter 2–120 characters." }]);
      }
      return idempotent(c, userId, "admin.corrections", body, async () => {
        const changeId = `pc_${newId()}`;
        const url = canonicalizeUrl(body.evidence.url);
        const doc: SourceDocument = {
          id: `own-${await sha256Hex(url, 20)}`,
          publisher: body.evidence.publisher,
          url,
          title: body.evidence.title,
          documentType: body.evidence.documentType ?? (body.field === "website" || body.field === "irUrl" ? "company_page" : "reference"),
          isPrimary: body.field === "website" || body.field === "irUrl" || body.evidence.documentType === "annual_report" || body.evidence.documentType === "press_release",
          publishedDate: body.evidence.publishedDate ? { date: body.evidence.publishedDate, precision: "day" } : null,
          retrievedAt: null,
          retrievalStatus: "not_retrieved",
          retrievalNote: "Cited by the site owner with this correction; the server did not fetch the document.",
          contentHash: null,
          language: "en",
        };
        const claim: CompiledClaim = {
          id: `ev-c-${changeId.slice(3)}`,
          subject: { type: "company", id: company.id },
          field: body.field,
          label: `Correction: ${body.field}`,
          display: Array.isArray(next) ? next.join(", ") : next,
          documentId: doc.id,
          locator: null,
          excerpt: body.evidence.excerpt ?? null,
          status: "human_reviewed",
          checkedAt: localDate(c.now, BRIEF_TZ),
          method: "owner_entry",
          note: `Correction entered by the site owner: ${body.note}`,
        };
        await db
          .prepare("INSERT INTO finance_published_changes (id, entity_type, entity_id, change_type, payload_json, evidence_json, note, review_item_id, published_at) VALUES (?, 'company', ?, 'company_correction', ?, ?, ?, NULL, ?)")
          .bind(changeId, company.id, JSON.stringify({ field: body.field, next }), JSON.stringify({ documents: [doc], claims: [claim] }), body.note, c.now.toISOString())
          .run();
        return { status: 201, body: { id: changeId, companyId: company.id, field: body.field } };
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/briefs/compile",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zCompile, await readJson(c.request, MAX_BODY));
      return idempotent(c, userId, "briefs.compile", body, async () => {
        const view = await getResearch(db);
        let ctx = PUBLIC_RANK_CONTEXT;
        let openQuestions: string[] = [];
        if (body.scope === "private") {
          ctx = await rankContextFor(db, userId);
          if (body.kind === "weekly") {
            const notes = (await db.prepare("SELECT title FROM finance_notes WHERE user_id = ? AND template = 'research_question' AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 4").bind(userId).all<{ title: string }>()).results ?? [];
            openQuestions = notes.map((n) => n.title);
          }
        }
        const res = await compileAndStore({ db, view, now: c.now, kind: body.kind, scope: body.scope, userKey: body.scope === "private" ? userId : "", ctx, openQuestions, reason: "owner request" });
        if (!res.ok) throw new HttpError(422, res.code, res.message);
        return { status: res.created ? 201 : 200, body: { brief: { id: res.id, version: res.version, created: res.created } } };
      });
    },
  });
}
