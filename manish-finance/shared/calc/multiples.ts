import { type CalcResult, fail, isFiniteNumber, ok } from "./result";

/**
 * Valuation multiples with explicit availability states.
 *
 * NM              – economically not meaningful (e.g. negative or zero denominator)
 * not_disclosed   – the figure exists but the parties did not disclose it
 * not_available   – we do not hold a sourced figure
 * not_applicable  – the measure does not fit this business (e.g. EV/EBITDA for a bank)
 */
export type MultipleValue =
  | { kind: "value"; value: number }
  | { kind: "NM"; reason: string }
  | { kind: "not_disclosed"; reason?: string }
  | { kind: "not_available"; reason?: string }
  | { kind: "not_applicable"; reason: string };

export type AvailabilityInput = number | null | { missing: "not_disclosed" | "not_available" | "not_applicable"; reason?: string };

function unwrap(x: AvailabilityInput, label: string): { n: number } | { mv: MultipleValue } {
  if (x === null || x === undefined) return { mv: { kind: "not_available", reason: `${label} not available` } };
  if (typeof x === "object") {
    if (x.missing === "not_applicable") return { mv: { kind: "not_applicable", reason: x.reason ?? `${label} not applicable` } };
    return { mv: { kind: x.missing, reason: x.reason ?? `${label} ${x.missing.replace("_", " ")}` } };
  }
  if (!isFiniteNumber(x)) return { mv: { kind: "not_available", reason: `${label} is not a finite number` } };
  return { n: x };
}

function ratio(numerator: AvailabilityInput, denominator: AvailabilityInput, numLabel: string, denLabel: string, nmReason: string): MultipleValue {
  const n = unwrap(numerator, numLabel);
  if ("mv" in n) return n.mv;
  const d = unwrap(denominator, denLabel);
  if ("mv" in d) return d.mv;
  if (d.n <= 0) return { kind: "NM", reason: nmReason };
  if (n.n <= 0) return { kind: "NM", reason: `${numLabel} is zero or negative` };
  return { kind: "value", value: n.n / d.n };
}

/** EV / Revenue = EV ÷ comparable-period revenue. */
export function evToRevenue(ev: AvailabilityInput, revenue: AvailabilityInput): MultipleValue {
  return ratio(ev, revenue, "Enterprise value", "Revenue", "Revenue is zero or negative");
}

/** EV / EBITDA = EV ÷ comparable-period EBITDA. Negative or zero EBITDA → NM. */
export function evToEbitda(ev: AvailabilityInput, ebitda: AvailabilityInput): MultipleValue {
  return ratio(ev, ebitda, "Enterprise value", "EBITDA", "EBITDA is zero or negative");
}

/** P/E = common equity value ÷ earnings attributable to common shareholders. */
export function priceToEarnings(equityValue: AvailabilityInput, earningsToCommon: AvailabilityInput): MultipleValue {
  return ratio(equityValue, earningsToCommon, "Equity value", "Earnings to common", "Earnings are zero or negative");
}

/** P/B = common equity value ÷ common book equity. */
export function priceToBook(equityValue: AvailabilityInput, commonBookEquity: AvailabilityInput): MultipleValue {
  return ratio(equityValue, commonBookEquity, "Equity value", "Common book equity", "Book equity is zero or negative");
}

/** Per-share P/E requires diluted share consistency between price and EPS. */
export function perSharePe(price: number | null, dilutedEps: number | null, epsBasis: "diluted" | "basic"): MultipleValue {
  if (epsBasis !== "diluted") return { kind: "not_applicable", reason: "Use diluted EPS with a diluted share price basis" };
  return ratio(price, dilutedEps, "Share price", "Diluted EPS", "EPS is zero or negative");
}

export type PremiumConvention = "prior_close" | "vwap_1m" | "vwap_3m" | "vwap_6m" | "sebi_regulatory_floor" | "other";

