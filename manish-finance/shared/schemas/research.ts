import * as z from "zod";
import {
  BUYER_TYPE_LABEL,
  BUYER_TYPES,
  DEAL_STATUS_LABEL,
  DEAL_STATUSES,
  DEAL_TYPE_LABEL,
  DEAL_TYPES,
  PAYMENT_TYPES,
  SECTOR_NAMES,
  SECTOR_SLUGS,
  VALUE_BASES,
  VALUE_BASIS_LABEL,
  VERIFICATION_LABEL,
  VERIFICATION_STATUSES,
} from "../labels";

export {
  BUYER_TYPE_LABEL,
  BUYER_TYPES,
  DEAL_STATUS_LABEL,
  DEAL_STATUSES,
  DEAL_TYPE_LABEL,
  DEAL_TYPES,
  PAYMENT_TYPES,
  SECTOR_NAMES,
  SECTOR_SLUGS,
  VALUE_BASES,
  VALUE_BASIS_LABEL,
  VERIFICATION_LABEL,
  VERIFICATION_STATUSES,
};

/**
 * Research archive schemas. The archive is authored in data/archive, validated at build time
 * (npm run verify:content) and compiled into the finance Worker module.
 */

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;
export const zId = z.string().regex(ID_RE, "lowercase slug id");
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const zTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/, "UTC ISO timestamp");
export const zCountry = z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2");
export const zCurrency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217");
export const zHttpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://") || u.startsWith("http://"), "http(s) URL");

export const zSectorSlug = z.enum(SECTOR_SLUGS);
export type SectorSlug = z.infer<typeof zSectorSlug>;

export const zDealType = z.enum(DEAL_TYPES);
export type DealType = z.infer<typeof zDealType>;
export const zDealStatus = z.enum(DEAL_STATUSES);
export type DealStatus = z.infer<typeof zDealStatus>;
export const zBuyerType = z.enum(BUYER_TYPES);
export type BuyerType = z.infer<typeof zBuyerType>;
export const zPaymentType = z.enum(PAYMENT_TYPES);
export type PaymentType = z.infer<typeof zPaymentType>;

export const zValueBasis = z.enum(VALUE_BASES);
export type ValueBasis = z.infer<typeof zValueBasis>;
export const SCALE_UNITS = ["one", "thousand", "lakh", "million", "crore", "billion", "trillion"] as const;
export const zScaleUnit = z.enum(SCALE_UNITS);

export const zVerificationStatus = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof zVerificationStatus>;
export const CHECK_METHODS = ["document_retrieval", "web_search_index", "owner_entry", "calculation", "builder_background"] as const;
export const zCheckMethod = z.enum(CHECK_METHODS);
export type CheckMethod = z.infer<typeof zCheckMethod>;

export const zDateValue = z.object({
  date: zIsoDate,
  precision: z.enum(["day", "month", "quarter", "year"]),
});

/** An inline citation attached to an authored fact. Compiled into claim records with stable IDs. */
export const zCite = z.object({
  doc: zId,
  locator: z.string().max(200).nullish(),
  /** Short permitted excerpt (≤ 300 chars); full copyrighted text is never stored. */
  excerpt: z.string().max(300).nullish(),
  status: zVerificationStatus,
  checkedAt: zIsoDate.nullable(),
  method: zCheckMethod,
  note: z.string().max(400).nullish(),
});
export type Cite = z.infer<typeof zCite>;

export const DOCUMENT_TYPES = ["press_release", "exchange_filing", "regulatory_filing", "regulatory_order", "court_order", "annual_report", "investor_presentation", "company_page", "news_report", "reference", "dataset"] as const;

export const zSourceDocument = z.object({
  id: zId,
  publisher: z.string().min(2).max(120),
  url: zHttpsUrl,
  title: z.string().min(3).max(300),
  documentType: z.enum(DOCUMENT_TYPES),
  isPrimary: z.boolean(),
  publishedDate: zDateValue.nullable(),
  /** When the build or owner actually retrieved the document; null if never retrieved. */
  retrievedAt: zTimestamp.nullable(),
  retrievalStatus: z.enum(["retrieved", "not_retrieved", "unavailable"]),
  retrievalNote: z.string().max(400).nullish(),
  contentHash: z.string().nullish(),
  language: z.string().default("en"),
});
export type SourceDocument = z.infer<typeof zSourceDocument>;

