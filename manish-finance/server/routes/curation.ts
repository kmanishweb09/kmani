import { z } from "zod";
import type { CompiledClaim } from "../../shared/archive/compile";
import { localDate } from "../../shared/dates";
import { stableStringify } from "../../shared/text/hash";
import { requireOwner } from "../auth";
import { BRIEF_TZ } from "../briefCompiler";
import { DRAFT_KINDS, type DraftKind, type Evaluation, evaluateDraft } from "../curation";
import { idempotent, newId, parseJsonColumn, requireDb } from "../db";
import { HttpError, privateJson, readJson, sha256Hex, validationError } from "../http";
import { changeEntityKey, getResearch, type HistoryEntry, type ResearchView } from "../research";
import type { Router } from "../router";
import type { D1Database, RequestContext } from "../types";

/**
 * Owner research maintenance API. Every query is scoped to the authenticated owner's ID (drafts are
 * never visible to or editable by another account), every write is idempotent, draft edits use
 * revision numbers, and publishing re-validates and refuses when the record changed underneath.
 */

const DRAFT_BODY = 128 * 1024;
const IMPORT_BODY = 512 * 1024;
export const IMPORT_FORMAT = "finance-research-import-v1";

const zKind = z.enum(DRAFT_KINDS);
const zNewDraft = z.object({ kind: zKind, payload: z.record(z.string(), z.unknown()), evidence: z.record(z.string(), z.unknown()).default({ documents: [] }), note: z.string().trim().max(400).nullish() });
const zPatch = z.object({ revision: z.number().int().min(1), payload: z.record(z.string(), z.unknown()).optional(), evidence: z.record(z.string(), z.unknown()).optional(), note: z.string().trim().max(400).nullish(), rebase: z.boolean().optional() });
const zRevisionOnly = z.object({ revision: z.number().int().min(1), note: z.string().trim().max(400).nullish() });
const zImport = z.object({
  format: z.literal(IMPORT_FORMAT),
  items: z.array(z.object({ kind: zKind, payload: z.record(z.string(), z.unknown()), evidence: z.record(z.string(), z.unknown()).default({ documents: [] }), note: z.string().trim().max(400).nullish() })).min(1).max(100),
});
const zRevert = z.object({ note: z.string().trim().min(5, "Say why the change is being rolled back.").max(400) });

interface DraftRow {
  id: string;
  owner_id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  payload_json: string;
  evidence_json: string;
  note: string | null;
  base_seq: number;
  revision: number;
  status: string;
  origin: string;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
  published_change_id: string | null;
  published_at: string | null;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw validationError(r.error.issues);
  return r.data;
}

function ctxFor(c: RequestContext, view: ResearchView, idStem = "preview") {
  return { view, today: localDate(c.now, BRIEF_TZ), nowIso: c.now.toISOString(), idStem };
}

function evaluationView(e: Evaluation) {
  return { ok: e.ok, errors: e.errors, warnings: e.warnings, duplicates: e.duplicates, entity: e.entity, fields: e.fields, diff: e.diff, currentSeq: e.currentSeq, change: e.change ? { changeType: e.change.changeType, documents: e.change.evidence.documents, claims: e.change.evidence.claims } : null };
}

function draftView(r: DraftRow, e?: Evaluation) {
  const conflict = e && r.status === "draft" ? e.currentSeq > r.base_seq : false;
  return {
    id: r.id,
    kind: r.kind,
    entityType: r.entity_type,
    entityId: r.entity_id,
    payload: parseJsonColumn<Record<string, unknown>>(r.payload_json, {}),
    evidence: parseJsonColumn<Record<string, unknown>>(r.evidence_json, {}),
    note: r.note,
    baseSeq: r.base_seq,
    revision: r.revision,
    status: r.status,
    origin: r.origin,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedChangeId: r.published_change_id,
    publishedAt: r.published_at,
    ...(e ? { evaluation: evaluationView(e), conflict } : {}),
  };
}

async function loadDraft(db: D1Database, ownerId: string, id: string): Promise<DraftRow> {
  // Scoped by owner: a draft created under another account is simply not found.
  const row = await db.prepare("SELECT * FROM finance_research_drafts WHERE id = ? AND owner_id = ?").bind(id, ownerId).first<DraftRow>();
  if (!row) throw new HttpError(404, "NOT_FOUND", "Draft not found.");
  return row;
}

