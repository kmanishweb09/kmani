import ARCHIVE from "virtual:finance-archive";
import type { ClaimView, CompanySummary, DealDetail, DealSummary, EventView, RecordHistoryEntry, TermView } from "../shared/api";
import type { CompiledArchive, CompiledClaim, CompiledCompany, CompiledDeal } from "../shared/archive/compile";
import { collectEvidenceIds, summarizeDeal } from "../shared/archive/derive";
import { dealSearchText, normalizeSearchText } from "../shared/dealQuery";
import type { SourceDocument } from "../shared/schemas/research";
import { parseJsonColumn } from "./db";
import type { D1Database } from "./types";

/**
 * The published research view = compiled archive (immutable per release) + published changes from
 * D1 (appended events, revised terms, owner corrections, new deals, claim status updates).
 * Rebuilt only when the highest published change sequence changes.
 */

export const archive: CompiledArchive = ARCHIVE as CompiledArchive;

export interface PublishedChangeRow {
  seq: number;
  id: string;
  entity_type: string;
  entity_id: string;
  change_type: string;
  payload_json: string;
  evidence_json: string;
  note: string | null;
  published_at: string;
}

export interface Correction {
  id: string;
  field: string;
  previous: unknown;
  next: unknown;
  note: string;
  publishedAt: string;
  ev: string[];
}

export interface ResearchView {
  version: string;
  archiveVersion: string;
  overlaySeq: number;
  deals: CompiledDeal[];
  dealById: Map<string, CompiledDeal>;
  summaries: DealSummary[];
  summaryById: Map<string, DealSummary>;
  dealSearch: Map<string, string>;
  companies: CompiledCompany[];
  companyById: Map<string, CompiledCompany>;
  companySummaries: CompanySummary[];
  companyCorrections: Map<string, Correction[]>;
  claims: Record<string, CompiledClaim>;
  documents: Record<string, SourceDocument>;
  aliasIndex: Array<{ alias: string; type: "deal" | "company"; id: string; name: string }>;
  /** Published-change history per entity ("deal:<id>", "company:<id>", "claim:<id>"), oldest first. */
  history: Map<string, HistoryEntry[]>;
  /** Sequence of the latest effective change per entity field ("deal:<id>:<field>"; "*" = whole record). */
  fieldSeq: Map<string, number>;
}

export interface HistoryEntry {
  changeId: string;
  seq: number;
  changeType: string;
  fields: string[];
  note: string | null;
  publishedAt: string;
  /** Set when a later revert undid this change. */
  revertedBy: string | null;
  /** For a revert: the change it undid. */
  reverts: string | null;
  /** For edits: values before and after the change. */
  previous?: Record<string, unknown> | null;
  next?: Record<string, unknown> | null;
  /** Set when an event was appended but, being older than the current status, did not change it. */
  statusNotApplied?: boolean;
}

/** Deal fields an owner edit may replace (identity and dates move only through events and revisions). */
export const DEAL_EDITABLE = ["title", "aliases", "subsector", "peerGroup", "perimeter", "otherParties", "advisers", "rationale", "financing", "payment", "stake", "sectorContext", "tags", "comparables"] as const;
/** Company fields an owner edit may replace. */
export const COMPANY_EDITABLE = ["displayName", "legalName", "aliases", "website", "irUrl", "subsector", "tickers", "lifecycle", "businessModel", "country", "peers"] as const;

/** Fields a published change touches (drives revision-conflict checks and history). */
export function changeFields(changeType: string, payload: Record<string, unknown>): string[] {
  switch (changeType) {
    case "event_append":
      return (payload.event as EventView | undefined)?.statusAfter ? ["events", "status"] : ["events"];
    case "term_revision":
      return ["terms"];
    case "company_observation":
      return ["observations"];
    case "company_correction":
      return typeof payload.field === "string" ? [payload.field] : [];
    case "deal_edit":
    case "company_edit":
      return Object.keys((payload.fields as Record<string, unknown> | undefined) ?? {});
    case "claim_status":
      return ["status"];
    case "new_deal":
    case "deal_create":
    case "company_create":
      return ["*"];
    default:
      return [];
  }
}

