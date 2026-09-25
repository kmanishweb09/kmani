export const HEADLINE_METRICS: string[];
export const RANK_LABEL: string[];
export const CHECKED_STATUSES: Set<string>;
export const CONSEQUENTIAL_MAX_RANK: number;
interface ArchiveLike {
  version: string;
  claims: Record<string, { id: string; subject: { type: string; id: string }; field: string; label: string; display: string; status: string; documentId: string }>;
  documents: Record<string, { url: string; publisher: string; title: string; documentType: string; isPrimary: boolean; publishedDate?: { date: string } | null; retrievalStatus: string }>;
  deals: Array<{ id: string; title: string; autopsy?: unknown; terms: Array<{ headline?: boolean; metric: string }>; events: Array<{ type: string }> }>;
}
export interface WorklistItem {
  claimId: string;
  dealId: string;
  dealTitle: string;
  tier: 1 | 2;
  rank: number;
  rankLabel: string;
  field: string;
  label: string;
  display: string;
  status: string;
  documentId: string;
  primary: boolean;
  onlySecondarySources: boolean;
}
export function fieldRank(deal: ArchiveLike["deals"][number], claim: { field: string }): number;
export function buildWorklist(
  archive: ArchiveLike,
  generatedAt?: string,
): {
  generatedAt: string;
  archiveVersion: string;
  counts: {
    claimsTotal: number;
    claimsByStatus: Record<string, number>;
    dealClaimsNeedingPrimaryCheck: number;
    consequentialDealClaims: number;
    consequentialOnlySecondary: number;
    tier1Claims: number;
    documentsToRetrieve: number;
    primaryDocumentsToRetrieve: number;
  };
  documents: Array<{ documentId: string; url: string; isPrimary: boolean; tier: number; bestRank: number; claims: string[] }>;
  claims: WorklistItem[];
};
