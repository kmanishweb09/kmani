// Pure prioritisation of the primary-evidence worklist (no file or network access). Shared by
// scripts/evidence.mjs (worklist and retrieval) and the content verifier (evidence-quality counts), so
// "consequential" means the same thing in both.

export const HEADLINE_METRICS = ["enterprise_value", "equity_value", "stake_consideration", "value_unclear_basis"];
export const RANK_LABEL = ["Headline value", "Other material term / status / key event", "Stake, consideration", "Announcement date", "Parties, autopsy outcome facts", "Counterparties, financing, other events", "Rationale, advisers, context"];
/** Statuses that mean a claim was actually checked against its document (or by a named human reviewer). */
export const CHECKED_STATUSES = new Set(["source_checked", "human_reviewed"]);
/** Ranks 0–2 are "consequential": headline value, material terms, status, key events, stake and consideration. */
export const CONSEQUENTIAL_MAX_RANK = 2;

/** Lower rank = more consequential. */
export function fieldRank(deal, claim) {
  const f = claim.field;
  if (f.startsWith("terms.")) {
    const t = deal.terms[Number(f.split(".")[1])];
    if (t && (t.headline || HEADLINE_METRICS.includes(t.metric))) return 0;
    return 1;
  }
  if (f === "status" || f === "effective") return 1;
  if (f.startsWith("events.")) {
    const e = deal.events[Number(f.split(".")[1])];
    return e && ["completion", "termination", "withdrawal", "regulatory_decision", "regulatory_approval", "revision", "open_offer"].includes(e.type) ? 1 : 5;
  }
  if (f === "stake" || f === "payment" || f.startsWith("asAnnounced.")) return 2;
  if (f === "announced") return 3;
  if (f === "acquirer" || f === "target" || f.startsWith("autopsy.facts")) return 4;
  if (f.startsWith("otherParties") || f === "financing") return 5;
  return 6;
}

/** Deal claims not yet checked, prioritised (autopsies first, then by consequence), with the documents to retrieve. */
export function buildWorklist(archive, generatedAt = new Date().toISOString()) {
  const claims = Object.values(archive.claims);
  const docs = archive.documents;
  const dealById = new Map(archive.deals.map((d) => [d.id, d]));
  const byDoc = new Map();
  const items = [];
  for (const c of claims) {
    if (c.subject.type !== "deal" || CHECKED_STATUSES.has(c.status)) continue;
    const deal = dealById.get(c.subject.id);
    if (!deal) continue;
    const tier = deal.autopsy ? 1 : 2;
    const rank = fieldRank(deal, c);
    const doc = docs[c.documentId];
    const item = { claimId: c.id, dealId: deal.id, dealTitle: deal.title, tier, rank, rankLabel: RANK_LABEL[rank], field: c.field, label: c.label, display: c.display, status: c.status, documentId: c.documentId, primary: Boolean(doc?.isPrimary) };
    items.push(item);
    const list = byDoc.get(c.documentId) ?? [];
    list.push(item);
    byDoc.set(c.documentId, list);
  }
  // A consequential claim whose only sources are secondary needs a primary document found first.
  const claimDocs = new Map();
  for (const c of claims) claimDocs.set(`${c.subject.id}|${c.field}`, [...(claimDocs.get(`${c.subject.id}|${c.field}`) ?? []), docs[c.documentId]]);
  for (const it of items) it.onlySecondarySources = !(claimDocs.get(`${it.dealId}|${it.field}`) ?? []).some((d) => d?.isPrimary);
  const documents = [...byDoc.entries()]
    .map(([id, list]) => {
      const d = docs[id];
      const tier = Math.min(...list.map((x) => x.tier));
      const rank = Math.min(...list.map((x) => x.rank));
      return { documentId: id, url: d.url, publisher: d.publisher, title: d.title, documentType: d.documentType, isPrimary: d.isPrimary, publishedDate: d.publishedDate?.date ?? null, retrievalStatus: d.retrievalStatus, tier, bestRank: rank, claims: list.sort((a, b) => a.rank - b.rank).map((x) => x.claimId) };
    })
    .sort((a, b) => a.tier - b.tier || a.bestRank - b.bestRank || Number(b.isPrimary) - Number(a.isPrimary) || a.documentId.localeCompare(b.documentId));
  const byStatus = {};
  for (const c of claims) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const consequential = items.filter((x) => x.rank <= CONSEQUENTIAL_MAX_RANK);
  return {
    generatedAt,
    archiveVersion: archive.version,
    counts: {
      claimsTotal: claims.length,
      claimsByStatus: byStatus,
      dealClaimsNeedingPrimaryCheck: items.length,
      consequentialDealClaims: consequential.length,
      consequentialOnlySecondary: consequential.filter((x) => x.onlySecondarySources).length,
      tier1Claims: items.filter((x) => x.tier === 1).length,
      documentsToRetrieve: documents.length,
      primaryDocumentsToRetrieve: documents.filter((d) => d.isPrimary).length,
    },
    documents,
    claims: items.sort((a, b) => a.tier - b.tier || a.dealId.localeCompare(b.dealId) || a.rank - b.rank),
  };
}
