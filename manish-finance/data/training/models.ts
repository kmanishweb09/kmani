import type { TrainingModel } from "../../shared/schemas/research";

/**
 * FICTIONAL training models. Every company, number and scenario here is invented for practice and is
 * excluded from research statistics, coverage counts and briefs. Rates are decimals (0.25 = 25%).
 */
export const TRAINING_NOTICE = "Training example — fictional data. Not a real company or transaction.";

export const trainingModels: TrainingModel[] = [
  {
    id: "train-acq-northwind-cedar",
    kind: "acquisition",
    title: "Northwind Foods acquires Cedar Snacks (fictional)",
    description:
      "A fictional listed packaged-foods company buys a smaller snacks brand for ₹1,800 crore, funded with cash, new debt and new shares. Use it to see how funding mix, synergies and purchase-price amortisation move EPS — and why accretion is not value creation.",
    currency: "INR",
    unit: "crore",
    inputs: {
      accretion: {
        buyerNetIncome: 1200,
        buyerDilutedShares: 400,
        buyerSharePrice: 90,
        targetNetIncome: 95,
        equityConsideration: 1800,
        fundingCash: 400,
        fundingDebt: 800,
        fundingStock: 600,
        stockIssuePrice: 90,
        interestRateOnNewDebt: 0.085,
        foregoneCashYield: 0.06,
        pretaxSynergies: 60,
        incrementalRecurringCosts: 10,
        incrementalDaPpa: 25,
        taxRate: 0.25,
        oneTimeCosts: 45,
        transactionFees: 18,
        refinancedTargetDebt: 150,
      },
      targetProfile: { revenue: 1150, ebitda: 190, netDebt: 150, unaffectedEquityValue: 1450 },
    },
  },
  {
    id: "train-dcf-aurora-logistics",
    kind: "dcf",
    title: "Aurora Logistics DCF (fictional)",
    description:
      "A fictional mid-sized logistics company with five forecast years. Practise building FCFF from drivers, computing WACC, testing WACC and terminal growth in a sensitivity grid, and bridging enterprise value to value per share.",
    currency: "INR",
    unit: "crore",
    inputs: {
      forecast: {
        baseRevenue: 2400,
        baseNwc: 240,
        taxRate: 0.25,
        years: [
          { revenueGrowth: 0.14, ebitMargin: 0.11, daPctRevenue: 0.04, capexPctRevenue: 0.06, nwcPctRevenue: 0.1 },
          { revenueGrowth: 0.13, ebitMargin: 0.115, daPctRevenue: 0.04, capexPctRevenue: 0.06, nwcPctRevenue: 0.1 },
          { revenueGrowth: 0.12, ebitMargin: 0.12, daPctRevenue: 0.04, capexPctRevenue: 0.055, nwcPctRevenue: 0.1 },
          { revenueGrowth: 0.1, ebitMargin: 0.12, daPctRevenue: 0.04, capexPctRevenue: 0.05, nwcPctRevenue: 0.1 },
          { revenueGrowth: 0.08, ebitMargin: 0.12, daPctRevenue: 0.04, capexPctRevenue: 0.045, nwcPctRevenue: 0.1 },
        ],
      },
      capm: { riskFree: 0.07, beta: 1.1, equityRiskPremium: 0.065 },
      wacc: { equityValue: 3200, debtValue: 800, preTaxCostOfDebt: 0.095, taxRate: 0.25, taxShieldUsable: true, weightBasis: "target" },
      terminalGrowth: 0.05,
      bridge: { debt: 800, preferredEquity: 0, nonControllingInterests: 40, excessCash: 150, nonOperatingInvestments: 60 },
      dilutedShares: 32,
      sensitivity: { waccSteps: [-0.01, -0.005, 0, 0.005, 0.01], growthSteps: [-0.01, -0.005, 0, 0.005, 0.01] },
    },
  },
  {
    id: "train-fig-ri-harbor-bank",
    kind: "fig_residual_income",
    title: "Harbor Bank residual-income model (fictional)",
    description:
      "A fictional mid-sized Indian private bank. Value the equity with a five-year residual-income model, compare implied P/B with a justified P/B, and see how retained earnings (not deposits) fund growth. Includes a fictional peer table for P/B versus ROE.",
    currency: "INR",
    unit: "crore",
    inputs: {
      residualIncome: {
        openingBookEquity: 20000,
        costOfEquity: 0.13,
        years: [
          { roe: 0.14, payoutRatio: 0.2, capitalChanges: 0 },
          { roe: 0.145, payoutRatio: 0.2, capitalChanges: 0 },
          { roe: 0.15, payoutRatio: 0.2, capitalChanges: 0 },
          { roe: 0.15, payoutRatio: 0.25, capitalChanges: 0 },
          { roe: 0.15, payoutRatio: 0.25, capitalChanges: 0 },
        ],
      },
      justified: { roe: 0.15, costOfEquity: 0.13, growth: 0.08 },
      balanceSheet: { advances: 160000, deposits: 185000, cet1Ratio: 0.155, riskWeightedAssets: 125000, gnpaRatio: 0.019, nnpaRatio: 0.006, casaRatio: 0.34, nim: 0.036 },
      peers: [
        { name: "Peer A Bank (fictional)", pb: 2.6, roe: 0.17, cet1: 0.16 },
        { name: "Peer B Bank (fictional)", pb: 1.4, roe: 0.13, cet1: 0.14 },
        { name: "Peer C Bank (fictional)", pb: 0.9, roe: 0.1, cet1: 0.12 },
        { name: "Peer D Bank (fictional)", pb: 1.9, roe: 0.155, cet1: 0.17 },
      ],
    },
  },
  {
    id: "train-comps-orbit-software",
    kind: "comparables",
    title: "Orbit Software trading comparables (fictional)",
    description:
      "A fictional peer set for a mid-sized software company, including one peer with negative EBITDA to practise excluding not-meaningful multiples and reading medians and quartiles.",
    currency: "USD",
    unit: "million",
    inputs: {
      target: { name: "Orbit Software (fictional)", revenue: 420, ebitda: 88, netIncome: 52, bookEquity: 610, netDebt: -40, dilutedShares: 120 },
      peers: [
        { name: "Aster Cloud (fictional)", equityValue: 5200, netDebt: -300, revenue: 900, ebitda: 210, netIncome: 140, bookEquity: 1900 },
        { name: "Birch Systems (fictional)", equityValue: 2100, netDebt: 150, revenue: 520, ebitda: 105, netIncome: 60, bookEquity: 700 },
        { name: "Cobalt Apps (fictional)", equityValue: 3900, netDebt: 0, revenue: 610, ebitda: -20, netIncome: -45, bookEquity: 820 },
        { name: "Delta Data (fictional)", equityValue: 1700, netDebt: 220, revenue: 380, ebitda: 76, netIncome: 41, bookEquity: 560 },
        { name: "Elm Analytics (fictional)", equityValue: 2800, netDebt: -120, revenue: 450, ebitda: 118, netIncome: 79, bookEquity: 900 },
      ],
    },
  },
];
