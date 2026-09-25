import type { DealSummary } from "./api";
import { dealInGeo, type GeoMode, type GeoView } from "./geo";
import { toBase, type ScaleUnit } from "./money/units";
import type { DealFilters } from "./schemas/private";

/**
 * Deal filtering, sorting and URL (de)serialisation shared by the API, CSV export and the browser.
 * Filters are public research parameters and never contain private note text.
 */

export const SORT_FIELDS = ["announced", "status", "acquirer", "target", "sector", "value", "updated"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDir = "asc" | "desc";

export interface DealQuery extends DealFilters {
  sort?: SortField;
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

const LIST_KEYS = ["sector", "subsector", "buyerType", "dealType", "status", "payment"] as const;
const SCALAR_KEYS = ["q", "geo", "geoMode", "from", "to", "crossBorder", "value", "autopsy", "sort", "dir"] as const;

export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

export function dealSearchText(d: DealSummary): string {
  return normalizeSearchText(
    [d.title, ...d.aliases, d.acquirer.name, d.target.name, d.subsector, ...d.adviserNames, ...d.tags].join(" "),
  );
}

export function matchesFilters(d: DealSummary, f: DealFilters, searchText?: string): boolean {
  if (f.q) {
    const terms = normalizeSearchText(f.q).split(" ").filter(Boolean);
    const hay = searchText ?? dealSearchText(d);
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  if (f.sector?.length && !f.sector.includes(d.sector)) return false;
  if (f.subsector?.length && !f.subsector.includes(d.subsector)) return false;
  if (f.geo && !dealInGeo(d.target.country, d.acquirer.country, f.geo as GeoView, (f.geoMode ?? "either") as GeoMode)) return false;
  if (f.buyerType?.length && !f.buyerType.includes(d.buyerType)) return false;
  if (f.dealType?.length && !f.dealType.includes(d.dealType)) return false;
  if (f.status?.length && !f.status.includes(d.status)) return false;
  if (f.payment?.length && !d.paymentMix.some((p) => f.payment?.includes(p))) return false;
  if (f.from && d.announced.date < f.from) return false;
  if (f.to && d.announced.date > f.to) return false;
  if (f.crossBorder === "yes" && !d.crossBorder) return false;
  if (f.crossBorder === "no" && d.crossBorder) return false;
  if (f.value === "disclosed" && !d.valueDisclosed) return false;
  if (f.value === "undisclosed" && d.valueDisclosed) return false;
  if (f.autopsy === "yes" && !d.hasAutopsy) return false;
  return true;
}

/**
 * Value sorting compares only within the same currency and basis; mixed currencies sort by currency
 * code first so no implicit FX conversion happens. Undisclosed values always sort last.
 */
function compareValue(a: DealSummary, b: DealSummary): number {
  const ha = a.headline;
  const hb = b.headline;
  if (!ha && !hb) return 0;
  if (!ha) return 1;
  if (!hb) return -1;
  if (ha.currency !== hb.currency) return ha.currency.localeCompare(hb.currency);
  return toBase({ amount: ha.amount, currency: ha.currency, unit: ha.unit as ScaleUnit }) - toBase({ amount: hb.amount, currency: hb.currency, unit: hb.unit as ScaleUnit });
}

const STATUS_ORDER = ["rumoured", "proposed", "announced", "pending_approvals", "approved", "completed", "withdrawn", "terminated"];

export function sortDeals(items: DealSummary[], sort: SortField = "announced", dir: SortDir = "desc"): DealSummary[] {
  const mul = dir === "asc" ? 1 : -1;
  const cmp = (a: DealSummary, b: DealSummary): number => {
    switch (sort) {
      case "announced":
        return a.announced.date.localeCompare(b.announced.date);
      case "status":
        return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      case "acquirer":
        return a.acquirer.name.localeCompare(b.acquirer.name);
      case "target":
        return a.target.name.localeCompare(b.target.name);
      case "sector":
        return a.sector.localeCompare(b.sector) || a.subsector.localeCompare(b.subsector);
      case "value":
        return compareValue(a, b);
      case "updated":
        return a.lastChangedAt.localeCompare(b.lastChangedAt);
      default:
        return 0;
    }
  };
  return [...items].sort((a, b) => {
    if (sort === "value") {
      // Undisclosed values stay last regardless of direction.
      if (!a.headline && b.headline) return 1;
      if (a.headline && !b.headline) return -1;
    }
    return cmp(a, b) * mul || a.id.localeCompare(b.id);
  });
}

export function parseDealQuery(params: URLSearchParams): { query: DealQuery; errors: string[] } {
  const errors: string[] = [];
  const q: DealQuery = {};
  for (const k of LIST_KEYS) {
    const raw = params.getAll(k).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    if (raw.length) (q as Record<string, unknown>)[k] = [...new Set(raw)].slice(0, 20);
  }
  for (const k of SCALAR_KEYS) {
    const v = params.get(k);
    if (v !== null && v !== "") (q as Record<string, unknown>)[k] = v.slice(0, 120);
  }
  if (q.sort && !(SORT_FIELDS as readonly string[]).includes(q.sort)) {
    errors.push(`Unsupported sort field "${q.sort}".`);
    delete q.sort;
  }
  if (q.dir && q.dir !== "asc" && q.dir !== "desc") {
    errors.push("dir must be asc or desc.");
    delete q.dir;
  }
  if (q.geo && !["india", "apac", "global"].includes(q.geo)) {
    errors.push("geo must be india, apac or global.");
    delete q.geo;
  }
  if (q.geoMode && !["target", "acquirer", "either"].includes(q.geoMode)) {
    errors.push("geoMode must be target, acquirer or either.");
    delete q.geoMode;
  }
  for (const k of ["from", "to"] as const) {
    if (q[k] && !/^\d{4}-\d{2}-\d{2}$/.test(q[k] as string)) {
      errors.push(`${k} must be YYYY-MM-DD.`);
      delete q[k];
    }
  }
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  q.page = Number.isInteger(page) && page >= 1 ? page : 1;
  q.pageSize = Number.isInteger(pageSize) && pageSize >= 1 ? Math.min(pageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { query: q, errors };
}

export function dealQueryToParams(q: DealQuery, opts: { includePaging?: boolean } = {}): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of LIST_KEYS) {
    const v = q[k];
    if (v?.length) p.set(k, v.join(","));
  }
  for (const k of SCALAR_KEYS) {
    const v = q[k as keyof DealQuery];
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  if (opts.includePaging) {
    if (q.page && q.page > 1) p.set("page", String(q.page));
    if (q.pageSize && q.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(q.pageSize));
  }
  return p;
}

export function filtersOnly(q: DealQuery): DealFilters {
  const { sort: _s, dir: _d, page: _p, pageSize: _ps, ...f } = q;
  return f;
}

export function isEmptyFilter(f: DealFilters): boolean {
  return Object.values(f).every((v) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
}
