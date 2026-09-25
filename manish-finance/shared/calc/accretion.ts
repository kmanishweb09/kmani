import { type CalcIssue, type CalcResult, fail, isFiniteNumber, nearlyEqual, ok, requireNumbers } from "./result";

/**
 * Simplified accretion/dilution for a 100% acquisition with a full-year contribution.
 *
 *   New shares           = equity consideration funded with stock ÷ buyer issue price
 *   Adjusted combined NI = buyer NI + target NI
 *                          + (pretax synergies − incremental recurring costs − new interest expense
 *                             − foregone interest income − incremental D&A/PPA) × (1 − tax rate)
 *   Pro forma EPS        = adjusted combined NI ÷ (buyer diluted shares + new shares)
 *   Accretion/dilution   = pro forma EPS ÷ standalone buyer EPS − 1
 *
 * Buyer and target NI are after-tax and are not taxed again. Incremental adjustments are assumed
 * tax-deductible at one common rate (override with `adjustmentTaxRate`, or disable deductibility).
 * This is not a complete merger model and does not capture purchase accounting in full.
 */

export interface AccretionInput {
  buyerNetIncome: number | null;
  buyerDilutedShares: number | null;
  buyerSharePrice: number | null;
  targetNetIncome: number | null;
  /** Equity purchase consideration (not enterprise value). */
  equityConsideration: number | null;
  fundingCash: number | null;
  fundingDebt: number | null;
  fundingStock: number | null;
  /** Issue price for new buyer shares; defaults to the buyer share price. */
  stockIssuePrice?: number | null;
  interestRateOnNewDebt: number | null;
  /** Pre-tax yield the buyer loses on cash used. */
  foregoneCashYield: number | null;
  pretaxSynergies: number | null;
  incrementalRecurringCosts: number | null;
  incrementalDaPpa: number | null;
  taxRate: number | null;
  /** Optional override for the tax rate applied to incremental adjustments. */
  adjustmentTaxRate?: number | null;
  /** If false, incremental adjustments are treated as non-deductible (taxed at zero). */
  adjustmentsDeductible?: boolean;
  /** One-time pre-tax costs (e.g., integration, fees expensed); reported separately, not in run-rate EPS. */
  oneTimeCosts?: number | null;
  /** Transaction fees and debt refinancing are shown separately; they are not part of equity consideration. */
  transactionFees?: number | null;
  refinancedTargetDebt?: number | null;
  /** Fraction acquired; the simplified model only supports 1 (100%). */
  stakeAcquired?: number;
  /** Months of target contribution in the year; the simplified model only supports 12. */
  contributionMonths?: number;
}

export interface EpsBridgeStep {
  label: string;
  /** Change in pro forma net income from this item (after tax). */
  netIncomeImpact: number;
}

export interface AccretionOutput {
  newShares: number;
  newInterestExpense: number;
  foregoneInterestIncome: number;
  adjustmentsPreTax: number;
  adjustmentsAfterTax: number;
  combinedNetIncome: number;
  proFormaShares: number;
  standaloneEps: number;
  proFormaEps: number;
  /** null when standalone EPS is zero or negative (percentage not meaningful). */
  accretionPct: number | null;
  accretionPerShare: number;
  oneTimeCostsAfterTax: number;
  proFormaEpsIncludingOneTime: number;
  fundingMix: { cash: number; debt: number; stock: number };
  epsBridge: EpsBridgeStep[];
  separateItems: { transactionFees: number | null; refinancedTargetDebt: number | null };
  appliedAdjustmentTaxRate: number;
}

