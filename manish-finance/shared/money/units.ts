/**
 * Currency, scale and unit handling.
 *
 * Amounts are stored as { amount, currency, unit } exactly as reported (e.g. 26,850 INR crore).
 * Normalised base values (amount × unit multiplier) are computed on demand and never replace the
 * reported figure. Conversions between currencies always carry the FX pair, rate, date and method.
 */

export type ScaleUnit = "one" | "thousand" | "lakh" | "million" | "crore" | "billion" | "trillion";

export const UNIT_MULTIPLIER: Record<ScaleUnit, number> = {
  one: 1,
  thousand: 1e3,
  lakh: 1e5,
  million: 1e6,
  crore: 1e7,
  billion: 1e9,
  trillion: 1e12,
};

export const UNIT_LABEL: Record<ScaleUnit, string> = {
  one: "",
  thousand: "thousand",
  lakh: "lakh",
  million: "million",
  crore: "crore",
  billion: "billion",
  trillion: "trillion",
};

export interface Money {
  amount: number;
  currency: string;
  unit: ScaleUnit;
}

export function toBase(m: Money): number {
  return m.amount * UNIT_MULTIPLIER[m.unit];
}

export function rescale(m: Money, unit: ScaleUnit): Money {
  return { amount: toBase(m) / UNIT_MULTIPLIER[unit], currency: m.currency, unit };
}

export type FxSourceKind = "assumed" | "sourced";

export interface FxRate {
  /** e.g. { from: "USD", to: "INR", rate: 83 } means 1 USD = 83 INR. */
  from: string;
  to: string;
  rate: number;
  /** Date the rate applies to (YYYY-MM-DD). */
  rateDate: string;
  sourceKind: FxSourceKind;
  /** Evidence ID when sourced; description when assumed. */
  sourceRef: string;
  method: "spot_on_rate_date" | "average_for_period" | "user_assumption";
}

export interface ConvertedMoney {
  original: Money;
  converted: Money;
  fx: FxRate;
  label: string;
}

export class FxError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Converts using an explicit dated rate. Historical deal terms are never silently restated at today's FX. */
export function convertMoney(m: Money, fx: FxRate, targetUnit?: ScaleUnit): ConvertedMoney {
  if (m.currency === fx.to && fx.from !== fx.to) {
    throw new FxError("FX_DIRECTION", `Amount is already in ${fx.to}; use the inverse pair to convert from ${fx.to}.`);
  }
  if (m.currency !== fx.from) {
    throw new FxError("FX_PAIR_MISMATCH", `FX pair ${fx.from}/${fx.to} does not apply to an amount in ${m.currency}.`);
  }
  if (!Number.isFinite(fx.rate) || fx.rate <= 0) throw new FxError("FX_INVALID_RATE", "FX rate must be a positive number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fx.rateDate)) throw new FxError("FX_INVALID_DATE", "FX rate date must be YYYY-MM-DD.");
  const base = toBase(m) * fx.rate;
  const unit = targetUnit ?? m.unit;
  const converted: Money = { amount: base / UNIT_MULTIPLIER[unit], currency: fx.to, unit };
  const label =
    fx.sourceKind === "assumed"
      ? `Converted at an assumed ${fx.from}/${fx.to} rate of ${fx.rate} (${fx.rateDate}); assumed FX, not current FX`
      : `Converted at ${fx.from}/${fx.to} ${fx.rate} on ${fx.rateDate} (sourced)`;
  return { original: m, converted, fx, label };
}

/** Groups amounts by currency; no cross-currency total is produced without a documented conversion. */
export function totalsByCurrency(items: Money[], unitFor: (currency: string) => ScaleUnit): Array<{ currency: string; total: Money; count: number }> {
  const map = new Map<string, { base: number; count: number }>();
  for (const m of items) {
    const cur = map.get(m.currency) ?? { base: 0, count: 0 };
    cur.base += toBase(m);
    cur.count += 1;
    map.set(m.currency, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, v]) => {
      const unit = unitFor(currency);
      return { currency, total: { amount: v.base / UNIT_MULTIPLIER[unit], currency, unit }, count: v.count };
    });
}

export type NumberSystem = "indian" | "international";

const CURRENCY_SYMBOL: Record<string, string> = { INR: "₹", USD: "US$", EUR: "€", GBP: "£", JPY: "¥", SGD: "S$", AUD: "A$", CHF: "CHF ", AED: "AED ", HKD: "HK$", TWD: "NT$", CNY: "CN¥", KRW: "₩", CAD: "C$" };

export function currencyPrefix(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? `${currency} `;
}

function pickUnitIndian(base: number): ScaleUnit {
  const a = Math.abs(base);
  if (a >= 1e7) return "crore";
  if (a >= 1e5) return "lakh";
  return "one";
}

function pickUnitInternational(base: number): ScaleUnit {
  const a = Math.abs(base);
  if (a >= 1e12) return "trillion";
  if (a >= 1e9) return "billion";
  if (a >= 1e6) return "million";
  if (a >= 1e3) return "thousand";
  return "one";
}

function trimNumber(x: number, maxDigits: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits, minimumFractionDigits: 0 }).format(x);
}

/**
 * Formats a Money value for display. INR uses Indian units (lakh/crore, with lakh crore for very large
 * values) unless the user prefers international units; other currencies use international units.
 */
export function formatMoney(m: Money, opts: { inrSystem?: NumberSystem; digits?: number } = {}): string {
  const base = toBase(m);
  const digits = opts.digits ?? 2;
  const indian = m.currency === "INR" && (opts.inrSystem ?? "indian") === "indian";
  if (indian) {
    const unit = pickUnitIndian(base);
    const amount = base / UNIT_MULTIPLIER[unit];
    if (unit === "crore" && Math.abs(amount) >= 1e5) {
      return `${currencyPrefix("INR")}${trimNumber(amount / 1e5, digits, "en-IN")} lakh crore`;
    }
    const label = UNIT_LABEL[unit];
    return `${currencyPrefix("INR")}${trimNumber(amount, digits, "en-IN")}${label ? ` ${label}` : ""}`;
  }
  const unit = pickUnitInternational(base);
  const amount = base / UNIT_MULTIPLIER[unit];
  const label = UNIT_LABEL[unit];
  return `${currencyPrefix(m.currency)}${trimNumber(amount, digits, "en-US")}${label ? ` ${label}` : ""}`;
}

/** Formats exactly as reported (e.g. "₹26,850 crore"), without rescaling. */
export function formatAsReported(m: Money): string {
  const locale = m.currency === "INR" ? "en-IN" : "en-US";
  const label = UNIT_LABEL[m.unit];
  return `${currencyPrefix(m.currency)}${trimNumber(m.amount, 4, locale)}${label ? ` ${label}` : ""}`;
}

/** Percentage points vs basis points vs relative change for ratios expressed as decimals. */
export function ratioChange(from: number, to: number): { percentagePoints: number; bps: number; relative: number | null } {
  const pp = (to - from) * 100;
  return {
    percentagePoints: roundTo(pp, 10),
    bps: roundTo(pp * 100, 8),
    relative: from !== 0 ? (to - from) / Math.abs(from) : null,
  };
}

export function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function formatPercent(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function formatSignedBps(fromRatio: number, toRatio: number): string {
  const c = ratioChange(fromRatio, toRatio);
  const sign = c.bps > 0 ? "+" : c.bps < 0 ? "−" : "";
  return `${sign}${Math.abs(c.percentagePoints).toFixed(2).replace(/\.?0+$/, "")} pp (${sign}${Math.abs(c.bps).toFixed(0)} bps)`;
}
