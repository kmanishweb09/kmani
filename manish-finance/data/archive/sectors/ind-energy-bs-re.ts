import type { SectorInput } from "../../../shared/schemas/research";
import { ws } from "../lib";

export const industrials: SectorInput = {
  slug: "industrials",
  name: "Industrials",
  tagline: "Capital goods, vehicles, materials and engineering — order books, cycles and operating leverage.",
  howItMakesMoney:
    "Industrial companies make or build physical things for other businesses. Capital-goods and engineering firms win projects and recognise revenue as they execute an order book; vehicle makers sell units into cyclical demand plus spares and services; materials producers (steel, cement) earn a spread between product prices and input costs. Profitability depends on utilisation — fixed costs are high, so small changes in volume move margins sharply — and on how much capital (plants, working capital) each rupee of revenue ties up.",
  valueAccrual:
    "Value accrues to firms with technology or scale leadership, pricing power in consolidated markets, recurring aftermarket and service revenue, and disciplined capital allocation (high ROCE through the cycle). Commodity-like producers capture value only at the low-cost end of the curve.",
  subsectors: [
    { id: "capital-goods", name: "Capital goods and engineering", businessModel: "Project-based EPC and equipment with multi-year order books.", keyMetrics: ["order-book", "book-to-bill", "working-capital-days"], valuation: "P/E and EV/EBITDA on normalised margins; order-book coverage as a cross-check." },
    { id: "autos-cv", name: "Automotive and commercial vehicles", businessModel: "Unit sales into cyclical freight and consumer demand plus spares and financing.", keyMetrics: ["utilisation", "ebitda-margin-ind"], valuation: "EV/EBITDA on mid-cycle volumes." },
    { id: "materials", name: "Steel and cement", businessModel: "Commodity products priced per tonne; regional markets for cement, global for steel.", keyMetrics: ["utilisation", "ev-per-tonne"], valuation: "EV/EBITDA and EV per tonne of capacity; replacement cost." },
    { id: "automation", name: "Automation and robotics", businessModel: "Equipment and software for factory automation; tied to manufacturing capex.", keyMetrics: ["book-to-bill", "ebitda-margin-ind"], valuation: "EV/EBITDA and EV/revenue for growth assets." },
  ],
  valueChain: [
    { stage: "Raw materials", description: "Iron ore, coal, limestone, energy.", economics: "Input costs set the floor for materials margins.", examples: ["nippon-steel", "ambuja-cements"] },
    { stage: "Manufacturing and assembly", description: "Plants producing steel, cement, vehicles and equipment.", economics: "High fixed costs; utilisation drives returns.", examples: ["tata-motors", "nippon-steel"] },
    { stage: "Projects and services", description: "EPC contractors and aftermarket services.", economics: "Order-book visibility; service revenue is stickier.", examples: ["larsen-toubro"] },
  ],
  metrics: [
    { id: "order-book", name: "Order book / backlog", formula: "Value of contracted but unexecuted orders at period end", denominator: "n/a (often shown as years of revenue)", interpretation: "Revenue visibility.", limitations: "Definitions differ (inclusion of L1 positions, cancellations); not all orders are profitable.", unit: "currency" },
    { id: "book-to-bill", name: "Book-to-bill", formula: "Order inflow ÷ revenue for the period", denominator: "Revenue", interpretation: "Above 1 means the backlog is growing.", limitations: "Lumpy large orders distort single quarters.", unit: "ratio" },
    { id: "utilisation", name: "Capacity utilisation", formula: "Actual output ÷ installed capacity", denominator: "Installed capacity", interpretation: "Operating leverage indicator.", limitations: "Nameplate vs effective capacity differ.", unit: "percent" },
    { id: "ebitda-margin-ind", name: "EBITDA margin", formula: "EBITDA ÷ revenue", denominator: "Revenue", interpretation: "Operating profitability; normalise across the cycle.", limitations: "Commodity pass-through clauses inflate revenue without changing profit.", unit: "percent" },
    { id: "roce", name: "Return on capital employed (ROCE)", formula: "EBIT ÷ (equity + net debt), or EBIT ÷ (total assets − current liabilities)", denominator: "Capital employed (definitions vary)", interpretation: "Returns on the capital the business ties up.", limitations: "Goodwill and revaluations change the base.", unit: "percent" },
    { id: "working-capital-days", name: "Net working-capital days", formula: "(Receivables + inventory − payables) ÷ revenue × 365", denominator: "Revenue", interpretation: "Cash tied up in operations; high for EPC.", limitations: "Year-end timing; customer advances change it.", unit: "days" },
    { id: "ev-per-tonne", name: "EV per tonne of capacity", formula: "Enterprise value ÷ installed capacity (tonnes per annum)", denominator: "Installed capacity", interpretation: "Asset-based cross-check for cement and steel deals.", limitations: "Ignores location, efficiency and utilisation.", unit: "currency" },
  ],
  valuation: [
    { method: "EV/EBITDA on mid-cycle earnings", whenUseful: "Cyclical manufacturers.", whenMisleading: "Using peak or trough EBITDA without normalising." },
    { method: "EV per unit of capacity", whenUseful: "Cement and steel transactions; replacement-cost comparisons.", whenMisleading: "When assets are old, badly located or under-utilised." },
    { method: "P/E with order-book cross-check", whenUseful: "Engineering and EPC companies.", whenMisleading: "When working capital absorbs profits (earnings not converting to cash)." },
  ],
  mnaMotives: [
    "Buy capacity faster than building it (Adani–Ambuja/ACC).",
    "Globalise and gain technology (Tata Motors–Iveco, Nippon Steel–U.S. Steel).",
    "Carve out non-core divisions to specialist owners (ABB Robotics to SoftBank).",
    "Simplify group cross-holdings through take-privates (Toyota Industries).",
  ],
  integrationIssues: ["Plant integration and maintenance capex backlog", "Labour relations and union agreements", "Customer certification of new plants and suppliers", "Environmental liabilities"],
  diligenceQuestions: [
    "What is mid-cycle demand, and where are we in the cycle?",
    "How much maintenance capex is needed vs reported depreciation?",
    "Are commodity costs passed through to customers, and with what lag?",
    "What national-security or foreign-investment reviews apply?",
    "How concentrated is the customer base?",
  ],
  recurringStructures: ["Tender offers with mandatory open offers (India) or squeeze-outs (Japan)", "Carve-outs with transition service agreements", "National security agreements or golden shares in sensitive sectors (U.S. Steel)"],
  regulators: [
    { body: "Competition Commission of India (CCI)", url: "https://www.cci.gov.in", role: "Merger control." },
    { body: "Ministry of Labour and Employment", url: "https://labour.gov.in", role: "Labour codes affecting manufacturing workforces." },
  ],
  whatChanged: [
    { date: "2025-06-13", stage: "approval", title: "U.S. executive order allows Nippon Steel–U.S. Steel with a golden share", detail: "National security agreement conditions; the deal closed on 18 June 2025.", cites: [ws("fedreg-nippon-2025-06-20")] },
    { date: "2025-10-01", stage: "effective", title: "Tata Motors demerger takes effect", detail: "Commercial vehicles and passenger vehicles split into separately listed companies; the CV company listed on 12 November 2025.", cites: [ws("autocarpro-tata-demerger-2025"), ws("bt-tmcv-listing-2025-11-12")] },
    { date: "2025-11-21", stage: "effective", title: "India's four labour codes take effect", detail: "Codes on wages, industrial relations, social security and occupational safety replace 29 laws; central rules were issued in draft later.", cites: [ws("pib-labour-codes-2025-11-21")] },
  ],
  players: [
    { companyId: "larsen-toubro", group: "India — engineering and construction" },
    { companyId: "tata-motors", group: "India — commercial vehicles" },
    { companyId: "ambuja-cements", group: "India — cement" },
    { companyId: "nippon-steel", group: "Asia — steel" },
  ],
  practiceQuestionIds: ["q-ind-1", "q-ind-2", "q-ind-3", "q-ind-4", "q-ind-5"],
  sourcesNote: "Order-book and capacity definitions are company-specific.",
  recordUpdated: "2026-09-25",
};

