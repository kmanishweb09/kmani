import type { CompanyInput } from "../../../shared/schemas/research";
import { doc, lead, ws } from "../lib";

export const documents = [
  doc("hdfcbank-20f-fy2024", "HDFC Bank Limited (SEC Form 20-F)", "https://www.sec.gov/Archives/edgar/data/1144967/000119312524187406/d759422d20f.htm", "HDFC Bank Ltd annual report on Form 20-F for fiscal 2024", "regulatory_filing", true, "2024-07", "month"),
  doc("hdfcbank-q4fy25-presentation", "HDFC Bank Limited", "https://www.hdfcbank.com/content/bbp/repositories/723fb80a-2dde-42a3-9793-7ae1be57c87f/?path=/Footer/About+Us/About+Investor+Relations/pdf/2024/march/Q4FY25-Earnings-Presentation.pdf", "Q4FY25 Earnings Presentation", "investor_presentation", true, "2025-04-19"),
  doc("bs-hdfcbank-q4fy25-2025-04-21", "Business Standard", "https://www.business-standard.com/markets/capital-market-news/hdfc-bank-gains-after-q4-pat-rises-7-yoy-to-rs-17-616-cr-nii-rises-10-125042100175_1.html", "HDFC Bank gains after Q4 PAT rises 7% YoY to Rs 17,616 cr; NII rises 10%", "news_report", false, "2025-04-21"),
  doc("hdfcbank-q4fy26-presentation", "HDFC Bank Limited", "https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/pdf/about-us/financial-results/2025-2026/quarter-4/q4fy26-earnings-presentation.pdf", "Q4FY26 Earnings Presentation", "investor_presentation", true, "2026-04-18"),
  doc("bs-hdfcbank-q4fy26-2026-04-18", "Business Standard", "https://www.business-standard.com/companies/quarterly-results/hdfc-bank-q4fy26-results-profit-up-9-pc-to-rs-19-221-cr-on-lower-provisions-126041800535_1.html", "HDFC Bank Q4FY26 results: Profit up 9% to Rs 19,221 cr on lower provisions", "news_report", false, "2026-04-18"),
];