/** Entity key a published change applies to. */
export function changeEntityKey(ch: Pick<PublishedChangeRow, "entity_type" | "entity_id">): string {
  return `${ch.entity_type}:${ch.entity_id}`;
}

let cached: ResearchView | null = null;

interface EvidencePayload {
  documents?: SourceDocument[];
  claims?: CompiledClaim[];
}

function companySummary(c: CompiledCompany, dealCount: number): CompanySummary {
  return {
    id: c.id,
    displayName: c.displayName,
    legalName: c.legalName,
    aliases: c.aliases,
    country: c.country,
    sector: c.sector,
    subsector: c.subsector,
    lifecycle: c.lifecycle.status,
    tickers: c.tickers.filter((t) => t.active).map((t) => ({ exchange: t.exchange, symbol: t.symbol })),
    dealCount,
  };
}

function buildView(changes: PublishedChangeRow[]): ResearchView {
  const claims: Record<string, CompiledClaim> = { ...archive.claims };
  const documents: Record<string, SourceDocument> = { ...archive.documents };
  const deals = new Map<string, CompiledDeal>(archive.deals.map((d) => [d.id, d]));
  const companies = new Map<string, CompiledCompany>(archive.companies.map((c) => [c.id, c]));
  const lastChanged = new Map<string, string>();
  const companyCorrections = new Map<string, Correction[]>();
  const cloned = new Set<string>();
  const mutableDeal = (id: string): CompiledDeal | null => {
    const d = deals.get(id);
    if (!d) return null;
    if (!cloned.has(`deal:${id}`)) {
      const copy = structuredClone(d);
      deals.set(id, copy);
      cloned.add(`deal:${id}`);
      return copy;
    }
    return d;
  };
  const mutableCompany = (id: string): CompiledCompany | null => {
    const c = companies.get(id);
    if (!c) return null;
    if (!cloned.has(`company:${id}`)) {
      const copy = structuredClone(c);
      companies.set(id, copy);
      cloned.add(`company:${id}`);
      return copy;
    }
    return c;
  };

  // Reverts are resolved first: a reverted change is skipped entirely (its evidence too), and the
  // revert itself is recorded in the entity's history.
  const reverted = new Map<string, string>();
  for (const ch of changes) {
    if (ch.change_type !== "revert") continue;
    const target = parseJsonColumn<{ revertsChangeId?: string }>(ch.payload_json, {}).revertsChangeId;
    if (target) reverted.set(target, ch.id);
  }
  const history = new Map<string, HistoryEntry[]>();
  const fieldSeq = new Map<string, number>();
  const byId = new Map(changes.map((c) => [c.id, c]));
  const record = (ch: PublishedChangeRow, fields: string[], extra: Partial<HistoryEntry> = {}) => {
    const key = changeEntityKey(ch);
    const list = history.get(key) ?? [];
    list.push({ changeId: ch.id, seq: ch.seq, changeType: ch.change_type, fields, note: ch.note, publishedAt: ch.published_at, revertedBy: reverted.get(ch.id) ?? null, reverts: null, ...extra });
    history.set(key, list);
  };
  const touch = (ch: PublishedChangeRow, fields: string[]) => {
    for (const f of fields) fieldSeq.set(`${changeEntityKey(ch)}:${f}`, ch.seq);
  };

  for (const ch of changes) {
    const payload = parseJsonColumn<Record<string, unknown>>(ch.payload_json, {});
    const fields = changeFields(ch.change_type, payload);
    if (ch.change_type === "revert") {
      const target = byId.get(typeof payload.revertsChangeId === "string" ? payload.revertsChangeId : "");
      if (target) {
        const tf = changeFields(target.change_type, parseJsonColumn<Record<string, unknown>>(target.payload_json, {}));
        touch({ ...ch, entity_type: target.entity_type, entity_id: target.entity_id }, tf);
      }
      record(ch, [], { reverts: target?.id ?? null });
      continue;
    }
    if (reverted.has(ch.id)) {
      record(ch, fields);
      touch(ch, fields);
      continue;
    }
    const ev = parseJsonColumn<EvidencePayload>(ch.evidence_json, {});
    for (const d of ev.documents ?? []) documents[d.id] = d;
    for (const cl of ev.claims ?? []) claims[cl.id] = cl;
    const evIds = (ev.claims ?? []).map((c) => c.id);
    let extra: Partial<HistoryEntry> = {};
    switch (ch.change_type) {
      case "event_append": {
        const d = mutableDeal(ch.entity_id);
        const e = payload.event as EventView | undefined;
        if (!d || !e) break;
        d.events.push({ ...e, ev: e.ev?.length ? e.ev : evIds, origin: "published_update" });
        // An event dated before the current status (e.g. a historical filing imported later) is added to
        // the timeline but never moves the current status backwards.
        if (e.statusAfter) {
          if (e.date.date >= d.status.asOf) d.status = { value: e.statusAfter, asOf: e.date.date, note: null, ev: e.ev?.length ? e.ev : evIds };
          else extra = { statusNotApplied: true };
        }
        lastChanged.set(d.id, ch.published_at);
        break;
      }
      case "term_revision": {
        const d = mutableDeal(ch.entity_id);
        const t = payload.term as TermView | undefined;
        if (!d || !t) break;
        const supersedes = typeof payload.supersedesTermId === "string" ? payload.supersedesTermId : null;
        if (supersedes) {
          const old = d.terms.find((x) => x.id === supersedes);
          if (old && old.asOf <= t.asOf) old.correction = { publishedAt: ch.published_at, note: ch.note ?? "Revised terms published" };
        }
        // A revision dated before the latest current term of the same metric cannot become the headline.
        const newer = d.terms.some((x) => x.metric === t.metric && !x.correction && x.asOf > t.asOf);
        d.terms.push({ ...t, headline: newer ? false : t.headline, ev: t.ev?.length ? t.ev : evIds });
        lastChanged.set(d.id, ch.published_at);
        break;
      }
      case "new_deal":
      case "deal_create": {
        const nd = payload.deal as CompiledDeal | undefined;
        if (!nd || deals.has(nd.id)) break;
        deals.set(nd.id, nd);
        cloned.add(`deal:${nd.id}`);
        lastChanged.set(nd.id, ch.published_at);
        break;
      }
      case "deal_edit": {
        const d = mutableDeal(ch.entity_id);
        const f = (payload.fields as Record<string, unknown> | undefined) ?? {};
        if (!d) break;
        for (const [k, v] of Object.entries(f)) if ((DEAL_EDITABLE as readonly string[]).includes(k)) (d as unknown as Record<string, unknown>)[k] = v;
        extra = { previous: (payload.previous as Record<string, unknown>) ?? null, next: f };
        lastChanged.set(d.id, ch.published_at);
        break;
      }
      case "company_create": {
        const nc = payload.company as CompiledCompany | undefined;
        if (!nc || companies.has(nc.id)) break;
        companies.set(nc.id, nc);
        cloned.add(`company:${nc.id}`);
        break;
      }
      case "company_correction":
      case "company_edit": {
        const c = mutableCompany(ch.entity_id);
        if (!c) break;
        const f: Record<string, unknown> = ch.change_type === "company_edit" ? ((payload.fields as Record<string, unknown>) ?? {}) : typeof payload.field === "string" ? { [payload.field]: payload.next } : {};
        const list = companyCorrections.get(c.id) ?? [];
        for (const [field, next] of Object.entries(f)) {
          if (!(COMPANY_EDITABLE as readonly string[]).includes(field)) continue;
          const previous = (c as unknown as Record<string, unknown>)[field];
          (c as unknown as Record<string, unknown>)[field] = next;
          list.push({ id: ch.id, field, previous, next, note: ch.note ?? "", publishedAt: ch.published_at, ev: evIds });
        }
        companyCorrections.set(c.id, list);
        extra = { previous: (payload.previous as Record<string, unknown>) ?? null, next: f };
        break;
      }
      case "company_observation": {
        const c = mutableCompany(ch.entity_id);
        const o = payload.observation as CompiledCompany["observations"][number] | undefined;
        if (!c || !o) break;
        const supersedes = typeof payload.supersedesObservationId === "string" ? payload.supersedesObservationId : null;
        if (supersedes) {
          const old = c.observations.find((x) => x.id === supersedes) as (CompiledCompany["observations"][number] & { supersededBy?: unknown }) | undefined;
          if (old) old.supersededBy = { id: o.id, publishedAt: ch.published_at, note: ch.note ?? "Revised observation published" };
        }
        c.observations.push({ ...o, ev: o.ev?.length ? o.ev : evIds });
        break;
      }
      case "claim_status": {
        const id = typeof payload.claimId === "string" ? payload.claimId : "";
        const existing = claims[id];
        if (!existing) break;
        claims[id] = {
          ...existing,
          status: (payload.status as CompiledClaim["status"]) ?? existing.status,
          checkedAt: (payload.checkedAt as string) ?? existing.checkedAt,
          method: (payload.method as CompiledClaim["method"]) ?? existing.method,
          note: (payload.note as string) ?? existing.note,
          locator: typeof payload.locator === "string" ? payload.locator : existing.locator,
          excerpt: typeof payload.excerpt === "string" ? payload.excerpt : existing.excerpt,
        };
        const docPatch = payload.document as Partial<SourceDocument> & { id?: string } | undefined;
        const doc = docPatch?.id ? documents[docPatch.id] : undefined;
        if (doc && docPatch?.retrievedAt) documents[doc.id] = { ...doc, retrievedAt: docPatch.retrievedAt, retrievalStatus: "retrieved", retrievalNote: docPatch.retrievalNote ?? doc.retrievalNote ?? null };
        if (existing.subject.type === "deal") lastChanged.set(existing.subject.id, ch.published_at);
        extra = { previous: { status: existing.status, checkedAt: existing.checkedAt, method: existing.method }, next: { status: claims[id]?.status, checkedAt: claims[id]?.checkedAt, method: claims[id]?.method, checkedValue: payload.checkedValue ?? null } };
        break;
      }
      default:
        break;
    }
    record(ch, fields, extra);
    touch(ch, fields);
  }

  const dealList = [...deals.values()];
  const summaries = dealList.map((d) => summarizeDeal(d, claims, lastChanged.get(d.id)));
  const summaryById = new Map(summaries.map((s) => [s.id, s]));
  const dealSearch = new Map(summaries.map((s) => [s.id, dealSearchText(s)]));
  const dealCounts = new Map<string, number>();
  for (const d of dealList) {
    const ids = new Set([d.acquirer.companyId, d.target.companyId, ...d.otherParties.map((p) => p.companyId)].filter(Boolean) as string[]);
    for (const id of ids) dealCounts.set(id, (dealCounts.get(id) ?? 0) + 1);
  }
  const companyList = [...companies.values()];
  const aliasIndex: ResearchView["aliasIndex"] = [];
  for (const c of companyList) {
    const names = [c.displayName, c.legalName, ...c.aliases, ...c.formerNames.map((f) => f.name)];
    // "Credit Suisse (historical)" must still match "Credit Suisse" in a headline.
    const stripped = names.map((a) => a.replace(/\s*\([^)]*\)\s*$/, ""));
    for (const n of new Set([...names, ...stripped].map(normalizeSearchText))) {
      if (n.length >= 3) aliasIndex.push({ alias: n, type: "company", id: c.id, name: c.displayName });
    }
  }
  for (const d of dealList) {
    for (const a of new Set([d.title, ...d.aliases])) {
      const n = normalizeSearchText(a);
      if (n.length >= 3) aliasIndex.push({ alias: n, type: "deal", id: d.id, name: d.title });
    }
  }
  const overlaySeq = changes.length ? (changes[changes.length - 1] as PublishedChangeRow).seq : 0;
  return {
    version: `${archive.version}.${overlaySeq}`,
    archiveVersion: archive.version,
    overlaySeq,
    deals: dealList,
    dealById: deals,
    summaries,
    summaryById,
    dealSearch,
    companies: companyList,
    companyById: companies,
    companySummaries: companyList.map((c) => companySummary(c, dealCounts.get(c.id) ?? 0)),
    companyCorrections,
    claims,
    documents,
    aliasIndex,
    history,
    fieldSeq,
  };
}

