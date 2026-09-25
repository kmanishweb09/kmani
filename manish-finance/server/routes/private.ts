import { localDate } from "../../shared/dates";
import { DEFAULT_PREFERENCES } from "../../shared/defaults";
import { filtersOnly, matchesFilters } from "../../shared/dealQuery";
import { scheduleReview, SCHEDULER_VERSION, type Rating } from "../../shared/review/scheduler";
import {
  type DealFilters,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportBundle,
  type Preferences,
  zExportBundle,
  zImportCommit,
  zInterviewAttempt,
  zMemoryUpsert,
  zModelCreate,
  zModelPatch,
  zNoteCreate,
  zNotePatch,
  zPreferencesPatch,
  zProgressUpdate,
  zReviewSubmit,
  zSavedSearchCreate,
  zWatchCreate,
} from "../../shared/schemas/private";
import { toCsv } from "../../shared/text/csv";
import { requireOwner } from "../auth";
import { idempotencyKey, idempotent, newId, parseJsonColumn, requireDb } from "../db";
import { HttpError, privateJson, readJson, sha256Hex, textResponse, validationError } from "../http";
import {
  cardFromRow,
  type MemoryCardRow,
  type MemoryRecordRow,
  type ModelRow,
  modelFromRow,
  type NoteRow,
  noteFromRow,
  recordFromRows,
  type SavedSearchRow,
  savedSearchFromRow,
  type WatchRow,
} from "../privateStore";
import { archive, getResearch, type ResearchView } from "../research";
import type { Router } from "../router";
import type { D1Database, D1PreparedStatement, RequestContext } from "../types";

const NOTE_BODY_LIMIT = 256 * 1024;
const IMPORT_LIMIT = 5 * 1024 * 1024;

function uid(c: RequestContext): string {
  return requireOwner(c);
}

function nowIso(c: RequestContext): string {
  return c.now.toISOString();
}

function parse<T>(schema: { safeParse: (x: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw validationError(r.error.issues);
  return r.data;
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function loadPrefs(db: D1Database, userId: string): Promise<{ prefs: Preferences; revision: number }> {
  const row = await db.prepare("SELECT prefs_json, revision FROM finance_preferences WHERE user_id = ?").bind(userId).first<{ prefs_json: string; revision: number }>();
  if (!row) return { prefs: { ...DEFAULT_PREFERENCES }, revision: 0 };
  return { prefs: { ...DEFAULT_PREFERENCES, ...parseJsonColumn<Partial<Preferences>>(row.prefs_json, {}) }, revision: row.revision };
}

async function userToday(c: RequestContext, userId: string): Promise<{ today: string; timezone: string }> {
  const { prefs } = await loadPrefs(requireDb(c), userId);
  let tz = prefs.timezone || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "Asia/Kolkata";
  }
  return { today: localDate(c.now, tz), timezone: tz };
}

function noteLinkStatements(db: D1Database, noteId: string, userId: string, links: Array<{ type: string; id: string }>): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM finance_note_links WHERE note_id = ? AND user_id = ?").bind(noteId, userId)];
  for (const l of links) stmts.push(db.prepare("INSERT OR IGNORE INTO finance_note_links (note_id, user_id, entity_type, entity_id) VALUES (?, ?, ?, ?)").bind(noteId, userId, l.type, l.id));
  return stmts;
}

async function getNote(db: D1Database, userId: string, id: string): Promise<NoteRow | null> {
  return db.prepare("SELECT * FROM finance_notes WHERE id = ? AND user_id = ?").bind(id, userId).first<NoteRow>();
}

/** Validates that evidence/claim references resolve to published research or the user's own notes. */
async function validateRefs(c: RequestContext, userId: string, view: ResearchView, refs: Array<{ kind: string; id: string }>): Promise<void> {
  for (const r of refs) {
    if (r.kind === "claim" && !view.claims[r.id]) throw new HttpError(400, "UNKNOWN_SOURCE_REF", `Unknown evidence ID ${r.id}. Cards must cite a published source or your own note.`);
    if (r.kind === "note" && !(await getNote(requireDb(c), userId, r.id))) throw new HttpError(400, "UNKNOWN_SOURCE_REF", `Note ${r.id} not found.`);
    if (r.kind === "glossary" && !archive.glossary.some((g) => g.id === r.id)) throw new HttpError(400, "UNKNOWN_SOURCE_REF", `Unknown glossary term ${r.id}.`);
    if (r.kind === "module" && !archive.modules.some((m) => m.id === r.id)) throw new HttpError(400, "UNKNOWN_SOURCE_REF", `Unknown module ${r.id}.`);
  }
}

function entityTitle(view: ResearchView, kind: string, id: string): string {
  if (kind === "deal") return view.dealById.get(id)?.title ?? id;
  if (kind === "company") return view.companyById.get(id)?.displayName ?? id;
  if (kind === "sector") return archive.sectors.find((s) => s.slug === id)?.name ?? id;
  if (kind === "concept") return archive.glossary.find((g) => g.id === id)?.term ?? id;
  return id;
}

function entityVersion(view: ResearchView, kind: string, id: string): string | null {
  if (kind === "deal") return view.summaryById.get(id)?.lastChangedAt ?? null;
  if (kind === "company") return view.companyById.get(id)?.recordUpdated ?? null;
  if (kind === "concept") return archive.version;
  return null;
}

function matchingDealsChangedSince(view: ResearchView, filters: DealFilters, watermark: string | null): number {
  if (!watermark) return 0;
  return view.summaries.filter((d) => matchesFilters(d, filters, view.dealSearch.get(d.id)) && d.lastChangedAt > watermark).length;
}

function maxChanged(view: ResearchView, filters: DealFilters): string | null {
  const list = view.summaries.filter((d) => matchesFilters(d, filters, view.dealSearch.get(d.id))).map((d) => d.lastChangedAt);
  return list.length ? list.sort().pop() ?? null : null;
}

async function buildExport(c: RequestContext, userId: string): Promise<ExportBundle> {
  const db = requireDb(c);
  const all = async <T>(sql: string) => ((await db.prepare(sql).bind(userId).all<T>()).results ?? []) as T[];
  const notes = await all<NoteRow>("SELECT * FROM finance_notes WHERE user_id = ? ORDER BY created_at");
  const watches = await all<WatchRow>("SELECT * FROM finance_watches WHERE user_id = ? ORDER BY created_at");
  const searches = await all<SavedSearchRow>("SELECT * FROM finance_saved_searches WHERE user_id = ? ORDER BY created_at");
  const models = await all<ModelRow>("SELECT * FROM finance_models WHERE user_id = ? ORDER BY created_at");
  const records = await all<MemoryRecordRow>("SELECT * FROM finance_memory_records WHERE user_id = ? ORDER BY created_at");
  const cards = await all<MemoryCardRow>("SELECT * FROM finance_memory_cards WHERE user_id = ? ORDER BY created_at");
  const log = await all<Record<string, unknown>>("SELECT * FROM finance_review_log WHERE user_id = ? ORDER BY reviewed_at");
  const progress = await all<Record<string, unknown>>("SELECT * FROM finance_progress WHERE user_id = ? ORDER BY updated_at");
  const attempts = await all<Record<string, unknown>>("SELECT * FROM finance_interview_attempts WHERE user_id = ? ORDER BY created_at");
  const prefs = await loadPrefs(db, userId);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: nowIso(c),
    archiveVersion: archive.version,
    notes: notes.map((n) => {
      const x = noteFromRow(n);
      return { id: x.id, title: x.title, body: x.body, template: x.template, tags: x.tags, links: x.links, evidenceIds: x.evidenceIds, revision: x.revision, createdAt: x.createdAt, updatedAt: x.updatedAt, archivedAt: x.archivedAt };
    }),
    watches: watches.map((w) => ({ id: w.id, kind: w.kind as "deal", entityId: w.entity_id, createdAt: w.created_at, lastViewedAt: w.last_viewed_at, watermark: w.watermark, saved: Boolean(w.saved), following: Boolean(w.following) })),
    savedSearches: searches.map((s) => {
      const x = savedSearchFromRow(s);
      return { id: x.id, name: x.name, filters: x.filters, createdAt: x.createdAt, lastViewedAt: x.lastViewedAt, watermark: x.watermark };
    }),
    models: models.map((m) => {
      const x = modelFromRow(m);
      return { id: x.id, modelType: x.modelType, title: x.title, calcVersion: x.calcVersion, sourceSnapshot: { ...x.sourceSnapshot, reported: x.sourceSnapshot.reported ?? {} }, assumptions: x.assumptions, outputs: x.outputs, scenarios: x.scenarios, revision: x.revision, createdAt: x.createdAt, updatedAt: x.updatedAt };
    }),
    memory: {
      records: records.map((r) => ({ id: r.id, subjectType: r.subject_type as "deal", subjectId: r.subject_id, sourceVersion: r.source_version, createdAt: r.created_at, updatedAt: r.updated_at })),
      cards: cards.map((k) => {
        const x = cardFromRow(k);
        return { id: x.id, recordId: x.recordId, cardType: x.cardType, prompt: x.prompt, answer: x.answer, sourceRefs: x.sourceRefs, sourceVersion: x.sourceVersion, stage: x.stage, dueDate: x.dueDate, suspended: x.suspended, createdAt: x.createdAt, updatedAt: x.updatedAt };
      }),
      reviewLog: log.map((l) => ({
        id: String(l.id),
        cardId: String(l.card_id),
        reviewedAt: String(l.reviewed_at),
        reviewDate: String(l.review_date),
        rating: l.rating as Rating,
        stageBefore: Number(l.stage_before),
        stageAfter: Number(l.stage_after),
        dueBefore: String(l.due_before),
        dueAfter: String(l.due_after),
        schedulerVersion: String(l.scheduler_version),
      })),
    },
    preferences: prefs.revision ? prefs.prefs : null,
    progress: progress.map((p) => ({ itemType: p.item_type as "module", itemId: String(p.item_id), status: p.status as "completed", answer: parseJsonColumn(p.answer_json as string, null), correct: p.correct === null || p.correct === undefined ? null : Boolean(p.correct), updatedAt: String(p.updated_at) })),
    interviewAttempts: attempts.map((a) => ({
      id: String(a.id),
      promptId: String(a.prompt_id),
      subject: parseJsonColumn(a.subject_json as string, null),
      response: String(a.response),
      durationSec: Number(a.duration_sec),
      selfRubric: parseJsonColumn(a.self_rubric_json as string, {}),
      reflection: String(a.reflection ?? ""),
      createdAt: String(a.created_at),
    })),
  } as ExportBundle;
}

