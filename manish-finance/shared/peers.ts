import type { PeerCell, PeerDerived, PeerSetView, PeerStat } from "./api";
import type { CompiledCompany } from "./archive/compile";
import { observationDisplay, observationLabel } from "./archive/compile";
import { quantileSorted } from "./calc/multiples";
import { rescale, type ScaleUnit } from "./money/units";
import type { PeerSet } from "./schemas/research";

/**
 * Builds a peer-set matrix from sourced company observations.
 *
 * - One cell per company × metric × period end: flows (revenue, profit, EBIT) use 12-month periods
 *   ending on that date; ratios and headcount use point values at that date. Superseded and segment
 *   observations are ignored; the set's preferred scope wins when a company reports several.
 * - Currency amounts are converted only within the same currency and only between exact scales
 *   (₹ billion → ₹ crore). Different currencies are never converted.
 * - Growth and net margin are calculated only from two cells with the same unit and scope.
 * - Summary statistics pool only cells with the same unit and scope, and need at least three.
 */

export const PEER_MIN_SAMPLE = 3;
const FLOW_METRICS = new Set(["revenue", "total_income", "ebitda", "ebit", "net_income", "pat_attributable", "gross_written_premium", "ape", "vnb", "pre_sales", "gmv", "orders"]);
const DISPLAY_SCALE: Record<string, ScaleUnit> = { INR: "crore", USD: "million", EUR: "million", GBP: "million", JPY: "billion", SGD: "million", AUD: "million" };

type Observation = CompiledCompany["observations"][number] & { supersededBy?: unknown };

