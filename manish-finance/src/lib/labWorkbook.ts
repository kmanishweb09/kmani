import { CALC_VERSION } from "../../shared/calc/result";
import { buildXlsx, type CellValue, cellRef, colName, excelDate, type SheetSpec, safeSheetName, sheetRef, type StyleName } from "../../shared/xlsx/workbook";
import { ACCRETION_TRAINING, type AccretionAssumptions, computeAccretion } from "../pages/lab/AccretionTab";
import { COMPS_TRAINING, type CompsAssumptions, computeComps } from "../pages/lab/ComparablesTab";
import { computeDcf, DCF_TRAINING, type DcfAssumptions } from "../pages/lab/DcfTab";
import { computeFig, FIG_TRAINING, type FigAssumptions } from "../pages/lab/FigTab";

/**
 * Formula-based Excel workbooks for Lab scenarios. Each scenario gets a sheet whose outputs are live
 * formulas over its input cells (blue), mirroring the app's deterministic calculations in shared/calc.
 * Every formula also carries the value the app calculated, and is registered as a check: the test suite
 * recalculates the workbook in LibreOffice and compares each formula with the app's value.
 */

export type LabModel = "dcf" | "accretion" | "fig" | "comparables";

export interface WorkbookCheck {
  sheet: string;
  ref: string;
  label: string;
  expected: number | string;
}

export interface LabScenario<T> {
  name: string;
  assumptions: T;
}

const NA = "n/a";

class Sheet {
  readonly rows: CellValue[][] = [];
  readonly styles: Array<Array<StyleName | undefined>> = [];
  readonly checks: WorkbookCheck[] = [];
  cols: number[] = [34, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16];
  freeze?: string;
  constructor(readonly name: string) {}

  put(col: number, row: number, v: CellValue, s?: StyleName): string {
    (this.rows[row - 1] ??= [])[col] = v;
    (this.styles[row - 1] ??= [])[col] = s;
    return cellRef(col, row);
  }

  /** A formula cell holding the app's calculated value (cached, and checked after recalculation). */
  calc(col: number, row: number, f: string, expected: number | string | null | undefined, s: StyleName = "calc_num", label = ""): string {
    const ok = typeof expected === "string" || (typeof expected === "number" && Number.isFinite(expected));
    this.put(col, row, { f, v: ok ? expected : undefined }, s);
    if (ok) this.checks.push({ sheet: this.name, ref: cellRef(col, row), label: label || `${this.rows[row - 1]?.[0] ?? cellRef(col, row)}`, expected: expected as number | string });
    return cellRef(col, row);
  }

  input(col: number, row: number, v: number | string | boolean | null | undefined, s: StyleName = "input_num"): string {
    return this.put(col, row, v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v, s);
  }

  label(row: number, text: string, s: StyleName = "label"): void {
    this.put(0, row, text, s);
  }

  spec(): SheetSpec {
    return {
      name: this.name,
      rows: Array.from(this.rows, (r, ri) => Array.from(r ?? [], (v, ci) => ({ v, s: this.styles[ri]?.[ci] }))),
      cols: this.cols,
      freeze: this.freeze,
    };
  }
}

function header(sh: Sheet, row: number, text: string, from = 0, to = 1): void {
  sh.put(from, row, text, "header");
  for (let c = from + 1; c <= to; c++) sh.put(c, row, null, "header");
}

function intro(sh: Sheet, title: string, unitText: string, exported: Date): void {
  sh.put(0, 1, title, "title");
  sh.put(0, 2, `${unitText}. Blue cells are inputs (training example or your assumptions); black cells are formulas. Calculation version ${CALC_VERSION}; exported ${exported.toISOString().slice(0, 16).replace("T", " ")} UTC.`, "subtitle");
}

// ---------------------------------------------------------------- DCF

interface DcfRefs {
  wacc: string | null;
  ev: string | null;
  equity: string | null;
  perShare: string | null;
  tvShare: string | null;
}

