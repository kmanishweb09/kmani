import { type EquityBridgeInput, type EquityBridgeOutput, equityValueFromEnterprise } from "./bridge";
import { type CalcIssue, type CalcResult, fail, isFiniteNumber, ok, requireNumbers } from "./result";

/**
 * Discounted cash flow for non-financial businesses.
 *
 * FCFF = EBIT × (1 − tax) + D&A − capex − increase in operating working capital
 * PV   = Σ FCFF[t] / (1 + WACC)^t                      (annual, end-of-year discounting)
 * TV_N = FCFF[N] × (1 + g) / (WACC − g)                  (Gordon growth on the final forecast year)
 * EV   = PV of forecast FCFF + TV_N / (1 + WACC)^N
 *
 * All rates are decimals (0.10 = 10%). Amounts share one currency and unit, carried as metadata.
 */

export interface DriverYear {
  revenueGrowth: number | null;
  ebitMargin: number | null;
  daPctRevenue: number | null;
  capexPctRevenue: number | null;
  /** Operating working capital as a percentage of the same year's revenue (a level, not a change). */
  nwcPctRevenue: number | null;
}

export interface DriverForecastInput {
  baseRevenue: number | null;
  /** Operating working capital at the end of the base year (absolute amount). */
  baseNwc: number | null;
  taxRate: number | null;
  years: DriverYear[];
}

export interface ForecastRow {
  year: number;
  revenue: number;
  ebit: number;
  tax: number;
  nopat: number;
  da: number;
  capex: number;
  nwc: number;
  deltaNwc: number;
  fcff: number;
}

export function forecastFcff(input: DriverForecastInput): CalcResult<ForecastRow[]> {
  const errors: CalcIssue[] = requireNumbers({ baseRevenue: input.baseRevenue, baseNwc: input.baseNwc, taxRate: input.taxRate });
  if (!input.years.length) errors.push({ code: "NO_FORECAST_YEARS", message: "At least one forecast year is required." });
  input.years.forEach((y, i) => {
    errors.push(
      ...requireNumbers({
        [`years[${i}].revenueGrowth`]: y.revenueGrowth,
        [`years[${i}].ebitMargin`]: y.ebitMargin,
        [`years[${i}].daPctRevenue`]: y.daPctRevenue,
        [`years[${i}].capexPctRevenue`]: y.capexPctRevenue,
        [`years[${i}].nwcPctRevenue`]: y.nwcPctRevenue,
      }),
    );
  });
  if (errors.length) return fail(errors);
  const tax = input.taxRate as number;
  if (tax < 0 || tax >= 1) return fail({ code: "INVALID_TAX_RATE", field: "taxRate", message: "Tax rate must be between 0% and 100% (exclusive)." });
  if ((input.baseRevenue as number) <= 0) return fail({ code: "INVALID_BASE_REVENUE", field: "baseRevenue", message: "Base revenue must be positive." });

  const rows: ForecastRow[] = [];
  let prevRevenue = input.baseRevenue as number;
  let prevNwc = input.baseNwc as number;
  const warnings: CalcIssue[] = [];
  input.years.forEach((y, i) => {
    const revenue = prevRevenue * (1 + (y.revenueGrowth as number));
    const ebit = revenue * (y.ebitMargin as number);
    // Tax on negative EBIT is assumed zero in the simplified model (no loss carry-forward credit).
    const taxAmount = Math.max(0, ebit) * tax;
    const nopat = ebit - taxAmount;
    const da = revenue * (y.daPctRevenue as number);
    const capex = revenue * (y.capexPctRevenue as number);
    const nwc = revenue * (y.nwcPctRevenue as number);
    const deltaNwc = nwc - prevNwc;
    const fcff = nopat + da - capex - deltaNwc;
    if (ebit < 0 && i === input.years.length - 1) {
      warnings.push({ code: "NEGATIVE_TERMINAL_EBIT", message: "Final-year EBIT is negative; a terminal value on this base is not meaningful." });
    }
    rows.push({ year: i + 1, revenue, ebit, tax: taxAmount, nopat, da, capex, nwc, deltaNwc, fcff });
    prevRevenue = revenue;
    prevNwc = nwc;
  });
  if (rows.some((r) => r.ebit < 0)) {
    warnings.push({ code: "LOSS_TAX_SIMPLIFICATION", message: "Negative EBIT years are taxed at zero; loss carry-forwards are not modelled." });
  }
  return ok(rows, warnings);
}

