import type { DateValue } from "./dates";
import type {
  BuyerType,
  CheckMethod,
  DealStatus,
  DealType,
  EventType,
  PaymentType,
  SectorSlug,
  SourceDocument,
  ValueBasis,
  VerificationStatus,
} from "./schemas/research";

/** Types shared by the finance API and the browser client. */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Research cutoff / freshness context for the result set. */
  meta?: Record<string, unknown>;
}

export interface ClaimView {
  id: string;
  subject: { type: "deal" | "company" | "sector" | "brief" | "module"; id: string };
  field: string;
  label: string;
  display: string;
  document: SourceDocument;
  locator: string | null;
  excerpt: string | null;
  status: VerificationStatus;
  checkedAt: string | null;
  method: CheckMethod;
  note: string | null;
  /** Owner corrections or later revisions that supersede this claim. */
  supersededBy?: string | null;
}

export interface PartyView {
  companyId: string | null;
  name: string;
  country: string;
  ev: string[];
}

export interface TermView {
  id: string;
  metric: string;
  label: string;
  amount: number | null;
  currency: string | null;
  unit: string | null;
  ratio: number | null;
  text: string | null;
  valueBasis: ValueBasis | null;
  ownershipPct: number | null;
  kind: string;
  asOf: string;
  reference: string | null;
  status: "reported" | "calculated" | "derived";
  note: string | null;
  headline: boolean;
  ev: string[];
  /** Set when a published owner correction/revision supersedes this term. */
  correction?: { publishedAt: string; note: string } | null;
}

export interface EventView {
  id: string;
  type: EventType;
  date: DateValue;
  publishedDate: string | null;
  title: string;
  detail: string | null;
  jurisdiction: string | null;
  authority: string | null;
  statusAfter: DealStatus | null;
  ev: string[];
  origin: "archive" | "published_update";
}

export interface HeadlineValue {
  termId: string;
  metric: string;
  amount: number;
  currency: string;
  unit: string;
  valueBasis: ValueBasis;
  ownershipPct: number | null;
  ev: string[];
}

export type VerificationSummary = Record<VerificationStatus, number>;

export interface DealSummary {
  id: string;
  title: string;
  aliases: string[];
  dealType: DealType;
  buyerType: BuyerType;
  sector: SectorSlug;
  subsector: string;
  acquirer: PartyView;
  target: PartyView;
  announced: DateValue & { ev: string[] };
  status: DealStatus;
  statusAsOf: string;
  statusEv: string[];
  stake: { acquiredPct: number | null; resultingPct: number | null };
  headline: HeadlineValue | null;
  valueDisclosed: boolean;
  paymentMix: PaymentType[];
  crossBorder: boolean;
  hasAutopsy: boolean;
  verification: VerificationSummary;
  lastChangedAt: string;
  latestEvent: { type: EventType; date: DateValue; title: string } | null;
  adviserNames: string[];
  tags: string[];
  multiples: { evRevenue: number | null; evEbitda: number | null; priceToBook: number | null };
}

export interface DealDetail extends DealSummary {
  perimeter: string;
  stakeNote: string | null;
  stakeEv: string[];
  effective: (DateValue & { ev: string[] }) | null;
  otherParties: Array<PartyView & { role: string }>;
  terms: TermView[];
  payment: { mix: PaymentType[]; text: string; ev: string[] };
  financing: { text: string; ev: string[] } | null;
  events: EventView[];
  advisers: { disclosure: string; list: Array<{ side: string; role: string; name: string; ev: string[] }>; note: string | null };
  rationale: Array<{ text: string; ev: string[] }>;
  sectorContext: string | null;
  comparables: Array<{ dealId: string; reason: string; title: string | null }>;
  afterDeal: Array<{ date: string | null; kind: "fact" | "interpretation"; text: string; ev: string[] }>;
  autopsy: unknown | null;
  researchCutoff: string;
  recordUpdated: string;
  evidence: Record<string, ClaimView>;
  archiveVersion: string;
}