export const zPartyRef = z.object({
  companyId: zId.nullish(),
  name: z.string().min(2).max(160),
  country: zCountry,
  cites: z.array(zCite).default([]),
});

export const TERM_METRICS = [
  "enterprise_value",
  "equity_value",
  "stake_consideration",
  "value_unclear_basis",
  "offer_price_per_share",
  "share_exchange_ratio",
  "offer_premium",
  "ev_revenue",
  "ev_ebitda",
  "price_to_book",
  "price_to_earnings",
  "break_fee",
  "earn_out",
  "capital_injection",
  "debt_assumed",
  "other",
] as const;

export const zDealTerm = z.object({
  metric: z.enum(TERM_METRICS),
  label: z.string().max(160).nullish(),
  amount: z.number().finite().nullable().default(null),
  currency: zCurrency.nullish(),
  unit: zScaleUnit.nullish(),
  /** For multiples/ratios/percentages stored as decimals. */
  ratio: z.number().finite().nullish(),
  text: z.string().max(400).nullish(),
  valueBasis: zValueBasis.nullish(),
  /** Percentage of the target the amount refers to (0–100). */
  ownershipPct: z.number().min(0).max(100).nullish(),
  kind: z.enum(["announced", "revised", "final", "implied", "reported_by_media"]).default("announced"),
  /** Marks the term used as the list's headline value (otherwise chosen by basis priority). */
  headline: z.boolean().nullish(),
  asOf: zIsoDate,
  /** Reference info for premiums/multiples: date and convention, or the period of the denominator. */
  reference: z.string().max(300).nullish(),
  status: z.enum(["reported", "calculated", "derived"]).default("reported"),
  cites: z.array(zCite).min(1),
  note: z.string().max(500).nullish(),
});
export type DealTerm = z.infer<typeof zDealTerm>;

export const EVENT_TYPES = [
  "rumour",
  "announcement",
  "revision",
  "regulatory_filing",
  "regulatory_approval",
  "regulatory_decision",
  "shareholder_approval",
  "court_approval",
  "open_offer",
  "completion",
  "termination",
  "withdrawal",
  "subsequent",
] as const;
export const zEventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof zEventType>;

export const zDealEvent = z.object({
  type: zEventType,
  date: zDateValue,
  publishedDate: zIsoDate.nullish(),
  title: z.string().min(3).max(200),
  detail: z.string().max(800).nullish(),
  jurisdiction: zCountry.nullish(),
  authority: z.string().max(120).nullish(),
  /** Status the deal moved to because of this event, if any. */
  statusAfter: zDealStatus.nullish(),
  cites: z.array(zCite).min(1),
});
export type DealEvent = z.infer<typeof zDealEvent>;

export const zAdviser = z.object({
  side: z.enum(["buyer", "seller", "target", "company", "other"]),
  role: z.enum(["financial", "legal", "fairness_opinion", "other"]),
  name: z.string().min(2).max(160),
  cites: z.array(zCite).min(1),
});

export const zTextWithCites = z.object({ text: z.string().min(3).max(1200), cites: z.array(zCite).default([]) });

export const zAutopsy = z.object({
  asAnnounced: z.object({
    cutoff: zIsoDate,
    situation: z.string().min(20),
    whatBuyerIsBuying: z.string().min(10),
    keyAssumptions: z.array(z.string()).min(2),
    priceAndStructure: z.string().min(20),
    risksAtAnnouncement: z.array(z.string()).min(2),
    falsifiers: z.array(z.string()).min(1),
  }),
  whatWeKnowNow: z.object({
    cutoff: zIsoDate,
    facts: z.array(zTextWithCites).min(1),
    interpretation: z.array(z.string()).min(1),
    evidenceLimits: z.string().nullish(),
  }),
  analysis: z.object({
    thesis: z.string().min(20),
    alternatives: z.array(z.string()).min(1),
    risks: z.array(z.string()).min(1),
    falsifiers: z.array(z.string()).min(1),
  }),
  prompts: z.array(z.string()).min(3),
  rubric: z.array(z.object({ criterion: z.string(), strong: z.string(), weak: z.string() })).min(3),
});
export type Autopsy = z.infer<typeof zAutopsy>;

