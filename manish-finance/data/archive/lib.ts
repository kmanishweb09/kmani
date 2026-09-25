import type { Cite, SourceDocument } from "../../shared/schemas/research";

/**
 * Authoring helpers for the research archive.
 *
 * Verification policy used by this build (see docs/DATA_SOURCES.md):
 * - The build environment's egress policy blocked direct retrieval of source documents, so no claim
 *   is marked "Source checked". Documents carry retrievalStatus "not_retrieved".
 * - `ws()` marks a claim "search_corroborated": the value matched web-search results that cite the
 *   listed URL. The URL itself came from those results (never invented).
 * - `lead()` marks a claim "pending": recorded as a lead from background knowledge, awaiting a check.
 * - Nothing here is "human_reviewed"; only the owner can set that in the app.
 */

export const CHECKED = "2026-09-25";

const RETRIEVAL_NOTE = "Not retrieved: the build environment's network policy blocked this host. URL identified from web-search results on 25 Sep 2026.";

export function ws(doc: string, locator?: string, note?: string): Cite {
  return { doc, locator: locator ?? null, excerpt: null, status: "search_corroborated", checkedAt: CHECKED, method: "web_search_index", note: note ?? null };
}

export function lead(doc: string, note: string): Cite {
  return { doc, locator: null, excerpt: null, status: "pending", checkedAt: null, method: "builder_background", note };
}

type DocType = SourceDocument["documentType"];

export function doc(
  id: string,
  publisher: string,
  url: string,
  title: string,
  documentType: DocType,
  isPrimary: boolean,
  published: string | null,
  precision: "day" | "month" | "quarter" | "year" = "day",
): SourceDocument {
  return {
    id,
    publisher,
    url,
    title,
    documentType,
    isPrimary,
    publishedDate: published ? { date: normalizeDate(published), precision: published.length === 7 ? "month" : published.length === 4 ? "year" : precision } : null,
    retrievedAt: null,
    retrievalStatus: "not_retrieved",
    retrievalNote: RETRIEVAL_NOTE,
    contentHash: null,
    language: "en",
  };
}

/** Accepts YYYY, YYYY-MM or YYYY-MM-DD; partial dates keep their precision and use the first day. */
export function normalizeDate(d: string): string {
  if (/^\d{4}$/.test(d)) return `${d}-01-01`;
  if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
  return d;
}

export const day = (date: string) => ({ date, precision: "day" as const });
export const month = (date: string) => ({ date, precision: "month" as const });
