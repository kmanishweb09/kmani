import type { ClaimView, FeedItemView } from "../shared/api";
import type { SectorSlugValue } from "../shared/labels";
import type { SourceDocument } from "../shared/schemas/research";
import { parseJsonColumn } from "./db";
import { getSource } from "./sources/registry";
import type { D1Database } from "./types";

/** Read access to runtime-collected source documents and feed items (D1). */

export interface FeedRow {
  id: string;
  document_id: string;
  source_id: string;
  title: string;
  url: string;
  event_type: string;
  event_date: string | null;
  published_at: string | null;
  published_date: string | null;
  discovered_at: string;
  sectors_json: string;
  entities_json: string;
  verification: string;
  newly_discovered: number;
  cluster_key: string;
  excerpt: string | null;
}

export function runtimeClaimId(documentId: string): string {
  return `ev-u-${documentId}`;
}

export function feedRowToView(r: FeedRow): FeedItemView {
  return {
    id: r.id,
    sourceId: r.source_id,
    sourceName: getSource(r.source_id)?.name ?? r.source_id,
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    publishedDate: r.published_date ?? (r.published_at ? r.published_at.slice(0, 10) : null),
    eventDate: r.event_date,
    discoveredAt: r.discovered_at,
    eventType: r.event_type,
    sectors: parseJsonColumn<SectorSlugValue[]>(r.sectors_json, []),
    entities: parseJsonColumn<FeedItemView["entities"]>(r.entities_json, []),
    verification: r.verification as FeedItemView["verification"],
    newlyDiscovered: Boolean(r.newly_discovered),
    excerpt: r.excerpt,
  };
}

export async function listFeed(db: D1Database | undefined, opts: { sinceIso?: string; sector?: string; limit: number; offset?: number }): Promise<{ items: FeedItemView[]; total: number }> {
  if (!db) return { items: [], total: 0 };
  const where: string[] = ["verification != 'rejected'"];
  const binds: unknown[] = [];
  if (opts.sinceIso) {
    where.push("discovered_at >= ?");
    binds.push(opts.sinceIso);
  }
  if (opts.sector) {
    where.push("sectors_json LIKE ?");
    binds.push(`%"${opts.sector.replace(/[%_"]/g, "")}"%`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM finance_feed_items ${w}`).bind(...binds).first<{ n: number }>())?.n ?? 0;
    const rows = await db
      .prepare(`SELECT * FROM finance_feed_items ${w} ORDER BY COALESCE(event_date, published_date, substr(discovered_at, 1, 10)) DESC, discovered_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, opts.limit, opts.offset ?? 0)
      .all<FeedRow>();
    return { items: (rows.results ?? []).map(feedRowToView), total };
  } catch {
    return { items: [], total: 0 };
  }
}

interface DocRow {
  id: string;
  source_id: string;
  canonical_url: string;
  title: string;
  published_at: string | null;
  published_date: string | null;
  retrieved_at: string;
  content_hash: string;
  excerpt: string | null;
  locator: string | null;
  publisher: string | null;
  document_type: string | null;
}

const PRIMARY_TYPES = new Set(["press_release", "exchange_filing", "regulatory_filing", "regulatory_order", "court_order", "annual_report", "investor_presentation", "company_page"]);

/** Builds the SourceDocument shape for a runtime (D1) document. */
export function runtimeDocument(row: DocRow): SourceDocument {
  const src = getSource(row.source_id);
  const documentType = (row.document_type ??
    (src?.kind === "regulator" || src?.kind === "competition_authority" ? "regulatory_filing" : src?.kind === "exchange" ? "exchange_filing" : "news_report")) as SourceDocument["documentType"];
  const manual = !src?.connector;
  return {
    id: row.id,
    publisher: row.publisher ?? src?.publisher ?? row.source_id,
    url: row.canonical_url,
    title: row.title,
    documentType,
    isPrimary: row.document_type ? PRIMARY_TYPES.has(row.document_type) : src?.kind === "regulator" || src?.kind === "company" || src?.kind === "exchange" || src?.kind === "competition_authority",
    publishedDate: row.published_date ? { date: row.published_date, precision: "day" } : row.published_at ? { date: row.published_at.slice(0, 10), precision: "day" } : null,
    retrievedAt: manual ? null : row.retrieved_at,
    retrievalStatus: manual ? "not_retrieved" : "retrieved",
    retrievalNote: manual ? "Link and excerpt recorded by the site owner; the server did not fetch the document." : `Feed metadata retrieved from ${src?.name ?? row.source_id}; the linked document itself has not been reviewed.`,
    contentHash: row.content_hash,
    language: "en",
  };
}

export async function loadRuntimeDocument(db: D1Database, id: string): Promise<SourceDocument | null> {
  const row = await db.prepare("SELECT * FROM finance_source_documents WHERE id = ?").bind(id).first<DocRow>();
  return row ? runtimeDocument(row) : null;
}

/** Evidence for runtime documents: metadata retrieved from a feed, document itself not reviewed (a lead). */
export async function runtimeClaim(db: D1Database | undefined, claimId: string): Promise<ClaimView | null> {
  if (!db || !claimId.startsWith("ev-u-")) return null;
  const docId = claimId.slice(5);
  let row: DocRow | null = null;
  try {
    row = await db.prepare("SELECT * FROM finance_source_documents WHERE id = ?").bind(docId).first<DocRow>();
  } catch {
    return null;
  }
  if (!row) return null;
  const doc = runtimeDocument(row);
  const manual = !getSource(row.source_id)?.connector;
  return {
    id: claimId,
    subject: { type: "brief", id: row.id },
    field: "document",
    label: "Source-linked lead",
    display: row.title,
    document: doc,
    locator: row.locator ?? "Feed item metadata",
    excerpt: row.excerpt,
    status: "pending",
    checkedAt: manual ? null : row.retrieved_at.slice(0, 10),
    method: manual ? "owner_entry" : "document_retrieval",
    note: "A lead until the underlying document is read and checked.",
  };
}