export const zDeal = z.object({
  id: zId,
  title: z.string().min(5).max(160),
  aliases: z.array(z.string()).default([]),
  dealType: zDealType,
  buyerType: zBuyerType,
  sector: zSectorSlug,
  subsector: z.string().min(2).max(80),
  acquirer: zPartyRef,
  target: zPartyRef,
  otherParties: z.array(zPartyRef.extend({ role: z.enum(["seller", "co_investor", "merger_partner", "jv_partner", "competing_bidder", "regulator", "other"]) })).default([]),
  perimeter: z.string().min(10).max(600),
  stake: z.object({ acquiredPct: z.number().min(0).max(100).nullable(), resultingPct: z.number().min(0).max(100).nullable(), note: z.string().max(400).nullish(), cites: z.array(zCite).default([]) }),
  announced: zDateValue.extend({ cites: z.array(zCite).min(1) }),
  effective: zDateValue.extend({ cites: z.array(zCite).min(1) }).nullish(),
  status: z.object({ value: zDealStatus, asOf: zIsoDate, note: z.string().max(400).nullish(), cites: z.array(zCite).min(1) }),
  terms: z.array(zDealTerm).default([]),
  payment: z.object({ mix: z.array(zPaymentType).min(1), text: z.string().max(500), cites: z.array(zCite).default([]) }),
  financing: zTextWithCites.nullish(),
  events: z.array(zDealEvent).min(1),
  advisers: z.object({ disclosure: z.enum(["not_disclosed", "partial", "disclosed", "not_researched"]), list: z.array(zAdviser).default([]), note: z.string().nullish() }),
  rationale: z.array(zTextWithCites).default([]),
  sectorContext: z.string().max(2000).nullish(),
  comparables: z.array(z.object({ dealId: zId, reason: z.string().max(300) })).default([]),
  afterDeal: z.array(z.object({ date: zIsoDate.nullish(), kind: z.enum(["fact", "interpretation"]), text: z.string().max(800), cites: z.array(zCite).default([]) })).default([]),
  autopsy: zAutopsy.nullish(),
  tags: z.array(z.string()).default([]),
  researchCutoff: zIsoDate,
  recordUpdated: zIsoDate,
});
export type Deal = z.infer<typeof zDeal>;
export type DealInput = z.input<typeof zDeal>;

export const OBS_METRICS = [
  "revenue",
  "total_income",
  "ebitda",
  "ebit",
  "net_income",
  "pat_attributable",
  "total_assets",
  "net_worth",
  "total_deposits",
  "gross_advances",
  "net_advances",
  "nim",
  "gnpa_ratio",
  "nnpa_ratio",
  "casa_ratio",
  "crar",
  "cet1_ratio",
  "roa",
  "roe",
  "aum",
  "vnb",
  "vnb_margin",
  "ape",
  "embedded_value",
  "combined_ratio",
  "gross_written_premium",
  "employees",
  "customers",
  "subscribers",
  "arpu",
  "beds",
  "occupancy",
  "arpob",
  "capacity_mw",
  "order_book",
  "pre_sales",
  "leased_area",
  "occupancy_commercial",
  "gmv",
  "orders",
  "other",
] as const;

export const zObservation = z.object({
  metric: z.enum(OBS_METRICS),
  label: z.string().max(120).nullish(),
  value: z.number().finite().nullable(),
  /** Why the value is null (not disclosed, not comparable, etc.). */
  nullReason: z.string().max(200).nullish(),
  unit: z.enum(["currency", "percent", "ratio", "count", "mw", "sq_ft_million", "other"]),
  currency: zCurrency.nullish(),
  scale: zScaleUnit.nullish(),
  period: z.object({ type: z.enum(["FY", "CY", "H", "Q", "YTD", "LTM", "point"]), end: zIsoDate, months: z.number().int().min(0).max(12), label: z.string().max(80) }),
  scope: z.enum(["consolidated", "standalone", "segment", "not_stated"]),
  basis: z.enum(["reported", "company_adjusted", "regulatory", "operating_kpi"]),
  definition: z.string().max(300).nullish(),
  cites: z.array(zCite).min(1),
});
export type Observation = z.infer<typeof zObservation>;

