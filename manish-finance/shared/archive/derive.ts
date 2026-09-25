import type { DealSummary, HeadlineValue, MultipleDetail, TermView, VerificationSummary } from "../api";
import type { CompiledClaim, CompiledDeal } from "./compile";

/** Derives list-level fields from a compiled (and possibly overlaid) deal. Deterministic and cheap. */

const HEADLINE_METRICS = ["enterprise_value", "equity_value", "stake_consideration", "value_unclear_basis"] as const;
const KIND_ORDER: Record<string, number> = { final: 0, revised: 1, announced: 2, reported_by_media: 3, implied: 9 };

const METRIC_BASIS: Record<string, HeadlineValue["valueBasis"]> = {
  enterprise_value: "enterprise",
  equity_value: "equity",
  stake_consideration: "stake",
  value_unclear_basis: "unclear",
};

export function pickHeadline(terms: TermView[]): HeadlineValue | null {
  const eligible = terms.filter(
    (t) => (HEADLINE_METRICS as readonly string[]).includes(t.metric) && t.amount !== null && t.currency && t.unit && t.kind !== "implied" && !t.correction,
  );
  if (!eligible.length) return null;
  const flagged = eligible.find((t) => t.headline);
  const sorted = [...eligible].sort((a, b) => {
    const m = HEADLINE_METRICS.indexOf(a.metric as (typeof HEADLINE_METRICS)[number]) - HEADLINE_METRICS.indexOf(b.metric as (typeof HEADLINE_METRICS)[number]);
    if (m) return m;
    const k = (KIND_ORDER[a.kind] ?? 5) - (KIND_ORDER[b.kind] ?? 5);
    if (k) return k;
    return b.asOf.localeCompare(a.asOf);
  });
  const t = flagged ?? (sorted[0] as TermView);
  return {
    termId: t.id,
    metric: t.metric,
    amount: t.amount as number,
    currency: t.currency as string,
    unit: t.unit as string,
    valueBasis: t.valueBasis ?? METRIC_BASIS[t.metric] ?? "unclear",
    ownershipPct: t.ownershipPct,
    ev: t.ev,
  };
}

export function collectEvidenceIds(d: CompiledDeal): string[] {
  const ids: string[] = [
    ...d.acquirer.ev,
    ...d.target.ev,
    ...d.otherParties.flatMap((p) => p.ev),
    ...d.stake.ev,
    ...d.announced.ev,
    ...(d.effective?.ev ?? []),
    ...d.status.ev,
    ...d.terms.flatMap((t) => t.ev),
    ...d.payment.ev,
    ...(d.financing?.ev ?? []),
    ...d.events.flatMap((e) => e.ev),
    ...d.advisers.list.flatMap((a) => a.ev),
    ...d.rationale.flatMap((r) => r.ev),
    ...d.afterDeal.flatMap((a) => a.ev),
    ...(d.autopsy?.whatWeKnowNow.facts.flatMap((f) => f.ev) ?? []),
    ...(d.asAnnounced?.payment?.ev ?? []),
    ...(d.asAnnounced?.stake?.ev ?? []),
    ...(d.asAnnounced?.financing?.ev ?? []),
  ];
  return [...new Set(ids)];
}

export function verificationSummary(ids: string[], claims: Record<string, Pick<CompiledClaim, "status">>): VerificationSummary {
  const s: VerificationSummary = { source_checked: 0, search_corroborated: 0, pending: 0, conflict: 0, human_reviewed: 0 };
  for (const id of ids) {
    const c = claims[id];
    if (c) s[c.status] += 1;
  }
  return s;
}

/** The current (not superseded) multiple for a metric, preferring reported over calculated, then the latest. */
export function multipleOf(terms: TermView[], metric: string): MultipleDetail | null {
  const candidates = terms
    .filter((x) => x.metric === metric && x.ratio !== null && Number.isFinite(x.ratio) && !x.correction && x.kind !== "implied")
    .sort((a, b) => (a.status === b.status ? b.asOf.localeCompare(a.asOf) : a.status === "reported" ? -1 : b.status === "reported" ? 1 : 0));
  const t = candidates[0];
  if (!t) return null;
  return { value: t.ratio as number, termId: t.id, status: t.status, basis: t.multipleBasis ?? null, reference: t.reference, ev: t.ev };
}

export function multiplesOf(terms: TermView[]): Pick<DealSummary, "multiples" | "multipleDetails"> {
  const multipleDetails = { evRevenue: multipleOf(terms, "ev_revenue"), evEbitda: multipleOf(terms, "ev_ebitda"), priceToBook: multipleOf(terms, "price_to_book") };
  return {
    multipleDetails,
    multiples: { evRevenue: multipleDetails.evRevenue?.value ?? null, evEbitda: multipleDetails.evEbitda?.value ?? null, priceToBook: multipleDetails.priceToBook?.value ?? null },
  };
}

export function summarizeDeal(d: CompiledDeal, claims: Record<string, Pick<CompiledClaim, "status">>, lastChangedAt?: string): DealSummary {
  const latest = [...d.events].sort((a, b) => (a.date.date < b.date.date ? 1 : a.date.date > b.date.date ? -1 : 0))[0] ?? null;
  const headline = pickHeadline(d.terms);
  return {
    id: d.id,
    title: d.title,
    aliases: d.aliases,
    dealType: d.dealType,
    buyerType: d.buyerType,
    sector: d.sector,
    subsector: d.subsector,
    peerGroup: d.peerGroup ?? null,
    acquirer: d.acquirer,
    target: d.target,
    announced: d.announced,
    status: d.status.value,
    statusAsOf: d.status.asOf,
    statusEv: d.status.ev,
    stake: { acquiredPct: d.stake.acquiredPct, resultingPct: d.stake.resultingPct },
    headline,
    valueDisclosed: d.terms.some((t) => (HEADLINE_METRICS as readonly string[]).includes(t.metric) && t.amount !== null),
    paymentMix: d.payment.mix,
    crossBorder: d.acquirer.country !== d.target.country,
    hasAutopsy: Boolean(d.autopsy),
    verification: verificationSummary(collectEvidenceIds(d), claims),
    lastChangedAt: lastChangedAt ?? d.recordUpdated,
    latestEvent: latest ? { type: latest.type, date: latest.date, title: latest.title } : null,
    adviserNames: d.advisers.list.map((a) => a.name),
    tags: d.tags,
    ...multiplesOf(d.terms),
  };
}
