import { type CalcIssue, type CalcResult, fail, isFiniteNumber, ok } from "./result";

/**
 * Simplified enterprise-value bridge for an ordinary non-financial company.
 *
 *   EV = equity value + interest-bearing debt + preferred equity + non-controlling interests
 *        − excess cash − separately valued non-operating investments
 *
 * Not suitable for banks: deposits are operating funding, not financing debt.
 */

export type BridgeComponentKey =
  | "debt"
  | "preferredEquity"
  | "nonControllingInterests"
  | "excessCash"
  | "nonOperatingInvestments";

export const BRIDGE_COMPONENTS: ReadonlyArray<{ key: BridgeComponentKey; label: string; sign: 1 | -1 }> = [
  { key: "debt", label: "Interest-bearing debt", sign: 1 },
  { key: "preferredEquity", label: "Preferred equity", sign: 1 },
  { key: "nonControllingInterests", label: "Non-controlling interests", sign: 1 },
  { key: "excessCash", label: "Excess cash", sign: -1 },
  { key: "nonOperatingInvestments", label: "Non-operating investments", sign: -1 },
];

export type LeaseTreatment = "included_in_debt" | "excluded" | "not_applicable";

export interface EvBridgeInput {
  /** Common equity value (market or book, see `valueBasis`). */
  equityValue: number | null;
  debt: number | null;
  preferredEquity: number | null;
  nonControllingInterests: number | null;
  excessCash: number | null;
  nonOperatingInvestments: number | null;
  /** How lease liabilities are treated. If included in debt, EBITDA used in multiples must be pre-lease-expense (post-IFRS 16 / Ind AS 116). */
  leaseTreatment?: LeaseTreatment;
  valueBasis?: "market" | "book" | "mixed";
}

export interface BridgeStep {
  key: "equityValue" | BridgeComponentKey | "enterpriseValue";
  label: string;
  amount: number;
  /** Signed contribution to the enterprise value (equity positive, cash negative). */
  contribution: number;
}

export interface EvBridgeOutput {
  enterpriseValue: number;
  steps: BridgeStep[];
  valueBasis: "market" | "book" | "mixed";
  leaseTreatment: LeaseTreatment;
}

function missingComponents(input: Partial<Record<BridgeComponentKey | "equityValue", number | null>>, keys: string[]): CalcIssue[] {
  const issues: CalcIssue[] = [];
  for (const k of keys) {
    const v = (input as Record<string, unknown>)[k];
    if (v === null || v === undefined) {
      issues.push({
        code: "BRIDGE_INCOMPLETE",
        field: k,
        message: `${labelFor(k)} is not provided. An incomplete bridge is incomplete: absent debt is not zero debt. Enter the amount or confirm it is zero.`,
      });
    } else if (!isFiniteNumber(v)) {
      issues.push({ code: "INVALID_NUMBER", field: k, message: `${labelFor(k)} must be a finite number.` });
    }
  }
  return issues;
}

function labelFor(key: string): string {
  if (key === "equityValue") return "Equity value";
  if (key === "enterpriseValue") return "Enterprise value";
  return BRIDGE_COMPONENTS.find((c) => c.key === key)?.label ?? key;
}

function negativeWarnings(input: EvBridgeInput): CalcIssue[] {
  const warnings: CalcIssue[] = [];
  for (const c of BRIDGE_COMPONENTS) {
    const v = input[c.key];
    if (isFiniteNumber(v) && v < 0) {
      warnings.push({ code: "NEGATIVE_COMPONENT", field: c.key, message: `${c.label} is negative. Check the sign convention: enter amounts as positive numbers; the bridge applies the sign.` });
    }
  }
  return warnings;
}

function leaseWarning(t: LeaseTreatment): CalcIssue[] {
  if (t === "included_in_debt") {
    return [{ code: "LEASES_IN_DEBT", message: "Lease liabilities are included in debt. Use EBITDA before lease expense (IFRS 16 / Ind AS 116 basis) so numerator and denominator are consistent." }];
  }
  if (t === "excluded") {
    return [{ code: "LEASES_EXCLUDED", message: "Lease liabilities are excluded from debt. Use EBITDA after lease expense (e.g., EBITDAR-less-rent or pre-IFRS 16 basis) to avoid mixing bases." }];
  }
  return [];
}