export const zCompany = z.object({
  id: zId,
  legalName: z.string().min(2).max(200),
  displayName: z.string().min(2).max(120),
  aliases: z.array(z.string()).default([]),
  formerNames: z.array(z.object({ name: z.string(), until: zIsoDate.nullish() })).default([]),
  tickers: z.array(z.object({ exchange: z.string().max(20), symbol: z.string().max(20), note: z.string().max(80).nullish(), active: z.boolean().default(true) })).default([]),
  country: zCountry,
  sector: zSectorSlug,
  subsector: z.string().min(2).max(80),
  lifecycle: z.object({
    status: z.enum(["active", "acquired", "merged", "delisted", "private", "joint_venture"]),
    note: z.string().max(300).nullish(),
    validTo: zIsoDate.nullish(),
    successorId: zId.nullish(),
    parentId: zId.nullish(),
  }),
  website: zHttpsUrl.nullish(),
  irUrl: zHttpsUrl.nullish(),
  identityCites: z.array(zCite).min(1),
  businessModel: z.object({
    summary: z.string().min(40),
    customers: z.string().min(10),
    products: z.string().min(10),
    revenueModel: z.string().min(10),
    costDrivers: z.string().min(10),
    positioning: z.string().min(10),
    risks: z.array(z.string()).min(2),
    basisNote: z.string().max(300).nullish(),
  }),
  observations: z.array(zObservation).default([]),
  peers: z.array(z.object({ companyId: zId, reason: z.string().min(5).max(240) })).default([]),
  ownership: z.array(z.object({ holder: z.string(), pct: z.number().min(0).max(100).nullable(), asOf: zIsoDate, cites: z.array(zCite).min(1) })).default([]),
  recordUpdated: zIsoDate,
});
export type Company = z.infer<typeof zCompany>;
export type CompanyInput = z.input<typeof zCompany>;

export const zMetricDef = z.object({
  id: zId,
  name: z.string(),
  formula: z.string(),
  denominator: z.string(),
  interpretation: z.string(),
  limitations: z.string(),
  unit: z.enum(["percent", "ratio", "multiple", "currency", "count", "days", "bps", "other"]),
});
export type MetricDef = z.infer<typeof zMetricDef>;

export const zSector = z.object({
  slug: zSectorSlug,
  name: z.string(),
  tagline: z.string().max(200),
  howItMakesMoney: z.string().min(200),
  valueAccrual: z.string().min(100),
  /** Analyst primer (Markdown): connective reasoning, written as analysis rather than sourced claims. */
  primer: z.string().min(200).nullish(),
  subsectors: z.array(z.object({ id: zId, name: z.string(), businessModel: z.string().min(40), keyMetrics: z.array(zId).min(1), valuation: z.string().min(20) })).min(3),
  valueChain: z.array(z.object({ stage: z.string(), description: z.string(), economics: z.string(), examples: z.array(zId).default([]) })).min(3),
  metrics: z.array(zMetricDef).min(6),
  valuation: z.array(z.object({ method: z.string(), whenUseful: z.string(), whenMisleading: z.string() })).min(3),
  mnaMotives: z.array(z.string()).min(3),
  integrationIssues: z.array(z.string()).min(3),
  diligenceQuestions: z.array(z.string()).min(5),
  recurringStructures: z.array(z.string()).min(2),
  regulators: z.array(z.object({ body: z.string(), url: zHttpsUrl, role: z.string(), cites: z.array(zCite).default([]) })).default([]),
  whatChanged: z
    .array(
      z.object({
        date: zIsoDate,
        stage: z.enum(["proposal", "consultation", "rule", "approval", "effective", "market_event"]),
        title: z.string(),
        detail: z.string(),
        cites: z.array(zCite).min(1),
      }),
    )
    .default([]),
  players: z.array(z.object({ companyId: zId, group: z.string(), note: z.string().max(200).nullish() })).default([]),
  practiceQuestionIds: z.array(zId).min(5),
  figWorkflow: z
    .object({
      questions: z.array(z.string()).min(5),
      modelBySubsector: z.array(z.object({ subsector: z.string(), primaryApproach: z.string(), avoid: z.string() })).min(5),
      regulatoryVsAccounting: z.string().min(100),
    })
    .nullish(),
  sourcesNote: z.string().nullish(),
  recordUpdated: zIsoDate,
});
export type Sector = z.infer<typeof zSector>;
export type SectorInput = z.input<typeof zSector>;