async function evaluateRow(c: RequestContext, view: ResearchView, r: { kind: string; payload_json: string; evidence_json: string }, idStem = "preview"): Promise<Evaluation> {
  return evaluateDraft(r.kind as DraftKind, parseJsonColumn(r.payload_json, {}), parseJsonColumn(r.evidence_json, {}), ctxFor(c, view, idStem));
}

async function openDraftWithKey(db: D1Database, ownerId: string, key: string, exceptId?: string): Promise<{ id: string } | null> {
  return db.prepare("SELECT id FROM finance_research_drafts WHERE owner_id = ? AND dedupe_key = ? AND status = 'draft' AND id != ?").bind(ownerId, key, exceptId ?? "").first<{ id: string }>();
}

/** Converts compiled values back to authoring form (claim IDs → citations) for edit templates. */
function toInput(view: ResearchView, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => toInput(view, v));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "ev" && Array.isArray(v)) {
      out.cites = (v as string[])
        .map((id) => view.claims[id])
        .filter((x): x is CompiledClaim => Boolean(x))
        .map((cl) => ({ doc: cl.documentId, locator: cl.locator, excerpt: cl.excerpt, status: cl.status, checkedAt: cl.checkedAt, method: cl.method, note: cl.note }));
    } else out[k] = toInput(view, v);
  }
  return out;
}

function latestEffective(view: ResearchView, entityKey: string): HistoryEntry | null {
  const list = (view.history.get(entityKey) ?? []).filter((h) => h.changeType !== "revert" && !h.revertedBy);
  return list[list.length - 1] ?? null;
}

