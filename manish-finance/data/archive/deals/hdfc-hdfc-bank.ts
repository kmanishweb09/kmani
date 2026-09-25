import type { DealInput } from "../../../shared/schemas/research";
import { day, doc, ws } from "../lib";

export const documents = [
  doc("hdfcbank-pr-2022-04-04", "HDFC Bank Limited", "https://www.hdfcbank.com/personal/about-us/news-room/press-release/2022/q2/hdfc-limited-and-hdfc-bank-limited-announce-a-transformational-merger", "HDFC Limited and HDFC Bank Limited Announce a Transformational Merger", "press_release", true, "2022-04-04"),
  doc("hdfcltd-pr-2022-04-04", "Housing Development Finance Corporation Limited", "https://homeloans.hdfc.bank.in/content/dam/housingdevelopmentfinancecorp/pdf/media/2022/news-and-press-corner/hdfc-limited-and-hdfc-bank-limited-announce-a-transformational-merger/HDFC-Limited-And-HDFC-Bank-Limited-Announce-a-Transformational-Merger.pdf", "HDFC Limited and HDFC Bank Limited Announce a Transformational Merger (PDF)", "press_release", true, "2022-04-04"),
  doc("hdfcbank-6k-2022-04", "HDFC Bank Limited (SEC Form 6-K)", "https://www.sec.gov/Archives/edgar/data/1144967/000119312522095376/d292183d6k.htm", "HDFC Bank Ltd Form 6-K (April 2022)", "regulatory_filing", true, "2022-04", "month"),
  doc("hdfcbank-pr-2023-06-30", "HDFC Bank Limited", "https://www.hdfc.bank.in/press-release/2023/q2/hdfc-ltd-to-merge-into-hdfc-bank-effective-july-1-2023", "HDFC Ltd. to merge into HDFC Bank effective July 1, 2023", "press_release", true, "2023-06-30"),
  doc("bs-hdfc-rbi-2022-07-04", "Business Standard", "https://www.business-standard.com/article/finance/hdfc-bank-receives-no-objection-letter-from-rbi-for-merger-with-hdfc-122070401339_1.html", "HDFC Bank receives no objection letter from RBI for merger with HDFC", "news_report", false, "2022-07-04"),
  doc("bs-hdfc-exchanges-2022-07-03", "Business Standard", "https://www.business-standard.com/amp/article/finance/no-adverse-observations-from-bse-and-nse-on-the-proposed-merger-hdfc-bank-122070300461_1.html", "HDFC and HDFC Bank merger proposal gets nod from stock exchanges", "news_report", false, "2022-07-03"),
  doc("bs-hdfc-cci-2022-08-13", "Business Standard", "https://www.business-standard.com/article/companies/competition-commission-of-india-approves-merger-of-hdfc-bank-hdfc-ltd-122081300648_1.html", "Competition Commission of India approves merger of HDFC Bank, HDFC Ltd", "news_report", false, "2022-08-13"),
  doc("bs-hdfc-nclt-petition-2022-12-08", "Business Standard", "https://www.business-standard.com/article/finance/hdfc-bank-files-petition-with-nclt-for-approval-of-merger-with-hdfc-ltd-122120801192_1.html", "HDFC Bank files petition with NCLT for approval of merger with HDFC Ltd", "news_report", false, "2022-12-08"),
  doc("bt-hdfc-effective-2023-06-30", "Business Today", "https://www.businesstoday.in/industry/banks/story/hdfc-hdfc-bank-boards-approve-july-1-as-effective-date-of-mega-merger-july-13-set-as-record-date-387800-2023-06-30", "HDFC, HDFC Bank boards approve July 1 as effective date of mega merger, July 13 set as record date", "news_report", false, "2023-06-30"),
  doc("icicidirect-hdfc-dates", "ICICI Direct", "https://www.icicidirect.com/equity-products/cash-equity/blogs/mega-merger-hdfc-ltd-and-hdfc-bank-important-dates", "HDFC Ltd and HDFC Bank merger: important dates", "news_report", false, null),
  doc("cravath-hdfc-2022", "Cravath, Swaine & Moore LLP", "https://www.cravath.com/news-insights/hdfc-bank-limiteds-dollar40-billion-merger-with-hdfc-limited.html", "HDFC Bank Limited’s $40 Billion Merger with HDFC Limited", "company_page", true, "2022-04", "month"),
  doc("hdfcbank-6k-2025-q4", "HDFC Bank Limited (SEC Form 6-K)", "https://www.sec.gov/Archives/edgar/data/1144967/000119312525158455/d793213dex99.pdf", "HDFC Bank Form 6-K exhibit: financial results for the quarter and year ended March 31, 2025", "regulatory_filing", true, "2025-04", "month"),
  doc("bs-hdfcbank-cd-ratio-2024-10-20", "Business Standard", "https://www.business-standard.com/companies/news/hdfc-bank-to-slow-loan-book-growth-in-fy25-in-order-to-reduce-cd-ratio-124102000520_1.html", "HDFC Bank aims to reduce CD ratio, plans slower loan growth in FY25", "news_report", false, "2024-10-20"),
];