function dcfSheet(name: string, a: DcfAssumptions, exported: Date): { sheet: Sheet; refs: DcfRefs } {
  const r = computeDcf(a);
  const sh = new Sheet(name);
  const n = a.mode === "drivers" ? a.years.length : a.directFcff.length;
  const yc = (i: number) => 1 + i; // year i (0-based) → column index
  const last = colName(yc(n - 1));
  intro(sh, `DCF — ${name}`, `${a.currency} ${a.unit}${DCF_TRAINING ? ` · ${DCF_TRAINING.title}` : ""}`, exported);
  header(sh, 4, "Forecast inputs", 0, n);
  const taxRow = 7;
  if (a.mode === "drivers") {
    sh.label(5, "Base-year revenue");
    sh.input(1, 5, a.baseRevenue);
    sh.label(6, "Base-year operating working capital");
    sh.input(1, 6, a.baseNwc);
  } else {
    sh.put(0, 5, "Direct FCFF mode: free cash flows are entered below.", "note");
  }
  sh.label(taxRow, "Tax rate");
  sh.input(1, taxRow, a.taxRate, "input_pct");
  const yearRow = 9;
  sh.put(0, yearRow, a.mode === "drivers" ? "Driver" : "Year", "header");
  for (let i = 0; i < n; i++) sh.put(yc(i), yearRow, i + 1, "year");
  let fcffRow: number;
  if (a.mode === "drivers") {
    const drivers: Array<[keyof DcfAssumptions["years"][number], string]> = [
      ["revenueGrowth", "Revenue growth"],
      ["ebitMargin", "EBIT margin"],
      ["daPctRevenue", "D&A % of revenue"],
      ["capexPctRevenue", "Capex % of revenue"],
      ["nwcPctRevenue", "Operating working capital % of revenue"],
    ];
    drivers.forEach(([k, label], j) => {
      sh.label(10 + j, label);
      a.years.forEach((y, i) => sh.input(yc(i), 10 + j, y[k], "input_pct"));
    });
    header(sh, 16, "Forecast (FCFF)", 0, n);
    const rows = r.rows;
    const L = ["Revenue", "EBIT", "Tax on EBIT (zero if EBIT is negative)", "NOPAT", "D&A", "Capex", "Operating working capital", "Increase in working capital", "Free cash flow to the firm (FCFF)"];
    L.forEach((l, j) => sh.label(17 + j, l, j === 8 ? "bold" : "label"));
    for (let i = 0; i < n; i++) {
      const c = colName(yc(i));
      const prev = i === 0 ? null : colName(yc(i - 1));
      const row = rows[i];
      sh.calc(yc(i), 17, i === 0 ? `$B$5*(1+${c}10)` : `${prev}17*(1+${c}10)`, row?.revenue);
      sh.calc(yc(i), 18, `${c}17*${c}11`, row?.ebit);
      sh.calc(yc(i), 19, `MAX(0,${c}18)*$B$${taxRow}`, row?.tax);
      sh.calc(yc(i), 20, `${c}18-${c}19`, row?.nopat);
      sh.calc(yc(i), 21, `${c}17*${c}12`, row?.da);
      sh.calc(yc(i), 22, `${c}17*${c}13`, row?.capex);
      sh.calc(yc(i), 23, `${c}17*${c}14`, row?.nwc);
      sh.calc(yc(i), 24, i === 0 ? `${c}23-$B$6` : `${c}23-${prev}23`, row?.deltaNwc);
      sh.calc(yc(i), 25, `${c}20+${c}21-${c}22-${c}24`, row?.fcff, "total_num");
    }
    fcffRow = 25;
  } else {
    sh.label(10, "Free cash flow to the firm (FCFF)", "bold");
    a.directFcff.forEach((v, i) => sh.input(yc(i), 10, v));
    fcffRow = 10;
  }

  let row = fcffRow + 2;
  header(sh, row, "Discount rate", 0, 1);
  let waccRef: string;
  if (a.waccMode === "build") {
    const s0 = row;
    sh.label(s0 + 1, "Risk-free rate");
    sh.input(1, s0 + 1, a.riskFree, "input_pct");
    sh.label(s0 + 2, "Beta");
    sh.input(1, s0 + 2, a.beta);
    sh.label(s0 + 3, "Equity risk premium");
    sh.input(1, s0 + 3, a.equityRiskPremium, "input_pct");
    sh.label(s0 + 4, "Cost of equity (CAPM)");
    sh.calc(1, s0 + 4, `B${s0 + 1}+B${s0 + 2}*B${s0 + 3}`, r.costOfEquity, "calc_pct");
    sh.label(s0 + 5, "Equity value (for weights)");
    sh.input(1, s0 + 5, a.equityValue);
    sh.label(s0 + 6, "Debt value (for weights)");
    sh.input(1, s0 + 6, a.debtValue);
    sh.label(s0 + 7, "Pre-tax cost of debt");
    sh.input(1, s0 + 7, a.preTaxCostOfDebt, "input_pct");
    sh.label(s0 + 8, "Debt tax shield usable (1 = yes, 0 = no)");
    sh.input(1, s0 + 8, a.taxShieldUsable, "input_int");
    sh.label(s0 + 9, "After-tax cost of debt");
    sh.calc(1, s0 + 9, `B${s0 + 7}*IF(B${s0 + 8}=1,1-$B$${taxRow},1)`, r.waccDetail?.afterTaxCostOfDebt, "calc_pct");
    sh.label(s0 + 10, "Equity weight");
    sh.calc(1, s0 + 10, `B${s0 + 5}/(B${s0 + 5}+B${s0 + 6})`, r.waccDetail?.equityWeight, "calc_pct");
    sh.label(s0 + 11, "Debt weight");
    sh.calc(1, s0 + 11, `B${s0 + 6}/(B${s0 + 5}+B${s0 + 6})`, r.waccDetail?.debtWeight, "calc_pct");
    sh.label(s0 + 12, "WACC", "bold");
    waccRef = sh.calc(1, s0 + 12, `B${s0 + 10}*B${s0 + 4}+B${s0 + 11}*B${s0 + 9}`, r.wacc, "total_pct");
    row = s0 + 13;
  } else {
    sh.label(row + 1, "WACC (entered)", "bold");
    waccRef = sh.input(1, row + 1, a.directWacc, "input_pct");
    row += 2;
  }
  sh.label(row, "Terminal growth (perpetuity)");
  const gRef = sh.input(1, row, a.terminalGrowth, "input_pct");
  const W = `$${waccRef.replace(/(\d+)$/, "$$$1")}`;
  const G = `$${gRef.replace(/(\d+)$/, "$$$1")}`;

  row += 2;
  const v0 = row;
  header(sh, v0, "Valuation", 0, n);
  const dcf = r.dcf;
  sh.label(v0 + 1, "Discount factor (end of year)");
  sh.label(v0 + 2, "Present value of FCFF");
  for (let i = 0; i < n; i++) {
    const c = colName(yc(i));
    sh.calc(yc(i), v0 + 1, `1/(1+${W})^${c}$${yearRow}`, dcf?.discountFactors[i], "calc_factor");
    sh.calc(yc(i), v0 + 2, `${c}${fcffRow}*${c}${v0 + 1}`, dcf?.pvFcff[i]);
  }
  sh.label(v0 + 3, "PV of forecast FCFF");
  const pvForecast = sh.calc(1, v0 + 3, `SUM(B${v0 + 2}:${last}${v0 + 2})`, dcf?.pvForecast);
  sh.label(v0 + 4, "Terminal value (Gordon growth on final-year FCFF)");
  const tv = sh.calc(1, v0 + 4, `IF(${W}>${G},${last}${fcffRow}*(1+${G})/(${W}-${G}),"${NA}: WACC must exceed growth")`, dcf ? dcf.terminalValue : undefined);
  sh.label(v0 + 5, "PV of terminal value");
  const pvTv = sh.calc(1, v0 + 5, `IFERROR(${tv}*${last}${v0 + 1},"${NA}")`, dcf?.pvTerminal);
  sh.label(v0 + 6, "Enterprise value", "bold");
  const ev = sh.calc(1, v0 + 6, `IFERROR(${pvForecast}+${pvTv},"${NA}")`, dcf?.enterpriseValue, "total_num");
  sh.label(v0 + 7, "Terminal value share of EV");
  const tvShare = sh.calc(1, v0 + 7, `IFERROR(${pvTv}/${ev},"${NA}")`, dcf?.terminalShare, "calc_pct");

  const q0 = v0 + 9;
  header(sh, q0, `Equity bridge (${a.bridgeCurrency})`, 0, 1);
  const bridgeItems: Array<[keyof DcfAssumptions, string]> = [
    ["debt", "Interest-bearing debt (−)"],
    ["preferredEquity", "Preferred equity (−)"],
    ["nonControllingInterests", "Non-controlling interests (−)"],
    ["excessCash", "Excess cash (+)"],
    ["nonOperatingInvestments", "Non-operating investments (+)"],
  ];
  bridgeItems.forEach(([k, l], j) => {
    sh.label(q0 + 1 + j, l);
    sh.input(1, q0 + 1 + j, a[k] as number | null);
  });
  sh.label(q0 + 6, "Equity value", "bold");
  let equityRef: string | null = null;
  let perShareRef: string | null = null;
  if (a.bridgeCurrency !== a.currency) {
    sh.put(1, q0 + 6, `${NA}: bridge in ${a.bridgeCurrency}, cash flows in ${a.currency}; convert with a dated FX rate first`, "note");
  } else {
    equityRef = sh.calc(1, q0 + 6, `IFERROR(${ev}-B${q0 + 1}-B${q0 + 2}-B${q0 + 3}+B${q0 + 4}+B${q0 + 5},"${NA}")`, r.equity?.bridge.equityValue, "total_num");
  }
  sh.label(q0 + 7, "Diluted shares");
  const shares = sh.input(1, q0 + 7, a.dilutedShares);
  sh.label(q0 + 8, "Value per share", "bold");
  if (equityRef) perShareRef = sh.calc(1, q0 + 8, `IFERROR(IF(${shares}>0,${equityRef}/${shares},"${NA}"),"${NA}")`, r.equity?.perShare, "total_num");

  // Sensitivity: WACC × terminal growth, same steps as the app.
  const steps = [-0.01, -0.005, 0, 0.005, 0.01];
  const s0 = q0 + 10;
  header(sh, s0, "Sensitivity: enterprise value (rows: WACC; columns: terminal growth)", 0, steps.length);
  const fcffRange = `$B$${fcffRow}:$${last}$${fcffRow}`;
  const yearRange = `$B$${yearRow}:$${last}$${yearRow}`;
  steps.forEach((d, j) => sh.calc(1 + j, s0 + 1, `${G}${d < 0 ? "-" : "+"}${Math.abs(d)}`, a.terminalGrowth !== null ? a.terminalGrowth + d : undefined, "calc_pct"));
  steps.forEach((dw, i) => {
    const rr = s0 + 2 + i;
    sh.calc(0, rr, `${W}${dw < 0 ? "-" : "+"}${Math.abs(dw)}`, r.wacc !== null && r.wacc !== undefined ? r.wacc + dw : undefined, "calc_pct");
    steps.forEach((_, j) => {
      const g = `${colName(1 + j)}$${s0 + 1}`;
      const w = `$A${rr}`;
      const cell = r.grid?.[i]?.[j];
      const expected = cell ? (cell.result.ok ? cell.result.enterpriseValue : NA) : undefined;
      sh.calc(1 + j, rr, `IFERROR(IF(${w}>${g},SUMPRODUCT(${fcffRange}/(1+${w})^${yearRange})+$${last}$${fcffRow}*(1+${g})/(${w}-${g})/(1+${w})^$${last}$${yearRow},"${NA}"),"${NA}")`, expected);
    });
  });
  if (equityRef && r.equity && a.dilutedShares) {
    const p0 = s0 + 8;
    header(sh, p0, "Sensitivity: value per share (same grid; net claims held constant)", 0, steps.length);
    steps.forEach((d, j) => sh.calc(1 + j, p0 + 1, `${colName(1 + j)}${s0 + 1}`, a.terminalGrowth !== null ? a.terminalGrowth + d : undefined, "calc_pct"));
    steps.forEach((dw, i) => {
      const rr = p0 + 2 + i;
      sh.calc(0, rr, `A${s0 + 2 + i}`, r.wacc !== null && r.wacc !== undefined ? r.wacc + dw : undefined, "calc_pct");
      steps.forEach((_, j) => {
        const evCell = `${colName(1 + j)}${s0 + 2 + i}`;
        const cell = r.grid?.[i]?.[j];
        const expected = cell ? (cell.result.ok && cell.result.perShare !== null ? cell.result.perShare : NA) : undefined;
        sh.calc(1 + j, rr, `IF(ISNUMBER(${evCell}),(${evCell}-(${ev}-${equityRef}))/${shares},"${NA}")`, expected);
      });
    });
  }
  sh.freeze = "B5";
  return { sheet: sh, refs: { wacc: waccRef, ev, equity: equityRef, perShare: perShareRef, tvShare } };
}