async function entityMaxSeq(db: D1Database, type: string, id: string): Promise<number> {
  return (await db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM finance_published_changes WHERE entity_type = ? AND entity_id = ?").bind(type, id).first<{ m: number }>())?.m ?? 0;
}

export function registerCurationRoutes(r: Router): void {
  r.add({
    method: "GET",
    pattern: "/api/finance/admin/drafts",
    access: "owner",
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const status = c.url.searchParams.get("status") ?? "draft";
      if (!["draft", "published", "discarded", "all"].includes(status)) throw new HttpError(400, "INVALID_STATUS", "status must be draft, published, discarded or all.");
      const rows =
        status === "all"
          ? await db.prepare("SELECT * FROM finance_research_drafts WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200").bind(ownerId).all<DraftRow>()
          : await db.prepare("SELECT * FROM finance_research_drafts WHERE owner_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 200").bind(ownerId, status).all<DraftRow>();
      const view = await getResearch(db);
      const items = [];
      for (const row of rows.results ?? []) {
        const e = row.status === "draft" ? await evaluateRow(c, view, row) : undefined;
        const v = draftView(row, e);
        items.push({ ...v, payload: undefined, evidence: undefined, summary: e ? { ok: e.ok, errors: e.errors.length, warnings: e.warnings.length, duplicates: e.duplicates.length, entityLabel: e.entity.label } : null });
      }
      return privateJson({ items });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/drafts/preview",
    access: "owner",
    bodyLimit: DRAFT_BODY,
    handler: async (c) => {
      requireOwner(c);
      const db = requireDb(c);
      const body = parse(zNewDraft, await readJson(c.request, DRAFT_BODY));
      const view = await getResearch(db);
      const e = await evaluateDraft(body.kind, body.payload, body.evidence, ctxFor(c, view));
      return privateJson({ evaluation: evaluationView(e) });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/admin/drafts/template",
    access: "owner",
    handler: async (c) => {
      requireOwner(c);
      const db = requireDb(c);
      const kind = parse(zKind, c.url.searchParams.get("kind"));
      const entityId = c.url.searchParams.get("entityId") ?? "";
      const view = await getResearch(db);
      const deal = view.dealById.get(entityId);
      const company = view.companyById.get(entityId);
      const claim = view.claims[entityId];
      const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, toInput(view, o[k])]));
      let payload: Record<string, unknown>;
      switch (kind) {
        case "company_edit":
          if (!company) throw new HttpError(404, "NOT_FOUND", "Company not found.");
          payload = { companyId: company.id, fields: pick(company as unknown as Record<string, unknown>, ["displayName", "subsector"]), cites: [] };
          break;
        case "deal_edit":
          if (!deal) throw new HttpError(404, "NOT_FOUND", "Deal not found.");
          payload = { dealId: deal.id, fields: pick(deal as unknown as Record<string, unknown>, ["otherParties", "advisers"]), cites: [] };
          break;
        case "term_revision":
          if (!deal) throw new HttpError(404, "NOT_FOUND", "Deal not found.");
          payload = { dealId: deal.id, term: { metric: "ev_ebitda", ratio: null, kind: "announced", asOf: deal.announced.date, status: "reported", multipleBasis: { periodType: "LTM", periodEnd: deal.announced.date, periodLabel: "LTM to …", accountingBasis: "not_stated", perimeter: "Target group, consolidated", adjusted: false }, cites: [{ doc: "d1", locator: null, excerpt: null, status: "human_reviewed", checkedAt: null, method: "owner_entry" }] }, supersedesTermId: null };
          break;
        case "observation":
          if (!company) throw new HttpError(404, "NOT_FOUND", "Company not found.");
          payload = { companyId: company.id, observation: { metric: "revenue", value: null, nullReason: null, unit: "currency", currency: company.country === "IN" ? "INR" : "USD", scale: company.country === "IN" ? "crore" : "million", period: { type: "FY", end: "", months: 12, label: "" }, scope: "consolidated", basis: "reported", cites: [{ doc: "d1", locator: null, excerpt: null, status: "human_reviewed", checkedAt: null, method: "owner_entry" }] }, supersedesObservationId: null };
          break;
        case "deal_event":
          if (!deal) throw new HttpError(404, "NOT_FOUND", "Deal not found.");
          payload = { dealId: deal.id, event: { type: "subsequent", date: { date: "", precision: "day" }, publishedDate: null, title: "", statusAfter: null, cites: [{ doc: "d1", locator: null, excerpt: null, status: "human_reviewed", checkedAt: null, method: "owner_entry" }] } };
          break;
        case "claim_verification":
          if (!claim) throw new HttpError(404, "NOT_FOUND", "Claim not found.");
          payload = { claimId: claim.id, status: "source_checked", checkedValue: "", locator: claim.locator ?? "", excerpt: claim.excerpt ?? "", retrievedAt: null, note: null };
          break;
        case "company_create":
          payload = { company: { id: "", legalName: "", displayName: "", aliases: [], tickers: [], country: "IN", sector: "fig", subsector: "", lifecycle: { status: "active" }, identityCites: [{ doc: "d1", status: "human_reviewed", checkedAt: null, method: "owner_entry" }], businessModel: { summary: "", customers: "", products: "", revenueModel: "", costDrivers: "", positioning: "", risks: [] }, observations: [], peers: [], ownership: [], recordUpdated: localDate(c.now, BRIEF_TZ) } };
          break;
        case "deal_create":
          payload = { deal: { id: "", title: "", dealType: "control_acquisition", buyerType: "strategic", sector: "fig", subsector: "", peerGroup: "banks", acquirer: { name: "", country: "IN", cites: [] }, target: { name: "", country: "IN", cites: [] }, perimeter: "", stake: { acquiredPct: null, resultingPct: null, cites: [] }, announced: { date: "", precision: "day", cites: [] }, status: { value: "announced", asOf: "", cites: [] }, terms: [], payment: { mix: ["undisclosed"], text: "", cites: [] }, events: [], advisers: { disclosure: "not_researched", list: [] }, researchCutoff: localDate(c.now, BRIEF_TZ), recordUpdated: localDate(c.now, BRIEF_TZ) } };
          break;
      }
      const documents = claim ? [] : [{ ref: "d1", url: "", publisher: "", title: "", documentType: "press_release", isPrimary: true, publishedDate: null, retrievedAt: null }];
      return privateJson({ kind, payload, evidence: { documents } });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/drafts",
    access: "owner",
    bodyLimit: DRAFT_BODY,
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zNewDraft, await readJson(c.request, DRAFT_BODY));
      return idempotent(c, ownerId, "admin.drafts.create", body, async () => {
        const view = await getResearch(db);
        const e = await evaluateDraft(body.kind, body.payload, body.evidence, ctxFor(c, view));
        const existing = await openDraftWithKey(db, ownerId, e.dedupeKey);
        if (existing) throw new HttpError(409, "DUPLICATE_DRAFT", "An open draft already proposes this change.", { draftId: existing.id });
        const id = `dr_${newId()}`;
        const nowIso = c.now.toISOString();
        const row: DraftRow = { id, owner_id: ownerId, kind: body.kind, entity_type: e.entity.type, entity_id: e.entity.id, payload_json: JSON.stringify(body.payload), evidence_json: JSON.stringify(body.evidence), note: body.note ?? null, base_seq: e.currentSeq, revision: 1, status: "draft", origin: "manual", dedupe_key: e.dedupeKey, created_at: nowIso, updated_at: nowIso, published_change_id: null, published_at: null };
        await db
          .prepare("INSERT INTO finance_research_drafts (id, owner_id, kind, entity_type, entity_id, payload_json, evidence_json, note, base_seq, revision, status, origin, dedupe_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'draft', 'manual', ?, ?, ?)")
          .bind(id, ownerId, row.kind, row.entity_type, row.entity_id, row.payload_json, row.evidence_json, row.note, row.base_seq, row.dedupe_key, nowIso, nowIso)
          .run();
        return { status: 201, body: { draft: draftView(row, e) } };
      });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/admin/drafts/:id",
    access: "owner",
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const row = await loadDraft(db, ownerId, c.params.id ?? "");
      const view = await getResearch(db);
      return privateJson({ draft: draftView(row, await evaluateRow(c, view, row)) });
    },
  });

  r.add({
    method: "PATCH",
    pattern: "/api/finance/admin/drafts/:id",
    access: "owner",
    bodyLimit: DRAFT_BODY,
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zPatch, await readJson(c.request, DRAFT_BODY));
      const row = await loadDraft(db, ownerId, c.params.id ?? "");
      if (row.status !== "draft") throw new HttpError(409, "NOT_EDITABLE", `This draft was already ${row.status}; start a new draft to change the published record.`);
      const view = await getResearch(db);
      const next = { ...row, payload_json: body.payload ? JSON.stringify(body.payload) : row.payload_json, evidence_json: body.evidence ? JSON.stringify(body.evidence) : row.evidence_json, note: body.note === undefined ? row.note : (body.note ?? null) };
      const e = await evaluateRow(c, view, next);
      if (await openDraftWithKey(db, ownerId, e.dedupeKey, row.id)) throw new HttpError(409, "DUPLICATE_DRAFT", "Another open draft already proposes this change.");
      const baseSeq = body.rebase ? e.currentSeq : row.base_seq;
      const nowIso = c.now.toISOString();
      const res = await db
        .prepare("UPDATE finance_research_drafts SET payload_json = ?, evidence_json = ?, note = ?, entity_type = ?, entity_id = ?, dedupe_key = ?, base_seq = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND revision = ? AND status = 'draft'")
        .bind(next.payload_json, next.evidence_json, next.note, e.entity.type, e.entity.id, e.dedupeKey, baseSeq, nowIso, row.id, ownerId, body.revision)
        .run();
      if (!res.meta.changes) {
        const current = await loadDraft(db, ownerId, row.id);
        throw new HttpError(409, "STALE_DRAFT", "This draft was changed in another tab or device. Reload it before editing.", { draft: draftView(current) });
      }
      const updated = await loadDraft(db, ownerId, row.id);
      return privateJson({ draft: draftView(updated, e) });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/drafts/:id/publish",
    access: "owner",
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zRevisionOnly, await readJson(c.request, 4096));
      const id = c.params.id ?? "";
      return idempotent(c, ownerId, `admin.drafts.publish.${id}`, body, async () => {
        const row = await loadDraft(db, ownerId, id);
        if (row.status !== "draft") throw new HttpError(409, "NOT_EDITABLE", `This draft was already ${row.status}.`);
        if (row.revision !== body.revision) throw new HttpError(409, "STALE_DRAFT", "This draft changed since you last loaded it. Review the latest version before publishing.", { draft: draftView(row) });
        const view = await getResearch(db);
        const changeId = `pc_${newId()}`;
        const e = await evaluateRow(c, view, row, changeId.slice(3, 15));
        if (!e.ok || !e.change) throw new HttpError(422, "DRAFT_INVALID", "Fix the errors in this draft before publishing.", { evaluation: evaluationView(e) });
        if (e.currentSeq > row.base_seq) {
          throw new HttpError(409, "REVISION_CONFLICT", `${e.entity.label} changed after this draft was prepared. Review the current values, then rebase the draft.`, { evaluation: evaluationView(e), baseSeq: row.base_seq, currentSeq: e.currentSeq });
        }
        // One transaction: the change is inserted only while the draft is still this revision and no other
        // change to the same record landed in between; the draft is marked published only if it was.
        const seenSeq = await entityMaxSeq(db, e.entity.type, e.entity.id);
        const nowIso = c.now.toISOString();
        await db.batch([
          db
            .prepare(
              "INSERT INTO finance_published_changes (id, entity_type, entity_id, change_type, payload_json, evidence_json, note, review_item_id, published_at) SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM finance_research_drafts WHERE id = ? AND owner_id = ? AND status = 'draft' AND revision = ?) AND (SELECT COALESCE(MAX(seq), 0) FROM finance_published_changes WHERE entity_type = ? AND entity_id = ?) = ?",
            )
            .bind(changeId, e.entity.type, e.entity.id, e.change.changeType, JSON.stringify(e.change.payload), JSON.stringify(e.change.evidence), body.note ?? row.note, nowIso, row.id, ownerId, body.revision, e.entity.type, e.entity.id, seenSeq),
          db
            .prepare("UPDATE finance_research_drafts SET status = 'published', published_change_id = ?, published_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'draft' AND EXISTS (SELECT 1 FROM finance_published_changes WHERE id = ?)")
            .bind(changeId, nowIso, nowIso, row.id, ownerId, changeId),
        ]);
        const published = await db.prepare("SELECT seq FROM finance_published_changes WHERE id = ?").bind(changeId).first<{ seq: number }>();
        if (!published) throw new HttpError(409, "REVISION_CONFLICT", "The record or the draft changed while publishing. Reload and try again.");
        return { status: 200, body: { draft: draftView(await loadDraft(db, ownerId, row.id)), changeId, seq: published.seq, entity: e.entity, warnings: e.warnings } };
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/drafts/:id/discard",
    access: "owner",
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zRevisionOnly, await readJson(c.request, 4096));
      const row = await loadDraft(db, ownerId, c.params.id ?? "");
      const res = await db
        .prepare("UPDATE finance_research_drafts SET status = 'discarded', note = COALESCE(?, note), updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'draft' AND revision = ?")
        .bind(body.note ?? null, c.now.toISOString(), row.id, ownerId, body.revision)
        .run();
      if (!res.meta.changes) throw new HttpError(409, row.status === "draft" ? "STALE_DRAFT" : "NOT_EDITABLE", row.status === "draft" ? "This draft changed since you last loaded it." : `This draft was already ${row.status}.`);
      return privateJson({ draft: draftView(await loadDraft(db, ownerId, row.id)) });
    },
  });

  const importPreview = async (c: RequestContext, db: D1Database, ownerId: string, body: z.infer<typeof zImport>) => {
    const view = await getResearch(db);
    const seen = new Map<string, number>();
    const items = [];
    for (const [i, it] of body.items.entries()) {
      const e = await evaluateDraft(it.kind, it.payload, it.evidence, ctxFor(c, view));
      const inFile = seen.get(e.dedupeKey);
      if (inFile === undefined) seen.set(e.dedupeKey, i);
      const open = await openDraftWithKey(db, ownerId, e.dedupeKey);
      const exactPublished = e.duplicates.some((d) => d.exact);
      const action = inFile !== undefined ? "skip_duplicate_in_file" : open ? "skip_open_draft" : exactPublished ? "skip_duplicate_published" : e.ok ? "create_draft" : "create_draft_with_errors";
      items.push({ index: i, kind: it.kind, action, duplicateOfIndex: inFile ?? null, openDraftId: open?.id ?? null, evaluation: evaluationView(e), dedupeKey: e.dedupeKey, entity: e.entity, currentSeq: e.currentSeq });
    }
    return items;
  };

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/import/preview",
    access: "owner",
    bodyLimit: IMPORT_BODY,
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zImport, await readJson(c.request, IMPORT_BODY));
      const items = await importPreview(c, db, ownerId, body);
      const count = (a: string) => items.filter((x) => x.action === a).length;
      return privateJson({ items: items.map(({ dedupeKey: _k, currentSeq: _s, ...rest }) => rest), summary: { total: items.length, create: count("create_draft"), createWithErrors: count("create_draft_with_errors"), skipped: items.length - count("create_draft") - count("create_draft_with_errors") } });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/import",
    access: "owner",
    bodyLimit: IMPORT_BODY,
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zImport, await readJson(c.request, IMPORT_BODY));
      return idempotent(c, ownerId, "admin.import", { h: await sha256Hex(stableStringify(body), 32) }, async () => {
        const items = await importPreview(c, db, ownerId, body);
        const batch = `import:${newId().slice(0, 12)}`;
        const nowIso = c.now.toISOString();
        const created: Array<{ index: number; draftId: string }> = [];
        for (const it of items) {
          if (it.action !== "create_draft" && it.action !== "create_draft_with_errors") continue;
          const src = body.items[it.index] as z.infer<typeof zImport>["items"][number];
          const id = `dr_${newId()}`;
          const res = await db
            .prepare("INSERT INTO finance_research_drafts (id, owner_id, kind, entity_type, entity_id, payload_json, evidence_json, note, base_seq, revision, status, origin, dedupe_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?, ?) ON CONFLICT DO NOTHING")
            .bind(id, ownerId, src.kind, it.entity.type, it.entity.id, JSON.stringify(src.payload), JSON.stringify(src.evidence), src.note ?? null, it.currentSeq, batch, it.dedupeKey, nowIso, nowIso)
            .run();
          if (res.meta.changes) created.push({ index: it.index, draftId: id });
        }
        return { status: 201, body: { batch, created, skipped: items.filter((x) => !created.some((cr) => cr.index === x.index)).map((x) => ({ index: x.index, action: x.action })) } };
      });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/admin/history",
    access: "owner",
    handler: async (c) => {
      requireOwner(c);
      const db = requireDb(c);
      const view = await getResearch(db);
      const entity = c.url.searchParams.get("entity");
      const all = entity ? [[entity, view.history.get(entity) ?? []] as const] : [...view.history.entries()];
      const items = all.flatMap(([key, list]) => list.map((h) => ({ entity: key, ...h, canRevert: h.changeType !== "revert" && !h.revertedBy && latestEffective(view, key)?.changeId === h.changeId })));
      items.sort((a, b) => b.seq - a.seq);
      const warnings = entity ? view.warnings.filter((w) => w.entity === entity) : view.warnings;
      return privateJson({ items: items.slice(0, 200), warnings: [...warnings].sort((a, b) => b.seq - a.seq) });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/admin/changes/:id/revert",
    access: "owner",
    handler: async (c) => {
      const ownerId = requireOwner(c);
      const db = requireDb(c);
      const body = parse(zRevert, await readJson(c.request, 4096));
      const id = c.params.id ?? "";
      return idempotent(c, ownerId, `admin.changes.revert.${id}`, body, async () => {
        const target = await db.prepare("SELECT seq, id, entity_type, entity_id, change_type FROM finance_published_changes WHERE id = ?").bind(id).first<{ seq: number; id: string; entity_type: string; entity_id: string; change_type: string }>();
        if (!target) throw new HttpError(404, "NOT_FOUND", "Published change not found.");
        if (target.change_type === "revert") throw new HttpError(409, "CANNOT_REVERT_REVERT", "A rollback cannot itself be rolled back; publish the change again as a new draft.");
        const view = await getResearch(db);
        const key = changeEntityKey(target);
        const entry = (view.history.get(key) ?? []).find((h) => h.changeId === id);
        if (entry?.revertedBy) throw new HttpError(409, "ALREADY_REVERTED", "This change was already rolled back.");
        const latest = latestEffective(view, key);
        if (latest && latest.changeId !== id) throw new HttpError(409, "LATER_CHANGES", "Later changes to this record depend on it. Roll those back first (newest first).", { latestChangeId: latest.changeId });
        const revertId = `pc_${newId()}`;
        const seenSeq = await entityMaxSeq(db, target.entity_type, target.entity_id);
        await db
          .prepare("INSERT INTO finance_published_changes (id, entity_type, entity_id, change_type, payload_json, evidence_json, note, review_item_id, published_at) SELECT ?, ?, ?, 'revert', ?, '{}', ?, NULL, ? WHERE (SELECT COALESCE(MAX(seq), 0) FROM finance_published_changes WHERE entity_type = ? AND entity_id = ?) = ?")
          .bind(revertId, target.entity_type, target.entity_id, JSON.stringify({ revertsChangeId: id, revertedChangeType: target.change_type }), body.note, c.now.toISOString(), target.entity_type, target.entity_id, seenSeq)
          .run();
        const ok = await db.prepare("SELECT seq FROM finance_published_changes WHERE id = ?").bind(revertId).first<{ seq: number }>();
        if (!ok) throw new HttpError(409, "REVISION_CONFLICT", "The record changed while rolling back. Reload and try again.");
        return { status: 200, body: { id: revertId, reverts: id, entity: key } };
      });
    },
  });
}