export function accretionDilution(input: AccretionInput): CalcResult<AccretionOutput> {
  const errors: CalcIssue[] = requireNumbers({
    buyerNetIncome: input.buyerNetIncome,
    buyerDilutedShares: input.buyerDilutedShares,
    buyerSharePrice: input.buyerSharePrice,
    targetNetIncome: input.targetNetIncome,
    equityConsideration: input.equityConsideration,
    fundingCash: input.fundingCash,
    fundingDebt: input.fundingDebt,
    fundingStock: input.fundingStock,
    interestRateOnNewDebt: input.interestRateOnNewDebt,
    foregoneCashYield: input.foregoneCashYield,
    pretaxSynergies: input.pretaxSynergies,
    incrementalRecurringCosts: input.incrementalRecurringCosts,
    incrementalDaPpa: input.incrementalDaPpa,
    taxRate: input.taxRate,
  });
  if (errors.length) return fail(errors);

  const stake = input.stakeAcquired ?? 1;
  if (stake !== 1) {
    return fail({
      code: "PARTIAL_ACQUISITION_UNSUPPORTED",
      field: "stakeAcquired",
      message: "The simplified model assumes a 100% acquisition. Partial stakes need minority-interest and consolidation treatment it does not model.",
    });
  }
  const months = input.contributionMonths ?? 12;
  if (months !== 12) {
    return fail({
      code: "PARTIAL_YEAR_UNSUPPORTED",
      field: "contributionMonths",
      message: "The simplified model assumes a full-year contribution. Stub periods are not supported.",
    });
  }

  const buyerShares = input.buyerDilutedShares as number;
  const buyerPrice = input.buyerSharePrice as number;
  if (buyerShares <= 0) return fail({ code: "INVALID_SHARE_COUNT", field: "buyerDilutedShares", message: "Buyer diluted shares must be positive." });
  if (buyerPrice <= 0) return fail({ code: "INVALID_PRICE", field: "buyerSharePrice", message: "Buyer share price must be positive." });

  const cash = input.fundingCash as number;
  const debt = input.fundingDebt as number;
  const stock = input.fundingStock as number;
  const consideration = input.equityConsideration as number;
  if (cash < 0 || debt < 0 || stock < 0) return fail({ code: "NEGATIVE_FUNDING", message: "Funding amounts must be non-negative." });
  if (consideration <= 0) return fail({ code: "INVALID_CONSIDERATION", field: "equityConsideration", message: "Equity consideration must be positive." });
  if (!nearlyEqual(cash + debt + stock, consideration, 1e-9, 1e-9)) {
    return fail({
      code: "FUNDING_MISMATCH",
      message: `Funding (cash ${cash} + debt ${debt} + stock ${stock} = ${cash + debt + stock}) must equal equity consideration (${consideration}). Fees and refinancing are entered separately.`,
    });
  }

  const tax = input.taxRate as number;
  if (tax < 0 || tax >= 1) return fail({ code: "INVALID_TAX_RATE", field: "taxRate", message: "Tax rate must be between 0% and 100% (exclusive)." });
  let adjTax = input.adjustmentTaxRate ?? tax;
  if (!isFiniteNumber(adjTax) || adjTax < 0 || adjTax >= 1) {
    return fail({ code: "INVALID_TAX_RATE", field: "adjustmentTaxRate", message: "Adjustment tax rate must be between 0% and 100% (exclusive)." });
  }
  if (input.adjustmentsDeductible === false) adjTax = 0;

  const issuePrice = input.stockIssuePrice ?? buyerPrice;
  if (!isFiniteNumber(issuePrice) || issuePrice <= 0) {
    return fail({ code: "INVALID_PRICE", field: "stockIssuePrice", message: "Stock issue price must be positive." });
  }

  const newShares = stock / issuePrice;
  const newInterestExpense = debt * (input.interestRateOnNewDebt as number);
  const foregoneInterestIncome = cash * (input.foregoneCashYield as number);
  const synergies = input.pretaxSynergies as number;
  const recurring = input.incrementalRecurringCosts as number;
  const daPpa = input.incrementalDaPpa as number;
  const adjustmentsPreTax = synergies - recurring - newInterestExpense - foregoneInterestIncome - daPpa;
  const afterTaxFactor = 1 - adjTax;
  const adjustmentsAfterTax = adjustmentsPreTax * afterTaxFactor;
  const buyerNi = input.buyerNetIncome as number;
  const targetNi = input.targetNetIncome as number;
  const combinedNetIncome = buyerNi + targetNi + adjustmentsAfterTax;
  const proFormaShares = buyerShares + newShares;
  const standaloneEps = buyerNi / buyerShares;
  const proFormaEps = combinedNetIncome / proFormaShares;
  const warnings: CalcIssue[] = [];
  let accretionPct: number | null = null;
  if (standaloneEps > 0) {
    accretionPct = proFormaEps / standaloneEps - 1;
  } else {
    warnings.push({
      code: "EPS_NOT_POSITIVE",
      message: "Standalone EPS is zero or negative, so percentage accretion/dilution is not meaningful. Compare absolute EPS instead.",
    });
  }
  const oneTime = input.oneTimeCosts ?? 0;
  if (!isFiniteNumber(oneTime) || oneTime < 0) return fail({ code: "INVALID_NUMBER", field: "oneTimeCosts", message: "One-time costs must be a non-negative number." });
  const oneTimeCostsAfterTax = oneTime * afterTaxFactor;
  const proFormaEpsIncludingOneTime = (combinedNetIncome - oneTimeCostsAfterTax) / proFormaShares;

  const epsBridge: EpsBridgeStep[] = [
    { label: "Target net income", netIncomeImpact: targetNi },
    { label: "Synergies (after tax)", netIncomeImpact: synergies * afterTaxFactor },
    { label: "Recurring costs (after tax)", netIncomeImpact: -recurring * afterTaxFactor },
    { label: "Interest on new debt (after tax)", netIncomeImpact: -newInterestExpense * afterTaxFactor },
    { label: "Foregone interest on cash (after tax)", netIncomeImpact: -foregoneInterestIncome * afterTaxFactor },
    { label: "Incremental D&A / PPA (after tax)", netIncomeImpact: -daPpa * afterTaxFactor },
  ];

  warnings.push({ code: "EPS_NOT_VALUE", message: "EPS accretion alone does not establish value creation; compare the price paid with the value of what is acquired." });
  const fees = input.transactionFees ?? null;
  const refinanced = input.refinancedTargetDebt ?? null;
  if (fees !== null || refinanced !== null) {
    warnings.push({ code: "SEPARATE_ITEMS", message: "Fees and refinanced debt are shown separately and are not included in equity consideration or run-rate EPS." });
  }

  return ok(
    {
      newShares,
      newInterestExpense,
      foregoneInterestIncome,
      adjustmentsPreTax,
      adjustmentsAfterTax,
      combinedNetIncome,
      proFormaShares,
      standaloneEps,
      proFormaEps,
      accretionPct,
      accretionPerShare: proFormaEps - standaloneEps,
      oneTimeCostsAfterTax,
      proFormaEpsIncludingOneTime,
      fundingMix: { cash, debt, stock },
      epsBridge,
      separateItems: { transactionFees: fees, refinancedTargetDebt: refinanced },
      appliedAdjustmentTaxRate: adjTax,
    },
    warnings,
  );
}

/** Explains which inputs moved EPS between two scenarios ("What changed?"). */
export function explainScenarioChange(a: AccretionInput, b: AccretionInput): Array<{ field: keyof AccretionInput; from: unknown; to: unknown }> {
  const keys = Object.keys({ ...a, ...b }) as Array<keyof AccretionInput>;
  return keys.filter((k) => a[k] !== b[k]).map((k) => ({ field: k, from: a[k], to: b[k] }));
}