// ---------------------------------------------------------------- Accretion / dilution

function accretionSheet(name: string, a: AccretionAssumptions, exported: Date) {
  const r = computeAccretion(a);
  const o = r.ok ? r.value : null;
  const sh = new Sheet(name);
  sh.cols = [54, 16, 16, 16, 16, 16];
  intro(sh, `Accretion/dilution — ${name}`, `${ACCRETION_TRAINING?.currency ?? "INR"} ${ACCRETION_TRAINING?.unit ?? "crore"} (shares in the same scale; EPS in currency per share)`, exported);
  header(sh, 4, "Inputs", 0, 1);
  const inputs: Array<[keyof AccretionAssumptions, string, StyleName]> = [
    ["buyerNetIncome", "Buyer net income", "input_num"],
    ["buyerDilutedShares", "Buyer diluted shares", "input_num"],
    ["buyerSharePrice", "Buyer share price", "input_num"],
    ["targetNetIncome", "Target net income", "input_num"],
    ["equityConsideration", "Equity consideration", "input_num"],
    ["fundingCash", "Funded with cash", "input_num"],
    ["fundingDebt", "Funded with new debt", "input_num"],
    ["fundingStock", "Funded with new shares", "input_num"],
    ["stockIssuePrice", "Share issue price (blank = buyer share price)", "input_num"],
    ["interestRateOnNewDebt", "Interest rate on new debt", "input_pct"],
    ["foregoneCashYield", "Foregone yield on cash", "input_pct"],
    ["pretaxSynergies", "Pre-tax synergies (run-rate)", "input_num"],
    ["incrementalRecurringCosts", "Incremental recurring costs", "input_num"],
    ["incrementalDaPpa", "Incremental D&A / PPA", "input_num"],
    ["taxRate", "Tax rate", "input_pct"],
    ["adjustmentTaxRate", "Tax rate on adjustments (blank = tax rate)", "input_pct"],
    ["adjustmentsDeductible", "Adjustments tax-deductible (1 = yes, 0 = no)", "input_int"],
    ["oneTimeCosts", "One-time costs (pre-tax, excluded from run-rate EPS)", "input_num"],
    ["transactionFees", "Transaction fees (shown separately)", "input_num"],
    ["refinancedTargetDebt", "Target debt refinanced (shown separately)", "input_num"],
  ];
  const at: Record<string, string> = {};
  inputs.forEach(([k, l, s], j) => {
    sh.label(5 + j, l);
    const v = k === "adjustmentsDeductible" ? a.adjustmentsDeductible !== false : (a[k] as number | null | undefined);
    at[k] = sh.input(1, 5 + j, v, s);
  });
  const R = (k: string) => at[k] as string;
  const c0 = 5 + inputs.length + 1;
  header(sh, c0, "Calculation", 0, 1);
  const rows: Array<[string, string, number | string | null | undefined, StyleName]> = [];
  const ref = (i: number) => `B${c0 + 1 + i}`;
  const issue = `IF(ISNUMBER(${R("stockIssuePrice")}),${R("stockIssuePrice")},${R("buyerSharePrice")})`;
  rows.push(["Funding minus consideration (must be 0)", `${R("fundingCash")}+${R("fundingDebt")}+${R("fundingStock")}-${R("equityConsideration")}`, o ? 0 : undefined, "calc_num"]);
  rows.push(["Tax rate applied to adjustments", `IF(${R("adjustmentsDeductible")}=1,IF(ISNUMBER(${R("adjustmentTaxRate")}),${R("adjustmentTaxRate")},${R("taxRate")}),0)`, o?.appliedAdjustmentTaxRate, "calc_pct"]);
  rows.push(["New shares issued", `${R("fundingStock")}/${issue}`, o?.newShares, "calc_num"]);
  rows.push(["Interest on new debt (pre-tax)", `${R("fundingDebt")}*${R("interestRateOnNewDebt")}`, o?.newInterestExpense, "calc_num"]);
  rows.push(["Foregone interest on cash (pre-tax)", `${R("fundingCash")}*${R("foregoneCashYield")}`, o?.foregoneInterestIncome, "calc_num"]);
  rows.push(["Adjustments (pre-tax)", `${R("pretaxSynergies")}-${R("incrementalRecurringCosts")}-${ref(3)}-${ref(4)}-${R("incrementalDaPpa")}`, o?.adjustmentsPreTax, "calc_num"]);
  rows.push(["Adjustments (after tax)", `${ref(5)}*(1-${ref(1)})`, o?.adjustmentsAfterTax, "calc_num"]);
  rows.push(["Combined net income", `${R("buyerNetIncome")}+${R("targetNetIncome")}+${ref(6)}`, o?.combinedNetIncome, "calc_num"]);
  rows.push(["Pro forma diluted shares", `${R("buyerDilutedShares")}+${ref(2)}`, o?.proFormaShares, "calc_num"]);
  rows.push(["Standalone buyer EPS", `${R("buyerNetIncome")}/${R("buyerDilutedShares")}`, o?.standaloneEps, "calc_num"]);
  rows.push(["Pro forma EPS", `${ref(7)}/${ref(8)}`, o?.proFormaEps, "total_num"]);
  rows.push(["Accretion / (dilution)", `IF(${ref(9)}>0,${ref(10)}/${ref(9)}-1,"${NA}: standalone EPS not positive")`, o ? (o.accretionPct ?? `${NA}: standalone EPS not positive`) : undefined, "total_pct"]);
  rows.push(["EPS change per share", `${ref(10)}-${ref(9)}`, o?.accretionPerShare, "calc_num"]);
  rows.push(["One-time costs (after tax)", `N(${R("oneTimeCosts")})*(1-${ref(1)})`, o?.oneTimeCostsAfterTax, "calc_num"]);
  rows.push(["Pro forma EPS including one-time costs", `(${ref(7)}-${ref(13)})/${ref(8)}`, o?.proFormaEpsIncludingOneTime, "calc_num"]);
  rows.forEach(([l, f, e, s], i) => {
    sh.label(c0 + 1 + i, l, s.startsWith("total") ? "bold" : "label");
    sh.calc(1, c0 + 1 + i, f, e, s);
  });
  const b0 = c0 + rows.length + 2;
  header(sh, b0, "EPS bridge: change in net income (after tax)", 0, 1);
  const t = `(1-${ref(1)})`;
  const bridge: Array<[string, string]> = [
    ["Target net income", `${R("targetNetIncome")}`],
    ["Synergies (after tax)", `${R("pretaxSynergies")}*${t}`],
    ["Recurring costs (after tax)", `-${R("incrementalRecurringCosts")}*${t}`],
    ["Interest on new debt (after tax)", `-${ref(3)}*${t}`],
    ["Foregone interest on cash (after tax)", `-${ref(4)}*${t}`],
    ["Incremental D&A / PPA (after tax)", `-${R("incrementalDaPpa")}*${t}`],
  ];
  bridge.forEach(([l, f], i) => {
    sh.label(b0 + 1 + i, l);
    sh.calc(1, b0 + 1 + i, f, o?.epsBridge[i]?.netIncomeImpact);
  });
  // Sensitivity: accretion by synergy level × interest rate, same grid as the app.
  const s0 = b0 + bridge.length + 2;
  const mults = [0, 0.5, 1, 1.5];
  const deltas = [-0.02, -0.01, 0, 0.01, 0.02];
  header(sh, s0, "Sensitivity: accretion / (dilution) (rows: pre-tax synergies; columns: interest rate on new debt)", 0, deltas.length);
  deltas.forEach((d, j) => sh.calc(1 + j, s0 + 1, `${R("interestRateOnNewDebt")}${d < 0 ? "-" : "+"}${Math.abs(d)}`, a.interestRateOnNewDebt !== null ? (a.interestRateOnNewDebt ?? 0) + d : undefined, "calc_pct"));
  mults.forEach((m, i) => {
    const rr = s0 + 2 + i;
    sh.calc(0, rr, `${R("pretaxSynergies")}*${m}`, a.pretaxSynergies !== null ? (a.pretaxSynergies ?? 0) * m : undefined, "calc_num");
    deltas.forEach((d, j) => {
      const rate = `${colName(1 + j)}$${s0 + 1}`;
      const syn = `$A${rr}`;
      const res = computeAccretion({ ...a, pretaxSynergies: (a.pretaxSynergies ?? 0) * m, interestRateOnNewDebt: (a.interestRateOnNewDebt ?? 0) + d });
      const expected = o ? (res.ok ? (res.value.accretionPct ?? NA) : NA) : undefined;
      sh.calc(1 + j, rr, `IFERROR(IF($${ref(9).replace("B", "B$")}>0,((${R("buyerNetIncome")}+${R("targetNetIncome")}+(${syn}-${R("incrementalRecurringCosts")}-${R("fundingDebt")}*${rate}-$${ref(4).replace("B", "B$")}-${R("incrementalDaPpa")})*(1-$${ref(1).replace("B", "B$")}))/$${ref(8).replace("B", "B$")})/$${ref(9).replace("B", "B$")}-1,"${NA}"),"${NA}")`, expected, "calc_pct");
    });
  });
  sh.freeze = "B5";
  return { sheet: sh, refs: { standaloneEps: ref(9), proFormaEps: ref(10), accretion: ref(11), newShares: ref(2) } };
}