export const companies: CompanyInput[] = [
  {
    id: "hdfc-bank",
    legalName: "HDFC Bank Limited",
    displayName: "HDFC Bank",
    aliases: ["HDFCBANK", "HDB"],
    tickers: [
      { exchange: "NSE", symbol: "HDFCBANK" },
      { exchange: "BSE", symbol: "500180" },
      { exchange: "NYSE", symbol: "HDB", note: "American Depositary Shares" },
    ],
    country: "IN",
    sector: "fig",
    subsector: "Banks (private sector)",
    lifecycle: { status: "active" },
    website: "https://www.hdfc.bank.in",
    identityCites: [
      ws("hdfcbank-20f-fy2024", "Form 20-F cover page: registrant name and ADS listing"),
      lead("hdfcbank-20f-fy2024", "NSE and BSE codes recorded from builder knowledge; confirm on the exchange pages."),
    ],
    businessModel: {
      summary:
        "India's largest private-sector bank by assets. It earns mainly net interest income by lending to retail customers (home loans after the 2023 HDFC Ltd merger, personal, vehicle and card loans), SMEs and corporates, funded by a large branch-sourced deposit base; fee income from cards, payments, distribution and transaction banking adds a second engine.",
      customers: "Retail depositors and borrowers across urban and semi-urban India, SMEs, large corporates and government entities.",
      products: "Current and savings accounts, term deposits, mortgages, unsecured retail loans, credit cards, payments, wholesale and transaction banking; insurance and asset-management subsidiaries after the merger.",
      revenueModel: "Net interest margin on loans funded by deposits, plus fees and commissions; subsidiaries contribute insurance and asset-management earnings.",
      costDrivers: "Deposit costs, branch network and staff, technology, credit losses (provisions) and regulatory reserve requirements (CRR/SLR) that earn little.",
      positioning: "Scale deposit franchise and a long record of low credit losses; the merger added a large mortgage book that dilutes margins but lowers risk.",
      risks: ["Funding growth: deposits must keep pace with lending after the merger", "Net interest margin pressure from the lower-yielding mortgage book", "Unsecured retail credit cycle", "Technology and outage risk, which has drawn regulatory action in the past"],
      basisNote: "Analysis written for Finance Desk from the bank's disclosures listed in the evidence; not a statement by the company.",
    },
    observations: [
      { metric: "gnpa_ratio", value: 1.33, unit: "percent", period: { type: "point", end: "2025-03-31", months: 0, label: "31 Mar 2025" }, scope: "standalone", basis: "regulatory", definition: "Gross NPAs as a percentage of gross advances (RBI asset classification).", cites: [ws("bs-hdfcbank-q4fy25-2025-04-21"), ws("hdfcbank-q4fy25-presentation")] },
      { metric: "nnpa_ratio", value: 0.43, unit: "percent", period: { type: "point", end: "2025-03-31", months: 0, label: "31 Mar 2025" }, scope: "standalone", basis: "regulatory", definition: "Net NPAs as a percentage of net advances.", cites: [ws("bs-hdfcbank-q4fy25-2025-04-21")] },
      { metric: "crar", value: 19.6, unit: "percent", period: { type: "point", end: "2025-03-31", months: 0, label: "31 Mar 2025" }, scope: "standalone", basis: "regulatory", definition: "Total capital adequacy ratio under Basel III.", cites: [ws("bs-hdfcbank-q4fy25-2025-04-21")] },
      { metric: "cet1_ratio", value: 17.2, unit: "percent", period: { type: "point", end: "2025-03-31", months: 0, label: "31 Mar 2025" }, scope: "standalone", basis: "regulatory", cites: [ws("bs-hdfcbank-q4fy25-2025-04-21")] },
      { metric: "total_deposits", value: 2714714.9, unit: "currency", currency: "INR", scale: "crore", period: { type: "point", end: "2025-03-31", months: 0, label: "31 Mar 2025" }, scope: "standalone", basis: "reported", cites: [ws("hdfcbank-6k-2025-q4")] },
      { metric: "gross_advances", value: 2619608.6, unit: "currency", currency: "INR", scale: "crore", period: { type: "point", end: "2025-03-31", months: 0, label: "31 Mar 2025" }, scope: "standalone", basis: "reported", definition: "Gross advances as reported in the results release.", cites: [ws("hdfcbank-6k-2025-q4")] },
      { metric: "gnpa_ratio", value: 1.15, unit: "percent", period: { type: "point", end: "2026-03-31", months: 0, label: "31 Mar 2026" }, scope: "standalone", basis: "regulatory", definition: "Gross NPAs as a percentage of gross advances.", cites: [ws("bs-hdfcbank-q4fy26-2026-04-18"), ws("hdfcbank-q4fy26-presentation")] },
      { metric: "nnpa_ratio", value: 0.38, unit: "percent", period: { type: "point", end: "2026-03-31", months: 0, label: "31 Mar 2026" }, scope: "standalone", basis: "regulatory", cites: [ws("hdfcbank-q4fy26-presentation")] },
      { metric: "crar", value: 19.7, unit: "percent", period: { type: "point", end: "2026-03-31", months: 0, label: "31 Mar 2026" }, scope: "standalone", basis: "regulatory", cites: [ws("hdfcbank-q4fy26-presentation")] },
      { metric: "cet1_ratio", value: 17.3, unit: "percent", period: { type: "point", end: "2026-03-31", months: 0, label: "31 Mar 2026" }, scope: "standalone", basis: "regulatory", cites: [ws("hdfcbank-q4fy26-presentation")] },
      { metric: "total_deposits", value: 31.05, unit: "currency", currency: "INR", scale: "trillion", period: { type: "point", end: "2026-03-31", months: 0, label: "31 Mar 2026" }, scope: "standalone", basis: "reported", definition: "End-of-period deposits; reported as ₹31.05 trillion (+14.4% year on year).", cites: [ws("hdfcbank-q4fy26-presentation"), ws("bs-hdfcbank-q4fy26-2026-04-18")] },
    ],
    peers: [
      { companyId: "axis-bank", reason: "Large private bank competing for the same retail and corporate customers." },
      { companyId: "federal-bank", reason: "Mid-sized private bank; useful contrast in scale and funding mix." },
      { companyId: "rbl-bank", reason: "Smaller private bank recently recapitalised by a foreign acquirer." },
    ],
    ownership: [],
    recordUpdated: "2026-09-25",
  },
  {
    id: "hdfc-ltd",
    legalName: "Housing Development Finance Corporation Limited",
    displayName: "HDFC Ltd (historical)",
    aliases: ["HDFC", "Housing Development Finance Corporation"],
    formerNames: [],
    tickers: [{ exchange: "NSE", symbol: "HDFC", active: false }],
    country: "IN",
    sector: "fig",
    subsector: "Housing finance company",
    lifecycle: { status: "merged", note: "Merged into HDFC Bank under the composite scheme of amalgamation.", validTo: "2023-07-01", successorId: "hdfc-bank" },
    website: null,
    identityCites: [ws("hdfcltd-pr-2022-04-04", "Press release naming the company as India's largest housing finance company"), lead("hdfcltd-pr-2022-04-04", "Former NSE symbol recorded from builder knowledge.")],
    businessModel: {
      summary:
        "Until July 2023, India's largest housing finance company: it originated and held long-dated home loans funded by bonds, bank borrowings and public deposits, and owned stakes in HDFC Bank, HDFC Life, HDFC ERGO and HDFC AMC.",
      customers: "Individual home buyers and, to a lesser degree, developers and corporates.",
      products: "Home loans, construction finance, deposits from the public; group holdings in insurance and asset management.",
      revenueModel: "Spread between mortgage yields and wholesale funding costs, plus dividends and value from subsidiaries.",
      costDrivers: "Cost of borrowings (bonds, bank loans, deposits), credit costs and a lean operating cost base.",
      positioning: "Low-cost mortgage originator with strong asset quality; its funding cost advantage narrowed as NBFC regulation converged with banks.",
      risks: ["Wholesale funding cost and refinancing risk", "Regulatory convergence with banks eroding its model"],
      basisNote: "Historical entity; kept for deal history. Analysis based on the merger announcement.",
    },
    observations: [],
    peers: [{ companyId: "hdfc-bank", reason: "Successor entity after the 2023 merger." }],
    ownership: [],
    recordUpdated: "2026-09-25",
  },
];
