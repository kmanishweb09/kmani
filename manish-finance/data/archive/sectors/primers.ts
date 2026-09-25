/**
 * Analyst primers: the connective reasoning of each playbook. Written for Finance Desk as analysis
 * (not sourced claims); dated facts referenced here are cited in the playbook's deals and "What changed" feed.
 */
export const PRIMERS: Record<string, string> = {
  fig: `**Start with the balance sheet, not the income statement.** For a bank, deposits are raw material, not financing. That is why enterprise value is not meaningful and why analysts value the equity directly: price-to-book against return on equity, or a residual-income model where value equals today's book plus the present value of future returns above the cost of equity.

**Separate the four FIG business models before comparing anything.** A spread business (HDFC Bank, Shriram Finance), an underwriting business (a general insurer), a fee business (an asset manager such as Blackstone) and a toll business (an exchange or payment network) need different metrics. Comparing an NBFC's NIM with a bank's, or an insurer's P/E with a bank's, without adjusting for funding and capital, produces false conclusions.

**Capital is the constraint.** Growth consumes regulatory capital, so the question in almost every Indian FIG deal of 2025–26 was who supplies it: Emirates NBD injected primary capital into RBL, MUFG into Shriram, Blackstone into Federal Bank through warrants. Each deal price should be read as a price for capital plus control or influence — and pre-money versus post-money value matters.

**Regulation changes the numbers you compare.** RBI's move to expected-credit-loss provisioning from April 2027 will change reported asset quality and book value; Swiss capital rules show how a regulator can reprice a completed merger years later. Always record whether a number is an accounting figure or a regulatory one.`,
  tmt: `**Classify the revenue before choosing a multiple.** A rupee of Wipro services revenue, a dollar of VMware subscription revenue and a rupee of JioStar advertising revenue carry different margins, risk and durability. Most valuation mistakes in TMT come from applying one multiple across these.

**Recurring revenue is valuable only if it is retained.** Net revenue retention, churn and gross margin tell you whether an installed base compounds. Broadcom paid for VMware because switching costs gave it pricing power; the test after the deal was whether customers stayed despite price increases.

**Platforms are judged on unit economics and regulation.** For marketplaces and delivery apps, GMV shows scale, but contribution margin per order shows whether scale creates value. Ride-hailing consolidation (Grab–Uber) and media consolidation (Reliance–Disney) both reduced competition — which is exactly what competition authorities examine.

**Antitrust is part of valuation.** Microsoft–Activision took 21 months and ended with a divestiture of cloud rights. India's deal value threshold (from September 2024) now brings high-value digital acquisitions with small Indian turnover under CCI review, and the DPDP Rules add data-protection diligence for any data-heavy target.

**India angle.** Indian IT services firms grow through bolt-on acquisitions for capabilities and clients (Wipro–Harman DTS, LTI–Mindtree merger). Watch constant-currency growth, large-deal TCV, margin bands and attrition.`,
  healthcare: `**Products and services are different businesses.** A pharma company sells a regulated product with high gross margins but binary approval and compliance risk; a hospital sells capacity, doctors' time and trust, with operating leverage once beds mature. Valuation, diligence and integration all differ.

**In Indian pharma, the domestic branded business is the anchor.** Chronic-therapy brands prescribed by doctors earn stable, high margins; that is why Torrent paid a large premium for JB Chemicals' cardiac brands. U.S. generics are more volatile — price erosion and FDA inspections can swing earnings — while specialty products (Sun's global specialty portfolio) can lift margins if launches succeed.

**Hospital economics follow occupancy and ARPOB.** New hospitals lose money for several years before maturing; a chain's consolidated EBITDA margin mixes mature and new beds, so compare cohorts, not totals. Doctor retention and payer mix (cash, insurance, government schemes) drive ARPOB.

**Quality systems are a deal risk.** India's revised Schedule M raised manufacturing standards for all drugmakers (larger firms from January 2025, extended MSME deadline to December 2025). An acquirer inheriting a plant with compliance gaps inherits remediation costs and possible supply interruptions.

**Global context.** Pfizer–Seagen shows the patent-cliff motive: large pharma buying late-stage or commercial assets to replace revenue. Indian acquirers more often buy brands, market access or minority buyouts (Sun–Taro).`,
  consumer: `**Decompose growth into volume, price and mix.** HUL reports underlying volume growth separately because price increases can hide weak demand. A consumer brand with rising revenue but falling volumes may be losing relevance.

**GMV is not revenue; sell-in is not sell-through.** Platforms like Flipkart and Eternal report gross order values, but their revenue is a take rate plus fees (or gross sales if they hold inventory, which India's FDI rules restrict for foreign-owned marketplaces). FMCG companies' reported sales are sell-in to distributors; consumer offtake (sell-through) can diverge, especially when channels destock.

**Channels are shifting.** Quick commerce is taking share in urban India, changing trade terms for brands and giving platforms advertising income. Large incumbents respond by buying digital-first brands (HUL–Minimalist) — paying for growth, customer data and founder energy, which must be retained after the deal.

**Taxes and regulation move demand.** The September 2025 GST rationalisation lowered rates on many everyday goods; when rates fall, volumes may rise and companies must decide how much benefit to pass on.

**Global context.** Kimberly-Clark–Kenvue is a scale-and-synergy deal that also inherits product litigation; Couche-Tard's withdrawn approach to Seven & i shows that target boards and governance norms can stop a well-financed bidder. In consumer M&A, the brand is the asset — diligence the brand's health, not just the P&L.`,
  industrials: `**Think in cycles.** Industrial earnings swing with capex, freight and construction cycles. Value an industrial company on mid-cycle margins and volumes, not the latest quarter. Commercial vehicles (Tata Motors) and steel (Nippon Steel–U.S. Steel) are classic cyclicals; engineering and construction (L&T) is driven by order books.

**Order books are visibility, not profit.** Check book-to-bill, the margin embedded in new orders, and working-capital days — EPC companies can report profits while cash stays tied up in receivables.

**Capacity is bought when it is cheaper than building.** Adani's purchase of Ambuja and ACC bought cement capacity and market position in one step; EV per tonne of capacity is a useful cross-check against replacement cost, but location, efficiency and utilisation matter.

**Strategic industries attract state scrutiny.** The Nippon Steel–U.S. Steel deal was blocked, then approved with a golden share and investment commitments. Tata Motors' offer for Iveco required selling the defence business separately. Expect national-security and foreign-investment reviews when targets touch defence, steel or critical supply chains.

**Group simplification is a recurring motive.** Demergers (Tata Motors' split into CV and PV companies) and take-privates (Toyota Industries) aim to remove conglomerate discounts and cross-holdings — minority shareholders and activists push on price when they believe the sum of the parts is worth more.`,
  "energy-infrastructure": `**Separate the asset from the company.** Much value sits in project SPVs with their own debt, offtake contracts and concession terms. Equity value depends on leverage, refinancing and the quality of the offtaker — a state distribution company with payment delays is not the same as a creditworthy corporate buyer.

**Contracted versus merchant exposure drives risk.** A renewable portfolio with 25-year PPAs behaves like a bond with construction risk; merchant capacity behaves like a commodity. JSW Energy's O2 Power acquisition bought operating and under-construction capacity to accelerate its targets — the price per MW only makes sense alongside contract terms and completion risk.

**Policy changes project returns.** India's phased withdrawal of the inter-state transmission charge waiver from July 2025 raises costs for new renewable projects connecting to the inter-state grid; bidders must reflect this in tariffs.

**In oil and gas, rights and partners matter.** Chevron–Hess shows that a joint operating agreement's pre-emption clause can delay a corporate deal for more than a year. ExxonMobil–Pioneer shows the scale logic of contiguous acreage.

**Valuation.** Use project DCF and equity IRR for contracted assets, NAV of reserves for upstream, and EV/EBITDA only for diversified operating companies — and always check what debt sits at the project level.`,
  "business-services": `**People are the product.** Business-services firms sell labour and expertise, so margins depend on utilisation, pricing and where the work is delivered from. India is both a delivery base (CX, back office, engineering services) and a growing domestic market.

**Scale consolidation is the dominant deal theme.** Concentrix–Webhelp and Teleperformance–Majorel (both 2023) combined large CX providers to serve global clients across more languages and locations. The pay-off depends on keeping clients and managers through integration — client conflicts can emerge when a combined firm serves competitors.

**Automation is both threat and opportunity.** Generative AI can reduce the number of human-handled interactions. Watch organic growth, pricing per transaction and the mix of higher-value services such as trust and safety or analytics. Valuation multiples in CX fell as markets priced this risk.

**Regulation raises the cost floor.** India's labour codes (effective November 2025) standardise wage definitions and extend social security to gig and platform workers; the DPDP Rules impose data-processing obligations from 2027. Diligence should test compliance and cost impact, not just revenue.

**Deal structures reflect uncertainty.** Sellers' notes, earn-outs and share consideration (as in Concentrix–Webhelp) align sellers with post-deal performance but expose them to the buyer's share price — the value at closing can differ materially from signing.`,
  "real-estate": `**Developers and rental owners are different businesses.** A developer's pre-sales show demand, collections show cash, and recognised revenue lags both — so P/E is a poor guide. A rental owner's value is NOI capitalised at a market cap rate, minus debt; occupancy, lease expiries and tenant quality drive it.

**NAV is the anchor.** For developers, NAV sums the value of land and projects; for rental portfolios, NOI ÷ cap rate − net debt. Listed REITs trade at premiums or discounts to NAV depending on interest rates and confidence in growth — Blackstone's take-private of AIR Communities is an example of buying listed assets when the public price looked low relative to private values.

**Institutional capital shapes Indian commercial real estate.** GIC's stake in DLF's rental arm (DCCDL) shows the model: sovereign funds buy into stabilised office portfolios, and developers recycle capital into new projects. REITs and SM REITs (from March 2024) provide listed exits.

**Asset versus share deals.** Buying shares of a company inherits its liabilities and tax history; buying assets can be cleaner but triggers stamp duty and transfer costs. Title, approvals and RERA compliance are core diligence items.

**Interest rates matter more than in most sectors.** Cap rates move with bond yields; a small rise in rates can wipe out several years of rent growth in valuation terms.`,
};
