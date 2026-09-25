import { type CalcResult, fail, isFiniteNumber, ok } from "./result";

/**
 * Reporting periods. Fiscal years, calendar years, quarters, YTD and LTM are distinct and must be
 * aligned before computing multiples. Balance-sheet observations are points in time (type "point").
 */

export type PeriodType = "FY" | "CY" | "H" | "Q" | "YTD" | "LTM" | "point";

export interface Period {
  type: PeriodType;
  /** Last day covered (YYYY-MM-DD); for "point" the balance-sheet date. */
  end: string;
  /** Number of months covered (0 for point-in-time). */
  months: number;
  /** Display label as reported, e.g. "FY2025 (year ended 31 Mar 2025)". */
  label?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidPeriod(p: Period): boolean {
  if (!DATE_RE.test(p.end)) return false;
  if (p.type === "point") return p.months === 0;
  if (p.type === "FY" || p.type === "CY" || p.type === "LTM") return p.months === 12;
  if (p.type === "H") return p.months === 6;
  if (p.type === "Q") return p.months === 3;
  if (p.type === "YTD") return p.months > 0 && p.months < 12;
  return false;
}

/** A flow measure used as an annual multiple denominator must cover exactly twelve months. */
export function isAnnualFlowPeriod(p: Period): boolean {
  return isValidPeriod(p) && p.months === 12 && p.type !== "point";
}

/** Two periods are comparable for peer statistics if both are annual and end within `toleranceDays`. */
export function periodsAligned(a: Period, b: Period, toleranceDays = 92): { aligned: boolean; reason?: string } {
  if (!isAnnualFlowPeriod(a) || !isAnnualFlowPeriod(b)) return { aligned: false, reason: "Both periods must cover twelve months (FY, CY or LTM)." };
  const diff = Math.abs(Date.parse(`${a.end}T00:00:00Z`) - Date.parse(`${b.end}T00:00:00Z`)) / 86_400_000;
  if (diff > toleranceDays) return { aligned: false, reason: `Period ends differ by ${Math.round(diff)} days (limit ${toleranceDays}).` };
  return { aligned: true };
}

export interface LtmDerivation {
  value: number;
  period: Period;
  formula: string;
}

/**
 * LTM = last full fiscal year + current YTD − prior-year comparable YTD.
 * Requires the two YTD periods to cover the same number of months, the prior YTD to end one year
 * before the current YTD, and the fiscal year to end between them.
 */
export function deriveLtmFromYtd(
  fy: { value: number | null; period: Period },
  ytdCurrent: { value: number | null; period: Period },
  ytdPrior: { value: number | null; period: Period },
): CalcResult<LtmDerivation> {
  for (const [name, x] of Object.entries({ fy, ytdCurrent, ytdPrior })) {
    if (x.value === null || !isFiniteNumber(x.value)) return fail({ code: "MISSING_INPUT", field: name, message: `${name} value is missing.` });
    if (!isValidPeriod(x.period)) return fail({ code: "INVALID_PERIOD", field: name, message: `${name} period is invalid.` });
  }
  if (fy.period.type !== "FY" && fy.period.type !== "CY") return fail({ code: "NOT_ANNUAL", message: "The base period must be a full fiscal or calendar year." });
  if (ytdCurrent.period.type !== "YTD" || ytdPrior.period.type !== "YTD") {
    return fail({ code: "NOT_YTD", message: "LTM derivation needs a current and a prior-year YTD figure." });
  }
  if (ytdCurrent.period.months !== ytdPrior.period.months) {
    return fail({ code: "YTD_MISMATCH", message: "Current and prior YTD must cover the same number of months." });
  }
  const cur = new Date(`${ytdCurrent.period.end}T00:00:00Z`);
  const prior = new Date(`${ytdPrior.period.end}T00:00:00Z`);
  const expectedPrior = new Date(cur);
  expectedPrior.setUTCFullYear(cur.getUTCFullYear() - 1);
  if (Math.abs(prior.getTime() - expectedPrior.getTime()) > 3 * 86_400_000) {
    return fail({ code: "YTD_NOT_COMPARABLE", message: "Prior YTD must end one year before current YTD." });
  }
  if (!(fy.period.end > ytdPrior.period.end && fy.period.end < ytdCurrent.period.end)) {
    return fail({ code: "FY_OUT_OF_RANGE", message: "The fiscal year must end after the prior YTD and before the current YTD." });
  }
  const value = (fy.value as number) + (ytdCurrent.value as number) - (ytdPrior.value as number);
  return ok({
    value,
    period: { type: "LTM", end: ytdCurrent.period.end, months: 12, label: `LTM to ${ytdCurrent.period.end}` },
    formula: `LTM = FY (${fy.period.end}) ${fy.value} + YTD (${ytdCurrent.period.end}) ${ytdCurrent.value} − prior YTD (${ytdPrior.period.end}) ${ytdPrior.value}`,
  });
}

/** LTM from four consecutive discrete quarters (not four YTD figures). */
export function deriveLtmFromQuarters(quarters: Array<{ value: number | null; period: Period }>): CalcResult<LtmDerivation> {
  if (quarters.length !== 4) return fail({ code: "NEED_FOUR_QUARTERS", message: "Exactly four discrete quarters are required." });
  if (quarters.some((q) => q.period.type !== "Q")) {
    return fail({ code: "NOT_DISCRETE_QUARTERS", message: "LTM from quarters needs discrete quarterly figures; summing YTD figures double-counts." });
  }
  if (quarters.some((q) => q.value === null || !isFiniteNumber(q.value))) return fail({ code: "MISSING_INPUT", message: "A quarterly value is missing." });
  const sorted = [...quarters].sort((a, b) => a.period.end.localeCompare(b.period.end));
  for (let i = 1; i < sorted.length; i++) {
    const gap = (Date.parse(`${(sorted[i] as { period: Period }).period.end}T00:00:00Z`) - Date.parse(`${(sorted[i - 1] as { period: Period }).period.end}T00:00:00Z`)) / 86_400_000;
    if (gap < 80 || gap > 100) return fail({ code: "NON_CONSECUTIVE", message: "Quarters must be consecutive." });
  }
  const value = sorted.reduce((s, q) => s + (q.value as number), 0);
  const last = sorted[3] as { period: Period };
  return ok({ value, period: { type: "LTM", end: last.period.end, months: 12, label: `LTM to ${last.period.end}` }, formula: "LTM = sum of four consecutive discrete quarters" });
}