function pick(obs: Observation[], metric: string, periodEnd: string, preferred: string): Observation | null {
  const flow = FLOW_METRICS.has(metric);
  const candidates = obs.filter(
    (o) =>
      o.metric === metric &&
      !o.supersededBy &&
      o.scope !== "segment" &&
      o.value !== null &&
      o.period.end === periodEnd &&
      (flow ? o.period.months === 12 && o.period.type !== "point" : o.period.type === "point" || o.period.months === 12),
  );
  const rank = (o: Observation) => (o.scope === preferred ? 0 : o.scope === "consolidated" || o.scope === "standalone" ? 1 : 2);
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function normalize(o: Observation): { value: number; unitLabel: string } {
  const v = o.value as number;
  if (o.unit === "currency" && o.currency && o.scale) {
    const target = DISPLAY_SCALE[o.currency] ?? (o.scale as ScaleUnit);
    const m = rescale({ amount: v, currency: o.currency, unit: o.scale as ScaleUnit }, target);
    return { value: m.amount, unitLabel: `${o.currency} ${target}` };
  }
  if (o.unit === "percent") return { value: v, unitLabel: "%" };
  if (o.unit === "count") return { value: v, unitLabel: "count" };
  return { value: v, unitLabel: o.unit };
}

export function buildPeerMatrix(set: PeerSet, companies: Map<string, CompiledCompany>): Omit<PeerSetView, "evidence"> {
  const cells: PeerCell[] = [];
  const present = set.companyIds.filter((id) => companies.has(id));
  for (const companyId of present) {
    const co = companies.get(companyId) as CompiledCompany;
    for (const metric of set.metrics) {
      for (const p of set.periods) {
        const o = pick(co.observations as Observation[], metric, p.end, set.preferredScope);
        if (!o) continue;
        const n = normalize(o);
        cells.push({
          companyId,
          metric,
          periodEnd: p.end,
          value: o.value as number,
          display: observationDisplay(o),
          unit: o.unit,
          currency: o.currency ?? null,
          scale: o.scale ?? null,
          scope: o.scope,
          basis: o.basis,
          normalized: n,
          ev: o.ev,
          observationId: o.id,
          definition: o.definition ?? null,
        });
      }
    }
  }
  const cellAt = (companyId: string, metric: string, end: string) => cells.find((c) => c.companyId === companyId && c.metric === metric && c.periodEnd === end) ?? null;

  const derived: PeerDerived[] = [];
  const periods = set.periods.map((p) => p.end);
  for (const companyId of present) {
    for (const metric of ["revenue", "net_income"] as const) {
      if (!set.metrics.includes(metric)) continue;
      for (let i = 1; i < periods.length; i++) {
        const cur = cellAt(companyId, metric, periods[i] as string);
        const prev = cellAt(companyId, metric, periods[i - 1] as string);
        if (!cur || !prev) continue;
        const same = cur.normalized?.unitLabel === prev.normalized?.unitLabel && cur.scope === prev.scope;
        derived.push({
          companyId,
          metric: metric === "revenue" ? "revenue_growth" : "net_income_growth",
          periodEnd: cur.periodEnd,
          value: same && prev.normalized && cur.normalized && prev.normalized.value > 0 ? cur.normalized.value / prev.normalized.value - 1 : null,
          reason: same ? (prev.normalized && prev.normalized.value <= 0 ? "Prior-year value is zero or negative" : null) : "Units or reporting scope differ between the two years",
          inputs: [prev.observationId, cur.observationId],
        });
      }
    }
    if (set.metrics.includes("revenue") && set.metrics.includes("net_income")) {
      for (const end of periods) {
        const rev = cellAt(companyId, "revenue", end);
        const ni = cellAt(companyId, "net_income", end);
        if (!rev || !ni) continue;
        const same = rev.normalized?.unitLabel === ni.normalized?.unitLabel && rev.scope === ni.scope;
        derived.push({
          companyId,
          metric: "net_margin",
          periodEnd: end,
          value: same && rev.normalized && ni.normalized && rev.normalized.value > 0 ? ni.normalized.value / rev.normalized.value : null,
          reason: same ? null : "Revenue and profit are in different units or scopes",
          inputs: [rev.observationId, ni.observationId],
        });
      }
    }
  }

  const stats: PeerStat[] = [];
  for (const metric of set.metrics) {
    for (const end of periods) {
      const group = cells.filter((c) => c.metric === metric && c.periodEnd === end && c.normalized);
      if (!group.length) {
        stats.push({ metric, periodEnd: end, n: 0, median: null, unitLabel: null, excluded: [], note: "No sourced values for this period." });
        continue;
      }
      // Pool the most common unit+scope combination; everything else is listed as excluded.
      const key = (c: PeerCell) => `${c.normalized?.unitLabel}|${c.scope}`;
      const counts = new Map<string, number>();
      for (const c of group) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as string;
      const pooled = group.filter((c) => key(c) === best);
      const excluded = group.filter((c) => key(c) !== best).map((c) => ({ companyId: c.companyId, reason: c.normalized?.unitLabel !== best.split("|")[0] ? `Different unit (${c.normalized?.unitLabel})` : `Different reporting scope (${c.scope})` }));
      const values = pooled.map((c) => (c.normalized as { value: number }).value).sort((a, b) => a - b);
      stats.push({
        metric,
        periodEnd: end,
        n: values.length,
        median: values.length >= PEER_MIN_SAMPLE ? quantileSorted(values, 0.5) : null,
        unitLabel: best.split("|")[0] ?? null,
        excluded,
        note: values.length >= PEER_MIN_SAMPLE ? null : `Only ${values.length} comparable value${values.length === 1 ? "" : "s"}; no median (minimum ${PEER_MIN_SAMPLE}).`,
      });
    }
  }

  const expected = present.length * set.metrics.length * set.periods.length;
  return {
    id: set.id,
    name: set.name,
    description: set.description,
    sector: set.sector,
    note: set.note ?? null,
    preferredScope: set.preferredScope,
    companies: present.map((id) => {
      const c = companies.get(id) as CompiledCompany;
      return { id, displayName: c.displayName, subsector: c.subsector, country: c.country };
    }),
    metrics: set.metrics.map((m) => ({ id: m, label: observationLabel(m) })),
    periods: set.periods,
    cells,
    derived,
    stats,
    coverage: { filled: cells.length, expected, missing: set.companyIds.filter((id) => !companies.has(id)) },
  };
}
