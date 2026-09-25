import type { SourceHealth, SourceStatusView } from "../../shared/api";
import type { D1Database, FinanceEnv } from "../types";

/**
 * Source registry. Definitions (endpoint, rights notes, capabilities) are reviewed code; runtime state
 * (last attempt/success, errors, backoff, owner enable/disable) lives in finance_source_state.
 *
 * Endpoint verification is honest: an endpoint is "verified_live" only after a successful live fetch
 * has been recorded (live_verified_at). Documentation URLs are not proof that a feed works.
 */

export type ConnectorKind = "sec_submissions" | "rss";

export interface SourceDefinition {
  id: string;
  name: string;
  publisher: string;
  kind: "regulator" | "exchange" | "company" | "publisher" | "reference" | "competition_authority";
  accessMethod: "api" | "rss" | "manual" | "link_only";
  endpoint: string | null;
  documentationUrl: string | null;
  capabilities: string[];
  coverage: string;
  rightsNotes: string;
  refreshIntervalMinutes: number | null;
  staleAfterHours: number | null;
  connector: ConnectorKind | null;
  /** Hosts the connector may contact (exact match). Redirects outside this set are rejected. */
  allowedHosts: string[];
  /** Publisher's local time zone, used to derive publication dates from timestamps. */
  timeZone?: string;
  /** Registered default sector tags for items from this source. */
  defaultSectors: string[];
  defaultEnabled: boolean;
  requiresEnv?: Array<keyof FinanceEnv>;
  /** CIKs monitored by the SEC connector (10-digit, zero padded). */
  secCiks?: Array<{ cik: string; name: string; companyId?: string }>;
  verificationNote: string;
}

export const SEC_FORMS_OF_INTEREST = ["8-K", "8-K/A", "6-K", "S-4", "S-4/A", "F-4", "F-4/A", "425", "DEFM14A", "PREM14A", "DEFM14C", "SC TO-T", "SC TO-C", "SC 14D9", "SC 13D", "SC 13D/A", "SC 13E3", "SCHEDULE 13D", "SCHEDULE 13D/A", "SC TO-I"];