export const deal: DealInput = {
  id: "hdfc-hdfc-bank-merger",
  title: "HDFC Ltd merges into HDFC Bank",
  aliases: ["HDFC twins merger", "HDFC–HDFC Bank amalgamation", "Housing Development Finance Corporation merger"],
  dealType: "merger",
  buyerType: "strategic",
  sector: "fig",
  subsector: "Banks and housing finance",
  acquirer: { companyId: "hdfc-bank", name: "HDFC Bank Limited", country: "IN", cites: [ws("hdfcbank-pr-2022-04-04")] },
  target: { companyId: "hdfc-ltd", name: "Housing Development Finance Corporation Limited (HDFC Ltd)", country: "IN", cites: [ws("hdfcbank-pr-2022-04-04")] },
  otherParties: [],
  perimeter:
    "Composite scheme of amalgamation: HDFC Investments Limited and HDFC Holdings Limited merge into HDFC Ltd, and HDFC Ltd merges into HDFC Bank, bringing HDFC Ltd's mortgage book and its holdings in subsidiaries into the bank.",
  stake: {
    acquiredPct: 100,
    resultingPct: 100,
    note: "An amalgamation of the whole company. HDFC Ltd's own shareholding in HDFC Bank is extinguished; HDFC Ltd shareholders receive HDFC Bank shares.",
    cites: [ws("hdfcbank-pr-2022-04-04")],
  },
  announced: { ...day("2022-04-04"), cites: [ws("hdfcbank-pr-2022-04-04"), ws("cravath-hdfc-2022")] },
  effective: { ...day("2023-07-01"), cites: [ws("hdfcbank-pr-2023-06-30"), ws("bt-hdfc-effective-2023-06-30")] },
  status: { value: "completed", asOf: "2023-07-01", cites: [ws("hdfcbank-pr-2023-06-30")] },
  terms: [
    {
      metric: "share_exchange_ratio",
      text: "42 HDFC Bank shares (face value ₹1) for every 25 HDFC Ltd shares (face value ₹2)",
      amount: null,
      kind: "announced",
      asOf: "2022-04-04",
      status: "reported",
      cites: [ws("hdfcbank-pr-2022-04-04"), ws("bt-hdfc-effective-2023-06-30")],
    },
    {
      metric: "value_unclear_basis",
      label: "Widely reported deal value",
      amount: 40,
      currency: "USD",
      unit: "billion",
      valueBasis: "unclear",
      kind: "reported_by_media",
      asOf: "2022-04-04",
      status: "reported",
      headline: true,
      note: "An all-stock amalgamation has no cash price. The ~US$40 billion figure is how advisers and media described the transaction's size; the documents reviewed do not define its basis, so it is not an enterprise or equity value.",
      cites: [ws("cravath-hdfc-2022", "Page title and summary")],
    },
    {
      metric: "other",
      label: "Resulting ownership",
      text: "Existing HDFC Ltd shareholders to own about 41% of HDFC Bank; the bank becomes 100% owned by public shareholders",
      amount: null,
      kind: "announced",
      asOf: "2022-04-04",
      status: "reported",
      cites: [ws("hdfcbank-pr-2022-04-04")],
    },
  ],
  payment: { mix: ["stock"], text: "All-stock amalgamation: HDFC Ltd shareholders received newly issued HDFC Bank shares at the exchange ratio; no cash consideration.", cites: [ws("hdfcbank-pr-2022-04-04")] },
  financing: null,
  events: [
    { type: "announcement", date: day("2022-04-04"), publishedDate: "2022-04-04", title: "Boards approve the composite scheme of amalgamation", detail: "Both boards approved the scheme on 4 April 2022, with completion expected in 15–18 months subject to approvals.", jurisdiction: "IN", statusAfter: "announced", cites: [ws("hdfcbank-pr-2022-04-04"), ws("icicidirect-hdfc-dates")] },
    { type: "regulatory_approval", date: day("2022-07-02"), publishedDate: "2022-07-03", title: "BSE and NSE issue observation letters with no adverse observations", jurisdiction: "IN", authority: "BSE / NSE", statusAfter: "pending_approvals", cites: [ws("bs-hdfc-exchanges-2022-07-03", "Report of exchange observation letters", "Exact letter date recorded as reported; publication date 3 July 2022.")] },
    { type: "regulatory_approval", date: day("2022-07-04"), publishedDate: "2022-07-04", title: "RBI issues no-objection to the scheme", detail: "RBI's no-objection was subject to conditions; it is an approval step, not completion.", jurisdiction: "IN", authority: "Reserve Bank of India", cites: [ws("bs-hdfc-rbi-2022-07-04")] },
    { type: "regulatory_approval", date: day("2022-08-12"), publishedDate: "2022-08-13", title: "Competition Commission of India approves the combination", jurisdiction: "IN", authority: "Competition Commission of India", cites: [ws("bs-hdfc-cci-2022-08-13")] },
    { type: "shareholder_approval", date: day("2022-11-25"), title: "Shareholders approve the scheme at tribunal-convened meetings", jurisdiction: "IN", cites: [ws("bs-hdfc-nclt-petition-2022-12-08", "Report of approvals ahead of NCLT petition")] },
    { type: "court_approval", date: day("2023-03-17"), title: "NCLT Mumbai sanctions the scheme", jurisdiction: "IN", authority: "National Company Law Tribunal", statusAfter: "approved", cites: [ws("icicidirect-hdfc-dates")] },
    { type: "completion", date: day("2023-07-01"), publishedDate: "2023-06-30", title: "Merger becomes effective; record date for share allotment set as 13 July 2023", jurisdiction: "IN", statusAfter: "completed", cites: [ws("hdfcbank-pr-2023-06-30"), ws("bt-hdfc-effective-2023-06-30")] },
  ],
  advisers: {
    disclosure: "partial",
    list: [{ side: "buyer", role: "legal", name: "Cravath, Swaine & Moore LLP (U.S. counsel to HDFC Bank)", cites: [ws("cravath-hdfc-2022")] }],
    note: "Only advisers with a sourced role are listed. Indian counsel and financial advisers were not researched for this record.",
  },
  rationale: [
    { text: "Regulatory harmonisation between banks and NBFCs over recent years made the combination possible.", cites: [ws("hdfcbank-pr-2022-04-04"), ws("hdfcltd-pr-2022-04-04")] },
    { text: "A larger balance sheet would allow underwriting of large-ticket infrastructure loans, faster credit growth, more affordable housing and more priority-sector credit, including to agriculture.", cites: [ws("hdfcbank-pr-2022-04-04")] },
    { text: "Combining HDFC Ltd's leadership in housing finance with HDFC Bank's distribution and customer franchise lets the combined entity offer a full suite of financial products.", cites: [ws("hdfcbank-pr-2022-04-04")] },
  ],
  sectorContext:
    "Indian housing finance has two funding models: banks fund mortgages with retail deposits (CASA and term deposits) but carry CRR, SLR and priority-sector obligations; housing finance companies fund with bonds, bank loans and public deposits without those reserve requirements but at a higher marginal cost. As RBI tightened NBFC regulation (scale-based regulation from October 2021), the arbitrage narrowed, making a combined balance sheet more attractive for the largest HFC.",
  comparables: [
    { dealId: "axis-citi-india-consumer", reason: "Same period, large Indian private bank acquiring a retail franchise to accelerate distribution." },
    { dealId: "ubs-credit-suisse", reason: "Contrast: a rescue merger versus a planned strategic amalgamation; both reshape a bank balance sheet." },
  ],
  afterDeal: [
    { date: "2025-03-31", kind: "fact", text: "HDFC Bank reported total deposits of ₹27,14,714.9 crore (up 14.1% year on year) and gross advances of ₹26,19,608.6 crore (up 5.4%) for the year ended 31 March 2025.", cites: [ws("hdfcbank-6k-2025-q4", "Results exhibit, balance sheet highlights")] },
    { date: "2024-10-20", kind: "fact", text: "Management said it would grow loans more slowly than deposits in FY25 to bring down the elevated credit-deposit ratio that followed the merger.", cites: [ws("bs-hdfcbank-cd-ratio-2024-10-20")] },
  ],
  autopsy: {
    asAnnounced: {
      cutoff: "2022-04-04",
      situation:
        "India's largest private bank proposed to absorb its own promoter, India's largest housing finance company, in an all-stock scheme. HDFC Ltd owned a large minority stake in HDFC Bank; the bank already sourced home loans for HDFC Ltd. Regulators had been tightening rules for large NBFCs, narrowing the advantage of keeping mortgages outside the bank.",
      whatBuyerIsBuying:
        "A large, mature mortgage book and its origination capability, direct ownership of the HDFC group's insurance and asset-management subsidiaries, and the removal of a cross-holding. It is buying assets and distribution, not new customers alone: the value case depends on funding those mortgages more cheaply and selling more products to both customer bases.",
      keyAssumptions: [
        "The bank can replace HDFC Ltd's wholesale borrowings with cheaper retail deposits over a few years.",
        "Regulatory costs on the acquired balance sheet (cash reserve, statutory liquidity and priority-sector lending requirements) are manageable or phased in.",
        "Cross-selling lifts the share of bank customers with a home loan and of borrowers using bank products.",
        "Mortgage asset quality stays strong through the integration period.",
      ],
      priceAndStructure:
        "No cash changes hands: 42 HDFC Bank shares for every 25 HDFC Ltd shares, with HDFC Ltd's own stake in the bank cancelled so the bank ends up fully publicly held and HDFC Ltd's shareholders own about 41% of it. Because it is share-for-share, what matters is the relative valuation of the two stocks embedded in the ratio, not a headline dollar figure.",
      risksAtAnnouncement: [
        "Margin dilution: mortgages yield less than the bank's blended loan book.",
        "Liquidity drag from reserve requirements on the combined liabilities if regulatory forbearance is limited.",
        "Deposit mobilisation may lag loan growth, pushing the credit-deposit ratio up.",
        "Integration of two large organisations, systems and cultures.",
        "Approvals needed for the bank to hold the insurance subsidiaries.",
      ],
      falsifiers: [
        "Net interest margin stays well below the pre-merger level for several years with no offsetting fee or cross-sell benefit.",
        "Deposits fail to grow fast enough, forcing the bank to slow lending materially.",
        "RBI grants little relief on reserve requirements for the acquired book.",
      ],
    },
    whatWeKnowNow: {
      cutoff: "2026-09-25",
      facts: [
        { text: "The scheme became effective on 1 July 2023 after RBI, CCI, exchange, shareholder and NCLT approvals.", cites: [ws("hdfcbank-pr-2023-06-30"), ws("icicidirect-hdfc-dates")] },
        { text: "The credit-deposit ratio rose sharply at the merger; the bank deliberately grew loans more slowly than deposits in FY25 to reduce it.", cites: [ws("bs-hdfcbank-cd-ratio-2024-10-20")] },
        { text: "For FY2025 the bank reported deposit growth of 14.1% against advances growth of 5.4%.", cites: [ws("hdfcbank-6k-2025-q4")] },
      ],
      interpretation: [
        "The binding constraint after the merger moved from capital to deposits: the bank had to rebuild its funding base before growing loans at its historical pace.",
        "The announcement-date risk list anticipated this; the outcome so far supports the funding-drag concern more than the cross-sell upside, which is harder to measure from public data.",
      ],
      evidenceLimits: "Cross-sell outcomes and reserve-requirement relief details were not verified here. Share-price performance is not shown because no licensed price source is connected.",
    },
    analysis: {
      thesis:
        "Strategically, the merger removed a regulatory arbitrage that was already closing and gave the bank a long-duration mortgage asset. Financially, it traded near-term margin and funding flexibility for a larger, lower-risk asset base; value creation depends on how cheaply and quickly the bank can deposit-fund the mortgage book.",
      alternatives: [
        "Defensive consolidation: HDFC Ltd faced rising regulatory costs as a large NBFC, so the merger may have been as much about avoiding a slow squeeze as about growth.",
        "Group simplification: collapsing the promoter holding structure and bringing subsidiaries under one listed parent.",
      ],
      risks: ["Prolonged funding cost pressure", "Execution risk in deposit mobilisation", "Concentration of mortgage risk on one balance sheet"],
      falsifiers: ["Evidence that cross-sell and fee income do not rise over several years", "Persistent loan-growth underperformance versus peers because of funding limits"],
    },
    prompts: [
      "What is the buyer actually buying: earnings, distribution, technology, customers, a licence, or control?",
      "Which two assumptions most affect the value of this share exchange?",
      "What evidence would make you reject the stated synergy case?",
      "Is the funding structure consistent with the bank's regulatory constraints?",
    ],
    rubric: [
      { criterion: "Evidence", strong: "Uses the scheme terms, approval chain and post-merger funding data with dates.", weak: "Relies on the ‘US$40 billion’ headline as if it were a price." },
      { criterion: "Logic", strong: "Links regulatory convergence to the funding-cost and margin trade-off.", weak: "Says ‘synergies’ without naming the mechanism." },
      { criterion: "Valuation", strong: "Explains that an all-stock ratio embeds relative valuation and ownership (41%).", weak: "Treats the deal as a cash acquisition." },
      { criterion: "Risk", strong: "Names deposit mobilisation and reserve requirements as the key risks and how to monitor them.", weak: "Lists generic integration risk only." },
    ],
  },
  tags: ["all-stock", "regulatory convergence", "India banking", "mortgages"],
  researchCutoff: "2026-09-25",
  recordUpdated: "2026-09-25",
};