export const zGlossaryTerm = z.object({
  id: zId,
  term: z.string(),
  definition: z.string().min(20),
  context: z.string().min(10),
  confusion: z.string().min(10),
  example: z.object({ type: z.enum(["deal", "company", "sector", "module"]), id: zId, note: z.string().max(200) }).nullish(),
  sectors: z.array(zSectorSlug).default([]),
});
export type GlossaryTerm = z.infer<typeof zGlossaryTerm>;

export const zQuestion = z.object({
  id: zId,
  topic: z.object({ type: z.enum(["module", "sector", "deal", "drill"]), id: z.string() }),
  kind: z.enum(["mcq", "numeric", "open"]),
  prompt: z.string().min(10),
  options: z.array(z.string()).nullish(),
  answerIndex: z.number().int().min(0).nullish(),
  answerValue: z.number().finite().nullish(),
  tolerance: z.number().min(0).nullish(),
  answerUnit: z.string().nullish(),
  explanation: z.string().min(20),
  rubric: z.array(z.string()).nullish(),
  difficulty: z.enum(["intro", "core", "stretch"]).default("core"),
});
export type Question = z.infer<typeof zQuestion>;

export const zModule = z.object({
  id: zId,
  number: z.number().int().min(1).max(12),
  title: z.string(),
  summary: z.string().max(300),
  minutes: z.number().int().min(5).max(90),
  explanation: z.string().min(400),
  workedExample: z.string().min(200),
  commonMistakes: z.array(z.string()).min(3),
  questionIds: z.array(zId).min(3),
  sourcePointers: z.array(z.object({ title: z.string(), publisher: z.string(), url: zHttpsUrl, note: z.string().max(200).nullish() })).min(1),
  related: z.array(z.object({ type: z.enum(["deal", "sector", "glossary", "lab"]), id: z.string() })).default([]),
});
export type LearningModule = z.infer<typeof zModule>;

export const zBriefItem = z.object({
  rank: z.number().int().min(1),
  headline: z.string(),
  whatChanged: z.string(),
  eventDate: zDateValue,
  publishedDate: zIsoDate.nullable(),
  whyItMatters: z.string(),
  uncertainty: z.string(),
  eventType: z.string(),
  sectors: z.array(zSectorSlug),
  entities: z.array(z.object({ type: z.enum(["deal", "company", "sector"]), id: zId })).default([]),
  whyThisAppears: z.string(),
  newlyDiscovered: z.boolean().default(false),
  cites: z.array(zCite).min(1),
});

export const zBrief = z.object({
  id: zId,
  kind: z.enum(["daily", "weekly"]),
  title: z.string(),
  label: z.string(),
  periodStart: zIsoDate,
  periodEnd: zIsoDate,
  cutoffAt: zTimestamp,
  generatedAt: zTimestamp,
  method: z.enum(["compiled_archive_example", "compiled", "ai_synthesis"]),
  items: z.array(zBriefItem).min(1),
  deepDive: z.object({ entity: z.object({ type: z.enum(["deal", "company"]), id: zId }), why: z.string() }).nullish(),
  sectorImplication: z.object({ sector: zSectorSlug, causalChain: z.array(z.string()).min(2), label: z.literal("Analysis") }).nullish(),
  question: z.object({ text: z.string(), template: z.string().nullish() }).nullish(),
  weekly: z
    .object({
      statusChanges: z.array(z.object({ dealId: zId, change: z.string() })).default([]),
      openQuestions: z.array(z.string()).default([]),
      reflectionPrompt: z.string(),
    })
    .nullish(),
});
export type Brief = z.infer<typeof zBrief>;

export const zTrainingModel = z.object({
  id: zId,
  kind: z.enum(["acquisition", "dcf", "fig_residual_income", "comparables"]),
  title: z.string(),
  description: z.string(),
  currency: z.string(),
  unit: z.string(),
  inputs: z.record(z.string(), z.unknown()),
});
export type TrainingModel = z.infer<typeof zTrainingModel>;