export const SOURCES: SourceDefinition[] = [
  {
    id: "sec-edgar-submissions",
    name: "SEC EDGAR submissions (covered US-listed companies)",
    publisher: "U.S. Securities and Exchange Commission",
    kind: "regulator",
    accessMethod: "api",
    endpoint: "https://data.sec.gov/submissions/CIK{cik}.json",
    documentationUrl: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    capabilities: ["filing_metadata", "merger_documents", "8-K_items"],
    coverage: "Recent filings (8-K, 6-K, S-4/F-4, 425, merger proxies, tender-offer schedules) for covered companies with SEC filings. Not a normalised global deal feed.",
    rightsNotes:
      "Public EDGAR data; no API key. Server-side only (no browser CORS). Requires a declared User-Agent with a real contact (FINANCE_SEC_USER_AGENT) and compliance with the SEC fair-access policy; requests are cached and spaced conservatively.",
    refreshIntervalMinutes: 360,
    staleAfterHours: 36,
    connector: "sec_submissions",
    allowedHosts: ["data.sec.gov"],
    timeZone: "America/New_York",
    defaultSectors: [],
    defaultEnabled: true,
    requiresEnv: ["FINANCE_SEC_USER_AGENT"],
    secCiks: [
      // CIKs taken from sec.gov/Archives/edgar/data/<CIK>/ paths of filings cited in the research archive.
      { cik: "0000789019", name: "Microsoft Corp", companyId: "microsoft" },
      { cik: "0001730168", name: "Broadcom Inc", companyId: "broadcom" },
      { cik: "0001744489", name: "Walt Disney Co", companyId: "disney" },
      { cik: "0000078003", name: "Pfizer Inc", companyId: "pfizer" },
      { cik: "0000034088", name: "Exxon Mobil Corp", companyId: "exxonmobil" },
      { cik: "0000093410", name: "Chevron Corp" },
      { cik: "0000104169", name: "Walmart Inc", companyId: "walmart" },
      { cik: "0000055785", name: "Kimberly-Clark Corp", companyId: "kimberly-clark" },
      { cik: "0000035527", name: "Fifth Third Bancorp", companyId: "fifth-third" },
      { cik: "0000712515", name: "Electronic Arts Inc", companyId: "electronic-arts" },
      { cik: "0001803599", name: "Concentrix Corp", companyId: "concentrix" },
      { cik: "0001144967", name: "HDFC Bank Ltd", companyId: "hdfc-bank" },
      { cik: "0001123799", name: "Wipro Ltd", companyId: "wipro" },
    ],
    verificationNote: "Endpoint format from SEC API documentation. Not reachable from the build environment (egress policy); run npm run check:sources:live or the Sources ‘Test connection’ action to verify.",
  },
  {
    id: "rbi-press-releases",
    name: "RBI press releases (RSS)",
    publisher: "Reserve Bank of India",
    kind: "regulator",
    accessMethod: "rss",
    endpoint: "https://rbi.org.in/pressreleases_rss.xml",
    documentationUrl: "https://rbi.org.in/Scripts/rss.aspx",
    capabilities: ["regulatory_press_releases", "bank_licensing", "penalties", "approvals"],
    coverage: "RBI press releases: monetary policy, regulatory actions, approvals relevant to banks and NBFCs.",
    rightsNotes: "Official RSS listed on the RBI RSS page. Link to originals; store titles, dates and short summaries only. Automated access may be blocked by the site; failures are shown, not bypassed.",
    refreshIntervalMinutes: 360,
    staleAfterHours: 48,
    connector: "rss",
    allowedHosts: ["rbi.org.in", "www.rbi.org.in"],
    timeZone: "Asia/Kolkata",
    defaultSectors: ["fig"],
    defaultEnabled: true,
    verificationNote: "Feed URL taken from the RBI RSS directory listing. Not reachable from the build environment; unverified until a live fetch succeeds.",
  },
  {
    id: "rbi-notifications",
    name: "RBI notifications (RSS)",
    publisher: "Reserve Bank of India",
    kind: "regulator",
    accessMethod: "rss",
    endpoint: "https://rbi.org.in/notifications_rss.xml",
    documentationUrl: "https://rbi.org.in/Scripts/rss.aspx",
    capabilities: ["circulars", "directions", "draft_directions"],
    coverage: "RBI notifications and circulars (final rules and some drafts).",
    rightsNotes: "Official RSS listed on the RBI RSS page. Distinguish draft directions from final/effective rules before summarising.",
    refreshIntervalMinutes: 360,
    staleAfterHours: 48,
    connector: "rss",
    allowedHosts: ["rbi.org.in", "www.rbi.org.in"],
    timeZone: "Asia/Kolkata",
    defaultSectors: ["fig"],
    defaultEnabled: true,
    verificationNote: "Feed URL taken from the RBI RSS directory listing. Not reachable from the build environment; unverified until a live fetch succeeds.",
  },
  {
    id: "sebi-rss",
    name: "SEBI updates (RSS)",
    publisher: "Securities and Exchange Board of India",
    kind: "regulator",
    accessMethod: "rss",
    endpoint: "https://www.sebi.gov.in/sebirss.xml",
    documentationUrl: "https://www.sebi.gov.in/",
    capabilities: ["circulars", "consultation_papers", "orders", "press_releases"],
    coverage: "SEBI circulars, consultation papers, orders and press releases (takeover code, listing, AIF, mutual fund rules).",
    rightsNotes: "Official RSS published by SEBI. Consultation papers are proposals, not rules. Link to originals; do not republish full documents.",
    refreshIntervalMinutes: 360,
    staleAfterHours: 48,
    connector: "rss",
    allowedHosts: ["www.sebi.gov.in", "sebi.gov.in"],
    timeZone: "Asia/Kolkata",
    defaultSectors: ["fig"],
    defaultEnabled: true,
    verificationNote: "Feed URL published on sebi.gov.in. Not reachable from the build environment; unverified until a live fetch succeeds.",
  },
  {
    id: "cci-combinations",
    name: "CCI combination orders and press releases",
    publisher: "Competition Commission of India",
    kind: "competition_authority",
    accessMethod: "manual",
    endpoint: null,
    documentationUrl: "https://www.cci.gov.in/combination",
    capabilities: ["merger_approvals", "green_channel_notices"],
    coverage: "Approvals of combinations under the Competition Act. An approval does not prove completion.",
    rightsNotes: "No documented machine-readable feed was identified; use the manual source-link workflow (paste the order/press-release URL and a short excerpt).",
    refreshIntervalMinutes: null,
    staleAfterHours: null,
    connector: null,
    allowedHosts: [],
    defaultSectors: [],
    defaultEnabled: true,
    verificationNote: "Manual source.",
  },
  {
    id: "nse-bse-disclosures",
    name: "NSE/BSE corporate announcements",
    publisher: "National Stock Exchange of India / BSE",
    kind: "exchange",
    accessMethod: "manual",
    endpoint: null,
    documentationUrl: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
    capabilities: ["issuer_announcements", "open_offer_documents"],
    coverage: "Listed-company disclosures in India.",
    rightsNotes: "Exchange websites use anti-bot protections and undocumented endpoints; automated retrieval is not attempted. Record filings manually with their URL and date.",
    refreshIntervalMinutes: null,
    staleAfterHours: null,
    connector: null,
    allowedHosts: [],
    defaultSectors: [],
    defaultEnabled: true,
    verificationNote: "Manual source.",
  },
  {
    id: "company-ir",
    name: "Company investor-relations pages",
    publisher: "Various issuers",
    kind: "company",
    accessMethod: "manual",
    endpoint: null,
    documentationUrl: null,
    capabilities: ["press_releases", "annual_reports", "investor_presentations"],
    coverage: "Deal announcements, results and annual reports from acquirers and targets.",
    rightsNotes: "Link to originals and store short excerpts only. Official RSS feeds may be registered per company after verification.",
    refreshIntervalMinutes: null,
    staleAfterHours: null,
    connector: null,
    allowedHosts: [],
    defaultSectors: [],
    defaultEnabled: true,
    verificationNote: "Manual source.",
  },
  {
    id: "owner-manual",
    name: "Owner-recorded source links",
    publisher: "Various (recorded by the site owner)",
    kind: "reference",
    accessMethod: "manual",
    endpoint: null,
    documentationUrl: null,
    capabilities: ["source_links", "short_excerpts", "deal_event_proposals"],
    coverage: "Links and short excerpts the owner records for sources without a permitted automated feed. The server stores the link; it never fetches it.",
    rightsNotes: "Store the link, title, dates and a short excerpt (≤ 300 characters) only.",
    refreshIntervalMinutes: null,
    staleAfterHours: null,
    connector: null,
    allowedHosts: [],
    defaultSectors: [],
    defaultEnabled: true,
    verificationNote: "Manual source.",
  },
  {
    id: "damodaran-reference",
    name: "Damodaran Online (NYU Stern) reference data",
    publisher: "Aswath Damodaran, NYU Stern",
    kind: "reference",
    accessMethod: "link_only",
    endpoint: null,
    documentationUrl: "https://pages.stern.nyu.edu/~adamodar/",
    capabilities: ["methodology", "educational_datasets"],
    coverage: "Valuation methodology and educational datasets. Not a current transaction dataset.",
    rightsNotes: "Educational reference; link only.",
    refreshIntervalMinutes: null,
    staleAfterHours: null,
    connector: null,
    allowedHosts: [],
    defaultSectors: [],
    defaultEnabled: true,
    verificationNote: "Reference link.",
  },
];

