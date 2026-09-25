import type { PeerSet } from "../../shared/schemas/research";

/**
 * Numerical peer sets (September 2026 follow-up). Values come only from each company's sourced
 * observations; a cell with no sourced observation stays empty. Periods are Indian fiscal years
 * (year to 31 March); ratios and headcount are point values at the period end.
 */
export const peerSets: PeerSet[] = [
  {
    id: "india-banks",
    name: "Indian banks",
    description: "Seven listed Indian banks: the four largest private-sector banks, the largest public-sector bank (SBI) and two mid-sized private banks that brought in foreign strategic investors (Federal Bank, RBL Bank).",
    sector: "fig",
    companyIds: ["hdfc-bank", "icici-bank", "axis-bank", "kotak-mahindra-bank", "state-bank-of-india", "federal-bank", "rbl-bank"],
    metrics: ["gnpa_ratio", "nnpa_ratio", "crar", "cet1_ratio", "net_income"],
    periods: [
      { end: "2024-03-31", label: "FY24" },
      { end: "2025-03-31", label: "FY25" },
      { end: "2026-03-31", label: "FY26" },
    ],
    preferredScope: "standalone",
    note: "Asset-quality and capital ratios are regulatory measures as reported by each bank; profit is the bank's reported full-year profit after tax. HDFC Bank's FY24 figures follow its July 2023 merger with HDFC Ltd. Market data (P/B, P/E) is not held.",
  },
  {
    id: "india-it-services",
    name: "Indian IT services",
    description: "Six listed Indian IT services companies (TCS, Infosys, HCLTech, Wipro, Tech Mahindra, LTIMindtree) compared on reported consolidated revenue, operating margin, profit and headcount.",
    sector: "tmt",
    companyIds: ["tcs", "infosys", "hcltech", "wipro", "tech-mahindra", "ltimindtree"],
    metrics: ["revenue", "ebit_margin", "net_income", "employees"],
    periods: [
      { end: "2024-03-31", label: "FY24" },
      { end: "2025-03-31", label: "FY25" },
      { end: "2026-03-31", label: "FY26" },
    ],
    preferredScope: "consolidated",
    note: "Some companies report rupee figures in crore and others in billion; they are converted exactly within the same currency (1 billion = 100 crore). US-dollar figures are shown as reported and never converted. Trading multiples need dated market prices, which are not held.",
  },
];
