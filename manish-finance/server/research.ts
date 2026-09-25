import ARCHIVE from "virtual:finance-archive";
import type { ClaimView, CompanySummary, DealSummary, EventView, TermView } from "../shared/api";
import type { CompiledArchive, CompiledClaim, CompiledCompany, CompiledDeal } from "../shared/archive/compile";
import { summarizeDeal } from "../shared/archive/derive";
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

  for (const ch of changes) {
    const payload = parseJsonColumn<Record<string, unknown>>(ch.payload_json, {});
    const ev = parseJsonColumn<EvidencePayload>(ch.evidence_json, {});
    for (const d of ev.documents ?? []) documents[d.id] = d;
    for (const cl of ev.claims ?? []) claims[cl.id] = cl;
    const evIds = (ev.claims ?? []).map((c) => c.id);
    switch (ch.change_type) {
      case "event_append": {
        const d = mutableDeal(ch.entity_id);
        const e = payload.event as EventView | undefined;
        if (!d || !e) break;
        d.events.push({ ...e, ev: e.ev?.length ? e.ev : evIds, origin: "published_update" });
        if (e.statusAfter) d.status = { value: e.statusAfter, asOf: e.date.date, note: null, ev: evIds };
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
          if (old) old.correction = { publishedAt: ch.published_at, note: ch.note ?? "Revised terms published" };
        }
        d.terms.push({ ...t, ev: t.ev?.length ? t.ev : evIds });
        lastChanged.set(d.id, ch.published_at);
        break;
      }
      case "new_deal": {
        const nd = payload.deal as CompiledDeal | undefined;
        if (!nd || deals.has(nd.id)) break;
        deals.set(nd.id, nd);
        lastChanged.set(nd.id, ch.published_at);
        break;
      }
      case "company_correction": {
        const c = mutableCompany(ch.entity_id);
        const field = typeof payload.field === "string" ? payload.field : "";
        if (!c || !field) break;
        const allowed = ["displayName", "legalName", "aliases", "website", "irUrl", "subsector", "tickers", "lifecycle", "businessModel", "country"];
        if (!allowed.includes(field)) break;
        const previous = (c as unknown as Record<string, unknown>)[field];
        (c as unknown as Record<string, unknown>)[field] = payload.next;
        const list = companyCorrections.get(c.id) ?? [];
        list.push({ id: ch.id, field, previous, next: payload.next, note: ch.note ?? "", publishedAt: ch.published_at, ev: evIds });
        companyCorrections.set(c.id, list);
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
        };
        if (existing.subject.type === "deal") lastChanged.set(existing.subject.id, ch.published_at);
        break;
      }
      default:
        break;
    }
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
  };
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