export function enterpriseValueFromEquity(input: EvBridgeInput): CalcResult<EvBridgeOutput> {
  const errors = missingComponents(input, ["equityValue", ...BRIDGE_COMPONENTS.map((c) => c.key)]);
  if (errors.length) return fail(errors);
  const equity = input.equityValue as number;
  const steps: BridgeStep[] = [{ key: "equityValue", label: "Equity value", amount: equity, contribution: equity }];
  let ev = equity;
  for (const c of BRIDGE_COMPONENTS) {
    const amount = input[c.key] as number;
    const contribution = c.sign * amount;
    ev += contribution;
    steps.push({ key: c.key, label: c.label, amount, contribution });
  }
  steps.push({ key: "enterpriseValue", label: "Enterprise value", amount: ev, contribution: ev });
  const leaseTreatment = input.leaseTreatment ?? "not_applicable";
  const warnings = [...negativeWarnings(input), ...leaseWarning(leaseTreatment)];
  if (input.valueBasis === "mixed") {
    warnings.push({ code: "MIXED_BASIS", message: "The bridge mixes market and book values. State which components use book values." });
  }
  return ok({ enterpriseValue: ev, steps, valueBasis: input.valueBasis ?? "market", leaseTreatment }, warnings);
}

export interface EquityBridgeInput {
  enterpriseValue: number | null;
  debt: number | null;
  preferredEquity: number | null;
  nonControllingInterests: number | null;
  excessCash: number | null;
  nonOperatingInvestments: number | null;
}

export interface EquityBridgeOutput {
  equityValue: number;
  steps: BridgeStep[];
}

/** Reverse bridge used after a DCF: equity = EV − debt − preferred − NCI + excess cash + non-operating investments. */
export function equityValueFromEnterprise(input: EquityBridgeInput): CalcResult<EquityBridgeOutput> {
  const errors = missingComponents(input, ["enterpriseValue", ...BRIDGE_COMPONENTS.map((c) => c.key)]);
  if (errors.length) return fail(errors);
  const ev = input.enterpriseValue as number;
  const steps: BridgeStep[] = [{ key: "enterpriseValue", label: "Enterprise value", amount: ev, contribution: ev }];
  let equity = ev;
  for (const c of BRIDGE_COMPONENTS) {
    const amount = input[c.key] as number;
    // Moving from EV to equity reverses each sign.
    const contribution = -c.sign * amount;
    equity += contribution;
    steps.push({ key: c.key, label: c.label, amount, contribution });
  }
  steps.push({ key: "equityValue", label: "Equity value", amount: equity, contribution: equity });
  const warnings: CalcIssue[] = [];
  if (equity <= 0) {
    warnings.push({ code: "NON_POSITIVE_EQUITY", message: "Implied equity value is zero or negative: claims senior to common equity exceed enterprise value." });
  }
  return ok({ equityValue: equity, steps }, warnings);
}

export interface ReconciliationOutput {
  bridgeEnterpriseValue: number;
  disclosedEnterpriseValue: number;
  difference: number;
  differencePct: number;
  withinTolerance: boolean;
}

/**
 * Compares a bridge output with a disclosed transaction EV. The disclosed figure is never replaced;
 * the UI shows both with the difference so definitional gaps (leases, earn-outs, debt-like items) are visible.
 */
export function reconcileEnterpriseValue(bridgeEv: number, disclosedEv: number, tolerancePct = 0.02): CalcResult<ReconciliationOutput> {
  if (!isFiniteNumber(bridgeEv) || !isFiniteNumber(disclosedEv)) {
    return fail({ code: "INVALID_NUMBER", message: "Both enterprise values must be finite numbers." });
  }
  if (disclosedEv === 0) {
    return fail({ code: "ZERO_DENOMINATOR", message: "Disclosed enterprise value is zero; reconciliation percentage is not meaningful." });
  }
  const difference = bridgeEv - disclosedEv;
  const differencePct = difference / disclosedEv;
  return ok({
    bridgeEnterpriseValue: bridgeEv,
    disclosedEnterpriseValue: disclosedEv,
    difference,
    differencePct,
    withinTolerance: Math.abs(differencePct) <= tolerancePct,
  });
}