/** Latest effective change sequence among the given fields of an entity (0 when untouched since the archive). */
export function entityFieldSeq(view: Pick<ResearchView, "fieldSeq">, entityKey: string, fields: string[]): number {
  let max = view.fieldSeq.get(`${entityKey}:*`) ?? 0;
  const all = fields.includes("*");
  for (const [k, v] of view.fieldSeq) {
    if (!k.startsWith(`${entityKey}:`)) continue;
    if (all || fields.includes(k.slice(entityKey.length + 1))) max = Math.max(max, v);
  }
  return max;
}

/** Returns the current research view, reloading overlays only when D1 has newer published changes. */
export async function getResearch(db: D1Database | undefined): Promise<ResearchView> {
  if (!db) {
    if (!cached || cached.overlaySeq !== 0) cached = buildView([]);
    return cached;
  }
  let maxSeq = 0;
  try {
    const row = await db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM finance_published_changes").first<{ m: number }>();
    maxSeq = row?.m ?? 0;
  } catch {
    // Table missing (migration not applied): serve the archive only.
    if (!cached || cached.overlaySeq !== 0) cached = buildView([]);
    return cached;
  }
  if (cached && cached.overlaySeq === maxSeq) return cached;
  const rows = maxSeq
    ? ((await db.prepare("SELECT seq, id, entity_type, entity_id, change_type, payload_json, evidence_json, note, published_at FROM finance_published_changes ORDER BY seq ASC").all<PublishedChangeRow>()).results ?? [])
    : [];
  cached = buildView(rows);
  return cached;
}