export const energyInfra: SectorInput = {
  slug: "energy-infrastructure",
  name: "Energy & Infrastructure",
  tagline: "Oil and gas, power, renewables and contracted infrastructure — reserves, capacity, offtake and project cash flows.",
  howItMakesMoney:
    "Energy and infrastructure businesses sell a commodity or a service from long-lived physical assets. Upstream oil and gas producers earn price minus lifting and development cost per barrel. Power producers sell electricity either under long-term power purchase agreements (PPAs) at fixed tariffs or into merchant markets. Transmission, roads and ports earn regulated or concession-based returns. Much value sits in project companies (SPVs) financed with non-recourse debt, so equity returns depend on leverage and refinancing.",
  valueAccrual:
    "Value accrues to low-cost reserves, contracted cash flows with creditworthy offtakers, and developers who can build at lower cost of capital than the returns they lock in. Merchant exposure and weak counterparties (some state distribution companies) reduce value.",
  subsectors: [
    { id: "upstream", name: "Oil and gas upstream", businessModel: "Exploration and production; reserves in joint operating agreements.", keyMetrics: ["reserves", "cost-per-boe"], valuation: "NAV of reserves, EV per flowing barrel, EV/EBITDAX." },
    { id: "power-renewables", name: "Power and renewables", businessModel: "Generation under PPAs or merchant; renewable build-out with storage.", keyMetrics: ["capacity-mw", "plf-cuf", "contracted-share"], valuation: "Project DCF and equity IRR; EV per MW for acquisitions." },
    { id: "infra-assets", name: "Transport and transmission infrastructure", businessModel: "Concession or regulated returns; often held in InvITs.", keyMetrics: ["dscr", "contracted-share"], valuation: "Dividend yield / DCF to concession end; InvIT NAV." },
  ],
  valueChain: [
    { stage: "Resources and development", description: "Reserves, land, permits and grid connectivity.", economics: "Scarce inputs; permitting delays destroy value.", examples: ["exxonmobil"] },
    { stage: "Construction", description: "EPC for plants, wells and lines.", economics: "Cost overruns hit equity IRR.", examples: ["jsw-energy"] },
    { stage: "Operation and offtake", description: "Running assets and selling output.", economics: "Contract terms and counterparty quality drive cash-flow certainty.", examples: ["jsw-energy", "reliance-industries"] },
  ],
  metrics: [
    { id: "capacity-mw", name: "Installed capacity (MW)", formula: "Sum of commissioned generating capacity", denominator: "n/a", interpretation: "Scale of a power portfolio.", limitations: "Capacity ≠ output; mix and utilisation matter.", unit: "count" },
    { id: "plf-cuf", name: "PLF / CUF", formula: "Actual energy generated ÷ (capacity × hours in period)", denominator: "Maximum possible generation", interpretation: "Utilisation (PLF for thermal, CUF for renewables).", limitations: "Weather, curtailment and grid availability drive renewables CUF.", unit: "percent" },
    { id: "contracted-share", name: "Contracted vs merchant share", formula: "Capacity or revenue under long-term PPAs ÷ total", denominator: "Total capacity or revenue", interpretation: "Cash-flow certainty.", limitations: "PPA counterparty credit matters as much as the contract.", unit: "percent" },
    { id: "dscr", name: "Debt service coverage ratio (DSCR)", formula: "Cash flow available for debt service ÷ scheduled principal + interest", denominator: "Scheduled debt service", interpretation: "Project-finance headroom.", limitations: "Defined in loan agreements; varies.", unit: "ratio" },
    { id: "reserves", name: "Proved reserves", formula: "Estimated recoverable volumes under defined criteria (SEC or PRMS)", denominator: "n/a", interpretation: "Resource base supporting future production.", limitations: "Reserve categories (1P/2P) and price decks differ.", unit: "other" },
    { id: "cost-per-boe", name: "Cost per barrel of oil equivalent", formula: "Operating (and sometimes development) cost ÷ production volume", denominator: "Barrels of oil equivalent produced", interpretation: "Competitiveness through the price cycle.", limitations: "Inclusions vary.", unit: "currency" },
  ],
  valuation: [
    { method: "Project DCF and equity IRR", whenUseful: "Contracted power and infrastructure projects with defined lives.", whenMisleading: "When tariff renegotiation, curtailment or refinancing risk is ignored." },
    { method: "EV per MW / per flowing barrel", whenUseful: "Transaction benchmarks for portfolios.", whenMisleading: "Ignores age, contract terms and location." },
    { method: "NAV of reserves", whenUseful: "Upstream companies with defined reserves.", whenMisleading: "Commodity price deck assumptions dominate." },
  ],
  mnaMotives: [
    "Buy contiguous acreage and inventory (ExxonMobil–Pioneer).",
    "Buy long-life discovered resources (Chevron–Hess for Guyana).",
    "Buy operating and under-construction renewables to accelerate capacity targets (JSW–O2 Power).",
  ],
  integrationIssues: ["Partner consents and change-of-control clauses in joint operating agreements", "Refinancing project debt", "Integrating operations and maintenance contracts", "Decommissioning liabilities"],
  diligenceQuestions: [
    "Who are the offtakers, and what is their payment record?",
    "What share of cash flows is contracted, and for how long?",
    "Do partners have pre-emption or change-of-control rights (Stabroek)?",
    "What transmission charges and grid connectivity apply after the ISTS waiver phase-out?",
    "What refinancing and interest-rate risks sit in the SPVs?",
  ],
  recurringStructures: ["All-stock mergers among oil majors", "Platform acquisitions of renewable portfolios from sponsors", "InvIT structures for operating infrastructure"],
  regulators: [
    { body: "Central Electricity Regulatory Commission (CERC)", url: "https://cercind.gov.in", role: "Inter-state tariffs and power markets." },
    { body: "Ministry of Power", url: "https://powermin.gov.in", role: "Power policy, including ISTS charges." },
    { body: "Ministry of New and Renewable Energy (MNRE)", url: "https://mnre.gov.in", role: "Renewable energy policy." },
  ],
  whatChanged: [
    { date: "2025-07-01", stage: "effective", title: "ISTS charge waiver for renewables begins to phase out", detail: "Projects commissioned from July 2025 to June 2026 pay 25% of applicable inter-state transmission charges, rising in steps to 100% from July 2028.", cites: [ws("tnd-ists-2025"), ws("crisil-ists-2025-07")] },
    { date: "2025-07-18", stage: "market_event", title: "Stabroek arbitration clears Chevron–Hess", detail: "The ICC tribunal rejected ExxonMobil's claimed pre-emption right, showing how JOA terms can hold up corporate deals.", cites: [ws("cnbc-cvx-hess-2025-07-18")] },
    { date: "2025-12-09", stage: "rule", title: "SEBI amends REIT and InvIT regulations", detail: "Harmonised amendments, including a wider definition of strategic investors in InvITs and REITs.", cites: [ws("lexology-reit-invit-2025-12")] },
  ],
  players: [
    { companyId: "reliance-industries", group: "India — integrated energy" },
    { companyId: "jsw-energy", group: "India — power and renewables" },
    { companyId: "exxonmobil", group: "Global — oil and gas" },
  ],
  practiceQuestionIds: ["q-en-1", "q-en-2", "q-en-3", "q-en-4", "q-en-5"],
  sourcesNote: "Distinguish operating companies from project SPVs and contracted from merchant capacity.",
  recordUpdated: "2026-09-25",
};