type Collection = "notes" | "watches" | "savedSearches" | "models" | "memoryRecords" | "memoryCards" | "reviewLog" | "progress" | "interviewAttempts" | "preferences";

interface PreviewRecord {
  key: string;
  collection: Collection;
  id: string;
  title: string;
  status: "new" | "duplicate" | "conflict" | "invalid";
  reason: string | null;
  foreign?: boolean;
}

const TABLE: Record<Exclude<Collection, "preferences" | "progress">, string> = {
  notes: "finance_notes",
  watches: "finance_watches",
  savedSearches: "finance_saved_searches",
  models: "finance_models",
  memoryRecords: "finance_memory_records",
  memoryCards: "finance_memory_cards",
  reviewLog: "finance_review_log",
  interviewAttempts: "finance_interview_attempts",
};

async function fingerprint(x: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(x), 24);
}

async function previewImport(c: RequestContext, userId: string, bundle: ExportBundle): Promise<PreviewRecord[]> {
  const db = requireDb(c);
  const existing = await buildExport(c, userId);
  const records: PreviewRecord[] = [];
  const check = async (collection: Exclude<Collection, "preferences" | "progress">, items: Array<{ id: string } & Record<string, unknown>>, mine: Array<{ id: string } & Record<string, unknown>>, title: (x: Record<string, unknown>) => string, compare: (x: Record<string, unknown>) => unknown) => {
    const byId = new Map(mine.map((m) => [m.id, m]));
    for (const it of items) {
      const key = `${collection}:${it.id}`;
      const own = byId.get(it.id);
      if (own) {
        const same = (await fingerprint(compare(own))) === (await fingerprint(compare(it)));
        records.push({ key, collection, id: it.id, title: title(it), status: same ? "duplicate" : "conflict", reason: same ? "Identical record already exists" : "Same ID with different content" });
      } else {
        const foreign = await db.prepare(`SELECT 1 AS x FROM ${TABLE[collection]} WHERE id = ? AND user_id != ?`).bind(it.id, userId).first();
        records.push({ key, collection, id: it.id, title: title(it), status: foreign ? "conflict" : "new", reason: foreign ? "ID is used by another account; can only be imported as a copy" : null, ...(foreign ? { foreign: true } : {}) });
      }
    }
  };
  await check("notes", bundle.notes, existing.notes, (x) => String(x.title), (x) => ({ title: x.title, body: x.body, tags: x.tags, template: x.template }));
  await check("watches", bundle.watches, existing.watches, (x) => `${x.kind} ${x.entityId}`, (x) => ({ kind: x.kind, entityId: x.entityId }));
  await check("savedSearches", bundle.savedSearches, existing.savedSearches, (x) => String(x.name), (x) => ({ name: x.name, filters: x.filters }));
  await check("models", bundle.models, existing.models, (x) => String(x.title), (x) => ({ title: x.title, assumptions: x.assumptions, modelType: x.modelType }));
  await check("memoryRecords", bundle.memory.records, existing.memory.records, (x) => `${x.subjectType} ${x.subjectId}`, (x) => ({ subjectType: x.subjectType, subjectId: x.subjectId }));
  await check("memoryCards", bundle.memory.cards, existing.memory.cards, (x) => String(x.prompt).slice(0, 80), (x) => ({ prompt: x.prompt, answer: x.answer, cardType: x.cardType }));
  await check("reviewLog", bundle.memory.reviewLog, existing.memory.reviewLog, (x) => `review ${x.reviewDate}`, (x) => ({ cardId: x.cardId, reviewedAt: x.reviewedAt, rating: x.rating }));
  await check("interviewAttempts", bundle.interviewAttempts, existing.interviewAttempts, (x) => `attempt ${x.promptId}`, (x) => ({ promptId: x.promptId, response: x.response }));
  // Subject-level duplicates: a memory record for the same subject under a different ID is a conflict, not a second record.
  for (const r of records.filter((x) => x.collection === "memoryRecords" && x.status === "new")) {
    const incoming = bundle.memory.records.find((m) => m.id === r.id);
    if (incoming && existing.memory.records.some((m) => m.subjectType === incoming.subjectType && m.subjectId === incoming.subjectId)) {
      r.status = "conflict";
      r.reason = "A Deal Memory record already exists for this subject";
    }
  }
  for (const p of bundle.progress) records.push({ key: `progress:${p.itemType}:${p.itemId}`, collection: "progress", id: `${p.itemType}:${p.itemId}`, title: `${p.itemType} ${p.itemId}`, status: existing.progress.some((e) => e.itemType === p.itemType && e.itemId === p.itemId) ? "duplicate" : "new", reason: null });
  if (bundle.preferences) records.push({ key: "preferences:me", collection: "preferences", id: "me", title: "Preferences", status: existing.preferences ? "conflict" : "new", reason: existing.preferences ? "Preferences already set" : null });
  return records;
}

