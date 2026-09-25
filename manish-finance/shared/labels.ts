/**
 * Enumerations and display labels shared by server and browser. Kept free of zod so the browser
 * bundle does not include schema code.
 */

export const SECTOR_SLUGS = ["fig", "tmt", "healthcare", "consumer", "industrials", "energy-infrastructure", "business-services", "real-estate"] as const;
export type SectorSlugValue = (typeof SECTOR_SLUGS)[number];

export const SECTOR_NAMES: Record<SectorSlugValue, string> = {
  fig: "FIG",
  tmt: "TMT",
  healthcare: "Healthcare",
  consumer: "Consumer",
  industrials: "Industrials",
  "energy-infrastructure": "Energy & Infrastructure",
  "business-services": "Business Services",
  "real-estate": "Real Estate",
};

export const SECTOR_LONG_NAMES: Record<SectorSlugValue, string> = {
  fig: "Financial Institutions (FIG)",
  tmt: "Technology, Media & Telecom",
  healthcare: "Healthcare",
  consumer: "Consumer",
  industrials: "Industrials",
  "energy-infrastructure": "Energy & Infrastructure",
  "business-services": "Business Services",
  "real-estate": "Real Estate",
};

export const DEAL_TYPES = ["merger", "control_acquisition", "minority_stake", "asset_purchase", "carve_out", "buyout", "joint_venture", "proposal"] as const;
export type DealTypeValue = (typeof DEAL_TYPES)[number];
export const DEAL_TYPE_LABEL: Record<DealTypeValue, string> = {
  merger: "Merger",
  control_acquisition: "Control acquisition",
  minority_stake: "Minority stake",
  asset_purchase: "Asset/business purchase",
  carve_out: "Carve-out",
  buyout: "Buyout",
  joint_venture: "Joint venture",
  proposal: "Announced proposal",
};

/**
 * Peer group of the target's business, used to decide which transaction multiples may be aggregated.
 * Multiples from different peer groups (e.g. software and pharma) are never pooled.
 */
export const PEER_GROUPS = [
  "banks",
  "nbfc",
  "insurance",
  "it-services",
  "software",
  "semiconductors",
  "media",
  "video-games",
  "consumer-internet",
  "consumer-brands",
  "retail",
  "pharma",
  "biotech",
  "hospitals",
  "cement",
  "steel",
  "autos",
  "industrial-machinery",
  "upstream-oil-gas",
  "renewable-power",
  "commercial-real-estate",
  "residential-real-estate",
  "cx-outsourcing",
] as const;
export type PeerGroupValue = (typeof PEER_GROUPS)[number];
export const PEER_GROUP_LABEL: Record<PeerGroupValue, string> = {
  banks: "Banks",
  nbfc: "Non-bank lenders (NBFCs)",
  insurance: "Insurance",
  "it-services": "IT services",
  software: "Software",
  semiconductors: "Semiconductors",
  media: "Media and entertainment",
  "video-games": "Video games",
  "consumer-internet": "Consumer internet platforms",
  "consumer-brands": "Consumer brands",
  retail: "Retail",
  pharma: "Pharmaceuticals",
  biotech: "Biotech",
  hospitals: "Hospitals",
  cement: "Cement",
  steel: "Steel",
  autos: "Automotive",
  "industrial-machinery": "Industrial machinery",
  "upstream-oil-gas": "Upstream oil and gas",
  "renewable-power": "Renewable power",
  "commercial-real-estate": "Commercial real estate",
  "residential-real-estate": "Residential real estate",
  "cx-outsourcing": "Customer-experience outsourcing",
};

export const DEAL_STATUSES = ["rumoured", "proposed", "announced", "pending_approvals", "approved", "completed", "withdrawn", "terminated"] as const;
export type DealStatusValue = (typeof DEAL_STATUSES)[number];
export const DEAL_STATUS_LABEL: Record<DealStatusValue, string> = {
  rumoured: "Rumoured",
  proposed: "Proposed",
  announced: "Announced",
  pending_approvals: "Pending approvals",
  approved: "Approved",
  completed: "Completed",
  withdrawn: "Withdrawn",
  terminated: "Terminated",
};