export interface WaccInput {
  equityValue: number | null;
  debtValue: number | null;
  costOfEquity: number | null;
  preTaxCostOfDebt: number | null;
  taxRate: number | null;
  /** If false, the debt tax shield is not assumed usable (e.g., loss-making company). */
  taxShieldUsable: boolean;
  weightBasis: "market" | "book" | "target";
}

export interface WaccOutput {
  wacc: number;
  equityWeight: number;
  debtWeight: number;
  afterTaxCostOfDebt: number;
}

/** WACC = E/(D+E) × cost of equity + D/(D+E) × pre-tax cost of debt × (1 − tax rate). */
export function computeWacc(input: WaccInput): CalcResult<WaccOutput> {
  const errors = requireNumbers({
    equityValue: input.equityValue,
    debtValue: input.debtValue,
    costOfEquity: input.costOfEquity,
    preTaxCostOfDebt: input.preTaxCostOfDebt,
    taxRate: input.taxRate,
  });
  if (errors.length) return fail(errors);
  const e = input.equityValue as number;
  const d = input.debtValue as number;
  if (e < 0 || d < 0) return fail({ code: "NEGATIVE_WEIGHT", message: "Equity and debt values must be non-negative." });
  if (e + d <= 0) return fail({ code: "ZERO_CAPITAL", message: "Equity plus debt must be positive." });
  const t = input.taxRate as number;
  if (t < 0 || t >= 1) return fail({ code: "INVALID_TAX_RATE", field: "taxRate", message: "Tax rate must be between 0% and 100% (exclusive)." });
  const afterTaxCostOfDebt = (input.preTaxCostOfDebt as number) * (input.taxShieldUsable ? 1 - t : 1);
  const equityWeight = e / (e + d);
  const debtWeight = d / (e + d);
  const wacc = equityWeight * (input.costOfEquity as number) + debtWeight * afterTaxCostOfDebt;
  const warnings: CalcIssue[] = [];
  if (input.weightBasis !== "market") {
    warnings.push({ code: "NON_MARKET_WEIGHTS", message: `Weights use ${input.weightBasis} values; market-value weights are preferred where available.` });
  }
  if (!input.taxShieldUsable) {
    warnings.push({ code: "NO_TAX_SHIELD", message: "Debt tax shield assumed unusable; after-tax cost of debt equals pre-tax cost." });
  }
  return ok({ wacc, equityWeight, debtWeight, afterTaxCostOfDebt }, warnings);
}

/** CAPM cost of equity = risk-free rate + beta × equity risk premium (all user assumptions). */
export function capmCostOfEquity(riskFree: number | null, beta: number | null, equityRiskPremium: number | null): CalcResult<number> {
  const errors = requireNumbers({ riskFree, beta, equityRiskPremium });
  if (errors.length) return fail(errors);
  return ok((riskFree as number) + (beta as number) * (equityRiskPremium as number));
}

export interface DcfOutput {
  discountFactors: number[];
  pvFcff: number[];
  pvForecast: number;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  terminalShare: number;
}

export function validateRates(wacc: number | null, terminalGrowth: number | null): CalcIssue[] {
  const errors = requireNumbers({ wacc, terminalGrowth });
  if (errors.length) return errors;
  const w = wacc as number;
  const g = terminalGrowth as number;
  if (w <= -1) errors.push({ code: "INVALID_WACC", field: "wacc", message: "WACC must be greater than −100%." });
  if (w <= g) {
    errors.push({
      code: "WACC_NOT_ABOVE_GROWTH",
      field: "terminalGrowth",
      message: "WACC must exceed terminal growth. With WACC ≤ g the Gordon growth formula has no finite value, so no valuation is produced.",
    });
  }
  return errors;
}

