/**
 * Geography helpers. Views overlap by design: APAC includes India and Global includes both, so
 * counts from different views must never be summed as if they were separate markets.
 */

export type GeoView = "india" | "apac" | "global";
export type GeoMode = "target" | "acquirer" | "either";

export const APAC_COUNTRIES = new Set([
  "IN", "CN", "JP", "KR", "SG", "AU", "NZ", "HK", "TW", "ID", "MY", "TH", "PH", "VN", "BD", "LK", "PK", "NP", "KH", "MM", "LA", "BN", "MO", "MN", "FJ", "PG", "MV", "BT",
]);

export const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", CH: "Switzerland", SG: "Singapore", JP: "Japan", AU: "Australia", CN: "China",
  HK: "Hong Kong", TW: "Taiwan", KR: "South Korea", AE: "United Arab Emirates", SA: "Saudi Arabia", DE: "Germany", FR: "France", NL: "Netherlands",
  IT: "Italy", ES: "Spain", SE: "Sweden", IE: "Ireland", CA: "Canada", ID: "Indonesia", MY: "Malaysia", TH: "Thailand", PH: "Philippines",
  VN: "Vietnam", IL: "Israel", LU: "Luxembourg", BE: "Belgium", DK: "Denmark", NO: "Norway", FI: "Finland", BR: "Brazil", MX: "Mexico",
  ZA: "South Africa", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman", NZ: "New Zealand", MU: "Mauritius", BM: "Bermuda", KY: "Cayman Islands",
};

export function countryName(code: string | null | undefined): string {
  if (!code) return "—";
  return COUNTRY_NAMES[code] ?? code;
}

export function countryInView(country: string, view: GeoView): boolean {
  if (view === "global") return true;
  if (view === "india") return country === "IN";
  return APAC_COUNTRIES.has(country);
}

export function dealInGeo(targetCountry: string, acquirerCountry: string, view: GeoView, mode: GeoMode): boolean {
  if (view === "global") return true;
  const t = countryInView(targetCountry, view);
  const a = countryInView(acquirerCountry, view);
  if (mode === "target") return t;
  if (mode === "acquirer") return a;
  return t || a;
}

export function regionLabel(country: string): "India" | "APAC (ex-India)" | "Rest of world" {
  if (country === "IN") return "India";
  if (APAC_COUNTRIES.has(country)) return "APAC (ex-India)";
  return "Rest of world";
}

export const GEO_HELP =
  "India shows deals with an Indian target or acquirer (per the location rule). APAC includes India plus the rest of Asia-Pacific. Global includes everything. The views overlap, so do not add their counts together.";