// ---------------------------------------------------------------- FIG residual income

function figSheet(name: string, a: FigAssumptions, exported: Date) {
  const r = computeFig(a);
  const ri = r.ri.ok ? r.ri.value : null;
  const sh = new Sheet(name);
  sh.cols = [46, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16];
  intro(sh, `FIG residual income — ${name}`, `${FIG_TRAINING?.currency ?? "INR"} ${FIG_TRAINING?.unit ?? "crore"}`, exported);
  header(sh, 4, "Inputs", 0, 1);
  sh.label(5, "Opening common book equity");
  sh.input(1, 5, a.openingBookEquity);
  sh.label(6, "Cost of equity");
  sh.input(1, 6, a.costOfEquity, "input_pct");
  const drivers = a.riMode === "drivers";
  const n = drivers ? a.years.length : a.directYears.length;
  const yc = (i: number) => 1 + i;
  const last = colName(yc(n - 1));
  sh.put(0, 8, drivers ? "Driver" : "Year", "header");
  for (let i = 0; i < n; i++) sh.put(yc(i), 8, i + 1, "year");
  if (drivers) {
    sh.label(9, "ROE on opening book");
    sh.label(10, "Payout ratio (of net income)");
    sh.label(11, "Capital changes (issuance +, buyback −)");
    a.years.forEach((y, i) => {
      sh.input(yc(i), 9, y.roe, "input_pct");
      sh.input(yc(i), 10, y.payoutRatio, "input_pct");
      sh.input(yc(i), 11, y.capitalChanges);
    });
  } else {
    sh.label(9, "Net income");
    sh.label(10, "Distributions to common");
    sh.label(11, "Capital changes (issuance +, buyback −)");
    a.directYears.forEach((y, i) => {
      sh.input(yc(i), 9, y.netIncome);
      sh.input(yc(i), 10, y.distributions);
      sh.input(yc(i), 11, y.capitalChanges);
    });
  }
  header(sh, 13, "Residual income", 0, n);
  const L = ["Opening book equity", "Net income", "Distributions", "Equity charge (cost of equity × opening book)", "Residual income", "Discount factor", "Present value of residual income", "Closing book equity", "ROE (net income ÷ opening book)"];
  L.forEach((l, j) => sh.label(14 + j, l));
  for (let i = 0; i < n; i++) {
    const c = colName(yc(i));
    const prev = i === 0 ? null : colName(yc(i - 1));
    const row = ri?.rows[i];
    sh.calc(yc(i), 14, i === 0 ? "$B$5" : `${prev}21`, row?.openingBook);
    sh.calc(yc(i), 15, drivers ? `${c}9*${c}14` : `${c}9`, row?.netIncome);
    sh.calc(yc(i), 16, drivers ? `${c}10*${c}15` : `${c}10`, row?.distributions);
    sh.calc(yc(i), 17, `$B$6*${c}14`, row?.equityCharge);
    sh.calc(yc(i), 18, `IF(${c}14>0,${c}15-${c}17,"${NA}: book not positive")`, row?.residualIncome);
    sh.calc(yc(i), 19, `1/(1+$B$6)^${c}$8`, row?.discountFactor, "calc_factor");
    sh.calc(yc(i), 20, `IFERROR(${c}18*${c}19,"${NA}")`, row?.pvResidualIncome);
    sh.calc(yc(i), 21, `${c}14+${c}15-${c}16+${c}11`, row?.closingBook);
    sh.calc(yc(i), 22, `IF(${c}14>0,${c}15/${c}14,"${NA}")`, row?.roe, "calc_pct");
  }
  sh.label(24, "Sum of PV of residual income");
  sh.calc(1, 24, `SUM(B20:${last}20)`, ri?.sumPvResidualIncome);
  sh.label(25, "Equity value (book + PV of residual income)", "bold");
  const equity = sh.calc(1, 25, `IF(COUNT(B20:${last}20)=${n},B5+B24,"${NA}")`, ri?.equityValue, "total_num");
  sh.label(26, "Implied price-to-book");
  const pb = sh.calc(1, 26, `IFERROR(${equity}/B5,"${NA}")`, ri?.impliedPriceToBook, "calc_mult");
  sh.put(0, 27, "Terminal assumption: no residual income after the horizon (growth that only earns the cost of equity adds no value).", "subtitle");
  header(sh, 28, "Justified P/B (steady state)", 0, 1);
  sh.label(29, "Sustainable ROE");
  sh.input(1, 29, a.justifiedRoe, "input_pct");
  sh.label(30, "Cost of equity");
  sh.input(1, 30, a.justifiedCoe, "input_pct");
  sh.label(31, "Long-run growth");
  sh.input(1, 31, a.justifiedGrowth, "input_pct");
  sh.label(32, "Justified P/B = (ROE − g) ÷ (Ke − g)", "bold");
  const jpb = sh.calc(1, 32, `IF(B30>B31,(B29-B31)/(B30-B31),"${NA}: cost of equity must exceed growth")`, r.justified.ok ? r.justified.value : a.justifiedCoe !== null && a.justifiedGrowth !== null && a.justifiedRoe !== null ? `${NA}: cost of equity must exceed growth` : undefined, "calc_mult");
  const peers = Object.entries(a.peerAssumptions).filter(([, v]) => v.pb !== null || v.roe !== null);
  if (peers.length) {
    header(sh, 34, "Your market-data assumptions for real banks (entered in the Lab; not sourced)", 0, 2);
    sh.put(0, 35, "Company ID", "bold");
    sh.put(1, 35, "P/B", "bold");
    sh.put(2, 35, "ROE", "bold");
    peers.forEach(([id, v], i) => {
      sh.put(0, 36 + i, id);
      sh.input(1, 36 + i, v.pb);
      sh.input(2, 36 + i, v.roe, "input_pct");
    });
  }
  sh.freeze = "B5";
  return { sheet: sh, refs: { equity, pb, jpb } };
}