/** Enterprise value from an explicit FCFF series, end-of-year discounting, Gordon growth terminal value. */
export function dcfFromFcff(fcff: Array<number | null>, wacc: number | null, terminalGrowth: number | null): CalcResult<DcfOutput> {
  const errors: CalcIssue[] = [];
  if (!fcff.length) errors.push({ code: "NO_FORECAST_YEARS", message: "At least one FCFF year is required." });
  fcff.forEach((v, i) => errors.push(...requireNumbers({ [`fcff[${i}]`]: v })));
  errors.push(...validateRates(wacc, terminalGrowth));
  if (errors.length) return fail(errors);
  const w = wacc as number;
  const g = terminalGrowth as number;
  const flows = fcff as number[];
  const discountFactors = flows.map((_, i) => 1 / (1 + w) ** (i + 1));
  const pvFcff = flows.map((f, i) => f * (discountFactors[i] as number));
  const pvForecast = pvFcff.reduce((s, x) => s + x, 0);
  const last = flows[flows.length - 1] as number;
  const terminalValue = (last * (1 + g)) / (w - g);
  const pvTerminal = terminalValue * (discountFactors[discountFactors.length - 1] as number);
  const enterpriseValue = pvForecast + pvTerminal;
  const warnings: CalcIssue[] = [];
  if (last <= 0) warnings.push({ code: "NON_POSITIVE_TERMINAL_FCFF", message: "Final-year FCFF is zero or negative; the terminal value is not economically meaningful." });
  const terminalShare = enterpriseValue !== 0 ? pvTerminal / enterpriseValue : Number.NaN;
  if (!Number.isFinite(terminalShare)) {
    return fail({ code: "NON_FINITE_RESULT", message: "Enterprise value is zero; terminal share cannot be computed." });
  }
  if (terminalShare > 0.75) {
    warnings.push({ code: "TERMINAL_DOMINANT", message: `Terminal value is ${(terminalShare * 100).toFixed(0)}% of enterprise value; the result is highly sensitive to WACC and g.` });
  }
  if (g > 0.06) {
    warnings.push({ code: "HIGH_TERMINAL_GROWTH", message: "Terminal growth above ~6% is aggressive for a perpetuity; check it against long-run nominal growth in the cash-flow currency." });
  }
  for (const [k, v] of Object.entries({ pvForecast, terminalValue, pvTerminal, enterpriseValue })) {
    if (!Number.isFinite(v)) return fail({ code: "NON_FINITE_RESULT", field: k, message: `${k} is not finite.` });
  }
  return ok({ discountFactors, pvFcff, pvForecast, terminalValue, pvTerminal, enterpriseValue, terminalShare }, warnings);
}

export interface SensitivityCell {
  wacc: number;
  g: number;
  result: { ok: true; enterpriseValue: number; perShare: number | null } | { ok: false; code: string };
}

/** WACC × terminal-growth grid. Invalid cells stay invalid (never zero). */
export function sensitivityGrid(
  fcff: number[],
  waccs: number[],
  growths: number[],
  toPerShare?: (enterpriseValue: number) => number | null,
): SensitivityCell[][] {
  return waccs.map((w) =>
    growths.map((g) => {
      const r = dcfFromFcff(fcff, w, g);
      if (!r.ok) return { wacc: w, g, result: { ok: false as const, code: r.errors[0]?.code ?? "INVALID" } };
      return { wacc: w, g, result: { ok: true as const, enterpriseValue: r.value.enterpriseValue, perShare: toPerShare ? toPerShare(r.value.enterpriseValue) : null } };
    }),
  );
}

export interface DcfEquityOutput {
  dcf: DcfOutput;
  bridge: EquityBridgeOutput;
  perShare: number | null;
}

/** Applies the explicit EV → equity bridge and diluted share count to a DCF enterprise value. */
export function dcfToEquity(
  dcf: DcfOutput,
  bridge: Omit<EquityBridgeInput, "enterpriseValue">,
  dilutedShares: number | null,
  currencies: { cashFlowCurrency: string; bridgeCurrency: string },
): CalcResult<DcfEquityOutput> {
  if (currencies.cashFlowCurrency !== currencies.bridgeCurrency) {
    return fail({
      code: "CURRENCY_MISMATCH",
      message: `Cash flows are in ${currencies.cashFlowCurrency} but bridge items are in ${currencies.bridgeCurrency}. Convert with a dated FX rate first.`,
    });
  }
  const b = equityValueFromEnterprise({ ...bridge, enterpriseValue: dcf.enterpriseValue });
  if (!b.ok) return b;
  let perShare: number | null = null;
  const warnings = [...b.warnings];
  if (dilutedShares !== null) {
    if (!isFiniteNumber(dilutedShares) || dilutedShares <= 0) {
      return fail({ code: "INVALID_SHARE_COUNT", field: "dilutedShares", message: "Diluted share count must be a positive number." });
    }
    perShare = b.value.equityValue / dilutedShares;
  } else {
    warnings.push({ code: "NO_SHARE_COUNT", message: "No diluted share count provided; per-share value not calculated." });
  }
  return ok({ dcf, bridge: b.value, perShare }, warnings);
}
