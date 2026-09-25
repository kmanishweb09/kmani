import type { DealSummary, HeadlineValue, TermView, VerificationSummary } from "../api";
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

function ratioOf(terms: TermView[], metric: string): number | null {
  const t = terms.find((x) => x.metric === metric && x.ratio !== null && !x.correction);
  return t ? (t.ratio as number) : null;
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
    multiples: { evRevenue: ratioOf(d.terms, "ev_revenue"), evEbitda: ratioOf(d.terms, "ev_ebitda"), priceToBook: ratioOf(d.terms, "price_to_book") },
  };
}