// ---------------------------------------------------------------- Comparables

const MULTS = [
  { key: "evRevenue", label: "EV / Revenue", num: "J", den: "F" },
  { key: "evEbitda", label: "EV / EBITDA", num: "J", den: "G" },
  { key: "pe", label: "P / E", num: "D", den: "H" },
  { key: "pb", label: "P / B", num: "D", den: "I" },
] as const;

function multLabel(kind: string): string {
  return kind === "NM" ? "NM" : kind === "not_applicable" ? "excluded" : "n.a.";
}

function compsSheet(name: string, a: CompsAssumptions, exported: Date) {
  const r = computeComps(a);
  const sh = new Sheet(name);
  sh.cols = [46, 14, 24, 13, 13, 13, 13, 13, 13, 14, 12, 12, 12, 12];
  intro(sh, `Comparables — ${name}`, `${COMPS_TRAINING?.currency ?? "USD"} ${COMPS_TRAINING?.unit ?? "million"}`, exported);
  const h = 4;
  const heads = ["Peer", "Include (1/0)", "Exclusion reason", "Equity value", "Net debt", "Revenue", "EBITDA", "Net income", "Book equity", "Enterprise value", ...MULTS.map((m) => m.label)];
  heads.forEach((t, i) => sh.put(i, h, t, "header"));
  const first = h + 1;
  a.peers.forEach((p, i) => {
    const rr = first + i;
    const row = r.rows[i];
    sh.put(0, rr, p.name);
    sh.input(1, rr, p.include, "input_int");
    sh.input(2, rr, p.excludeReason || null, "input_text");
    sh.input(3, rr, p.equityValue);
    sh.input(4, rr, p.netDebt);
    sh.input(5, rr, p.revenue);
    sh.input(6, rr, p.ebitda);
    sh.input(7, rr, p.netIncome);
    sh.input(8, rr, p.bookEquity);
    sh.calc(9, rr, `IF(AND(ISNUMBER(D${rr}),ISNUMBER(E${rr})),D${rr}+E${rr},"n.a.")`, row?.ev ?? "n.a.");
    MULTS.forEach((m, j) => {
      const num = `${m.num}${rr}`;
      const den = `${m.den}${rr}`;
      const v = row ? (p.include ? row.m[m.key] : { kind: "not_applicable" as const, reason: "" }) : null;
      const expected = v ? (v.kind === "value" ? v.value : multLabel(v.kind)) : undefined;
      sh.calc(10 + j, rr, `IF(B${rr}<>1,"excluded",IF(AND(ISNUMBER(${num}),ISNUMBER(${den})),IF(${den}<=0,"NM",IF(${num}<=0,"NM",${num}/${den})),"n.a."))`, expected, "calc_mult");
    });
  });
  const lastPeer = first + a.peers.length - 1;
  const st0 = lastPeer + 2;
  const statRows: Array<[string, (rng: string) => string, keyof (typeof r.stats)["evEbitda"], StyleName]> = [
    ["Eligible peers (n)", (g) => `COUNT(${g})`, "n", "calc_int"],
    ["Mean", (g) => `IF(COUNT(${g})>0,AVERAGE(${g}),"—")`, "mean", "calc_mult"],
    ["Median", (g) => `IF(COUNT(${g})>0,MEDIAN(${g}),"—")`, "median", "calc_mult"],
    ["Lower quartile (Q1, inclusive)", (g) => `IF(COUNT(${g})>0,_xlfn.QUARTILE.INC(${g},1),"—")`, "q1", "calc_mult"],
    ["Upper quartile (Q3, inclusive)", (g) => `IF(COUNT(${g})>0,_xlfn.QUARTILE.INC(${g},3),"—")`, "q3", "calc_mult"],
    ["Minimum", (g) => `IF(COUNT(${g})>0,MIN(${g}),"—")`, "min", "calc_mult"],
    ["Maximum", (g) => `IF(COUNT(${g})>0,MAX(${g}),"—")`, "max", "calc_mult"],
  ];
  header(sh, st0, "Peer statistics (NM, n.a. and excluded peers are not counted; never treated as zero)", 0, 13);
  const statRef: Record<string, Record<string, string>> = {};
  statRows.forEach(([l, f, key, s], i) => {
    const rr = st0 + 1 + i;
    sh.label(rr, l);
    MULTS.forEach((m, j) => {
      const col = colName(10 + j);
      const stat = r.stats[m.key];
      const val = stat[key];
      const expected = key === "n" ? (val as number) : typeof val === "number" ? val : "—";
      (statRef[m.key] ??= {})[key] = sh.calc(10 + j, rr, f(`${col}${first}:${col}${lastPeer}`), expected, s);
    });
  });
  const t0 = st0 + statRows.length + 2;
  header(sh, t0, `Target: ${a.target.name}`, 0, 3);
  const tgt: Array<[keyof CompsAssumptions["target"], string]> = [
    ["revenue", "Revenue"],
    ["ebitda", "EBITDA"],
    ["netIncome", "Net income"],
    ["bookEquity", "Book equity"],
    ["netDebt", "Net debt"],
    ["dilutedShares", "Diluted shares"],
  ];
  const T: Record<string, string> = {};
  tgt.forEach(([k, l], i) => {
    sh.label(t0 + 1 + i, l);
    T[k] = sh.input(1, t0 + 1 + i, a.target[k] as number | null);
  });
  const i0 = t0 + tgt.length + 2;
  header(sh, i0, "Implied equity value", 0, 3);
  sh.put(1, i0 + 1, "Q1", "bold");
  sh.put(2, i0 + 1, "Median", "bold");
  sh.put(3, i0 + 1, "Q3", "bold");
  sh.label(i0 + 2, "From EV / EBITDA (multiple × EBITDA − net debt)");
  sh.label(i0 + 3, "From P / E (multiple × net income)");
  (["q1", "median", "q3"] as const).forEach((q, j) => {
    const mEv = statRef.evEbitda?.[q] as string;
    const mPe = statRef.pe?.[q] as string;
    const e1 = r.impliedEquityFromEbitda[q];
    const e2 = r.impliedEquityFromPe[q];
    sh.calc(1 + j, i0 + 2, `IF(AND(ISNUMBER(${mEv}),ISNUMBER(${T.ebitda}),ISNUMBER(${T.netDebt})),IF(${T.ebitda}>0,${mEv}*${T.ebitda}-${T.netDebt},"n.a."),"n.a.")`, e1 ?? "n.a.");
    sh.calc(1 + j, i0 + 3, `IF(AND(ISNUMBER(${mPe}),ISNUMBER(${T.netIncome})),IF(${T.netIncome}>0,${mPe}*${T.netIncome},"n.a."),"n.a.")`, e2 ?? "n.a.");
  });
  const b0 = i0 + 5;
  header(sh, b0, "Enterprise value bridge (market values; leases excluded from debt)", 0, 1);
  const br: Array<[keyof CompsAssumptions["bridge"], string]> = [
    ["equityValue", "Equity value"],
    ["debt", "Interest-bearing debt (+)"],
    ["preferredEquity", "Preferred equity (+)"],
    ["nonControllingInterests", "Non-controlling interests (+)"],
    ["excessCash", "Excess cash (−)"],
    ["nonOperatingInvestments", "Non-operating investments (−)"],
    ["disclosedEv", "Disclosed EV (for reconciliation)"],
  ];
  const B: Record<string, string> = {};
  br.forEach(([k, l], i) => {
    sh.label(b0 + 1 + i, l);
    B[k] = sh.input(1, b0 + 1 + i, a.bridge[k]);
  });
  const evRow = b0 + br.length + 1;
  sh.label(evRow, "Enterprise value", "bold");
  const evRef = sh.calc(1, evRow, `IF(COUNT(${B.equityValue},${B.debt},${B.preferredEquity},${B.nonControllingInterests},${B.excessCash},${B.nonOperatingInvestments})=6,${B.equityValue}+${B.debt}+${B.preferredEquity}+${B.nonControllingInterests}-${B.excessCash}-${B.nonOperatingInvestments},"${NA}: bridge incomplete (absent debt is not zero debt)")`, r.bridge.ok ? r.bridge.value.enterpriseValue : `${NA}: bridge incomplete (absent debt is not zero debt)`, "total_num");
  sh.label(evRow + 1, "Difference from disclosed EV");
  sh.calc(1, evRow + 1, `IF(AND(ISNUMBER(${evRef}),ISNUMBER(${B.disclosedEv})),IF(${B.disclosedEv}<>0,${evRef}-${B.disclosedEv},"${NA}"),"${NA}")`, r.recon?.ok ? r.recon.value.difference : NA);
  sh.label(evRow + 2, "Difference (% of disclosed EV)");
  sh.calc(1, evRow + 2, `IFERROR(IF(AND(ISNUMBER(${evRef}),ISNUMBER(${B.disclosedEv})),(${evRef}-${B.disclosedEv})/${B.disclosedEv},"${NA}"),"${NA}")`, r.recon?.ok ? r.recon.value.differencePct : NA, "calc_pct");
  const p0 = evRow + 4;
  header(sh, p0, "Offer premium", 0, 1);
  sh.label(p0 + 1, "Offer price per share");
  const offer = sh.input(1, p0 + 1, a.premium.offerPrice);
  sh.label(p0 + 2, "Unaffected reference price");
  const refP = sh.input(1, p0 + 2, a.premium.refPrice);
  sh.label(p0 + 3, "Reference price date");
  const refD = sh.input(1, p0 + 3, excelDate(a.premium.refDate), "input_date");
  sh.label(p0 + 4, "Announcement date");
  const annD = sh.input(1, p0 + 4, excelDate(a.premium.announcementDate), "input_date");
  sh.label(p0 + 5, "Reference convention");
  sh.input(1, p0 + 5, a.premium.convention, "input_text");
  sh.label(p0 + 6, "Offer premium", "bold");
  const affected = `${NA}: reference must be dated before the announcement`;
  sh.calc(1, p0 + 6, `IF(AND(ISNUMBER(${offer}),ISNUMBER(${refP}),ISNUMBER(${refD}),ISNUMBER(${annD})),IF(AND(${offer}>0,${refP}>0),IF(${refD}<${annD},${offer}/${refP}-1,"${affected}"),"${NA}"),"${NA}")`, r.premium ? (r.premium.ok ? r.premium.value.premium : r.premium.errors[0]?.code === "AFFECTED_REFERENCE" ? affected : NA) : NA, "total_pct");
  const m0 = p0 + 8;
  header(sh, m0, "Value implied by a stake price", 0, 1);
  sh.label(m0 + 1, "Consideration for the stake");
  const cons = sh.input(1, m0 + 1, a.minority.consideration);
  sh.label(m0 + 2, "Stake acquired (%, 0–100)");
  const stake = sh.input(1, m0 + 2, a.minority.stakePct);
  sh.label(m0 + 3, "Structure (secondary or primary)");
  const struct = sh.input(1, m0 + 3, a.minority.structure, "input_text");
  const valid = `AND(ISNUMBER(${cons}),ISNUMBER(${stake}),${cons}>0,${stake}>0,${stake}<=100,OR(${struct}="secondary",${stake}<100))`;
  sh.label(m0 + 4, "Implied 100% equity value (post-money if primary)", "bold");
  const implied = sh.calc(1, m0 + 4, `IF(${valid},${cons}/(${stake}/100),"${NA}: invalid stake or consideration")`, r.minority.ok ? r.minority.value.impliedEquityValue : `${NA}: invalid stake or consideration`, "total_num");
  sh.label(m0 + 5, "Pre-money value (primary only)");
  sh.calc(1, m0 + 5, `IF(AND(ISNUMBER(${implied}),${struct}="primary"),${implied}-${cons},"${NA}")`, r.minority.ok && r.minority.value.preMoney !== null ? r.minority.value.preMoney : NA);
  sh.freeze = "B5";
  return { sheet: sh, refs: { evEbitdaMedian: statRef.evEbitda?.median as string, peMedian: statRef.pe?.median as string, n: statRef.evEbitda?.n as string, impliedMedian: `C${i0 + 2}`, ev: evRef } };
}