export const BUYER_TYPES = ["strategic", "sponsor", "sovereign", "consortium", "financial_investor"] as const;
export type BuyerTypeValue = (typeof BUYER_TYPES)[number];
export const BUYER_TYPE_LABEL: Record<BuyerTypeValue, string> = {
  strategic: "Strategic",
  sponsor: "Financial sponsor",
  sovereign: "Sovereign/state investor",
  consortium: "Consortium",
  financial_investor: "Strategic financial institution",
};

export const PAYMENT_TYPES = ["cash", "stock", "debt_assumption", "mixed", "undisclosed", "other"] as const;
export const PAYMENT_LABEL: Record<(typeof PAYMENT_TYPES)[number], string> = {
  cash: "Cash",
  stock: "Stock",
  debt_assumption: "Debt assumed",
  mixed: "Mixed",
  undisclosed: "Undisclosed",
  other: "Other",
};

export const VALUE_BASES = ["enterprise", "equity", "stake", "unclear"] as const;
export type ValueBasisValue = (typeof VALUE_BASES)[number];
export const VALUE_BASIS_LABEL: Record<ValueBasisValue, string> = {
  enterprise: "Enterprise value",
  equity: "Equity value",
  stake: "Stake consideration",
  unclear: "Reported, basis unclear",
};
export const VALUE_BASIS_SHORT: Record<ValueBasisValue, string> = {
  enterprise: "EV",
  equity: "Equity",
  stake: "Stake",
  unclear: "Basis unclear",
};

export const VERIFICATION_STATUSES = ["source_checked", "search_corroborated", "pending", "conflict", "human_reviewed"] as const;
export type VerificationValue = (typeof VERIFICATION_STATUSES)[number];
export const VERIFICATION_LABEL: Record<VerificationValue, string> = {
  source_checked: "Source checked",
  search_corroborated: "Search-corroborated",
  pending: "Pending check",
  conflict: "Conflicting sources",
  human_reviewed: "Human reviewed",
};
export const VERIFICATION_HELP: Record<VerificationValue, string> = {
  source_checked: "Matched against the text of the retrieved source document.",
  search_corroborated:
    "Matched against search-engine results that cite this source. The document itself was not retrieved by the build environment, so this is weaker than a direct source check.",
  pending: "Recorded but not yet matched to retrieved evidence. Treat as a lead.",
  conflict: "Sources disagree. Both are retained; see the note for the active interpretation.",
  human_reviewed: "Reviewed by the site owner in the app.",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  rumour: "Rumour",
  announcement: "Announcement",
  revision: "Revised terms",
  regulatory_filing: "Regulatory filing",
  regulatory_approval: "Regulatory approval",
  regulatory_decision: "Regulatory decision",
  shareholder_approval: "Shareholder approval",
  court_approval: "Court/tribunal approval",
  open_offer: "Open offer",
  completion: "Completion",
  termination: "Termination",
  withdrawal: "Withdrawal",
  subsequent: "Subsequent event",
};

export const CARD_TYPES = ["who_bought_what", "consideration_structure", "rationale", "valuation_insight", "risk", "sixty_second", "concept"] as const;
export type CardTypeValue = (typeof CARD_TYPES)[number];
export const CARD_TYPE_LABEL: Record<CardTypeValue, string> = {
  who_bought_what: "Who bought what",
  consideration_structure: "Consideration and structure",
  rationale: "Rationale",
  valuation_insight: "One valuation insight",
  risk: "One risk",
  sixty_second: "60-second explanation",
  concept: "Concept",
};

export const NOTE_TEMPLATE_LABEL: Record<string, string> = {
  blank: "Blank note",
  deal_note: "One-page deal note",
  sector_thesis: "Sector thesis",
  company_note: "Company research note",
  weekly_reflection: "Weekly reflection",
  deal_view: "Your view on a deal",
  research_question: "Research question",
};