export interface PremiumReference {
  price: number;
  /** Date of the unaffected price (YYYY-MM-DD). */
  date: string;
  convention: PremiumConvention;
  /** Announcement date; the reference must be strictly before it to be unaffected. */
  announcementDate: string;
  note?: string;
}

export interface PremiumOutput {
  premium: number;
  reference: PremiumReference;
}

/** Offer premium = offer price per share ÷ unaffected reference price − 1. Rejects post-announcement baselines. */
export function offerPremium(offerPricePerShare: number | null, ref: PremiumReference | null): CalcResult<PremiumOutput> {
  if (offerPricePerShare === null || !isFiniteNumber(offerPricePerShare) || offerPricePerShare <= 0) {
    return fail({ code: "INVALID_OFFER_PRICE", field: "offerPricePerShare", message: "Offer price per share must be a positive number." });
  }
  if (!ref) return fail({ code: "MISSING_REFERENCE", field: "reference", message: "An unaffected reference price with its date and convention is required." });
  if (!isFiniteNumber(ref.price) || ref.price <= 0) {
    return fail({ code: "INVALID_REFERENCE_PRICE", field: "reference.price", message: "Reference price must be a positive number." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ref.date) || !/^\d{4}-\d{2}-\d{2}$/.test(ref.announcementDate)) {
    return fail({ code: "INVALID_DATE", field: "reference.date", message: "Reference and announcement dates must be YYYY-MM-DD." });
  }
  if (ref.date >= ref.announcementDate) {
    return fail({
      code: "AFFECTED_REFERENCE",
      field: "reference.date",
      message: "The reference price date is on or after the announcement. Use an unaffected (pre-announcement or pre-leak) price.",
    });
  }
  return ok({ premium: offerPricePerShare / ref.price - 1, reference: ref });
}

export interface MultipleObservation {
  id: string;
  label?: string;
  value: MultipleValue;
}

export interface MultipleStats {
  n: number;
  mean: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
  included: string[];
  excluded: Array<{ id: string; label?: string; kind: MultipleValue["kind"]; reason: string }>;
  quartileMethod: "linear-interpolation (inclusive, same as Excel QUARTILE.INC)";
}

/** Linear-interpolation quantile on a sorted array (inclusive method). */
export function quantileSorted(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0] as number;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

/**
 * Aggregates eligible multiples. NM, undisclosed, unavailable and not-applicable observations are
 * excluded with reasons and never treated as zero.
 */
export function summarizeMultiples(observations: MultipleObservation[]): MultipleStats {
  const included: Array<{ id: string; v: number }> = [];
  const excluded: MultipleStats["excluded"] = [];
  for (const o of observations) {
    if (o.value.kind === "value") {
      included.push({ id: o.id, v: o.value.value });
    } else {
      const reason = "reason" in o.value && o.value.reason ? o.value.reason : o.value.kind.replace("_", " ");
      excluded.push({ id: o.id, ...(o.label ? { label: o.label } : {}), kind: o.value.kind, reason });
    }
  }
  const sorted = included.map((x) => x.v).sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((s, x) => s + x, 0) / n : null;
  return {
    n,
    mean,
    median: quantileSorted(sorted, 0.5),
    q1: quantileSorted(sorted, 0.25),
    q3: quantileSorted(sorted, 0.75),
    min: n ? (sorted[0] as number) : null,
    max: n ? (sorted[n - 1] as number) : null,
    included: included.map((x) => x.id),
    excluded,
    quartileMethod: "linear-interpolation (inclusive, same as Excel QUARTILE.INC)",
  };
}

export function formatMultiple(v: MultipleValue, digits = 1): string {
  switch (v.kind) {
    case "value":
      return `${v.value.toFixed(digits)}×`;
    case "NM":
      return "NM";
    case "not_disclosed":
      return "Not disclosed";
    case "not_available":
      return "Not available";
    case "not_applicable":
      return "Not applicable";
  }
}