export function registerPrivateRoutes(r: Router): void {
  // ---------- Notes ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/notes",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const db = requireDb(c);
      const p = c.url.searchParams;
      const where = ["n.user_id = ?"];
      const binds: unknown[] = [userId];
      const q = (p.get("q") ?? "").trim().slice(0, 100);
      if (q) {
        where.push("(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')");
        binds.push(`%${likeEscape(q)}%`, `%${likeEscape(q)}%`);
      }
      const tag = p.get("tag");
      if (tag) {
        where.push("n.tags_json LIKE ? ESCAPE '\\'");
        binds.push(`%"${likeEscape(tag)}"%`);
      }
      const template = p.get("template");
      if (template) {
        where.push("n.template = ?");
        binds.push(template);
      }
      where.push(p.get("archived") === "1" ? "n.archived_at IS NOT NULL" : "n.archived_at IS NULL");
      let join = "";
      if (p.get("entityType") && p.get("entityId")) {
        join = "JOIN finance_note_links l ON l.note_id = n.id AND l.user_id = n.user_id AND l.entity_type = ? AND l.entity_id = ?";
        binds.unshift(p.get("entityType"), p.get("entityId"));
      }
      const limit = Math.min(200, Math.max(1, Number(p.get("limit") ?? "100") || 100));
      const rows = await db.prepare(`SELECT n.* FROM finance_notes n ${join} WHERE ${where.join(" AND ")} ORDER BY n.updated_at DESC LIMIT ?`).bind(...binds, limit).all<NoteRow>();
      const items = (rows.results ?? []).map((row) => {
        const n = noteFromRow(row);
        const { body, ...rest } = n;
        return { ...rest, excerpt: body.replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").trim().slice(0, 220) };
      });
      return privateJson({ items, total: items.length });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/notes",
    access: "owner",
    bodyLimit: NOTE_BODY_LIMIT,
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zNoteCreate, await readJson(c.request, NOTE_BODY_LIMIT));
      if (body.template === "deal_view") throw new HttpError(400, "USE_VIEW_ENDPOINT", "Use PUT /api/finance/notes/view for a deal view.");
      return idempotent(c, userId, "notes.create", body, async () => {
        const db = requireDb(c);
        const id = newId("n_");
        const now = nowIso(c);
        await db.batch([
          db
            .prepare("INSERT INTO finance_notes (id, user_id, title, body, template, tags_json, links_json, evidence_json, link_key, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)")
            .bind(id, userId, body.title, body.body, body.template, JSON.stringify(body.tags), JSON.stringify(body.links), JSON.stringify(body.evidenceIds), now, now),
          ...noteLinkStatements(db, id, userId, body.links),
        ]);
        const row = await getNote(db, userId, id);
        return { status: 201, body: { note: noteFromRow(row as NoteRow) } };
      });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/notes/view",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const dealId = c.url.searchParams.get("dealId") ?? "";
      const row = await requireDb(c).prepare("SELECT * FROM finance_notes WHERE user_id = ? AND template = 'deal_view' AND link_key = ?").bind(userId, `deal:${dealId}`).first<NoteRow>();
      return privateJson({ note: row ? noteFromRow(row) : null });
    },
  });

  r.add({
    method: "PUT",
    pattern: "/api/finance/notes/view",
    access: "owner",
    bodyLimit: NOTE_BODY_LIMIT,
    handler: async (c) => {
      const userId = uid(c);
      const raw = (await readJson(c.request, NOTE_BODY_LIMIT)) as Record<string, unknown>;
      const dealId = typeof raw.dealId === "string" ? raw.dealId : "";
      const view = await getResearch(c.db);
      if (!view.dealById.has(dealId)) throw new HttpError(404, "NOT_FOUND", "Deal not found.");
      const body = parse(zNoteCreate.pick({ title: true, body: true }), { title: raw.title, body: raw.body });
      const revision = raw.revision === null || raw.revision === undefined ? null : Number(raw.revision);
      const db = requireDb(c);
      const key = `deal:${dealId}`;
      const existing = await db.prepare("SELECT * FROM finance_notes WHERE user_id = ? AND template = 'deal_view' AND link_key = ?").bind(userId, key).first<NoteRow>();
      const now = nowIso(c);
      if (!existing) {
        if (revision !== null) throw new HttpError(409, "CONFLICT", "The view was deleted elsewhere.", { current: null });
        const id = newId("n_");
        const links = [{ type: "deal", id: dealId }];
        await db.batch([
          db
            .prepare("INSERT INTO finance_notes (id, user_id, title, body, template, tags_json, links_json, evidence_json, link_key, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'deal_view', '[]', ?, '[]', ?, 1, ?, ?) ON CONFLICT DO NOTHING")
            .bind(id, userId, body.title, body.body, JSON.stringify(links), key, now, now),
          ...noteLinkStatements(db, id, userId, links),
        ]);
        const row = await db.prepare("SELECT * FROM finance_notes WHERE user_id = ? AND template = 'deal_view' AND link_key = ?").bind(userId, key).first<NoteRow>();
        if (row && row.id !== id) throw new HttpError(409, "CONFLICT", "Another tab created this view first.", { current: { value: noteFromRow(row), revision: row.revision } });
        return privateJson({ note: noteFromRow(row as NoteRow) }, 201);
      }
      if (revision !== existing.revision) {
        throw new HttpError(409, "CONFLICT", "This view changed in another tab or device.", { current: { value: parseViewBody(existing.body), revision: existing.revision } });
      }
      const res = await db
        .prepare("UPDATE finance_notes SET title = ?, body = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?")
        .bind(body.title, body.body, now, existing.id, userId, existing.revision)
        .run();
      if (!res.meta.changes) throw new HttpError(409, "CONFLICT", "This view changed in another tab or device.");
      return privateJson({ note: noteFromRow((await getNote(db, userId, existing.id)) as NoteRow) });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/notes/:id/export.md",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const row = await getNote(requireDb(c), userId, c.params.id ?? "");
      if (!row) throw new HttpError(404, "NOT_FOUND", "Note not found.");
      const view = await getResearch(c.db);
      return textResponse(noteMarkdown(noteFromRow(row), view), "text/markdown; charset=utf-8", { filename: `${row.title.slice(0, 60)}.md`, private: true });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/notes/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const row = await getNote(requireDb(c), userId, c.params.id ?? "");
      if (!row) throw new HttpError(404, "NOT_FOUND", "Note not found.");
      return privateJson({ note: noteFromRow(row) });
    },
  });

  r.add({
    method: "PATCH",
    pattern: "/api/finance/notes/:id",
    access: "owner",
    bodyLimit: NOTE_BODY_LIMIT,
    handler: async (c) => {
      const userId = uid(c);
      const db = requireDb(c);
      const patch = parse(zNotePatch, await readJson(c.request, NOTE_BODY_LIMIT));
      const row = await getNote(db, userId, c.params.id ?? "");
      if (!row) throw new HttpError(404, "NOT_FOUND", "Note not found.");
      if (patch.revision !== row.revision) {
        const cur = noteFromRow(row);
        throw new HttpError(409, "CONFLICT", "This note changed in another tab or device. Reconcile before saving.", { current: { value: cur, revision: cur.revision } });
      }
      const cur = noteFromRow(row);
      const next = {
        title: patch.title ?? cur.title,
        body: patch.body ?? cur.body,
        template: patch.template ?? cur.template,
        tags: patch.tags ?? cur.tags,
        links: patch.links ?? cur.links,
        evidenceIds: patch.evidenceIds ?? cur.evidenceIds,
      };
      const archivedAt = patch.archived === undefined ? cur.archivedAt : patch.archived ? (cur.archivedAt ?? nowIso(c)) : null;
      const stmts: D1PreparedStatement[] = [
        db
          .prepare("UPDATE finance_notes SET title = ?, body = ?, template = ?, tags_json = ?, links_json = ?, evidence_json = ?, archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?")
          .bind(next.title, next.body, next.template, JSON.stringify(next.tags), JSON.stringify(next.links), JSON.stringify(next.evidenceIds), archivedAt, nowIso(c), row.id, userId, row.revision),
      ];
      if (patch.links) stmts.push(...noteLinkStatements(db, row.id, userId, next.links));
      const res = await db.batch(stmts);
      if (!res[0]?.meta.changes) throw new HttpError(409, "CONFLICT", "This note changed while saving. Reload and try again.");
      return privateJson({ note: noteFromRow((await getNote(db, userId, row.id)) as NoteRow) });
    },
  });

  r.add({
    method: "DELETE",
    pattern: "/api/finance/notes/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      if (c.url.searchParams.get("confirm") !== "true") throw new HttpError(400, "CONFIRMATION_REQUIRED", "Deleting a note needs confirm=true. Consider archiving instead.");
      const db = requireDb(c);
      const row = await getNote(db, userId, c.params.id ?? "");
      if (!row) throw new HttpError(404, "NOT_FOUND", "Note not found.");
      await db.batch([db.prepare("DELETE FROM finance_note_links WHERE note_id = ? AND user_id = ?").bind(row.id, userId), db.prepare("DELETE FROM finance_notes WHERE id = ? AND user_id = ?").bind(row.id, userId)]);
      return privateJson({ deleted: true, id: row.id });
    },
  });

  // ---------- Watchlist ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/watchlist",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const view = await getResearch(c.db);
      const rows = await requireDb(c).prepare("SELECT * FROM finance_watches WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<WatchRow>();
      const items = (rows.results ?? []).map((w) => {
        const version = entityVersion(view, w.kind, w.entity_id);
        return {
          id: w.id,
          kind: w.kind,
          entityId: w.entity_id,
          title: entityTitle(view, w.kind, w.entity_id),
          saved: Boolean(w.saved),
          following: Boolean(w.following),
          createdAt: w.created_at,
          lastViewedAt: w.last_viewed_at,
          watermark: w.watermark,
          changed: Boolean(w.following && version && w.watermark && version > w.watermark),
        };
      });
      return privateJson({ items });
    },
  });

  r.add({
    method: "PUT",
    pattern: "/api/finance/watchlist",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const raw = (await readJson(c.request, 4096)) as Record<string, unknown>;
      const base = parse(zWatchCreate, raw);
      const saved = raw.saved === true;
      const following = raw.following === true;
      const view = await getResearch(c.db);
      if (base.kind === "deal" && !view.dealById.has(base.entityId)) throw new HttpError(404, "NOT_FOUND", "Deal not found.");
      if (base.kind === "company" && !view.companyById.has(base.entityId)) throw new HttpError(404, "NOT_FOUND", "Company not found.");
      if (base.kind === "sector" && !archive.sectors.some((s) => s.slug === base.entityId)) throw new HttpError(404, "NOT_FOUND", "Sector not found.");
      const db = requireDb(c);
      if (!saved && !following) {
        await db.prepare("DELETE FROM finance_watches WHERE user_id = ? AND kind = ? AND entity_id = ?").bind(userId, base.kind, base.entityId).run();
        return privateJson({ item: null });
      }
      const now = nowIso(c);
      const watermark = entityVersion(view, base.kind, base.entityId);
      await db
        .prepare(
          "INSERT INTO finance_watches (id, user_id, kind, entity_id, saved, following, created_at, last_viewed_at, watermark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, kind, entity_id) DO UPDATE SET saved = excluded.saved, following = excluded.following",
        )
        .bind(newId("w_"), userId, base.kind, base.entityId, saved ? 1 : 0, following ? 1 : 0, now, now, watermark)
        .run();
      const row = await db.prepare("SELECT * FROM finance_watches WHERE user_id = ? AND kind = ? AND entity_id = ?").bind(userId, base.kind, base.entityId).first<WatchRow>();
      return privateJson({ item: row ? { id: row.id, kind: row.kind, entityId: row.entity_id, saved: Boolean(row.saved), following: Boolean(row.following) } : null });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/watchlist/viewed",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const base = parse(zWatchCreate, await readJson(c.request, 4096));
      const view = await getResearch(c.db);
      const version = entityVersion(view, base.kind, base.entityId);
      await requireDb(c).prepare("UPDATE finance_watches SET last_viewed_at = ?, watermark = COALESCE(?, watermark) WHERE user_id = ? AND kind = ? AND entity_id = ?").bind(nowIso(c), version, userId, base.kind, base.entityId).run();
      return privateJson({ ok: true });
    },
  });

  // ---------- Saved searches ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/saved-searches",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const view = await getResearch(c.db);
      const rows = await requireDb(c).prepare("SELECT * FROM finance_saved_searches WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<SavedSearchRow>();
      const items = (rows.results ?? []).map((row) => {
        const s = savedSearchFromRow(row);
        return { ...s, changes: matchingDealsChangedSince(view, s.filters, s.watermark) };
      });
      return privateJson({ items });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/saved-searches",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zSavedSearchCreate, await readJson(c.request, 8192));
      return idempotent(c, userId, "saved-searches.create", body, async () => {
        const db = requireDb(c);
        const count = (await db.prepare("SELECT COUNT(*) AS n FROM finance_saved_searches WHERE user_id = ?").bind(userId).first<{ n: number }>())?.n ?? 0;
        if (count >= 50) throw new HttpError(409, "LIMIT_REACHED", "You can keep up to 50 saved searches.");
        const view = await getResearch(c.db);
        const id = newId("s_");
        const now = nowIso(c);
        const filters = filtersOnly(body.filters);
        await db
          .prepare("INSERT INTO finance_saved_searches (id, user_id, name, filters_json, created_at, last_viewed_at, watermark) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, userId, body.name, JSON.stringify(filters), now, now, maxChanged(view, filters) ?? now)
          .run();
        const row = await db.prepare("SELECT * FROM finance_saved_searches WHERE id = ? AND user_id = ?").bind(id, userId).first<SavedSearchRow>();
        return { status: 201, body: { item: savedSearchFromRow(row as SavedSearchRow) } };
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/saved-searches/:id/viewed",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const db = requireDb(c);
      const row = await db.prepare("SELECT * FROM finance_saved_searches WHERE id = ? AND user_id = ?").bind(c.params.id, userId).first<SavedSearchRow>();
      if (!row) throw new HttpError(404, "NOT_FOUND", "Saved search not found.");
      const view = await getResearch(c.db);
      const s = savedSearchFromRow(row);
      const wm = maxChanged(view, s.filters);
      await db.prepare("UPDATE finance_saved_searches SET last_viewed_at = ?, watermark = COALESCE(?, watermark) WHERE id = ? AND user_id = ?").bind(nowIso(c), wm, row.id, userId).run();
      return privateJson({ ok: true });
    },
  });

  r.add({
    method: "DELETE",
    pattern: "/api/finance/saved-searches/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const res = await requireDb(c).prepare("DELETE FROM finance_saved_searches WHERE id = ? AND user_id = ?").bind(c.params.id, userId).run();
      if (!res.meta.changes) throw new HttpError(404, "NOT_FOUND", "Saved search not found.");
      return privateJson({ deleted: true });
    },
  });

  // ---------- Models ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/models",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const rows = await requireDb(c).prepare("SELECT * FROM finance_models WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200").bind(userId).all<ModelRow>();
      return privateJson({ items: (rows.results ?? []).map(modelFromRow) });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/models",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zModelCreate, await readJson(c.request, 256 * 1024));
      return idempotent(c, userId, "models.create", body, async () => {
        const db = requireDb(c);
        const id = newId("m_");
        const now = nowIso(c);
        await db
          .prepare("INSERT INTO finance_models (id, user_id, model_type, title, calc_version, source_json, assumptions_json, outputs_json, scenarios_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
          .bind(id, userId, body.modelType, body.title, body.calcVersion, JSON.stringify(body.sourceSnapshot), JSON.stringify(body.assumptions), JSON.stringify(body.outputs), JSON.stringify(body.scenarios), now, now)
          .run();
        const row = await db.prepare("SELECT * FROM finance_models WHERE id = ? AND user_id = ?").bind(id, userId).first<ModelRow>();
        return { status: 201, body: { model: modelFromRow(row as ModelRow) } };
      });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/models/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const row = await requireDb(c).prepare("SELECT * FROM finance_models WHERE id = ? AND user_id = ?").bind(c.params.id, userId).first<ModelRow>();
      if (!row) throw new HttpError(404, "NOT_FOUND", "Model not found.");
      return privateJson({ model: modelFromRow(row) });
    },
  });

  r.add({
    method: "PATCH",
    pattern: "/api/finance/models/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const db = requireDb(c);
      const patch = parse(zModelPatch, await readJson(c.request, 256 * 1024));
      const row = await db.prepare("SELECT * FROM finance_models WHERE id = ? AND user_id = ?").bind(c.params.id, userId).first<ModelRow>();
      if (!row) throw new HttpError(404, "NOT_FOUND", "Model not found.");
      if (patch.revision !== row.revision) throw new HttpError(409, "CONFLICT", "This model changed elsewhere.", { current: { value: modelFromRow(row), revision: row.revision } });
      const cur = modelFromRow(row);
      const res = await db
        .prepare("UPDATE finance_models SET title = ?, assumptions_json = ?, outputs_json = ?, scenarios_json = ?, calc_version = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?")
        .bind(patch.title ?? cur.title, JSON.stringify(patch.assumptions ?? cur.assumptions), JSON.stringify(patch.outputs ?? cur.outputs), JSON.stringify(patch.scenarios ?? cur.scenarios), patch.calcVersion ?? cur.calcVersion, nowIso(c), row.id, userId, row.revision)
        .run();
      if (!res.meta.changes) throw new HttpError(409, "CONFLICT", "This model changed while saving.");
      const next = await db.prepare("SELECT * FROM finance_models WHERE id = ? AND user_id = ?").bind(row.id, userId).first<ModelRow>();
      return privateJson({ model: modelFromRow(next as ModelRow) });
    },
  });

  r.add({
    method: "DELETE",
    pattern: "/api/finance/models/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      if (c.url.searchParams.get("confirm") !== "true") throw new HttpError(400, "CONFIRMATION_REQUIRED", "Deleting a model needs confirm=true.");
      const res = await requireDb(c).prepare("DELETE FROM finance_models WHERE id = ? AND user_id = ?").bind(c.params.id, userId).run();
      if (!res.meta.changes) throw new HttpError(404, "NOT_FOUND", "Model not found.");
      return privateJson({ deleted: true });
    },
  });

  // ---------- Deal Memory and review ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/memory",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const db = requireDb(c);
      const view = await getResearch(c.db);
      const recs = (await db.prepare("SELECT * FROM finance_memory_records WHERE user_id = ? ORDER BY updated_at DESC").bind(userId).all<MemoryRecordRow>()).results ?? [];
      const cards = (await db.prepare("SELECT * FROM finance_memory_cards WHERE user_id = ?").bind(userId).all<MemoryCardRow>()).results ?? [];
      const subjectFilter = c.url.searchParams.get("subjectId");
      const items = recs
        .filter((r0) => !subjectFilter || r0.subject_id === subjectFilter)
        .map((r0) => {
          const rec = recordFromRows(r0, cards);
          const cur = entityVersion(view, rec.subjectType, rec.subjectId);
          return { ...rec, title: entityTitle(view, rec.subjectType, rec.subjectId), updateAvailable: cur && cur !== rec.sourceVersion ? { currentVersion: cur, reason: "The linked research record changed after these cards were written. Your original answers are kept; review the new facts before updating." } : null };
        });
      return privateJson({ items });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/memory",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zMemoryUpsert, await readJson(c.request, 64 * 1024));
      const view = await getResearch(c.db);
      if (body.subject.type === "deal" && !view.dealById.has(body.subject.id)) throw new HttpError(404, "NOT_FOUND", "Deal not found.");
      if (body.subject.type === "concept" && !archive.glossary.some((g) => g.id === body.subject.id)) throw new HttpError(404, "NOT_FOUND", "Concept not found.");
      for (const card of body.cards) await validateRefs(c, userId, view, card.sourceRefs);
      return idempotent(c, userId, "memory.upsert", body, async () => {
        const db = requireDb(c);
        const { today } = await userToday(c, userId);
        const now = nowIso(c);
        const version = entityVersion(view, body.subject.type, body.subject.id) ?? archive.version;
        let rec = await db.prepare("SELECT * FROM finance_memory_records WHERE user_id = ? AND subject_type = ? AND subject_id = ?").bind(userId, body.subject.type, body.subject.id).first<MemoryRecordRow>();
        let created = false;
        if (!rec) {
          const id = newId("r_");
          await db
            .prepare("INSERT INTO finance_memory_records (id, user_id, subject_type, subject_id, source_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, subject_type, subject_id) DO NOTHING")
            .bind(id, userId, body.subject.type, body.subject.id, version, now, now)
            .run();
          rec = await db.prepare("SELECT * FROM finance_memory_records WHERE user_id = ? AND subject_type = ? AND subject_id = ?").bind(userId, body.subject.type, body.subject.id).first<MemoryRecordRow>();
          created = rec?.id === id;
        }
        if (!rec) throw new HttpError(500, "MEMORY_WRITE_FAILED", "Could not create the memory record.");
        const stmts: D1PreparedStatement[] = [db.prepare("UPDATE finance_memory_records SET source_version = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(version, now, rec.id, userId)];
        for (const card of body.cards) {
          stmts.push(
            db
              .prepare(
                "INSERT INTO finance_memory_cards (id, user_id, record_id, card_type, prompt, answer, source_refs_json, source_version, stage, due_date, suspended, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, -1, ?, 0, ?, ?) ON CONFLICT(record_id, card_type) DO UPDATE SET prompt = excluded.prompt, answer = excluded.answer, source_refs_json = excluded.source_refs_json, source_version = excluded.source_version, updated_at = excluded.updated_at",
              )
              .bind(newId("k_"), userId, rec.id, card.cardType, card.prompt, card.answer, JSON.stringify(card.sourceRefs), version, today, now, now),
          );
        }
        await db.batch(stmts);
        const cards = (await db.prepare("SELECT * FROM finance_memory_cards WHERE user_id = ? AND record_id = ?").bind(userId, rec.id).all<MemoryCardRow>()).results ?? [];
        return { status: created ? 201 : 200, body: { created, record: recordFromRows({ ...rec, source_version: version, updated_at: now }, cards), updateAvailable: false } };
      });
    },
  });

  r.add({
    method: "PATCH",
    pattern: "/api/finance/memory/cards/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const raw = (await readJson(c.request, 16 * 1024)) as Record<string, unknown>;
      const db = requireDb(c);
      const card = await db.prepare("SELECT * FROM finance_memory_cards WHERE id = ? AND user_id = ?").bind(c.params.id, userId).first<MemoryCardRow>();
      if (!card) throw new HttpError(404, "NOT_FOUND", "Card not found.");
      const suspended = typeof raw.suspended === "boolean" ? (raw.suspended ? 1 : 0) : card.suspended;
      const answer = typeof raw.answer === "string" && raw.answer.trim() ? raw.answer.trim().slice(0, 4000) : card.answer;
      await db.prepare("UPDATE finance_memory_cards SET suspended = ?, answer = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(suspended, answer, nowIso(c), card.id, userId).run();
      return privateJson({ card: cardFromRow({ ...card, suspended, answer }) });
    },
  });

  r.add({
    method: "DELETE",
    pattern: "/api/finance/memory/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      if (c.url.searchParams.get("confirm") !== "true") throw new HttpError(400, "CONFIRMATION_REQUIRED", "Deleting a memory record needs confirm=true.");
      const db = requireDb(c);
      const rec = await db.prepare("SELECT id FROM finance_memory_records WHERE id = ? AND user_id = ?").bind(c.params.id, userId).first<{ id: string }>();
      if (!rec) throw new HttpError(404, "NOT_FOUND", "Record not found.");
      await db.batch([db.prepare("DELETE FROM finance_memory_cards WHERE record_id = ? AND user_id = ?").bind(rec.id, userId), db.prepare("DELETE FROM finance_memory_records WHERE id = ? AND user_id = ?").bind(rec.id, userId)]);
      return privateJson({ deleted: true });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/review",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const db = requireDb(c);
      const view = await getResearch(c.db);
      const { today, timezone } = await userToday(c, userId);
      const due = (await db.prepare("SELECT * FROM finance_memory_cards WHERE user_id = ? AND suspended = 0 AND due_date <= ? ORDER BY due_date ASC, created_at ASC LIMIT 100").bind(userId, today).all<MemoryCardRow>()).results ?? [];
      const recs = (await db.prepare("SELECT * FROM finance_memory_records WHERE user_id = ?").bind(userId).all<MemoryRecordRow>()).results ?? [];
      const recById = new Map(recs.map((x) => [x.id, x]));
      const total = (await db.prepare("SELECT COUNT(*) AS n FROM finance_memory_cards WHERE user_id = ? AND suspended = 0").bind(userId).first<{ n: number }>())?.n ?? 0;
      const upcoming = (await db.prepare("SELECT due_date AS date, COUNT(*) AS count FROM finance_memory_cards WHERE user_id = ? AND suspended = 0 AND due_date > ? GROUP BY due_date ORDER BY due_date LIMIT 14").bind(userId, today).all<{ date: string; count: number }>()).results ?? [];
      return privateJson({
        today,
        timezone,
        schedulerVersion: SCHEDULER_VERSION,
        due: due.map((k) => {
          const rec = recById.get(k.record_id);
          return { ...cardFromRow(k), subjectType: rec?.subject_type ?? "deal", subjectId: rec?.subject_id ?? "", subjectTitle: rec ? entityTitle(view, rec.subject_type, rec.subject_id) : "" };
        }),
        dueCount: due.length,
        total,
        upcoming,
        note: "Self-assessed recall, not an externally verified measure of expertise.",
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/review",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zReviewSubmit, await readJson(c.request, 4096));
      const key = idempotencyKey(c, true) as string;
      const db = requireDb(c);
      const prior = await db.prepare("SELECT * FROM finance_review_log WHERE user_id = ? AND idempotency_key = ?").bind(userId, key).first<Record<string, unknown>>();
      if (prior) {
        const card = await db.prepare("SELECT * FROM finance_memory_cards WHERE id = ? AND user_id = ?").bind(prior.card_id, userId).first<MemoryCardRow>();
        return privateJson({ replayed: true, outcome: { stageBefore: prior.stage_before, stageAfter: prior.stage_after, dueBefore: prior.due_before, dueAfter: prior.due_after, reviewDate: prior.review_date, rating: prior.rating }, card: card ? cardFromRow(card) : null }, 200, { "Idempotent-Replayed": "true" });
      }
      const card = await db.prepare("SELECT * FROM finance_memory_cards WHERE id = ? AND user_id = ?").bind(body.cardId, userId).first<MemoryCardRow>();
      if (!card) throw new HttpError(404, "NOT_FOUND", "Card not found.");
      const { today } = await userToday(c, userId);
      const outcome = scheduleReview({ stage: card.stage, dueDate: card.due_date }, body.rating, today);
      const now = nowIso(c);
      const res = await db.batch([
        db.prepare("UPDATE finance_memory_cards SET stage = ?, due_date = ?, updated_at = ? WHERE id = ? AND user_id = ? AND stage = ? AND due_date = ?").bind(outcome.stageAfter, outcome.dueAfter, now, card.id, userId, card.stage, card.due_date),
        db
          .prepare("INSERT INTO finance_review_log (id, user_id, card_id, reviewed_at, review_date, rating, stage_before, stage_after, due_before, due_after, scheduler_version, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(newId("v_"), userId, card.id, now, today, body.rating, outcome.stageBefore, outcome.stageAfter, outcome.dueBefore, outcome.dueAfter, SCHEDULER_VERSION, key),
      ]);
      if (!res[0]?.meta.changes) throw new HttpError(409, "CONFLICT", "This card was reviewed in another tab. Reload the queue.");
      return privateJson({ outcome, card: cardFromRow({ ...card, stage: outcome.stageAfter, due_date: outcome.dueAfter, updated_at: now }) });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/review/history",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const cardId = c.url.searchParams.get("cardId");
      const db = requireDb(c);
      const rows = cardId
        ? await db.prepare("SELECT * FROM finance_review_log WHERE user_id = ? AND card_id = ? ORDER BY reviewed_at DESC LIMIT 200").bind(userId, cardId).all()
        : await db.prepare("SELECT * FROM finance_review_log WHERE user_id = ? ORDER BY reviewed_at DESC LIMIT 200").bind(userId).all();
      return privateJson({ items: rows.results ?? [] });
    },
  });

  // ---------- Preferences ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/preferences",
    access: "owner",
    handler: async (c) => privateJson(await loadPrefs(requireDb(c), uid(c))),
  });

  r.add({
    method: "PATCH",
    pattern: "/api/finance/preferences",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const patch = parse(zPreferencesPatch, await readJson(c.request, 8192));
      const db = requireDb(c);
      const cur = await loadPrefs(db, userId);
      const { revision, ...fields } = patch;
      if (revision !== undefined && revision !== cur.revision) throw new HttpError(409, "CONFLICT", "Preferences changed elsewhere.", { current: { value: cur.prefs, revision: cur.revision } });
      if (fields.timezone) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: fields.timezone });
        } catch {
          throw new HttpError(400, "VALIDATION_FAILED", "Unknown timezone.");
        }
      }
      const next = { ...cur.prefs, ...fields };
      const res = await db
        .prepare(
          "INSERT INTO finance_preferences (user_id, prefs_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, revision = finance_preferences.revision + 1, updated_at = excluded.updated_at WHERE finance_preferences.revision = ?",
        )
        .bind(userId, JSON.stringify(next), nowIso(c), cur.revision)
        .run();
      if (!res.meta.changes) throw new HttpError(409, "CONFLICT", "Preferences changed while saving.");
      return privateJson(await loadPrefs(db, userId));
    },
  });

  // ---------- Learning progress and interviews ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/progress",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const rows = await requireDb(c).prepare("SELECT item_type, item_id, status, answer_json, correct, updated_at FROM finance_progress WHERE user_id = ?").bind(userId).all<Record<string, unknown>>();
      return privateJson({
        items: (rows.results ?? []).map((x) => ({ itemType: x.item_type, itemId: x.item_id, status: x.status, answer: parseJsonColumn(x.answer_json as string, null), correct: x.correct === null ? null : Boolean(x.correct), updatedAt: x.updated_at })),
        modulesTotal: archive.modules.length,
        questionsTotal: archive.questions.length,
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/progress",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zProgressUpdate, await readJson(c.request, 8192));
      if (body.itemType === "module" && !archive.modules.some((m) => m.id === body.itemId)) throw new HttpError(404, "NOT_FOUND", "Module not found.");
      if (body.itemType === "question" && !archive.questions.some((q) => q.id === body.itemId)) throw new HttpError(404, "NOT_FOUND", "Question not found.");
      await requireDb(c)
        .prepare(
          "INSERT INTO finance_progress (user_id, item_type, item_id, status, answer_json, correct, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET status = CASE WHEN finance_progress.status = 'completed' THEN 'completed' ELSE excluded.status END, answer_json = excluded.answer_json, correct = excluded.correct, updated_at = excluded.updated_at",
        )
        .bind(userId, body.itemType, body.itemId, body.status, body.answer === undefined ? null : JSON.stringify(body.answer), body.correct === null || body.correct === undefined ? null : body.correct ? 1 : 0, nowIso(c))
        .run();
      return privateJson({ ok: true });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/interview",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const rows = await requireDb(c).prepare("SELECT * FROM finance_interview_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(userId).all<Record<string, unknown>>();
      return privateJson({
        items: (rows.results ?? []).map((a) => ({
          id: a.id,
          promptId: a.prompt_id,
          subject: parseJsonColumn(a.subject_json as string, null),
          response: a.response,
          durationSec: a.duration_sec,
          selfRubric: parseJsonColumn(a.self_rubric_json as string, {}),
          reflection: a.reflection,
          aiFeedback: parseJsonColumn(a.ai_feedback_json as string, null),
          createdAt: a.created_at,
        })),
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/interview",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zInterviewAttempt, await readJson(c.request, 64 * 1024));
      return idempotent(c, userId, "interview.create", body, async () => {
        const id = newId("i_");
        await requireDb(c)
          .prepare("INSERT INTO finance_interview_attempts (id, user_id, prompt_id, subject_json, response, duration_sec, self_rubric_json, reflection, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, userId, body.promptId, body.subject ? JSON.stringify(body.subject) : null, body.response, body.durationSec, JSON.stringify(body.selfRubric), body.reflection, nowIso(c))
          .run();
        return { status: 201, body: { id } };
      });
    },
  });

  r.add({
    method: "DELETE",
    pattern: "/api/finance/interview/:id",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const res = await requireDb(c).prepare("DELETE FROM finance_interview_attempts WHERE id = ? AND user_id = ?").bind(c.params.id, userId).run();
      if (!res.meta.changes) throw new HttpError(404, "NOT_FOUND", "Attempt not found.");
      return privateJson({ deleted: true });
    },
  });

  // ---------- Desk summary ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/desk",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const db = requireDb(c);
      const view = await getResearch(c.db);
      const { prefs } = await loadPrefs(db, userId);
      const { today, timezone } = await userToday(c, userId);
      const days = Math.min(31, Math.max(1, Number(c.url.searchParams.get("days") ?? prefs.newsWindowDays) || 7));
      const lastNote = await db.prepare("SELECT id, title, updated_at FROM finance_notes WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1").bind(userId).first<{ id: string; title: string; updated_at: string }>();
      const lastModel = await db.prepare("SELECT id, title, model_type, updated_at FROM finance_models WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1").bind(userId).first<{ id: string; title: string; model_type: string; updated_at: string }>();
      const due = (await db.prepare("SELECT COUNT(*) AS n FROM finance_memory_cards WHERE user_id = ? AND suspended = 0 AND due_date <= ?").bind(userId, today).first<{ n: number }>())?.n ?? 0;
      const total = (await db.prepare("SELECT COUNT(*) AS n FROM finance_memory_cards WHERE user_id = ? AND suspended = 0").bind(userId).first<{ n: number }>())?.n ?? 0;
      const watches = (await db.prepare("SELECT * FROM finance_watches WHERE user_id = ? AND following = 1 AND kind = 'deal'").bind(userId).all<WatchRow>()).results ?? [];
      const watchedItems = watches.map((w) => {
        const v = entityVersion(view, w.kind, w.entity_id);
        return { kind: w.kind, entityId: w.entity_id, title: entityTitle(view, w.kind, w.entity_id), changed: Boolean(v && w.watermark && v > w.watermark) };
      });
      const searches = (await db.prepare("SELECT * FROM finance_saved_searches WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").bind(userId).all<SavedSearchRow>()).results ?? [];
      const since = new Date(c.now.getTime() - days * 86_400_000).toISOString();
      const followed = prefs.followedSectors.length ? prefs.followedSectors : [prefs.highlightSector];
      let feedTotal = 0;
      let feedMatching = 0;
      try {
        feedTotal = (await db.prepare("SELECT COUNT(*) AS n FROM finance_feed_items WHERE discovered_at >= ? AND verification != 'rejected'").bind(since).first<{ n: number }>())?.n ?? 0;
        const rows = (await db.prepare("SELECT sectors_json FROM finance_feed_items WHERE discovered_at >= ? AND verification != 'rejected'").bind(since).all<{ sectors_json: string }>()).results ?? [];
        feedMatching = rows.filter((x) => parseJsonColumn<string[]>(x.sectors_json, []).some((s) => followed.includes(s as (typeof followed)[number]))).length;
      } catch {
        /* feed tables absent */
      }
      const progress = (await db.prepare("SELECT item_type, item_id, status FROM finance_progress WHERE user_id = ?").bind(userId).all<{ item_type: string; item_id: string; status: string }>()).results ?? [];
      const completed = new Set(progress.filter((p) => p.item_type === "module" && p.status === "completed").map((p) => p.item_id));
      const next = [...archive.modules].sort((a, b) => a.number - b.number).find((m) => !completed.has(m.id)) ?? null;
      return privateJson({
        today,
        timezone,
        lastNote: lastNote ? { id: lastNote.id, title: lastNote.title, updatedAt: lastNote.updated_at } : null,
        lastModel: lastModel ? { id: lastModel.id, title: lastModel.title, modelType: lastModel.model_type, updatedAt: lastModel.updated_at } : null,
        reviews: { due, total },
        watched: { changed: watchedItems.filter((w) => w.changed).length, total: watchedItems.length, items: watchedItems },
        savedSearches: searches.map((s) => {
          const x = savedSearchFromRow(s);
          return { id: x.id, name: x.name, changes: matchingDealsChangedSince(view, x.filters, x.watermark) };
        }),
        relevantItems: { matching: feedMatching, total: feedTotal, windowDays: days },
        nextModule: next ? { id: next.id, title: next.title, number: next.number } : null,
        progress: { modulesCompleted: completed.size, modulesTotal: archive.modules.length, questionsAnswered: progress.filter((p) => p.item_type === "question").length },
      });
    },
  });

  // ---------- Export / import ----------
  r.add({
    method: "GET",
    pattern: "/api/finance/export",
    access: "owner",
    handler: async (c) => {
      const bundle = await buildExport(c, uid(c));
      return privateJson(bundle, 200, { "Content-Disposition": `attachment; filename="finance-desk-export-${bundle.exportedAt.slice(0, 10)}.json"` });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/export/notes.md",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const view = await getResearch(c.db);
      const rows = (await requireDb(c).prepare("SELECT * FROM finance_notes WHERE user_id = ? ORDER BY updated_at DESC").bind(userId).all<NoteRow>()).results ?? [];
      const md = rows.map((n) => noteMarkdown(noteFromRow(n), view)).join("\n\n---\n\n");
      return textResponse(md || "# No notes\n", "text/markdown; charset=utf-8", { filename: "finance-desk-notes.md", private: true });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/export/reviews.csv",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const rows = (await requireDb(c).prepare("SELECT l.*, k.prompt FROM finance_review_log l LEFT JOIN finance_memory_cards k ON k.id = l.card_id AND k.user_id = l.user_id WHERE l.user_id = ? ORDER BY l.reviewed_at").bind(userId).all<Record<string, unknown>>()).results ?? [];
      const csv = toCsv(
        ["reviewed_at_utc", "review_date_local", "card_id", "prompt", "rating", "stage_before", "stage_after", "due_before", "due_after", "scheduler_version"],
        rows.map((x) => [String(x.reviewed_at), String(x.review_date), String(x.card_id), String(x.prompt ?? ""), String(x.rating), Number(x.stage_before), Number(x.stage_after), String(x.due_before), String(x.due_after), String(x.scheduler_version)]),
      );
      return textResponse(csv, "text/csv; charset=utf-8", { filename: "finance-desk-reviews.csv", private: true });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/import/preview",
    access: "owner",
    bodyLimit: IMPORT_LIMIT,
    handler: async (c) => {
      const userId = uid(c);
      const raw = await readJson(c.request, IMPORT_LIMIT);
      const parsed = zExportBundle.safeParse(raw);
      const db = requireDb(c);
      const id = newId("imp_");
      if (!parsed.success) {
        const errors = parsed.error.issues.slice(0, 50).map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
        return privateJson({ previewId: null, summary: {}, records: [], errors }, 422);
      }
      const records = await previewImport(c, userId, parsed.data);
      const summary: Record<string, { new: number; duplicate: number; conflict: number; invalid: number }> = {};
      for (const rec of records) {
        const s = (summary[rec.collection] ??= { new: 0, duplicate: 0, conflict: 0, invalid: 0 });
        s[rec.status] += 1;
      }
      await db
        .prepare("INSERT INTO finance_imports (id, user_id, status, bundle_json, preview_json, created_at) VALUES (?, ?, 'previewed', ?, ?, ?)")
        .bind(id, userId, JSON.stringify(parsed.data), JSON.stringify({ records, summary }), nowIso(c))
        .run();
      return privateJson({ previewId: id, summary, records, errors: [] });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/import/commit",
    access: "owner",
    handler: async (c) => {
      const userId = uid(c);
      const body = parse(zImportCommit, await readJson(c.request, 64 * 1024));
      return idempotent(c, userId, "import.commit", body, async () => {
        const db = requireDb(c);
        const imp = await db.prepare("SELECT * FROM finance_imports WHERE id = ? AND user_id = ?").bind(body.previewId, userId).first<{ id: string; status: string; bundle_json: string; preview_json: string; created_at: string; summary_json: string | null }>();
        if (!imp) throw new HttpError(404, "NOT_FOUND", "Import preview not found.");
        if (imp.status === "committed") return { status: 200, body: { summary: parseJsonColumn(imp.summary_json, {}), alreadyCommitted: true } };
        if (c.now.getTime() - Date.parse(imp.created_at) > 24 * 3_600_000) throw new HttpError(409, "PREVIEW_EXPIRED", "This preview is older than 24 hours. Preview the file again.");
        const bundle = JSON.parse(imp.bundle_json) as ExportBundle;
        const preview = JSON.parse(imp.preview_json) as { records: PreviewRecord[] };
        const byKey = new Map(preview.records.map((r0) => [r0.key, r0]));
        const idMap = new Map<string, string>();
        const counts: Record<string, { inserted: number; replaced: number; copied: number; skipped: number }> = {};
        const tally = (col: string, k: "inserted" | "replaced" | "copied" | "skipped") => {
          (counts[col] ??= { inserted: 0, replaced: 0, copied: 0, skipped: 0 })[k] += 1;
        };
        const decide = (col: Collection, id: string): { action: "insert" | "replace" | "copy" | "skip"; targetId: string } => {
          const rec = byKey.get(`${col}:${id}`);
          if (!rec) return { action: "skip", targetId: id };
          if (rec.status === "duplicate" || rec.status === "invalid") return { action: "skip", targetId: id };
          if (rec.status === "new") return { action: "insert", targetId: id };
          const d = body.decisions[rec.key] ?? "skip";
          if (d === "skip") return { action: "skip", targetId: id };
          if (d === "replace" && !rec.foreign) return { action: "replace", targetId: id };
          return { action: "copy", targetId: newId(id.slice(0, 2)) };
        };
        const stmts: D1PreparedStatement[] = [];
        const now = nowIso(c);
        for (const n of bundle.notes) {
          const { action, targetId } = decide("notes", n.id);
          if (action === "skip") {
            tally("notes", "skipped");
            continue;
          }
          if (action === "replace") {
            stmts.push(db.prepare("UPDATE finance_notes SET title = ?, body = ?, template = ?, tags_json = ?, links_json = ?, evidence_json = ?, archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?").bind(n.title, n.body, n.template, JSON.stringify(n.tags), JSON.stringify(n.links), JSON.stringify(n.evidenceIds), n.archivedAt, now, n.id, userId));
            tally("notes", "replaced");
          } else {
            const linkKey = n.template === "deal_view" ? (n.links.find((l) => l.type === "deal") ? `deal:${n.links.find((l) => l.type === "deal")?.id}` : null) : null;
            stmts.push(
              db
                .prepare("INSERT INTO finance_notes (id, user_id, title, body, template, tags_json, links_json, evidence_json, link_key, revision, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT DO NOTHING")
                .bind(targetId, userId, n.title, n.body, action === "copy" && n.template === "deal_view" ? "blank" : n.template, JSON.stringify(n.tags), JSON.stringify(n.links), JSON.stringify(n.evidenceIds), action === "copy" ? null : linkKey, n.createdAt, now, n.archivedAt),
              ...noteLinkStatements(db, targetId, userId, n.links),
            );
            tally("notes", action === "copy" ? "copied" : "inserted");
          }
        }
        for (const w of bundle.watches) {
          const { action } = decide("watches", w.id);
          if (action === "skip") {
            tally("watches", "skipped");
            continue;
          }
          const ww = w as typeof w & { saved?: boolean; following?: boolean };
          stmts.push(
            db
              .prepare("INSERT INTO finance_watches (id, user_id, kind, entity_id, saved, following, created_at, last_viewed_at, watermark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, kind, entity_id) DO UPDATE SET saved = excluded.saved, following = excluded.following")
              .bind(action === "copy" ? newId("w_") : w.id, userId, w.kind, w.entityId, ww.saved ? 1 : 0, ww.following === false ? 0 : 1, w.createdAt, w.lastViewedAt, w.watermark),
          );
          tally("watches", action === "replace" ? "replaced" : "inserted");
        }
        for (const s of bundle.savedSearches) {
          const { action, targetId } = decide("savedSearches", s.id);
          if (action === "skip") {
            tally("savedSearches", "skipped");
            continue;
          }
          if (action === "replace") stmts.push(db.prepare("UPDATE finance_saved_searches SET name = ?, filters_json = ? WHERE id = ? AND user_id = ?").bind(s.name, JSON.stringify(s.filters), s.id, userId));
          else stmts.push(db.prepare("INSERT INTO finance_saved_searches (id, user_id, name, filters_json, created_at, last_viewed_at, watermark) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(targetId, userId, s.name, JSON.stringify(s.filters), s.createdAt, s.lastViewedAt, s.watermark));
          tally("savedSearches", action === "replace" ? "replaced" : action === "copy" ? "copied" : "inserted");
        }
        for (const m of bundle.models) {
          const { action, targetId } = decide("models", m.id);
          if (action === "skip") {
            tally("models", "skipped");
            continue;
          }
          if (action === "replace") stmts.push(db.prepare("UPDATE finance_models SET title = ?, calc_version = ?, source_json = ?, assumptions_json = ?, outputs_json = ?, scenarios_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?").bind(m.title, m.calcVersion, JSON.stringify(m.sourceSnapshot), JSON.stringify(m.assumptions), JSON.stringify(m.outputs), JSON.stringify(m.scenarios), now, m.id, userId));
          else
            stmts.push(
              db
                .prepare("INSERT INTO finance_models (id, user_id, model_type, title, calc_version, source_json, assumptions_json, outputs_json, scenarios_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT DO NOTHING")
                .bind(targetId, userId, m.modelType, m.title, m.calcVersion, JSON.stringify(m.sourceSnapshot), JSON.stringify(m.assumptions), JSON.stringify(m.outputs), JSON.stringify(m.scenarios), m.createdAt, now),
            );
          tally("models", action === "replace" ? "replaced" : action === "copy" ? "copied" : "inserted");
        }
        for (const rec of bundle.memory.records) {
          const { action } = decide("memoryRecords", rec.id);
          if (action === "skip") {
            // Map cards of a skipped duplicate/conflicting subject to the existing record for this subject.
            const existing = await db.prepare("SELECT id FROM finance_memory_records WHERE user_id = ? AND subject_type = ? AND subject_id = ?").bind(userId, rec.subjectType, rec.subjectId).first<{ id: string }>();
            if (existing) idMap.set(rec.id, existing.id);
            tally("memoryRecords", "skipped");
            continue;
          }
          const targetId = action === "copy" ? newId("r_") : rec.id;
          idMap.set(rec.id, targetId);
          stmts.push(db.prepare("INSERT INTO finance_memory_records (id, user_id, subject_type, subject_id, source_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(targetId, userId, rec.subjectType, rec.subjectId, rec.sourceVersion, rec.createdAt, now));
          tally("memoryRecords", action === "copy" ? "copied" : "inserted");
        }
        for (const k of bundle.memory.cards) {
          const { action, targetId } = decide("memoryCards", k.id);
          const recordId = idMap.get(k.recordId) ?? k.recordId;
          if (action === "skip") {
            tally("memoryCards", "skipped");
            continue;
          }
          if (action === "replace") stmts.push(db.prepare("UPDATE finance_memory_cards SET prompt = ?, answer = ?, source_refs_json = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(k.prompt, k.answer, JSON.stringify(k.sourceRefs), now, k.id, userId));
          else
            stmts.push(
              db
                .prepare("INSERT INTO finance_memory_cards (id, user_id, record_id, card_type, prompt, answer, source_refs_json, source_version, stage, due_date, suspended, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
                .bind(targetId, userId, recordId, k.cardType, k.prompt, k.answer, JSON.stringify(k.sourceRefs), k.sourceVersion, k.stage, k.dueDate, k.suspended ? 1 : 0, k.createdAt, now),
            );
          tally("memoryCards", action === "replace" ? "replaced" : action === "copy" ? "copied" : "inserted");
        }
        for (const l of bundle.memory.reviewLog) {
          const { action } = decide("reviewLog", l.id);
          if (action !== "insert") {
            tally("reviewLog", "skipped");
            continue;
          }
          stmts.push(db.prepare("INSERT INTO finance_review_log (id, user_id, card_id, reviewed_at, review_date, rating, stage_before, stage_after, due_before, due_after, scheduler_version, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT DO NOTHING").bind(l.id, userId, l.cardId, l.reviewedAt, l.reviewDate, l.rating, l.stageBefore, l.stageAfter, l.dueBefore, l.dueAfter, l.schedulerVersion));
          tally("reviewLog", "inserted");
        }
        for (const p of bundle.progress) {
          stmts.push(db.prepare("INSERT INTO finance_progress (user_id, item_type, item_id, status, answer_json, correct, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, item_type, item_id) DO NOTHING").bind(userId, p.itemType, p.itemId, p.status, p.answer === undefined ? null : JSON.stringify(p.answer), p.correct === null || p.correct === undefined ? null : p.correct ? 1 : 0, p.updatedAt));
          tally("progress", "inserted");
        }
        for (const a of bundle.interviewAttempts) {
          const { action, targetId } = decide("interviewAttempts", a.id);
          if (action === "skip" || action === "replace") {
            tally("interviewAttempts", "skipped");
            continue;
          }
          stmts.push(db.prepare("INSERT INTO finance_interview_attempts (id, user_id, prompt_id, subject_json, response, duration_sec, self_rubric_json, reflection, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(targetId, userId, a.promptId, a.subject ? JSON.stringify(a.subject) : null, a.response, a.durationSec, JSON.stringify(a.selfRubric), a.reflection, a.createdAt));
          tally("interviewAttempts", action === "copy" ? "copied" : "inserted");
        }
        if (bundle.preferences) {
          const d = body.decisions["preferences:me"] ?? (byKey.get("preferences:me")?.status === "new" ? "replace" : "skip");
          if (d === "replace") {
            const cur = await loadPrefs(db, userId);
            stmts.push(db.prepare("INSERT INTO finance_preferences (user_id, prefs_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, revision = finance_preferences.revision + 1, updated_at = excluded.updated_at").bind(userId, JSON.stringify({ ...cur.prefs, ...bundle.preferences }), now));
            tally("preferences", "replaced");
          } else tally("preferences", "skipped");
        }
        const summary = { committedAt: now, counts, note: "Imports never delete existing records." };
        stmts.push(db.prepare("UPDATE finance_imports SET status = 'committed', committed_at = ?, summary_json = ? WHERE id = ? AND user_id = ? AND status = 'previewed'").bind(now, JSON.stringify(summary), imp.id, userId));
        // Each D1 batch is a transaction. Large imports are applied in chunks; every insert is
        // ON CONFLICT DO NOTHING, so retrying a partially applied commit is safe, and the preview is
        // marked committed only by the final chunk.
        for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
        return { status: 200, body: { summary } };
      });
    },
  });
}

function parseViewBody(body: string): Record<string, string> {
  const fields = ["My thesis", "Main risk", "What I need to verify", "Interview talking point"];
  const v: Record<string, string> = {};
  for (const f of fields) {
    const m = new RegExp(`## ${f}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body);
    v[f] = (m?.[1] ?? "").trim();
  }
  return v;
}

export function noteMarkdown(n: { title: string; body: string; tags: string[]; evidenceIds: string[]; updatedAt: string; links: Array<{ type: string; id: string }> }, view: ResearchView): string {
  const docs = new Map<string, string>();
  for (const id of n.evidenceIds) {
    const cl = view.claims[id];
    const d = cl ? view.documents[cl.documentId] : undefined;
    if (d) docs.set(d.id, `- [${id}] ${d.publisher}, “${d.title}”${d.publishedDate ? ` (${d.publishedDate.date})` : ""}: ${d.url}`);
  }
  const links = n.links.map((l) => `${l.type}:${l.id}`).join(", ");
  return `# ${n.title}\n\n_Updated ${n.updatedAt}${n.tags.length ? ` · tags: ${n.tags.join(", ")}` : ""}${links ? ` · linked: ${links}` : ""}_\n\n${n.body.trim()}\n${docs.size ? `\n## Cited evidence\n${[...docs.values()].join("\n")}\n` : ""}`;
}