export function getSource(id: string): SourceDefinition | undefined {
  return SOURCES.find((s) => s.id === id);
}

export interface SourceStateRow {
  source_id: string;
  enabled: number;
  config_json: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_http_status: number | null;
  etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
  next_allowed_at: string | null;
  last_item_count: number | null;
  live_verified_at: string | null;
  updated_at: string;
}

const HEALTH_LABEL: Record<SourceHealth, string> = {
  working: "Working and current",
  cached: "Cached (last update succeeded earlier)",
  stale: "Stale",
  manual: "Manual source",
  not_configured: "Not configured",
  rate_limited: "Rate limited",
  access_unavailable: "Access unavailable",
  failed: "Failed",
  never_run: "Not yet run",
};

export function computeHealth(def: SourceDefinition, state: SourceStateRow | undefined, env: FinanceEnv, now: Date): { health: SourceHealth; label: string } {
  if (def.accessMethod === "manual" || def.accessMethod === "link_only") return { health: "manual", label: HEALTH_LABEL.manual };
  const missing = (def.requiresEnv ?? []).filter((k) => typeof env[k] !== "string" || !(env[k] as string).trim());
  if (missing.length) return { health: "not_configured", label: `Not configured (set ${missing.join(", ")})` };
  if (state && !state.enabled) return { health: "not_configured", label: "Disabled by owner" };
  if (!state?.last_attempt_at) return { health: "never_run", label: HEALTH_LABEL.never_run };
  const staleMs = (def.staleAfterHours ?? 48) * 3_600_000;
  const lastOk = state.last_success_at ? now.getTime() - Date.parse(state.last_success_at) : Number.POSITIVE_INFINITY;
  const recent = lastOk <= staleMs;
  if (state.last_status === "working") return recent ? { health: "working", label: HEALTH_LABEL.working } : { health: "stale", label: HEALTH_LABEL.stale };
  if (state.last_status === "rate_limited") return { health: "rate_limited", label: HEALTH_LABEL.rate_limited };
  if (state.last_status === "access_unavailable") return { health: "access_unavailable", label: HEALTH_LABEL.access_unavailable };
  if (state.last_success_at) return recent ? { health: "cached", label: HEALTH_LABEL.cached } : { health: "stale", label: HEALTH_LABEL.stale };
  return { health: "failed", label: HEALTH_LABEL.failed };
}