export function resetResearchCache(): void {
  cached = null;
}

export function claimView(view: ResearchView, id: string): ClaimView | null {
  const c = view.claims[id];
  if (!c) return null;
  const document = view.documents[c.documentId];
  if (!document) return null;
  const { documentId: _d, ...rest } = c;
  return { ...rest, document };
}

export function evidenceMap(view: ResearchView, ids: Iterable<string>): Record<string, ClaimView> {
  const out: Record<string, ClaimView> = {};
  for (const id of ids) {
    const v = claimView(view, id);
    if (v) out[id] = v;
  }
  return out;
}

/** Full public deal record (current view) with its evidence map. */
export function dealDetail(view: ResearchView, id: string): DealDetail | null {
  const d = view.dealById.get(id);
  const s = view.summaryById.get(id);
  if (!d || !s) return null;
  return {
    ...s,
    perimeter: d.perimeter,
    stakeNote: d.stake.note,
    stakeEv: d.stake.ev,
    effective: d.effective,
    otherParties: d.otherParties,
    terms: d.terms,
    payment: d.payment,
    financing: d.financing,
    events: [...d.events].sort((a, b) => a.date.date.localeCompare(b.date.date)),
    advisers: d.advisers,
    rationale: d.rationale,
    sectorContext: d.sectorContext,
    comparables: d.comparables.map((c) => {
      const other = view.dealById.get(c.dealId);
      return { ...c, title: other?.title ?? null, announced: other?.announced.date ?? null };
    }),
    asAnnounced: d.asAnnounced ?? null,
    afterDeal: d.afterDeal,
    autopsy: d.autopsy,
    researchCutoff: d.researchCutoff,
    recordUpdated: d.recordUpdated,
    evidence: evidenceMap(view, collectEvidenceIds(d)),
    archiveVersion: view.archiveVersion,
    history: publicHistory(view, `deal:${id}`),
  };
}

/** Public view of a record's change history (no internal sequence numbers or before/after payloads). */
export function publicHistory(view: Pick<ResearchView, "history">, key: string): RecordHistoryEntry[] {
  return (view.history.get(key) ?? []).map((h) => ({ changeId: h.changeId, changeType: h.changeType, fields: h.fields, note: h.note, publishedAt: h.publishedAt, revertedBy: h.revertedBy, reverts: h.reverts, ...(h.statusNotApplied ? { statusNotApplied: true } : {}) }));
}
