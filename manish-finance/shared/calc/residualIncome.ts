import { type CalcIssue, type CalcResult, fail, ok, requireNumbers } from "./result";

/**
 * Residual-income (excess-return) equity model for a bank-style training case.
 *
 *   residual income[t] = NI[t] − cost of equity × opening book equity[t]
 *   equity value       = opening common book equity + Σ PV(residual income[t])
 *   closing book[t]    = opening book[t] + NI[t] − common distributions[t] + capital changes[t]
 *
 * Clean-surplus simplification: every change in book equity flows through NI, distributions or an
 * explicitly specified capital change. Terminal assumption: no residual income after the horizon
 * (finite horizon, no further excess return). Values an equity stake, not an enterprise.
 */

export interface RiYearInput {
  netIncome: number | null;
  distributions: number | null;
  /** Specified capital changes (issuance positive, buyback negative) and other explicitly listed adjustments. */
  capitalChanges: number | null;
}

export interface RiInput {
  openingBookEquity: number | null;
  costOfEquity: number | null;
  years: RiYearInput[];
}

export interface RiRow {
  year: number;
  openingBook: number;
  netIncome: number;
  roe: number;
  equityCharge: number;
  residualIncome: number;
  distributions: number;
  capitalChanges: number;
  closingBook: number;
  discountFactor: number;
  pvResidualIncome: number;
}

export interface RiOutput {
  rows: RiRow[];
  sumPvResidualIncome: number;
  equityValue: number;
  impliedPriceToBook: number;
  terminalAssumption: "no_residual_income_after_horizon";
}

export function residualIncomeValuation(input: RiInput): CalcResult<RiOutput> {
  const errors: CalcIssue[] = requireNumbers({ openingBookEquity: input.openingBookEquity, costOfEquity: input.costOfEquity });
  if (input.years.length < 1 || input.years.length > 10) {
    errors.push({ code: "INVALID_HORIZON", message: "Use a forecast horizon of 1–10 years (3–5 recommended)." });
  }
  input.years.forEach((y, i) =>
    errors.push(
      ...requireNumbers({
        [`years[${i}].netIncome`]: y.netIncome,
        [`years[${i}].distributions`]: y.distributions,
        [`years[${i}].capitalChanges`]: y.capitalChanges,
      }),
    ),
  );
  if (errors.length) return fail(errors);
  const ke = input.costOfEquity as number;
  if (ke <= 0 || ke >= 1) return fail({ code: "INVALID_COST_OF_EQUITY", field: "costOfEquity", message: "Cost of equity must be between 0% and 100% (exclusive)." });
  let book = input.openingBookEquity as number;
  if (book <= 0) return fail({ code: "INVALID_BOOK_EQUITY", field: "openingBookEquity", message: "Opening book equity must be positive." });
  const opening = book;
  const rows: RiRow[] = [];
  const warnings: CalcIssue[] = [];
  let sum = 0;
  for (const [i, y] of input.years.entries()) {
    // ROE and the equity charge are undefined on zero or negative book equity: stop rather than
    // return Infinity/NaN or a meaningless value.
    if (book <= 0) {
      return fail({
        code: "NON_POSITIVE_OPENING_BOOK",
        field: `years[${i}]`,
        message: `Opening book equity for year ${i + 1} is ${book === 0 ? "zero" : "negative"} after the year ${i} loss or distributions, so ROE and the equity charge are undefined. Add a capital injection in year ${i}, reduce the loss or distributions, or end the horizon at year ${i}.`,
      });
    }
    const ni = y.netIncome as number;
    const dist = y.distributions as number;
    const cap = y.capitalChanges as number;
    const equityCharge = ke * book;
    const ri = ni - equityCharge;
    const df = 1 / (1 + ke) ** (i + 1);
    const pv = ri * df;
    const closing = book + ni - dist + cap;
    rows.push({ year: i + 1, openingBook: book, netIncome: ni, roe: ni / book, equityCharge, residualIncome: ri, distributions: dist, capitalChanges: cap, closingBook: closing, discountFactor: df, pvResidualIncome: pv });
    if (closing <= 0) warnings.push({ code: "NON_POSITIVE_BOOK", message: `Closing book equity in year ${i + 1} is zero or negative; the bank would need new capital.` });
    sum += pv;
    book = closing;
  }
  const equityValue = opening + sum;
  const finite = [equityValue, sum, ...rows.flatMap((r) => [r.roe, r.equityCharge, r.residualIncome, r.closingBook, r.pvResidualIncome])].every(Number.isFinite);
  if (!finite) return fail({ code: "NOT_FINITE", message: "The inputs produce a non-finite result; check the magnitudes entered." });
  warnings.push({
    code: "FINITE_HORIZON",
    message: "Terminal assumption: no residual income after the forecast horizon. Growth that earns only the cost of equity adds no value.",
  });
  if (rows.some((r) => r.roe > 0.25)) {
    warnings.push({ code: "HIGH_ROE", message: "An ROE above 25% can reflect leverage, risk or temporary conditions; a high accounting ROE alone does not prove value." });
  }
  return ok({ rows, sumPvResidualIncome: sum, equityValue, impliedPriceToBook: equityValue / opening, terminalAssumption: "no_residual_income_after_horizon" }, warnings);
}

export interface RiDriverInput {
  openingBookEquity: number | null;
  costOfEquity: number | null;
  /** Per-year ROE on opening book and payout ratio of NI distributed to common shareholders. */
  years: Array<{ roe: number | null; payoutRatio: number | null; capitalChanges: number | null }>;
}

/** Driver mode: NI[t] = ROE[t] × opening book[t]; distributions = payout × NI. Shows why growth consumes capital. */
export function residualIncomeFromDrivers(input: RiDriverInput): CalcResult<RiOutput> {
  const errors: CalcIssue[] = requireNumbers({ openingBookEquity: input.openingBookEquity, costOfEquity: input.costOfEquity });
  input.years.forEach((y, i) =>
    errors.push(...requireNumbers({ [`years[${i}].roe`]: y.roe, [`years[${i}].payoutRatio`]: y.payoutRatio, [`years[${i}].capitalChanges`]: y.capitalChanges })),
  );
  if (errors.length) return fail(errors);
  let book = input.openingBookEquity as number;
  const years: RiYearInput[] = [];
  for (const y of input.years) {
    const payout = y.payoutRatio as number;
    if (payout < 0 || payout > 1.5) return fail({ code: "INVALID_PAYOUT", message: "Payout ratio should be between 0% and 150%." });
    const ni = (y.roe as number) * book;
    const dist = payout * ni;
    years.push({ netIncome: ni, distributions: dist, capitalChanges: y.capitalChanges });
    book = book + ni - dist + (y.capitalChanges as number);
  }
  return residualIncomeValuation({ openingBookEquity: input.openingBookEquity, costOfEquity: input.costOfEquity, years });
}

/** Justified P/B for steady state: (ROE − g) / (Ke − g). Used only as an explanatory comparison. */
export function justifiedPriceToBook(roe: number | null, costOfEquity: number | null, growth: number | null): CalcResult<number> {
  const errors = requireNumbers({ roe, costOfEquity, growth });
  if (errors.length) return fail(errors);
  const ke = costOfEquity as number;
  const g = growth as number;
  if (ke <= g) return fail({ code: "KE_NOT_ABOVE_GROWTH", message: "Cost of equity must exceed growth for a steady-state P/B." });
  return ok(((roe as number) - g) / (ke - g));
}