export interface CompanySummary {
  id: string;
  displayName: string;
  legalName: string;
  aliases: string[];
  country: string;
  sector: SectorSlug;
  subsector: string;
  lifecycle: string;
  tickers: Array<{ exchange: string; symbol: string }>;
  dealCount: number;
}

export interface ObservationView {
  id: string;
  metric: string;
  label: string;
  value: number | null;
  nullReason: string | null;
  unit: string;
  currency: string | null;
  scale: string | null;
  period: { type: string; end: string; months: number; label: string };
  scope: string;
  basis: string;
  definition: string | null;
  ev: string[];
}

export interface CompanyDetail extends CompanySummary {
  formerNames: Array<{ name: string; until: string | null }>;
  tickerDetails: Array<{ exchange: string; symbol: string; note: string | null; active: boolean }>;
  lifecycleDetail: { status: string; note: string | null; validTo: string | null; successorId: string | null; parentId: string | null };
  website: string | null;
  irUrl: string | null;
  identityEv: string[];
  businessModel: { summary: string; customers: string; products: string; revenueModel: string; costDrivers: string; positioning: string; risks: string[]; basisNote: string | null };
  observations: ObservationView[];
  peers: Array<{ companyId: string; reason: string; displayName: string | null }>;
  ownership: Array<{ holder: string; pct: number | null; asOf: string; ev: string[] }>;
  deals: DealSummary[];
  corrections: Array<{ id: string; field: string; previous: unknown; next: unknown; note: string; publishedAt: string; ev: string[] }>;
  evidence: Record<string, ClaimView>;
  recordUpdated: string;
}

export interface FeedItemView {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string | null;
  publishedDate: string | null;
  eventDate: string | null;
  discoveredAt: string;
  eventType: string;
  sectors: SectorSlug[];
  entities: Array<{ type: "deal" | "company"; id: string; name: string; confidence: "exact_alias" | "ambiguous" }>;
  verification: "lead" | "linked" | "reviewed" | "rejected";
  newlyDiscovered: boolean;
  excerpt: string | null;
}

export type SourceHealth =
  | "working"
  | "cached"
  | "stale"
  | "manual"
  | "not_configured"
  | "rate_limited"
  | "access_unavailable"
  | "failed"
  | "never_run";

export interface SourceStatusView {
  id: string;
  name: string;
  publisher: string;
  kind: string;
  accessMethod: string;
  endpoint: string | null;
  capabilities: string[];
  coverage: string;
  rightsNotes: string;
  refreshIntervalMinutes: number | null;
  staleAfterHours: number | null;
  enabled: boolean;
  health: SourceHealth;
  healthLabel: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastItemCount: number | null;
  error: string | null;
  endpointVerification: { status: "verified_live" | "unverified" | "manual"; checkedAt: string | null; note: string };
}

export interface StatusResponse {
  app: { name: string; version: string; archiveVersion: string; archiveCutoff: string; calcVersion: string };
  /** `key` is an opaque hash of the account ID used only to detect account changes client-side. */
  viewer: { signedIn: boolean; role: "anonymous" | "user" | "owner"; ownerConfigured: boolean; key: string | null };
  capabilities: {
    privateData: boolean;
    ai: { enabled: boolean; reason: string };
    maintenance: { scheduler: "not_configured" | "observed" | "stale"; lastScheduledRunAt: string | null; lastRunAt: string | null };
  };
  sources: { summary: Record<SourceHealth, number>; lastSuccessAt: string | null; items: Array<Pick<SourceStatusView, "id" | "name" | "health" | "healthLabel" | "lastSuccessAt">> };
  counts: { deals: number; companies: number; sectors: number; feedItems: number };
  serverTime: string;
  signInUrl: string;
  signOutUrl: string;
}

export interface SearchHit {
  type: "deal" | "company" | "sector" | "glossary" | "module" | "metric" | "note" | "brief";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
}
