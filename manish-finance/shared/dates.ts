/**
 * Date helpers. Timestamps are stored in UTC (ISO 8601). Date-only values (announcements, due dates)
 * stay as YYYY-MM-DD strings with an explicit precision and are never turned into a midnight timestamp.
 */

export type DatePrecision = "day" | "month" | "quarter" | "year";

export interface DateValue {
  /** YYYY-MM-DD (for month precision use the first day, for year use Jan 1). */
  date: string;
  precision: DatePrecision;
}

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at `now` in `timeZone`, as YYYY-MM-DD. Uses the server clock, not the client clock. */
export function localDate(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Calendar arithmetic on a date-only string (timezone-independent). */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats a date-only value honouring its precision ("Mar 2023", "Q1 2023", "2023"). */
export function formatDateValue(v: DateValue | string | null | undefined): string {
  if (!v) return "—";
  const dv: DateValue = typeof v === "string" ? { date: v, precision: "day" } : v;
  const m = DATE_RE.exec(dv.date);
  if (!m) return dv.date;
  const y = m[1];
  const mo = Number(m[2]);
  const d = Number(m[3]);
  switch (dv.precision) {
    case "year":
      return `${y}`;
    case "quarter":
      return `Q${Math.floor((mo - 1) / 3) + 1} ${y}`;
    case "month":
      return `${MONTHS[mo - 1]} ${y}`;
    default:
      return `${d} ${MONTHS[mo - 1]} ${y}`;
  }
}

/** Formats a UTC timestamp in the user's timezone with an explicit zone label. */
export function formatTimestamp(iso: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const s = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const zone = timeZone === "Asia/Kolkata" ? "IST" : timeZone;
  return `${s} ${zone}`;
}

export function relativeAge(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 0) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function compareDateValues(a: DateValue | null | undefined, b: DateValue | null | undefined): number {
  const x = a?.date ?? "";
  const y = b?.date ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}