export const businessServices: SectorInput = {
  slug: "business-services",
  name: "Business Services",
  tagline: "BPO and CX outsourcing, professional services, testing and staffing — people businesses with recurring contracts.",
  howItMakesMoney:
    "Business-services firms sell labour, expertise or managed processes to other companies. CX outsourcers (contact centres, trust and safety) bill per hour or per transaction; professional-services firms bill per project or retainer; testing, inspection and certification firms charge per test; staffing firms earn a markup on placed workers' pay. Revenue scales with people, so margins depend on utilisation, pricing, delivery-location mix and attrition.",
  valueAccrual:
    "Value accrues to firms with recurring multi-year contracts, specialised skills that command higher billing rates, low client concentration and delivery from lower-cost locations. Automation and AI shift value toward firms that sell outcomes rather than hours.",
  subsectors: [
    { id: "cx-bpo", name: "CX and BPO", businessModel: "Contact-centre and back-office services on multi-year contracts.", keyMetrics: ["organic-growth-bs", "attrition", "client-concentration"], valuation: "EV/EBITDA and P/E; discounts for automation risk." },
    { id: "professional-services", name: "Professional and engineering services", businessModel: "Project and retainer work by skilled professionals.", keyMetrics: ["utilisation-bs", "revenue-per-employee"], valuation: "EV/EBITDA and P/E; talent retention matters." },
    { id: "staffing", name: "Staffing and HR services", businessModel: "Markup on temporary workers' wages; volumes follow the economy.", keyMetrics: ["organic-growth-bs", "dso"], valuation: "EV/EBITDA on normalised volumes; low margins, high asset turns." },
  ],
  valueChain: [
    { stage: "Talent acquisition and training", description: "Hiring and training agents or professionals.", economics: "Attrition raises costs; training is a moat for specialised work.", examples: ["teleperformance", "concentrix"] },
    { stage: "Delivery", description: "Operating centres onshore, nearshore and offshore.", economics: "Location mix drives margins.", examples: ["concentrix"] },
    { stage: "Technology and automation", description: "Platforms, analytics and AI tools layered on services.", economics: "Can raise productivity but cannibalise hours billed.", examples: ["teleperformance"] },
  ],
  metrics: [
    { id: "organic-growth-bs", name: "Organic revenue growth", formula: "Growth excluding acquisitions and currency", denominator: "Prior-period revenue", interpretation: "Underlying demand.", limitations: "Company-defined.", unit: "percent" },
    { id: "utilisation-bs", name: "Utilisation", formula: "Billable hours ÷ available hours", denominator: "Available hours", interpretation: "Productivity of the workforce.", limitations: "Definitions vary (trainees, bench).", unit: "percent" },
    { id: "attrition", name: "Employee attrition", formula: "Leavers in the last 12 months ÷ average headcount", denominator: "Average headcount", interpretation: "Cost and service-quality pressure.", limitations: "Voluntary vs total; trailing vs annualised.", unit: "percent" },
    { id: "revenue-per-employee", name: "Revenue per employee", formula: "Revenue ÷ average headcount", denominator: "Average headcount", interpretation: "Pricing and mix of work.", limitations: "Mix of locations distorts comparisons.", unit: "currency" },
    { id: "client-concentration", name: "Client concentration", formula: "Revenue from top 10 (or largest) clients ÷ total revenue", denominator: "Total revenue", interpretation: "Dependence on a few customers.", limitations: "Disclosure varies.", unit: "percent" },
    { id: "dso", name: "Days sales outstanding (DSO)", formula: "Receivables ÷ revenue × 365", denominator: "Revenue", interpretation: "Billing and collection quality.", limitations: "Unbilled revenue treatment differs.", unit: "days" },
  ],
  valuation: [
    { method: "EV/EBITDA", whenUseful: "Mature services firms with stable margins.", whenMisleading: "When lease-heavy delivery centres change EBITDA or when AI disruption makes history a poor guide." },
    { method: "P/E and FCF yield", whenUseful: "Cash-generative firms returning capital.", whenMisleading: "When acquisition amortisation distorts earnings." },
    { method: "Buy-and-build multiple arbitrage", whenUseful: "Explaining sponsor roll-ups of small firms bought at lower multiples.", whenMisleading: "Assumes the combined firm will re-rate; integration often fails." },
  ],
  mnaMotives: [
    "Consolidate a fragmented industry for scale and client breadth (Concentrix–Webhelp, Teleperformance–Majorel).",
    "Add capabilities or geographies clients ask for.",
    "Buy-and-build strategies by sponsors.",
  ],
  integrationIssues: ["Retaining talent and managers", "Client conflicts between competitors served by the combined firm", "Harmonising pay and delivery platforms", "Founder dependence in acquired firms"],
  diligenceQuestions: [
    "How recurring and concentrated is revenue?",
    "What are attrition, utilisation and wage inflation trends?",
    "How exposed are services to AI automation?",
    "What are the labour-law and data-protection obligations (labour codes, DPDP)?",
    "How good is billing quality (DSO, unbilled revenue)?",
  ],
  recurringStructures: ["Share-and-cash consideration with sellers' notes (Concentrix–Webhelp)", "Public tender offers with cash and share alternatives (Teleperformance–Majorel)", "Earn-outs tied to founder retention"],
  regulators: [
    { body: "Ministry of Labour and Employment", url: "https://labour.gov.in", role: "Labour codes." },
    { body: "Ministry of Electronics and IT (MeitY)", url: "https://www.meity.gov.in", role: "Data protection (DPDP Act and Rules)." },
  ],
  whatChanged: [
    { date: "2025-11-21", stage: "effective", title: "Four labour codes take effect", detail: "Uniform wage definitions, social-security coverage (including gig and platform workers) and appointment letters.", cites: [ws("pib-labour-codes-2025-11-21")] },
    { date: "2025-12-30", stage: "consultation", title: "Draft central rules under the labour codes published", detail: "Central rules released in draft for consultation after the codes took effect.", cites: [ws("kpmg-labour-draft-rules-2026")] },
    { date: "2027-05-13", stage: "effective", title: "DPDP compliance obligations scheduled for data processors", detail: "Future date; relevant for outsourcers processing personal data for clients.", cites: [ws("sam-dpdp-2025-11")] },
  ],
  players: [
    { companyId: "concentrix", group: "Global — CX outsourcing" },
    { companyId: "teleperformance", group: "Global — CX outsourcing" },
  ],
  practiceQuestionIds: ["q-bs-1", "q-bs-2", "q-bs-3", "q-bs-4", "q-bs-5"],
  sourcesNote: "Indian IT services companies appear under TMT; business services here covers outsourcing and people-based services.",
  recordUpdated: "2026-09-25",
};

