export const EGRESS_MARKERS: RegExp;
export const RESTRICTED_MARKERS: RegExp;
export const IMPORT_LIMIT: number;
export interface RetrievalAttempt {
  documentId: string;
  url: string;
  attemptedAt: string;
  finishedAt: string | null;
  outcome: "retrieved" | "retrieved_pdf_unparsed" | "egress_blocked" | "access_restricted" | "robots_disallowed" | "rate_limited" | "http_error" | "network_error" | "timeout";
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  detail: string | null;
  userAgent: string;
}
export interface Candidate {
  claimId: string;
  documentId: string;
  retrievedAt: string;
  locator: string;
  excerpt: string;
  checkedValue: string;
  matchKind: string;
  recordedValue: string;
}
export interface NeedsHuman {
  claimId: string;
  documentId: string;
  reason: string;
  retrievedAt: string;
}
export interface ImportItem {
  kind: "claim_verification";
  documentId: string;
  payload: { claimId: string; status: "source_checked"; checkedValue: string; locator: string; excerpt: string; retrievedAt: string; note: null };
  evidence: { documents: [] };
}
export function retrieveDocuments(o: {
  docs: Array<{ documentId: string; url: string; claims: string[] }>;
  claims: Record<string, { display: string }>;
  ua: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  sleepImpl?: (ms: number) => Promise<void>;
  hostDelayMs?: number;
  onAttempt?: (a: RetrievalAttempt) => void;
}): Promise<{ attempts: RetrievalAttempt[]; candidates: Candidate[]; needsHuman: NeedsHuman[] }>;
export function importItem(c: Candidate): ImportItem;
export function mergeImportItems(existing: ImportItem[], candidates: Candidate[]): ImportItem[];
export function mergeNeedsHuman(existing: NeedsHuman[], items: NeedsHuman[]): NeedsHuman[];
export function chunkImportItems(items: ImportItem[], limit?: number): Array<{ name: string; items: ImportItem[] }>;