// ---------------------------------------------------------------- workbook

function aboutSheet(model: LabModel, exported: Date, trainingTitle: string | undefined): Sheet {
  const sh = new Sheet("About");
  sh.cols = [110];
  const lines: Array<[string, StyleName]> = [
    ["Finance Desk — Lab export", "title"],
    [`Model: ${model === "dcf" ? "Discounted cash flow" : model === "accretion" ? "Accretion/dilution" : model === "fig" ? "FIG residual income and justified P/B" : "Trading comparables"}. Exported ${exported.toISOString().replace(/\.\d{3}Z$/, "Z")}. Calculation version ${CALC_VERSION}.`, "label"],
    [trainingTitle ? `Starting inputs come from a fictional training example (${trainingTitle}); your edits are assumptions. No figure in this workbook is a sourced research value.` : "Inputs are assumptions entered in the Lab. No figure in this workbook is a sourced research value.", "label"],
    ["Blue cells are inputs; black cells are formulas that mirror the app's deterministic calculations. Change an input and the model recalculates.", "label"],
    ["Rates and percentages are stored as decimals (0.10 = 10%). Amounts keep one currency and scale; nothing is converted.", "label"],
    ['"n/a", "NM" (not meaningful), "excluded" and "—" mark values that cannot be calculated; they are never treated as zero.', "label"],
    ["The Summary sheet links to each scenario sheet, so scenarios stay comparable after edits.", "label"],
    ["For learning and analysis only; not investment advice.", "note"],
  ];
  lines.forEach(([t, s], i) => sh.put(0, i + 1, t, s));
  return sh;
}

