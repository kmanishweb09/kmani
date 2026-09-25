import type { DealSummary } from "./api";
import { formatDateValue } from "./dates";
import { type MultipleValue, summarizeMultiples, type MultipleStats } from "./calc/multiples";
import { formatAsReported, type ScaleUnit } from "./money/units";
import { BUYER_TYPE_LABEL, DEAL_STATUS_LABEL, DEAL_TYPE_LABEL, SECTOR_NAMES, VALUE_BASIS_LABEL } from "./labels";
import { countryName } from "./geo";

/**
 * Side-by-side deal comparison. Structural fields are shown for every deal; numeric statistics only
 * include compatible observations, and every exclusion carries a reason.
 */

export interface ComparisonCell {
  dealId: string;
  display: string;
  ev: string[];
}

export interface ComparisonRow {
  key: string;
  label: string;
  cells: ComparisonCell[];
  comparable: boolean;
  note: string | null;
}

export interface MetricComparison {
  metric: "evRevenue" | "evEbitda" | "priceToBook";
  label: string;
  observations: Array<{ dealId: string; value: MultipleValue }>;
  stats: MultipleStats;
}

export interface DealComparison {
  dealIds: string[];
  rows: ComparisonRow[];
  metrics: MetricComparison[];
  notes: string[];
}

function valueDisplay(d: DealSummary): string {
  if (!d.headline) return "Undisclosed";
  const h = d.headline;
  const amt = formatAsReported({ amount: h.amount, currency: h.currency, unit: h.unit as ScaleUnit });
  return `${amt} · ${VALUE_BASIS_LABEL[h.valueBasis]}${h.ownershipPct !== null ? ` (${h.ownershipPct}%)` : ""}`;
}

export function compareDeals(deals: DealSummary[]): DealComparison {
  const notes: string[] = [];
  const row = (key: string, label: string, get: (d: DealSummary) => string, evGet?: (d: DealSummary) => string[]): ComparisonRow => ({
    key,
    label,
    cells: deals.map((d) => ({ dealId: d.id, display: get(d), ev: evGet ? evGet(d) : [] })),
    comparable: true,
    note: null,
  });

  const valueRow = row("value", "Disclosed value", valueDisplay, (d) => d.headline?.ev ?? []);
  const withValue = deals.filter((d) => d.headline);
  const bases = new Set(withValue.map((d) => d.headline?.valueBasis));
  const currencies = new Set(withValue.map((d) => d.headline?.currency));
  const partial = withValue.some((d) => d.headline?.ownershipPct !== null && d.headline?.ownershipPct !== 100);
  const reasons: string[] = [];
  if (withValue.length < deals.length) reasons.push(`${deals.length - withValue.length} deal(s) have no disclosed value`);
  if (bases.size > 1) reasons.push(`value bases differ (${[...bases].map((b) => VALUE_BASIS_LABEL[b as keyof typeof VALUE_BASIS_LABEL]).join(" vs ")})`);
  if (currencies.size > 1) reasons.push(`currencies differ (${[...currencies].join(", ")}) and no dated FX conversion is applied`);
  if (partial) reasons.push("at least one value covers a partial stake, so it is not a 100% value");
  if (reasons.length) {
    valueRow.comparable = false;
    valueRow.note = `Values are shown as reported but are not directly comparable: ${reasons.join("; ")}.`;
  }

  const rows: ComparisonRow[] = [
    row("announced", "Announced", (d) => formatDateValue(d.announced), (d) => d.announced.ev),
    row("status", "Status (as of)", (d) => `${DEAL_STATUS_LABEL[d.status]} (${formatDateValue(d.statusAsOf)})`, (d) => d.statusEv),
    row("dealType", "Structure", (d) => DEAL_TYPE_LABEL[d.dealType]),
    row("buyerType", "Buyer type", (d) => BUYER_TYPE_LABEL[d.buyerType]),
    row("sector", "Sector / subsector", (d) => `${SECTOR_NAMES[d.sector]} · ${d.subsector}`),
    row("geography", "Target / acquirer country", (d) => `${countryName(d.target.country)} / ${countryName(d.acquirer.country)}`),
    row("stake", "Stake acquired → held", (d) => `${d.stake.acquiredPct ?? "—"}% → ${d.stake.resultingPct ?? "—"}%`),
    valueRow,
    row("payment", "Consideration", (d) => d.paymentMix.join(", ")),
  ];

  const structures = new Set(deals.map((d) => d.dealType));
  if (structures.size > 1) {
    const r = rows.find((x) => x.key === "dealType");
    if (r) {
      r.comparable = false;
      r.note = "Different structures (e.g., a minority stake versus a merger) answer different economic questions; compare with care.";
    }
  }
  const sectors = new Set(deals.map((d) => `${d.sector}|${d.subsector}`));
  if (sectors.size > 1) notes.push("Deals span different subsectors; business models and valuation conventions may differ.");

  const metricDefs: Array<{ metric: MetricComparison["metric"]; label: string; appliesTo: (d: DealSummary) => string | null }> = [
    { metric: "evRevenue", label: "EV / Revenue (disclosed)", appliesTo: (d) => (d.sector === "fig" && /bank|lend|nbfc/i.test(d.subsector) ? "Not meaningful for a bank or lender" : null) },
    { metric: "evEbitda", label: "EV / EBITDA (disclosed)", appliesTo: (d) => (d.sector === "fig" ? "EV/EBITDA does not apply to financial institutions" : null) },
    { metric: "priceToBook", label: "P / B (disclosed)", appliesTo: (d) => (d.sector === "fig" ? null : "P/B is mainly used for balance-sheet businesses such as banks and insurers") },
  ];
  const metrics: MetricComparison[] = metricDefs.map((m) => {
    const observations = deals.map((d) => {
      const na = m.appliesTo(d);
      const v = d.multiples[m.metric];
      let value: MultipleValue;
      if (na) value = { kind: "not_applicable", reason: na };
      else if (v === null) value = { kind: "not_available", reason: "No sourced transaction multiple in this database" };
      else if (v <= 0) value = { kind: "NM", reason: "Zero or negative multiple" };
      else value = { kind: "value", value: v };
      return { dealId: d.id, value };
    });
    return { metric: m.metric, label: m.label, observations, stats: summarizeMultiples(observations.map((o) => ({ id: o.dealId, value: o.value }))) };
  });
  notes.push("Statistics cover only the selected deals within this curated database; they do not describe the market.");
  return { dealIds: deals.map((d) => d.id), rows, metrics, notes };
}
