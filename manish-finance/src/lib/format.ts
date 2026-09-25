import type { HeadlineValue } from "../../shared/api";
import { type DateValue, formatDateValue, formatTimestamp } from "../../shared/dates";
import { formatAsReported, formatMoney, type NumberSystem, type ScaleUnit } from "../../shared/money/units";
import { VALUE_BASIS_SHORT } from "../../shared/labels";

export { formatDateValue, formatTimestamp };

export function money(amount: number | null | undefined, currency: string | null | undefined, unit: string | null | undefined, system: NumberSystem = "indian"): string {
  if (amount === null || amount === undefined || !currency || !unit) return "Undisclosed";
  return formatMoney({ amount, currency, unit: unit as ScaleUnit }, { inrSystem: system });
}

export function asReported(amount: number | null | undefined, currency: string | null | undefined, unit: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency || !unit) return "—";
  return formatAsReported({ amount, currency, unit: unit as ScaleUnit });
}

export function headlineText(h: HeadlineValue | null, system: NumberSystem = "indian"): { value: string; basis: string } {
  if (!h) return { value: "Undisclosed", basis: "" };
  return { value: money(h.amount, h.currency, h.unit, system), basis: `${VALUE_BASIS_SHORT[h.valueBasis]}${h.ownershipPct !== null && h.ownershipPct !== 100 ? ` · ${h.ownershipPct}%` : ""}` };
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function ratioPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function multiple(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}×`;
}

export function dateLabel(v: DateValue | string | null | undefined): string {
  return formatDateValue(v ?? null);
}

export function monogram(name: string): string {
  const words = name
    .replace(/\b(limited|ltd|inc|corp|corporation|company|co|plc|ag|sa|nv|holdings?|group|the)\b\.?/gi, "")
    .split(/[\s&/.-]+/)
    .filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0] ?? name).slice(0, 2);
  return letters.toUpperCase();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}
