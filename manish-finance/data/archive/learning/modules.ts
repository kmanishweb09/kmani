import type { LearningModule } from "../../../shared/schemas/research";

type ModuleInput = Omit<LearningModule, "related"> & { related?: LearningModule["related"] };

const DAMODARAN = { title: "Damodaran Online (valuation data and lecture notes)", publisher: "Aswath Damodaran, NYU Stern", url: "https://pages.stern.nyu.edu/~adamodar/", note: "Link only; not retrieved or checked by the build." };
const IFRS = { title: "IFRS Accounting Standards", publisher: "IFRS Foundation", url: "https://www.ifrs.org/issued-standards/list-of-standards/", note: "Primary standards; Ind AS are converged with IFRS with carve-outs." };
const SEBI = { title: "SEBI regulations (Takeover Regulations, ICDR, LODR)", publisher: "Securities and Exchange Board of India", url: "https://www.sebi.gov.in", note: "Check the current consolidated regulations before relying on thresholds." };

export const modules: ModuleInput[] = [
  {
    id: "m01-three-statements",
    number: 1,
    title: "The three financial statements and how they connect",
    summary: "How profit, balance sheet and cash flow fit together — and why profit is not cash.",
    minutes: 20,
    explanation: `The **income statement** measures performance over a period: revenue minus expenses gives profit. The **balance sheet** is a snapshot at a date: assets = liabilities + equity. The **cash-flow statement** explains why cash changed: operating, investing and financing flows.

They connect in three places:

1. **Net income flows into equity** (retained earnings), after dividends.
2. **Operating cash flow starts with net income** and adds back non-cash items (depreciation, amortisation, provisions) and changes in working capital.
3. **Closing cash** on the cash-flow statement equals cash on the balance sheet.

Capital expenditure appears in investing cash flow and raises fixed assets; depreciation later moves that cost through the income statement. Borrowing appears in financing cash flow and as debt on the balance sheet; interest goes through the income statement.

For banks the statements look different: loans are assets, deposits are liabilities, and "revenue" is mostly interest income. The same links hold, but working-capital logic does not apply in the usual way.`,
    workedExample: `A company earns **₹100** of net income, with **₹20** of depreciation. Receivables rise by **₹30** and payables rise by **₹10**. It spends **₹50** on capex and repays **₹15** of debt.

- Operating cash flow = 100 + 20 − 30 + 10 = **₹100**.
- Investing cash flow = −50. Financing cash flow = −15.
- Change in cash = 100 − 50 − 15 = **+₹35**.

On the balance sheet: equity rises by ₹100 (no dividend), fixed assets rise by 50 − 20 = ₹30, receivables +30, payables +10, debt −15, cash +35. Check: assets change = 30 + 30 + 35 = 95; liabilities + equity change = 10 − 15 + 100 = 95.`,
    commonMistakes: ["Treating net income as cash generated.", "Forgetting that depreciation is non-cash but capex is cash.", "Adding back a working-capital increase instead of subtracting it.", "Applying industrial working-capital logic to a bank."],
    questionIds: ["q-m1-1", "q-m1-2", "q-m1-3"],
    sourcePointers: [IFRS],
    related: [{ type: "glossary", id: "g-free-cash-flow" }, { type: "lab", id: "dcf" }],
  },
  {
    id: "m02-ev-equity",
    number: 2,
    title: "Enterprise value, equity value, cash, debt and non-controlling interests",
    summary: "The bridge from what the business is worth to what shareholders own.",
    minutes: 20,
    explanation: `**Equity value** is what the shareholders' claim is worth (share price × diluted shares). **Enterprise value (EV)** is the value of the operating business to all capital providers.

EV = equity value + debt + preferred equity + non-controlling interests (NCI) − cash and non-operating investments (± other debt-like items such as leases or pension deficits, if consistently treated).

Why add **NCI**? If a parent consolidates 100% of a subsidiary's EBITDA but owns 70%, the EBITDA includes the 30% belonging to others; adding the NCI value keeps numerator and denominator consistent. Similarly, if you exclude an associate's earnings from EBITDA, subtract the associate's value from EV.

**Consistency rule:** any claim included in EV must match the earnings measure in the multiple. If you capitalise leases as debt, use EBITDA before lease costs.

**Banks are different:** deposits and most debt are operating items for a bank, so EV is not meaningful — value the equity directly (P/B, P/E, residual income).

Finance Desk refuses to complete a bridge when a component is missing: missing is not zero.`,
    workedExample: `Share price **₹250**, diluted shares **40 million** → equity value = **₹10,000 million**.
Debt ₹3,000m, cash ₹1,200m, NCI ₹800m, investments in associates ₹500m.

EV = 10,000 + 3,000 + 800 − 1,200 − 500 = **₹12,100 million**.

If EBITDA (consolidated, excluding associates) is ₹1,100m, EV/EBITDA = 12,100 ÷ 1,100 = **11.0×**. Leaving out NCI would understate EV at ₹11,300m and give a misleading 10.3×.`,
    commonMistakes: ["Using basic instead of diluted shares.", "Forgetting NCI while using consolidated EBITDA.", "Subtracting all cash, including cash trapped for operations.", "Treating a bank's deposits as financing debt."],
    questionIds: ["q-m2-1", "q-m2-2", "q-m2-3"],
    sourcePointers: [DAMODARAN],
    related: [{ type: "lab", id: "comparables" }, { type: "glossary", id: "g-enterprise-value" }],
  },
  {
    id: "m03-working-capital",
    number: 3,
    title: "Working capital, cash conversion and cash versus earnings",
    summary: "Why fast-growing companies can run out of cash while reporting profits.",
    minutes: 15,
    explanation: `**Net working capital (operating)** = receivables + inventory − payables (plus other operating current items). When it rises, cash is absorbed; when it falls, cash is released.

**Cash conversion** compares operating cash flow (or free cash flow) with profit. A ratio well below 100% for several years suggests earnings are tied up in receivables or inventory — or that revenue recognition is aggressive.

Measure working capital in **days**: receivable days = receivables ÷ revenue × 365; inventory days = inventory ÷ COGS × 365; payable days = payables ÷ COGS × 365. The **cash conversion cycle** = receivable days + inventory days − payable days.

Business models differ: FMCG companies often run negative working capital (customers pay before suppliers are paid); EPC contractors often run large positive working capital; marketplaces can be negative because they collect from buyers before paying sellers.`,
    workedExample: `Revenue ₹365 crore; receivables ₹60 crore; COGS ₹219 crore; inventory ₹30 crore; payables ₹36 crore.

- Receivable days = 60 ÷ 365 × 365 = **60 days**.
- Inventory days = 30 ÷ 219 × 365 = **50 days**.
- Payable days = 36 ÷ 219 × 365 = **60 days**.
- Cash conversion cycle = 60 + 50 − 60 = **50 days**.

If revenue grows 20% with the same days, working capital grows about 20% too — cash the company must fund.`,
    commonMistakes: ["Computing inventory days on revenue instead of COGS (be consistent).", "Using year-end balances for seasonal businesses without averaging.", "Ignoring customer advances and unbilled revenue.", "Assuming profit growth means cash growth."],
    questionIds: ["q-m3-1", "q-m3-2", "q-m3-3"],
    sourcePointers: [IFRS, DAMODARAN],
    related: [{ type: "sector", id: "industrials" }],
  },
  {
    id: "m04-comps-precedents",
    number: 4,
    title: "Comparable companies versus precedent transactions",
    summary: "Trading multiples price minority stakes today; deal multiples price control at a past date.",
    minutes: 20,
    explanation: `**Comparable companies (trading comps)** value a company by the multiples at which similar listed companies trade today. They reflect minority, liquid stakes.

**Precedent transactions** use multiples paid in past acquisitions. They usually include a **control premium** and reflect the market conditions, synergies and competition of their date.

Good practice:

- Choose peers by **business model**, not just industry label (a SaaS firm is not an IT-services firm).
- Match periods (LTM vs forward) and definitions (adjusted vs reported EBITDA).
- Show the **distribution** (median, quartiles), not just an average, and list excluded peers with reasons (negative EBITDA → NM).
- For precedents, record the date, stake, basis (EV vs equity) and whether terms were revised.

Never mix enterprise value with net income (P/E uses equity value), or equity value with EBITDA.`,
    workedExample: `Four peers' EV/EBITDA: 9.0×, 11.0×, 12.5×, 20.0× (the last has depressed EBITDA). Median = (11.0 + 12.5) ÷ 2 = **11.75×**; the mean (13.1×) is pulled up by the outlier.

Target EBITDA ₹800 crore → EV ≈ 11.75 × 800 = **₹9,400 crore**. A precedent set with a 9–11× range from 2021 deals reflects a different interest-rate environment and includes control premiums — show both and explain the gap rather than averaging them.`,
    commonMistakes: ["Averaging trading and transaction multiples together.", "Using a peer with negative EBITDA in an EV/EBITDA median.", "Comparing multiples on different periods (LTM vs NTM).", "Ignoring the stake: a 26% purchase price is not a 100% value."],
    questionIds: ["q-m4-1", "q-m4-2", "q-m4-3"],
    sourcePointers: [DAMODARAN],
    related: [{ type: "lab", id: "comparables" }],
  },
  {
    id: "m05-dcf",
    number: 5,
    title: "DCF intuition, discount rates and terminal value",
    summary: "A business is worth the present value of its future free cash flows — and the terminal value usually dominates.",
    minutes: 25,
    explanation: `A **DCF** forecasts unlevered free cash flow (FCFF = EBIT × (1 − tax) + D&A − capex − Δ working capital) and discounts it at the **WACC**, the blended required return of debt and equity holders.

**Cost of equity** (CAPM) = risk-free rate + beta × equity risk premium. **Cost of debt** is after tax. Weights should be target market-value weights.

**Terminal value** (Gordon growth) = FCFF in the year after the forecast ÷ (WACC − g). The growth rate must be below WACC and, over the long run, no higher than nominal economic growth. Terminal value often makes up 60–80% of EV — so test sensitivity to WACC and g.

EV from the DCF minus net debt and other claims gives equity value; divide by diluted shares for value per share. Keep currencies consistent: an INR cash flow needs an INR discount rate.`,
    workedExample: `FCFF for years 1–3: ₹100, ₹110, ₹121. WACC 10%, terminal growth 4%.

PV of FCFF = 100/1.1 + 110/1.21 + 121/1.331 = 90.91 + 90.91 + 90.91 = **₹272.7**.
Terminal value at year 3 = 121 × 1.04 ÷ (0.10 − 0.04) = **₹2,097.3**; PV = 2,097.3 ÷ 1.331 = **₹1,575.8**.
EV = 272.7 + 1,575.8 = **₹1,848.5**; terminal value share ≈ **85%**.`,
    commonMistakes: ["Terminal growth at or above WACC.", "Discounting INR cash flows with a USD WACC.", "Using book-value weights for WACC.", "Double-counting growth: high forecast growth plus high terminal growth."],
    questionIds: ["q-m5-1", "q-m5-2", "q-m5-3"],
    sourcePointers: [DAMODARAN],
    related: [{ type: "lab", id: "dcf" }],
  },
  {
    id: "m06-ma-process",
    number: 6,
    title: "The M&A process, buyer types and transaction stages",
    summary: "From approach to completion: who buys, how, and what can go wrong between signing and closing.",
    minutes: 15,
    explanation: `**Buyer types:** strategic buyers (operating companies seeking synergies), financial sponsors (private equity using leverage and a defined exit), sovereign and pension investors (long horizons, lower return hurdles) and consortiums.

**Stages:** preparation → approach or auction → non-binding offers → due diligence → binding offer and signing → regulatory, shareholder and court approvals → completion (closing) → integration.

Between **signing and closing** the deal can change: competing bids (Comcast vs Disney for Fox), regulatory remedies (Microsoft–Activision), arbitration (Chevron–Hess), or termination (Zee–Sony). A proposal (Couche-Tard–Seven & i) is not a signed deal.

In India, listed-company acquisitions above thresholds trigger a **mandatory open offer** under SEBI's Takeover Regulations; mergers need **NCLT** sanction; many need **CCI** approval; banks and insurers need **RBI** or **IRDAI** approval.`,
    workedExample: `Emirates NBD–RBL Bank timeline: announced 18 October 2025 → CCI approval January 2026 → RBI approval (up to 74%, minimum 51%) → mandatory open offer 1–12 June 2026 → completion 18 June 2026. Each step changed the status; a tracker should record the event date, not the date an article was published.`,
    commonMistakes: ["Treating announcement as completion.", "Confusing a non-binding proposal with an agreement.", "Ignoring the open-offer step in Indian listed deals.", "Using the article date instead of the event date."],
    questionIds: ["q-m6-1", "q-m6-2", "q-m6-3"],
    sourcePointers: [SEBI],
    related: [{ type: "deal", id: "emirates-nbd-rbl-bank" }, { type: "deal", id: "zee-sony-merger" }],
  },
  {
    id: "m07-consideration",
    number: 7,
    title: "Consideration, financing, ownership and control",
    summary: "Cash versus stock, primary versus secondary, and why a stake percentage is not always control.",
    minutes: 20,
    explanation: `**Cash** gives sellers certainty; the buyer bears all risk and must finance it (cash, debt, new equity). **Stock** shares risk and upside with sellers but dilutes the buyer's holders; the exchange ratio fixes shares, so value moves with the buyer's price.

**Primary** investment (new shares) puts money into the company; **secondary** purchases pay existing holders. Emirates NBD's RBL investment was primary — the post-money value includes the new cash.

**Control** can differ from economic ownership: Indian banks cap voting rights (26%) regardless of shareholding; golden shares (U.S. Steel) give governments veto rights; dual-class shares separate votes from economics.

**Financing structures:** acquisition debt, bridge loans refinanced by bonds, sellers' notes, earn-outs and contingent shares (Concentrix–Webhelp).`,
    workedExample: `A buyer subscribes to new shares worth **₹26,853 crore** for **60%** of the enlarged bank.
Post-money equity value = 26,853 ÷ 0.60 = **₹44,755 crore**.
Pre-money value = 44,755 − 26,853 = **₹17,902 crore**.
Comparing ₹17,902 crore with the pre-deal market capitalisation shows the premium or discount paid — using ₹44,755 crore as "the price of the bank" double-counts the new cash.`,
    commonMistakes: ["Confusing pre-money and post-money values.", "Assuming ownership percentage equals voting control.", "Ignoring the buyer's share-price risk in stock deals.", "Treating a sellers' note as free money (it is deferred consideration)."],
    questionIds: ["q-m7-1", "q-m7-2", "q-m7-3"],
    sourcePointers: [SEBI],
    related: [{ type: "deal", id: "emirates-nbd-rbl-bank" }, { type: "deal", id: "concentrix-webhelp" }],
  },
  {
    id: "m08-synergies",
    number: 8,
    title: "Synergies, integration risks and value creation",
    summary: "A deal creates value only if synergies exceed the premium paid plus integration costs.",
    minutes: 15,
    explanation: `**Value created for the buyer** ≈ PV(synergies) − premium paid − integration costs.

**Cost synergies** (procurement, overlapping branches, headcount, IT) are more reliable than **revenue synergies** (cross-selling, pricing), which depend on customer behaviour.

Estimate synergies as **run-rate** annual amounts, phase them in, deduct one-time costs to achieve them, tax them, and discount them. Compare with the control premium.

**Integration risks:** customer and talent attrition, systems migration, culture, regulatory conditions (for example branch or job commitments in ANZ–Suncorp), and distraction from the base business.

Watch for **dis-synergies**: lost customers who do not want to depend on one supplier, or remedies imposed by regulators.`,
    workedExample: `Premium paid over the unaffected market value: **₹2,000 crore**. Expected run-rate pre-tax cost synergies: **₹300 crore** a year from year 3 (50% in year 1, 80% in year 2). One-time integration cost ₹400 crore. Tax 25%, discount rate 10%, synergies perpetual after year 3.

After-tax run-rate = 225. PV ≈ 112.5/1.1 + 180/1.21 + (225/0.10)/1.21 ≈ 102.3 + 148.8 + 1,859.5 = **₹2,110.5 crore**, minus integration cost (after tax ≈ 300) ≈ **₹1,810 crore** — less than the ₹2,000 crore premium. On these assumptions the buyer's shareholders lose value unless revenue synergies materialise.`,
    commonMistakes: ["Counting revenue synergies at full value.", "Forgetting one-time costs to achieve synergies.", "Comparing pre-tax synergies with an after-tax premium.", "Ignoring the time to achieve them."],
    questionIds: ["q-m8-1", "q-m8-2", "q-m8-3"],
    sourcePointers: [DAMODARAN],
    related: [{ type: "lab", id: "accretion" }],
  },
  {
    id: "m09-accretion-dilution",
    number: 9,
    title: "Accretion/dilution and why EPS is not the whole story",
    summary: "EPS accretion depends on financing costs versus the target's earnings yield — not on value creation.",
    minutes: 20,
    explanation: `**Pro forma EPS** = (buyer net income + target net income + after-tax synergies − after-tax cost of financing ± other adjustments) ÷ (buyer shares + new shares issued).

Rule of thumb for all-stock deals: accretive if the target's P/E is below the buyer's P/E. For cash deals: accretive if the target's earnings yield (1/P/E) exceeds the after-tax cost of debt (or forgone interest on cash).

But **accretion is not value creation**. A company can make EPS-accretive acquisitions that destroy value (buying low-growth, high-risk earnings with cheap debt), and dilutive deals can create value (buying fast-growing businesses). Also consider amortisation of acquired intangibles, one-time costs, and changes in risk and leverage.

Finance Desk shows one-time costs separately and refuses to compute a percentage when the buyer's EPS is not positive.`,
    workedExample: `Buyer: net income ₹500 crore, 100 crore shares (EPS ₹5.00). Target net income ₹60 crore. Price ₹900 crore, all debt at 8% pre-tax, tax 25%.

After-tax interest = 900 × 8% × 75% = ₹54 crore. Pro forma net income = 500 + 60 − 54 = ₹506 crore. EPS = 506 ÷ 100 = **₹5.06** → **1.2% accretive**.

If funded with new shares at ₹60 (15 crore shares): EPS = 560 ÷ 115 = **₹4.87** → **2.6% dilutive**. Same business, different financing.`,
    commonMistakes: ["Equating accretion with value creation.", "Forgetting the lost interest on cash used.", "Ignoring new amortisation of intangibles.", "Mixing one-time costs into run-rate EPS."],
    questionIds: ["q-m9-1", "q-m9-2", "q-m9-3"],
    sourcePointers: [DAMODARAN],
    related: [{ type: "lab", id: "accretion" }],
  },
  {
    id: "m10-fig-basics",
    number: 10,
    title: "FIG basics and why bank valuation differs",
    summary: "For banks, value the equity: P/B versus ROE, and residual income.",
    minutes: 25,
    explanation: `Banks borrow to lend. Deposits and interest are operating items, so **EV/EBITDA is meaningless** — there is no clean separation between operating and financing activity.

**Equity approaches:**

- **Justified P/B** = (ROE − g) ÷ (COE − g). A bank earning above its cost of equity deserves a P/B above 1; below it, less than 1.
- **Residual income**: value = book value + PV of (ROE − COE) × opening book value for each year.
- **P/E** on normalised earnings (strip one-off provisions or write-backs).

**Key metrics:** NIM, credit costs, GNPA/NNPA (regulatory), CASA ratio, CET1/CRAR (regulatory capital), ROA and ROE.

Growth consumes capital: to grow loans 15% with a stable CET1 ratio, a bank must retain enough earnings (or raise equity) to grow its capital ~15% too.

Insurers, asset managers and exchanges need their own models (P/EV, P/E, EV/EBITDA for fee businesses). A high P/B or ROE alone never proves a good investment — check how the ROE is produced.`,
    workedExample: `A bank with ROE **16%**, cost of equity **13%**, long-term growth **8%**:
Justified P/B = (0.16 − 0.08) ÷ (0.13 − 0.08) = 0.08 ÷ 0.05 = **1.6×**.

If ROE falls to 13% (equal to COE), justified P/B = 0.05 ÷ 0.05 = **1.0×**: growth adds no value when returns equal the cost of capital.`,
    commonMistakes: ["Using EV/EBITDA for banks.", "Subtracting deposits as if they were financing debt.", "Treating regulatory GNPA and accounting ECL as the same thing.", "Assuming high P/B means a good investment without testing ROE sustainability."],
    questionIds: ["q-m10-1", "q-m10-2", "q-m10-3"],
    sourcePointers: [DAMODARAN, { title: "Reserve Bank of India", publisher: "RBI", url: "https://www.rbi.org.in", note: "Prudential norms, capital adequacy and ECL directions." }],
    related: [{ type: "sector", id: "fig" }, { type: "lab", id: "fig" }],
  },
  {
    id: "m11-reading-filings",
    number: 11,
    title: "Reading announcements, filings and regulatory decisions critically",
    summary: "Separate facts, company framing and commentary; check the basis and date of every number.",
    minutes: 15,
    explanation: `A deal announcement is **marketing plus facts**. Extract the facts first:

- **Who** (legal entities), **what** (perimeter and stake), **how much** (basis: EV, equity value, stake consideration), **how** (cash, stock, financing), **when** (announcement, expected closing), **conditions** (approvals, shareholder votes).

Then question the framing: "valued at" may mean EV, equity or post-money; synergies are management estimates; "transformational" is not a metric.

**Primary sources** (exchange filings, regulator orders, SEC 8-K/6-K, CCI orders) outrank **secondary** (news, blogs). When a news report and a filing disagree, the filing wins — unless it was later amended.

For regulatory decisions distinguish a **proposal**, **consultation**, **rule**, **approval** and **effective** requirement. A draft RBI circular is not a rule; a bill passed by one house is not law.`,
    workedExample: `Headline: "MUFG to invest ₹39,618 crore in Shriram Finance." The filing specifies a **preferential issue** of new shares for **20%** of the enlarged capital at a set price per share — primary capital, a minority stake, and subject to CCI and shareholder approval. The headline number is a **stake consideration**, not the value of Shriram Finance (≈ ₹39,618 ÷ 20% ≈ ₹1.98 lakh crore post-money, calculated).`,
    commonMistakes: ["Treating a news summary as the primary source.", "Missing that a figure is post-money.", "Recording the article's date as the event date.", "Calling a consultation paper a rule."],
    questionIds: ["q-m11-1", "q-m11-2", "q-m11-3"],
    sourcePointers: [SEBI, { title: "SEC EDGAR full-text search", publisher: "U.S. Securities and Exchange Commission", url: "https://efts.sec.gov/LATEST/search-index?q=", note: "Official filings search; link only." }],
    related: [{ type: "deal", id: "mufg-shriram-finance" }],
  },
  {
    id: "m12-one-page-view",
    number: 12,
    title: "Writing a defensible one-page deal or sector view",
    summary: "Facts, rationale, price, risks, your view and what would change your mind — on one page.",
    minutes: 20,
    explanation: `A defensible view is **specific, sourced and falsifiable**.

Structure for a deal note:

1. **Transaction facts** (who, what, stake, value with basis, consideration, status, dates) — each with a source.
2. **Strategic rationale** — the company's stated reasons and your assessment.
3. **Price and structure** — multiples with periods; premium with reference date; financing.
4. **Sector context** — why now, what peers did.
5. **Synergies and risks** — quantified where possible.
6. **My view** — one or two sentences you would defend in an interview.
7. **What would change my mind** (falsifiers) and **open questions**.
8. **Sources and research cutoff.**

For a sector view: business models, value drivers, key players, valuation logic, consolidation thesis, catalysts, disconfirming evidence and a watchlist.

Label analysis as analysis. Do not use hindsight to judge what was knowable at announcement.`,
    workedExample: `"**My view:** Axis paid for distribution, not balance sheet. The price adjustment mechanism protected it before closing; the real test is card and deposit retention after the July 2024 migration. **I would change my mind if** acquired card spend fell materially after migration, because the premium is justified only by retained affluent customers."`,
    commonMistakes: ["Writing a summary with no view.", "Stating a view without falsifiers.", "Mixing facts and opinions without labels.", "Omitting dates and sources."],
    questionIds: ["q-m12-1", "q-m12-2", "q-m12-3"],
    sourcePointers: [DAMODARAN],
    related: [{ type: "deal", id: "axis-citi-india-consumer" }],
  },
];