export async function loadSourceStates(db: D1Database | undefined): Promise<Map<string, SourceStateRow>> {
  const map = new Map<string, SourceStateRow>();
  if (!db) return map;
  try {
    const rows = await db.prepare("SELECT * FROM finance_source_state").all<SourceStateRow>();
    for (const r of rows.results ?? []) map.set(r.source_id, r);
  } catch {
    // Migration not applied yet; treat all sources as never run.
  }
  return map;
}

/** Public-safe status (no secrets, no raw upstream errors; owner diagnostics add redacted detail). */
export function sourceStatusView(def: SourceDefinition, state: SourceStateRow | undefined, env: FinanceEnv, now: Date, detailed: boolean): SourceStatusView {
  const { health, label } = computeHealth(def, state, env, now);
  const verified = state?.live_verified_at ?? null;
  return {
    id: def.id,
    name: def.name,
    publisher: def.publisher,
    kind: def.kind,
    accessMethod: def.accessMethod,
    endpoint: def.endpoint,
    capabilities: def.capabilities,
    coverage: def.coverage,
    rightsNotes: def.rightsNotes,
    refreshIntervalMinutes: def.refreshIntervalMinutes,
    staleAfterHours: def.staleAfterHours,
    enabled: state ? Boolean(state.enabled) : def.defaultEnabled,
    health,
    healthLabel: label,
    lastAttemptAt: state?.last_attempt_at ?? null,
    lastSuccessAt: state?.last_success_at ?? null,
    lastItemCount: state?.last_item_count ?? null,
    error: state?.last_error ? (detailed ? state.last_error : publicErrorSummary(state)) : null,
    endpointVerification:
      def.accessMethod === "manual" || def.accessMethod === "link_only"
        ? { status: "manual", checkedAt: null, note: def.verificationNote }
        : verified
          ? { status: "verified_live", checkedAt: verified, note: "A live fetch succeeded from the deployed Worker." }
          : { status: "unverified", checkedAt: null, note: def.verificationNote },
  };
}

function publicErrorSummary(state: SourceStateRow): string {
  switch (state.last_status) {
    case "rate_limited":
      return "The source asked us to slow down; cached data is shown.";
    case "access_unavailable":
      return "The source refused automated access from this server; cached data (if any) is shown.";
    case "failed":
      return "The last refresh failed; cached data (if any) is shown.";
    default:
      return "See Sources for details.";
  }
}