export interface LabWorkbook {
  bytes: Uint8Array;
  checks: WorkbookCheck[];
  sheetNames: string[];
  fileName: string;
}

export function labWorkbook<T>(model: LabModel, scenarios: Array<LabScenario<T>>, opts: { exported?: Date; omitCachedValues?: boolean; plainStyles?: boolean } = {}): LabWorkbook {
  const exported = opts.exported ?? new Date();
  const taken = new Set<string>(["summary", "about"]);
  const sheets: Sheet[] = [];
  const summary = new Sheet("Summary");
  summary.cols = [30, 20, 20, 22, 26, 22];
  const heads: Record<LabModel, string[]> = {
    dcf: ["Scenario", "WACC", "Enterprise value", "Equity value", "Value per share", "Terminal share of EV"],
    accretion: ["Scenario", "Standalone EPS", "Pro forma EPS", "Accretion / (dilution)", "New shares"],
    fig: ["Scenario", "Equity value", "Implied P/B", "Justified P/B"],
    comparables: ["Scenario", "EV/EBITDA median", "P/E median", "Eligible peers (EV/EBITDA)", "Implied equity (median EV/EBITDA)", "EV from bridge"],
  };
  const styles: Record<LabModel, StyleName[]> = {
    dcf: ["calc_pct", "calc_num", "calc_num", "calc_num", "calc_pct"],
    accretion: ["calc_num", "calc_num", "calc_pct", "calc_num"],
    fig: ["calc_num", "calc_mult", "calc_mult"],
    comparables: ["calc_mult", "calc_mult", "calc_int", "calc_num", "calc_num"],
  };
  summary.put(0, 1, "Scenario summary (linked to the scenario sheets)", "title");
  heads[model].forEach((t, i) => summary.put(i, 3, t, "header"));
  scenarios.forEach((sc, i) => {
    const name = safeSheetName(sc.name, taken);
    let refs: Array<string | null>;
    let sheet: Sheet;
    if (model === "dcf") {
      const out = dcfSheet(name, sc.assumptions as DcfAssumptions, exported);
      sheet = out.sheet;
      refs = [out.refs.wacc, out.refs.ev, out.refs.equity, out.refs.perShare, out.refs.tvShare];
    } else if (model === "accretion") {
      const out = accretionSheet(name, sc.assumptions as AccretionAssumptions, exported);
      sheet = out.sheet;
      refs = [out.refs.standaloneEps, out.refs.proFormaEps, out.refs.accretion, out.refs.newShares];
    } else if (model === "fig") {
      const out = figSheet(name, sc.assumptions as FigAssumptions, exported);
      sheet = out.sheet;
      refs = [out.refs.equity, out.refs.pb, out.refs.jpb];
    } else {
      const out = compsSheet(name, sc.assumptions as CompsAssumptions, exported);
      sheet = out.sheet;
      refs = [out.refs.evEbitdaMedian, out.refs.peMedian, out.refs.n, out.refs.impliedMedian, out.refs.ev];
    }
    sheets.push(sheet);
    const rr = 4 + i;
    summary.put(0, rr, sc.name, "bold");
    refs.forEach((ref, j) => {
      if (!ref) {
        summary.put(1 + j, rr, NA, "calc_text");
        return;
      }
      const src = sheet.checks.find((c) => c.ref === ref);
      summary.calc(1 + j, rr, sheetRef(name, ref), src?.expected, styles[model][j], `${sc.name}: ${heads[model][1 + j]}`);
    });
  });
  const training = model === "dcf" ? DCF_TRAINING : model === "accretion" ? ACCRETION_TRAINING : model === "fig" ? FIG_TRAINING : COMPS_TRAINING;
  const all = [summary, ...sheets, aboutSheet(model, exported, training?.title)];
  const bytes = buildXlsx(
    all.map((s) => s.spec()),
    { title: `Finance Desk Lab — ${model}`, created: exported, omitCachedValues: opts.omitCachedValues, plainStyles: opts.plainStyles },
  );
  return { bytes, checks: all.flatMap((s) => s.checks), sheetNames: all.map((s) => s.name), fileName: `finance-lab-${model}-${exported.toISOString().slice(0, 10)}.xlsx` };
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