export const realEstate: SectorInput = {
  slug: "real-estate",
  name: "Real Estate",
  tagline: "Developers, rental platforms and REITs — pre-sales versus revenue, NOI versus cap rates.",
  howItMakesMoney:
    "Real estate has two very different models. Developers buy land, obtain approvals, sell homes or offices before or during construction (pre-sales), collect cash in instalments and recognise revenue when projects are completed. Rental owners (including REITs) hold completed offices, malls and warehouses and earn contracted rents; value is net operating income (NOI) capitalised at a market cap rate. Platforms and sponsors earn fees for managing assets for institutional capital.",
  valueAccrual:
    "Value accrues to owners of well-located land and assets with strong tenant demand, developers with fast approvals and execution, and rental platforms with low vacancy, long leases and access to low-cost capital. Leverage magnifies returns and risks.",
  subsectors: [
    { id: "developers", name: "Residential and commercial developers", businessModel: "Land to finished product sold to buyers; cash from pre-sales funds construction.", keyMetrics: ["pre-sales", "collections", "net-debt-re"], valuation: "NAV of land bank and projects; P/E is misleading because revenue recognition lags." },
    { id: "rental", name: "Rental platforms and REITs", businessModel: "Own and lease completed assets; distribute cash flow.", keyMetrics: ["noi", "cap-rate", "occupancy-re", "wale"], valuation: "NAV (NOI ÷ cap rate − debt), distribution yield, price/NAV." },
    { id: "platforms", name: "Real-estate investment managers", businessModel: "Fee income for managing funds and REITs.", keyMetrics: ["noi"], valuation: "P/E on fee earnings; asset manager metrics." },
  ],
  valueChain: [
    { stage: "Land and approvals", description: "Acquiring land with clear title and permissions.", economics: "The biggest source of risk and value in India.", examples: ["dlf"] },
    { stage: "Development", description: "Construction and sales.", economics: "Cash-flow timing depends on pre-sales and collections.", examples: ["dlf"] },
    { stage: "Ownership and leasing", description: "Stabilised rental assets.", economics: "Bond-like cash flows valued on cap rates.", examples: ["dlf-cyber-city", "mapletree-pact", "blackstone"] },
  ],
  metrics: [
    { id: "pre-sales", name: "Pre-sales (sales bookings)", formula: "Value of units booked in the period", denominator: "n/a", interpretation: "Demand and future cash inflows for developers.", limitations: "Not revenue; cancellations and booking definitions vary.", unit: "currency" },
    { id: "collections", name: "Collections", formula: "Cash received from customers in the period", denominator: "n/a", interpretation: "Cash reality behind pre-sales.", limitations: "Timing of instalments.", unit: "currency" },
    { id: "net-debt-re", name: "Net debt", formula: "Borrowings − cash and liquid investments", denominator: "n/a (compare with equity or NOI)", interpretation: "Leverage and resilience.", limitations: "Customer advances and lease liabilities complicate.", unit: "currency" },
    { id: "noi", name: "Net operating income (NOI)", formula: "Rental and related income − property operating expenses", denominator: "n/a", interpretation: "Cash earnings of rental assets before financing and corporate costs.", limitations: "Definitions differ across jurisdictions and REITs.", unit: "currency" },
    { id: "cap-rate", name: "Capitalisation rate", formula: "NOI ÷ property value", denominator: "Property value", interpretation: "Market pricing of rental income; lower cap rate = higher value.", limitations: "Appraisal-based; lags market changes.", unit: "percent" },
    { id: "occupancy-re", name: "Leased occupancy", formula: "Leased area ÷ leasable area", denominator: "Leasable area", interpretation: "Demand for rental space.", limitations: "Committed vs occupied differ.", unit: "percent" },
    { id: "wale", name: "Weighted average lease expiry (WALE)", formula: "Σ (remaining lease term × rent) ÷ total rent", denominator: "Total rent", interpretation: "Income security.", limitations: "Break clauses reduce effective WALE.", unit: "other" },
  ],
  valuation: [
    { method: "NAV (sum of project values or NOI ÷ cap rate − net debt)", whenUseful: "Developers and rental portfolios.", whenMisleading: "When cap rates or land values are appraised optimistically." },
    { method: "Distribution yield and price/NAV", whenUseful: "Listed REITs.", whenMisleading: "When distributions are funded by debt or one-offs." },
    { method: "P/E", whenUseful: "Stable fee-based platforms.", whenMisleading: "Developers — revenue recognition timing makes earnings lumpy and unrelated to value created." },
  ],
  mnaMotives: [
    "Institutional capital buying stabilised rental assets (GIC–DCCDL, Blackstone–AIR).",
    "REIT consolidation for scale and diversification (MCT–MNACT).",
    "Take-privates when public markets price REITs below NAV.",
  ],
  integrationIssues: ["Harmonising leases and property management", "Tax structures of trusts and SPVs", "Sponsor conflicts of interest"],
  diligenceQuestions: [
    "Is the land title clean and are approvals in place?",
    "What is the rent roll: tenant concentration, lease expiries and escalations?",
    "How do pre-sales reconcile to collections and recognised revenue?",
    "Is the transaction an asset purchase or a share purchase, and what are the tax consequences?",
    "How sensitive is value to cap-rate changes?",
  ],
  recurringStructures: ["Minority stake sales in rental platforms to sovereign funds (GIC–DCCDL)", "Trust schemes of arrangement for REIT mergers", "Take-privates of listed REITs by sponsors"],
  regulators: [
    { body: "SEBI (REITs and SM REITs)", url: "https://www.sebi.gov.in", role: "REIT regulations, including small and medium REITs." },
    { body: "Ministry of Housing and Urban Affairs", url: "https://mohua.gov.in", role: "RERA framework (enforced by state authorities)." },
  ],
  whatChanged: [
    { date: "2024-03-08", stage: "rule", title: "SEBI notifies the small and medium REIT (SM REIT) framework", detail: "Allows REIT schemes for assets of ₹50 crore and above, versus ₹500 crore for regular REITs.", cites: [ws("sebi-smreit-faq-2024-09"), ws("nishith-smreit-2024")] },
    { date: "2025-12-09", stage: "rule", title: "SEBI amends REIT and InvIT regulations", detail: "Includes a broader strategic-investor definition.", cites: [ws("lexology-reit-invit-2025-12")] },
    { date: "2026-09-22", stage: "rule", title: "RBI clarifies bank valuation of REIT and InvIT units", detail: "Quoted units valued as quoted securities; unquoted units at the trust's disclosed NAV.", cites: [ws("taxguru-rbi-invit-2026-09")] },
  ],
  players: [
    { companyId: "dlf", group: "India — developers" },
    { companyId: "dlf-cyber-city", group: "India — rental platforms" },
    { companyId: "mapletree-pact", group: "Asia — REITs" },
    { companyId: "blackstone", group: "Global — real-estate investors" },
  ],
  practiceQuestionIds: ["q-re-1", "q-re-2", "q-re-3", "q-re-4", "q-re-5"],
  sourcesNote: "Do not use one valuation template for developers and rental owners.",
  recordUpdated: "2026-09-25",
};
