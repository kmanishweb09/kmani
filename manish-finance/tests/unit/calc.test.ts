import { describe, expect, it } from "vitest";
import { accretionDilution, type AccretionInput } from "../../shared/calc/accretion";
import { enterpriseValueFromEquity, equityValueFromEnterprise, reconcileEnterpriseValue } from "../../shared/calc/bridge";
import { computeWacc, dcfFromFcff, dcfToEquity, forecastFcff, sensitivityGrid } from "../../shared/calc/dcf";
import { evToEbitda, evToRevenue, offerPremium, priceToBook, priceToEarnings, summarizeMultiples } from "../../shared/calc/multiples";
import { deriveLtmFromQuarters, deriveLtmFromYtd, periodsAligned } from "../../shared/calc/period";
import { justifiedPriceToBook, residualIncomeFromDrivers, residualIncomeValuation } from "../../shared/calc/residualIncome";
import { convertMoney, formatMoney, FxError, ratioChange, rescale, toBase, totalsByCurrency } from "../../shared/money/units";

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe("Section 9 mandatory fixtures", () => {
  it("EV bridge: equity 1,000 + debt 300 + preferred 50 + NCI 100 − cash 150 − investments 50 = 1,250", () => {
    const r = enterpriseValueFromEquity({ equityValue: 1000, debt: 300, preferredEquity: 50, nonControllingInterests: 100, excessCash: 150, nonOperatingInvestments: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.enterpriseValue).toBe(1250);
      expect(r.value.steps.map((s) => s.contribution)).toEqual([1000, 300, 50, 100, -150, -50, 1250]);
    }
  });

  it("EV/EBITDA: 1,250 / 100 = 12.5x", () => {
    expect(evToEbitda(1250, 100)).toEqual({ kind: "value", value: 12.5 });
  });

  it("Negative EBITDA → NM and excluded from aggregate statistics", () => {
    const nm = evToEbitda(1250, -10);
    expect(nm.kind).toBe("NM");
    const stats = summarizeMultiples([
      { id: "a", value: evToEbitda(1250, 100) },
      { id: "b", value: nm },
      { id: "c", value: evToEbitda(900, 100) },
    ]);
    expect(stats.n).toBe(2);
    expect(stats.included).toEqual(["a", "c"]);
    expect(stats.excluded).toEqual([{ id: "b", kind: "NM", reason: "EBITDA is zero or negative" }]);
    close(stats.median as number, 10.75);
  });

  it("DCF: FCFF 100 × 5, WACC 10%, g 2%, year-end discounting", () => {
    const r = dcfFromFcff([100, 100, 100, 100, 100], 0.1, 0.02);
    expect(r.ok).toBe(true);
    if (r.ok) {
      close(r.value.pvForecast, 379.078677);
      close(r.value.terminalValue, 1275);
      close(r.value.pvTerminal, 791.674687);
      close(r.value.enterpriseValue, 1170.753364);
    }
  });

  it("Invalid DCF: WACC 2% with g 2% → validation error, no numeric valuation", () => {
    const r = dcfFromFcff([100, 100, 100, 100, 100], 0.02, 0.02);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toContain("WACC_NOT_ABOVE_GROWTH");
      expect("value" in r).toBe(false);
    }
  });

  it("Accretion: buyer NI 20/10 sh/$20; target NI 5; 70 = debt 30 + stock 40; 10% debt; synergy 2; tax 30%", () => {
    const r = accretionDilution({
      buyerNetIncome: 20,
      buyerDilutedShares: 10,
      buyerSharePrice: 20,
      targetNetIncome: 5,
      equityConsideration: 70,
      fundingCash: 0,
      fundingDebt: 30,
      fundingStock: 40,
      interestRateOnNewDebt: 0.1,
      foregoneCashYield: 0,
      pretaxSynergies: 2,
      incrementalRecurringCosts: 0,
      incrementalDaPpa: 0,
      taxRate: 0.3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      close(r.value.newShares, 2);
      close(r.value.combinedNetIncome, 24.3);
      close(r.value.proFormaEps, 2.025);
      close(r.value.accretionPct as number, 0.0125);
    }
  });

  it("FIG residual income: book 100, NI 15, Ke 10%, one year → RI 5, value 104.545455", () => {
    const r = residualIncomeValuation({ openingBookEquity: 100, costOfEquity: 0.1, years: [{ netIncome: 15, distributions: 0, capitalChanges: 0 }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      close(r.value.rows[0]?.residualIncome as number, 5);
      close(r.value.equityValue, 104.545455);
      expect(r.value.terminalAssumption).toBe("no_residual_income_after_horizon");
    }
  });

  it("Currency: USD 1 million at assumed INR 83/USD = INR 83 million = INR 8.3 crore, labelled assumed", () => {
    const c = convertMoney({ amount: 1, currency: "USD", unit: "million" }, { from: "USD", to: "INR", rate: 83, rateDate: "2026-09-25", sourceKind: "assumed", sourceRef: "fixture", method: "user_assumption" });
    expect(c.converted).toEqual({ amount: 83, currency: "INR", unit: "million" });
    close(rescale(c.converted, "crore").amount, 8.3, 10);
    expect(c.label).toContain("assumed FX, not current FX");
    expect(formatMoney(c.converted, { inrSystem: "indian" })).toBe("₹8.3 crore");
    expect(formatMoney(c.converted, { inrSystem: "international" })).toBe("₹83 million");
  });

  it("Units: INR 1 crore = INR 10 million; INR 100 crore = INR 1 billion", () => {
    expect(rescale({ amount: 1, currency: "INR", unit: "crore" }, "million").amount).toBe(10);
    expect(rescale({ amount: 100, currency: "INR", unit: "crore" }, "billion").amount).toBe(1);
    expect(formatMoney({ amount: 1, currency: "INR", unit: "crore" }, { inrSystem: "international" })).toBe("₹10 million");
    expect(formatMoney({ amount: 100, currency: "INR", unit: "crore" }, { inrSystem: "international" })).toBe("₹1 billion");
  });

  it("Percentage vs bps: 10% → 12% = +2 percentage points = +200 bps", () => {
    const c = ratioChange(0.1, 0.12);
    expect(c.percentagePoints).toBe(2);
    expect(c.bps).toBe(200);
    close(c.relative as number, 0.2);
  });
});

describe("Bridge edge cases", () => {
  it("missing debt is not zero debt", () => {
    const r = enterpriseValueFromEquity({ equityValue: 1000, debt: null, preferredEquity: 0, nonControllingInterests: 0, excessCash: 0, nonOperatingInvestments: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: "BRIDGE_INCOMPLETE", field: "debt" });
  });
  it("rejects NaN and Infinity", () => {
    const r = enterpriseValueFromEquity({ equityValue: Number.NaN, debt: Number.POSITIVE_INFINITY, preferredEquity: 0, nonControllingInterests: 0, excessCash: 0, nonOperatingInvestments: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(["INVALID_NUMBER", "INVALID_NUMBER"]);
  });
  it("reverse bridge returns the original equity", () => {
    const r = equityValueFromEnterprise({ enterpriseValue: 1250, debt: 300, preferredEquity: 50, nonControllingInterests: 100, excessCash: 150, nonOperatingInvestments: 50 });
    expect(r.ok && r.value.equityValue).toBe(1000);
  });
  it("reconciliation keeps the disclosed figure and reports the gap", () => {
    const r = reconcileEnterpriseValue(1250, 1300);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.difference).toBe(-50);
      expect(r.value.withinTolerance).toBe(false);
    }
    expect(reconcileEnterpriseValue(1, 0).ok).toBe(false);
  });
  it("lease treatment produces an explicit consistency warning", () => {
    const r = enterpriseValueFromEquity({ equityValue: 10, debt: 1, preferredEquity: 0, nonControllingInterests: 0, excessCash: 0, nonOperatingInvestments: 0, leaseTreatment: "included_in_debt" });
    expect(r.ok && r.warnings.some((w) => w.code === "LEASES_IN_DEBT")).toBe(true);
  });
});

describe("Multiples and statistics", () => {
  it("distinguishes NM, not disclosed, not available and not applicable", () => {
    expect(evToRevenue(100, 0).kind).toBe("NM");
    expect(evToRevenue({ missing: "not_disclosed" }, 10).kind).toBe("not_disclosed");
    expect(evToRevenue(null, 10).kind).toBe("not_available");
    expect(evToEbitda(100, { missing: "not_applicable", reason: "Bank: EV/EBITDA not meaningful" })).toEqual({ kind: "not_applicable", reason: "Bank: EV/EBITDA not meaningful" });
    expect(priceToEarnings(100, -5).kind).toBe("NM");
    expect(priceToBook(150, 100)).toEqual({ kind: "value", value: 1.5 });
  });
  it("quartiles use inclusive linear interpolation", () => {
    const stats = summarizeMultiples([1, 2, 3, 4].map((v, i) => ({ id: String(i), value: { kind: "value" as const, value: v } })));
    expect(stats.q1).toBe(1.75);
    expect(stats.median).toBe(2.5);
    expect(stats.q3).toBe(3.25);
    expect(stats.mean).toBe(2.5);
  });
  it("empty sample yields nulls, not zeros", () => {
    const stats = summarizeMultiples([{ id: "x", value: { kind: "NM", reason: "neg" } }]);
    expect(stats.n).toBe(0);
    expect(stats.median).toBeNull();
    expect(stats.mean).toBeNull();
  });
  it("offer premium rejects a post-announcement baseline", () => {
    const bad = offerPremium(120, { price: 110, date: "2024-03-02", convention: "prior_close", announcementDate: "2024-03-01" });
    expect(bad.ok).toBe(false);
    const good = offerPremium(120, { price: 100, date: "2024-02-29", convention: "prior_close", announcementDate: "2024-03-01" });
    expect(good.ok && good.value.premium).toBeCloseTo(0.2, 10);
  });
});

describe("DCF details", () => {
  it("driver forecast computes FCFF = EBIT(1−t) + D&A − capex − ΔNWC", () => {
    const r = forecastFcff({
      baseRevenue: 1000,
      baseNwc: 100,
      taxRate: 0.25,
      years: [{ revenueGrowth: 0.1, ebitMargin: 0.2, daPctRevenue: 0.05, capexPctRevenue: 0.06, nwcPctRevenue: 0.1 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const y = r.value[0];
      close(y?.revenue as number, 1100);
      close(y?.nopat as number, 165);
      close(y?.deltaNwc as number, 10);
      close(y?.fcff as number, 165 + 55 - 66 - 10);
    }
  });
  it("sensitivity grid keeps invalid cells invalid", () => {
    const grid = sensitivityGrid([100, 100, 100, 100, 100], [0.02, 0.1], [0.02, 0.03]);
    expect(grid[0]?.[0]?.result).toEqual({ ok: false, code: "WACC_NOT_ABOVE_GROWTH" });
    expect(grid[1]?.[0]?.result.ok).toBe(true);
  });
  it("WACC with and without a usable tax shield", () => {
    const a = computeWacc({ equityValue: 600, debtValue: 400, costOfEquity: 0.12, preTaxCostOfDebt: 0.08, taxRate: 0.25, taxShieldUsable: true, weightBasis: "market" });
    expect(a.ok && a.value.wacc).toBeCloseTo(0.6 * 0.12 + 0.4 * 0.06, 12);
    const b = computeWacc({ equityValue: 600, debtValue: 400, costOfEquity: 0.12, preTaxCostOfDebt: 0.08, taxRate: 0.25, taxShieldUsable: false, weightBasis: "book" });
    expect(b.ok && b.value.wacc).toBeCloseTo(0.6 * 0.12 + 0.4 * 0.08, 12);
    expect(b.ok && b.warnings.map((w) => w.code)).toEqual(["NON_MARKET_WEIGHTS", "NO_TAX_SHIELD"]);
  });
  it("blocks inconsistent currencies and invalid share counts", () => {
    const d = dcfFromFcff([100], 0.1, 0.02);
    if (!d.ok) throw new Error("fixture");
    const bridge = { debt: 0, preferredEquity: 0, nonControllingInterests: 0, excessCash: 0, nonOperatingInvestments: 0 };
    expect(dcfToEquity(d.value, bridge, 10, { cashFlowCurrency: "USD", bridgeCurrency: "INR" }).ok).toBe(false);
    expect(dcfToEquity(d.value, bridge, 0, { cashFlowCurrency: "INR", bridgeCurrency: "INR" }).ok).toBe(false);
    const good = dcfToEquity(d.value, bridge, 10, { cashFlowCurrency: "INR", bridgeCurrency: "INR" });
    expect(good.ok && good.value.perShare).toBeCloseTo(d.value.enterpriseValue / 10, 10);
  });
  it("rejects missing FCFF years", () => {
    expect(dcfFromFcff([100, null, 100], 0.1, 0.02).ok).toBe(false);
    expect(dcfFromFcff([], 0.1, 0.02).ok).toBe(false);
  });
});

describe("Accretion/dilution guards", () => {
  const base: AccretionInput = {
    buyerNetIncome: 20,
    buyerDilutedShares: 10,
    buyerSharePrice: 20,
    targetNetIncome: 5,
    equityConsideration: 70,
    fundingCash: 0,
    fundingDebt: 30,
    fundingStock: 40,
    interestRateOnNewDebt: 0.1,
    foregoneCashYield: 0,
    pretaxSynergies: 2,
    incrementalRecurringCosts: 0,
    incrementalDaPpa: 0,
    taxRate: 0.3,
  };
  it("funding mix must reconcile to equity consideration", () => {
    const r = accretionDilution({ ...base, fundingStock: 35 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("FUNDING_MISMATCH");
  });
  it("blocks partial acquisitions and stub periods", () => {
    expect(accretionDilution({ ...base, stakeAcquired: 0.6 }).ok).toBe(false);
    expect(accretionDilution({ ...base, contributionMonths: 6 }).ok).toBe(false);
  });
  it("percentage accretion is null when standalone EPS is not positive", () => {
    const r = accretionDilution({ ...base, buyerNetIncome: -5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.accretionPct).toBeNull();
      expect(r.warnings.some((w) => w.code === "EPS_NOT_POSITIVE")).toBe(true);
    }
  });
  it("one-time costs are reported separately from run-rate EPS", () => {
    const r = accretionDilution({ ...base, oneTimeCosts: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      close(r.value.proFormaEps, 2.025);
      close(r.value.proFormaEpsIncludingOneTime, (24.3 - 0.7) / 12);
    }
  });
  it("cash funding costs foregone interest; all-cash has no new shares", () => {
    const r = accretionDilution({ ...base, fundingCash: 70, fundingDebt: 0, fundingStock: 0, foregoneCashYield: 0.04 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newShares).toBe(0);
      close(r.value.foregoneInterestIncome, 2.8);
    }
  });
  it("missing input is an error, not zero", () => {
    expect(accretionDilution({ ...base, targetNetIncome: null }).ok).toBe(false);
  });
});

describe("FIG residual income", () => {
  it("rolls book equity with clean surplus", () => {
    const r = residualIncomeValuation({
      openingBookEquity: 100,
      costOfEquity: 0.12,
      years: [
        { netIncome: 15, distributions: 5, capitalChanges: 0 },
        { netIncome: 16, distributions: 6, capitalChanges: 2 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rows[0]?.closingBook).toBe(110);
      expect(r.value.rows[1]?.openingBook).toBe(110);
      expect(r.value.rows[1]?.closingBook).toBe(122);
      close(r.value.rows[1]?.residualIncome as number, 16 - 13.2);
    }
  });
  it("driver mode: ROE equal to cost of equity adds no value", () => {
    const r = residualIncomeFromDrivers({ openingBookEquity: 100, costOfEquity: 0.1, years: [0, 1, 2].map(() => ({ roe: 0.1, payoutRatio: 0.3, capitalChanges: 0 })) });
    expect(r.ok && r.value.equityValue).toBeCloseTo(100, 9);
  });
  it("justified P/B requires Ke > g", () => {
    expect(justifiedPriceToBook(0.15, 0.1, 0.1).ok).toBe(false);
    const r = justifiedPriceToBook(0.15, 0.12, 0.06);
    expect(r.ok && r.value).toBeCloseTo(1.5, 12);
  });
});

describe("Periods and currency totals", () => {
  it("does not sum YTD figures into LTM; derives LTM from FY + YTD − prior YTD", () => {
    const r = deriveLtmFromYtd(
      { value: 400, period: { type: "FY", end: "2025-03-31", months: 12 } },
      { value: 220, period: { type: "YTD", end: "2025-09-30", months: 6 } },
      { value: 190, period: { type: "YTD", end: "2024-09-30", months: 6 } },
    );
    expect(r.ok && r.value.value).toBe(430);
    const bad = deriveLtmFromQuarters([1, 2, 3, 4].map((v, i) => ({ value: v, period: { type: "YTD" as const, end: `2025-0${i + 3}-30`, months: 3 } })));
    expect(bad.ok).toBe(false);
  });
  it("LTM from four consecutive discrete quarters", () => {
    const ends = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"];
    const r = deriveLtmFromQuarters(ends.map((end, i) => ({ value: 10 + i, period: { type: "Q" as const, end, months: 3 } })));
    expect(r.ok && r.value.value).toBe(46);
  });
  it("requires period alignment for peer statistics", () => {
    expect(periodsAligned({ type: "FY", end: "2025-03-31", months: 12 }, { type: "CY", end: "2024-12-31", months: 12 }).aligned).toBe(true);
    expect(periodsAligned({ type: "FY", end: "2025-03-31", months: 12 }, { type: "YTD", end: "2025-09-30", months: 6 }).aligned).toBe(false);
    expect(periodsAligned({ type: "FY", end: "2025-03-31", months: 12 }, { type: "FY", end: "2023-03-31", months: 12 }).aligned).toBe(false);
  });
  it("groups totals by currency instead of summing across currencies", () => {
    const t = totalsByCurrency(
      [
        { amount: 10, currency: "USD", unit: "billion" },
        { amount: 500, currency: "INR", unit: "crore" },
        { amount: 5, currency: "USD", unit: "billion" },
      ],
      (c) => (c === "INR" ? "crore" : "billion"),
    );
    expect(t).toEqual([
      { currency: "INR", total: { amount: 500, currency: "INR", unit: "crore" }, count: 1 },
      { currency: "USD", total: { amount: 15, currency: "USD", unit: "billion" }, count: 2 },
    ]);
  });
  it("FX conversion rejects mismatched pairs and invalid rates", () => {
    const fx = { from: "USD", to: "INR", rate: 83, rateDate: "2026-09-25", sourceKind: "assumed" as const, sourceRef: "x", method: "user_assumption" as const };
    expect(() => convertMoney({ amount: 1, currency: "EUR", unit: "million" }, fx)).toThrow(FxError);
    expect(() => convertMoney({ amount: 1, currency: "USD", unit: "million" }, { ...fx, rate: 0 })).toThrow(FxError);
    expect(toBase({ amount: 1.5, currency: "INR", unit: "lakh" })).toBe(150000);
  });
  it("formats large INR amounts in lakh crore", () => {
    expect(formatMoney({ amount: 40, currency: "INR", unit: "billion" })).toBe("₹4,000 crore");
    expect(formatMoney({ amount: 150000, currency: "INR", unit: "crore" })).toBe("₹1.5 lakh crore");
  });
});
