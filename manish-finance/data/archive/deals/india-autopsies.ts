import type { DealInput } from "../../../shared/schemas/research";
import { day, doc, ws } from "../lib";

export const documents = [
  // LTI + Mindtree
  doc("bt-lti-mindtree-2022-05-06", "Business Today", "https://www.businesstoday.in/latest/corporate/story/lt-infotech-mindtree-merger-announced-332606-2022-05-06", "L&T Infotech, Mindtree merger announced", "news_report", false, "2022-05-06"),
  doc("bloomberg-lti-mindtree-2022-05-06", "Bloomberg", "https://www.bloomberg.com/news/articles/2022-05-06/larsen-s-software-units-agree-to-merge-in-stock-swap-deal", "L&T's Mindtree and Larsen & Toubro Infotech to merge in $18 billion stock deal", "news_report", false, "2022-05-06"),
  doc("jsa-mindtree-2022", "JSA Advocates & Solicitors", "https://www.jsalaw.com/deals-matter/amalgamation-of-mindtree-limited-into-larsen-toubro-infotech-limited/", "Amalgamation of Mindtree Limited into Larsen & Toubro Infotech Limited", "company_page", true, "2022", "year"),
  doc("bt-ltimindtree-effective-2022-11-14", "Business Today", "https://www.businesstoday.in/latest/corporate/story/larsen-toubro-infotech-mindtree-become-one-merged-entity-352861-2022-11-14", "Larsen & Toubro Infotech, Mindtree become one merged entity", "news_report", false, "2022-11-14"),
  doc("bw-ltimindtree-2022-11-14", "LTIMindtree (Business Wire)", "https://www.businesswire.com/news/home/20221114005625/en", "LTIMindtree begins operating as a merged entity (press release)", "press_release", true, "2022-11-14"),
  doc("ltim-fy25-results-2025-04-23", "LTIMindtree Limited", "https://www.ltimindtree.com/news-event/ltimindtree-revenue-up-7-inr-q4fy25/", "LTIMindtree’s FY25 Revenue up 7% in INR", "press_release", true, "2025-04-23"),
  // Adani – Ambuja / ACC
  doc("adani-pr-2022-05-15", "Adani Group", "https://www.adani.com/newsroom/media-releases/adani-to-acquire-holcims-stake-in-ambuja-cements-and-acc-limited", "Adani to acquire Holcim's stake in Ambuja Cements and ACC Limited", "press_release", true, "2022-05-15"),
  doc("holcim-pr-2022-05-15", "Holcim Ltd", "https://www.holcim.com/media/media-releases/holcim-india-business-acquired", "Adani Group to acquire Holcim's India business", "press_release", true, "2022-05-15"),
  doc("latham-adani-2022-05", "Latham & Watkins LLP", "https://www.lw.com/en/news/2022/05/latham-advises-adani-group-on-its-acquisition-of-holcims-stake", "Latham advises Adani Group on its US$10.5 billion acquisition of Holcim's stake in Ambuja Cements and ACC", "company_page", true, "2022-05", "month"),
  doc("adani-pr-2022-09-16", "Adani Group", "https://www.adani.com/newsroom/media-releases/adani-becomes-indias-second-largest-cement-player", "Adani becomes India’s second largest cement player", "press_release", true, "2022-09-16"),
  doc("bs-ambuja-merger-2025-12-23", "Business Standard", "https://www.business-standard.com/markets/news/ambuja-cements-approves-merger-with-acc-orient-cement-brokerages-decode-impact-whats-in-for-investors-125122300610_1.html", "Ambuja Cements approves merger with ACC, Orient Cement; brokerages decode impact", "news_report", false, "2025-12-23"),
  // Zomato – Blinkit
  doc("zomato-letter-2022-06-24", "Zomato Limited", "https://www.zomato.com/blog/zomatos-proposed-acquisition-of-blinkit/", "Zomato’s proposed acquisition of Blinkit (shareholder letter)", "press_release", true, "2022-06-24"),
  doc("nse-zomato-blinkit-2022-06-24", "Zomato Limited (NSE filing)", "https://nsearchives.nseindia.com/corporate/ZOMATO_24062022195320_Zomato_ProposedAcquisitionofBlinkit.pdf", "Zomato’s Proposed Acquisition of Blinkit (exchange filing)", "exchange_filing", true, "2022-06-24"),
  doc("techcrunch-zomato-blinkit-2022-06-24", "TechCrunch", "https://techcrunch.com/2022/06/24/zomato-blinkit/", "Zomato acquires Blinkit for $568 million in instant-grocery delivery push", "news_report", false, "2022-06-24"),
  doc("inc42-zomato-blinkit-close-2022-08", "Inc42", "https://inc42.com/buzz/zomato-completes-acquisition-of-quick-commerce-startup-blinkit/", "Zomato completes acquisition of quick-commerce startup Blinkit", "news_report", false, "2022-08-10"),
  doc("inc42-zomato-sebi-2022-06", "Inc42", "https://inc42.com/buzz/zomato-investors-write-sebi-unhappy-late-blinkit-disclosure/", "Zomato investors write to SEBI, unhappy with late Blinkit disclosure", "news_report", false, "2022-06", "month"),
  doc("bs-eternal-rename-2025-02-06", "Business Standard", "https://www.business-standard.com/companies/news/zomato-board-approves-name-change-to-eternal-ltd-unveils-new-logo-125020601489_1.html", "Zomato board approves name change to Eternal Ltd, unveils new logo", "news_report", false, "2025-02-06"),
  doc("eternal-q4fy26-letter", "Eternal Limited", "https://www.eternal.com/blog/q4fy26/", "Q4FY26 shareholders' letter and results", "investor_presentation", true, "2026-04", "month"),
  doc("sahi-eternal-q4fy26", "Sahi", "https://www.sahi.com/blogs/eternal-limited-zomato-parent-q4-fy26-results-analysis", "Eternal Q4 FY26: Profit +346%, Blinkit EBITDA positive for first time", "news_report", false, "2026-04", "month"),
  // Zee – Sony
  doc("sony-6k-2024-01", "Sony Group Corporation (SEC Form 6-K)", "https://www.sec.gov/Archives/edgar/data/313838/000115752324000085/a53885811.htm", "Sony Group Corp Form 6-K (January 2024): termination of the merger agreement with Zee", "regulatory_filing", true, "2024-01", "month"),
  doc("variety-sony-zee-2024-01-22", "Variety", "https://variety.com/2024/tv/news/sony-zee-india-deal-halted-1235865873/", "Sony calls off $10 billion merger with Indian TV giant Zee Entertainment Enterprises", "news_report", false, "2024-01-22"),
  doc("deadline-sony-zee-2024-01-22", "Deadline", "https://deadline.com/2024/01/sony-zee-merger-called-off-termination-notice-india-1235800180/", "Sony walks away from $10B merger with Zee Entertainment in India", "news_report", false, "2024-01-22"),
  doc("vro-sony-zee-2024", "Value Research", "https://www.valueresearchonline.com/stories/53998/what-really-killed-the-sony-zee-merger/", "Zee-Sony merger collapse: $10 billion deal ends with drama", "news_report", false, "2024", "year"),
];

const PROMPTS = [
  "What is the buyer actually buying: earnings, distribution, technology, customers, a licence, or control?",
  "Which two assumptions most affect the price?",
  "What evidence would make you reject the stated synergy case?",
  "Is the financing structure consistent with the buyer's constraints?",
];

export const deals: DealInput[] = [
  {
    id: "lti-mindtree-merger",
    title: "Larsen & Toubro Infotech and Mindtree merge into LTIMindtree",
    aliases: ["LTIMindtree merger", "LTI–Mindtree amalgamation"],
    dealType: "merger",
    buyerType: "strategic",
    sector: "tmt",
    subsector: "IT services",
    acquirer: { companyId: "ltimindtree", name: "Larsen & Toubro Infotech Limited (renamed LTIMindtree Limited)", country: "IN", cites: [ws("bt-lti-mindtree-2022-05-06")] },
    target: { companyId: "mindtree", name: "Mindtree Limited", country: "IN", cites: [ws("bt-lti-mindtree-2022-05-06"), ws("jsa-mindtree-2022")] },
    otherParties: [{ role: "other", companyId: "larsen-toubro", name: "Larsen & Toubro Limited (controlling shareholder of both)", country: "IN", cites: [ws("bt-ltimindtree-effective-2022-11-14")] }],
    perimeter: "Amalgamation of Mindtree Limited into Larsen & Toubro Infotech Limited under a scheme approved by the NCLT Mumbai and Bengaluru benches; the combined company was renamed LTIMindtree.",
    stake: { acquiredPct: 100, resultingPct: 100, note: "Whole-company amalgamation between two listed subsidiaries of L&T; L&T held 68.73% of the merged entity.", cites: [ws("bt-ltimindtree-effective-2022-11-14")] },
    announced: { ...day("2022-05-06"), cites: [ws("bt-lti-mindtree-2022-05-06"), ws("bloomberg-lti-mindtree-2022-05-06")] },
    effective: { ...day("2022-11-14"), cites: [ws("bt-ltimindtree-effective-2022-11-14"), ws("bw-ltimindtree-2022-11-14")] },
    status: { value: "completed", asOf: "2022-11-14", cites: [ws("bt-ltimindtree-effective-2022-11-14")] },
    terms: [
      { metric: "share_exchange_ratio", text: "73 LTI shares for every 100 Mindtree shares", amount: null, kind: "announced", asOf: "2022-05-06", status: "reported", cites: [ws("bt-lti-mindtree-2022-05-06"), ws("bt-ltimindtree-effective-2022-11-14")] },
      { metric: "value_unclear_basis", label: "Reported size of the combination", amount: 18, currency: "USD", unit: "billion", valueBasis: "unclear", kind: "reported_by_media", asOf: "2022-05-06", status: "reported", headline: true, note: "A media description of the combined company's size in an all-stock merger, not a price.", cites: [ws("bloomberg-lti-mindtree-2022-05-06", "Headline")] },
    ],
    payment: { mix: ["stock"], text: "All-stock amalgamation at the fixed exchange ratio.", cites: [ws("bt-lti-mindtree-2022-05-06")] },
    financing: null,
    events: [
      { type: "announcement", date: day("2022-05-06"), publishedDate: "2022-05-06", title: "Boards approve the scheme of amalgamation", jurisdiction: "IN", statusAfter: "announced", cites: [ws("bt-lti-mindtree-2022-05-06")] },
      { type: "completion", date: day("2022-11-14"), publishedDate: "2022-11-14", title: "LTIMindtree begins operating as one merged entity", jurisdiction: "IN", statusAfter: "completed", cites: [ws("bt-ltimindtree-effective-2022-11-14"), ws("bw-ltimindtree-2022-11-14")] },
    ],
    advisers: { disclosure: "partial", list: [{ side: "target", role: "legal", name: "JSA Advocates & Solicitors (for Mindtree)", cites: [ws("jsa-mindtree-2022")] }] },
    rationale: [{ text: "Gain the scale to compete with large global and Indian IT services firms for bigger digital transformation deals.", cites: [ws("bloomberg-lti-mindtree-2022-05-06")] }],
    sectorContext:
      "Indian IT services firms win large multi-year outsourcing and transformation contracts where scale, client breadth and delivery depth matter. Two sister companies under one parent competed for some of the same clients; merging them removes that overlap and lifts the combined firm into a higher size tier.",
    comparables: [{ dealId: "wipro-harman-dts", reason: "Indian IT services firm using M&A to add engineering capability." }],
    afterDeal: [{ date: "2025-04-23", kind: "fact", text: "For FY2025 LTIMindtree reported revenue of US$4,492.5 million (up 4.8% in USD), an EBIT margin of 14.5% and order inflow of about US$6 billion.", cites: [ws("ltim-fy25-results-2025-04-23")] }],
    autopsy: {
      asAnnounced: {
        cutoff: "2022-05-06",
        situation:
          "L&T controlled two listed IT services companies: LTI and Mindtree, which L&T had taken over in 2019. Both served overlapping industries with complementary client lists. The boards proposed an all-stock amalgamation at 73 LTI shares per 100 Mindtree shares, keeping L&T in control of the larger combined firm.",
        whatBuyerIsBuying:
          "Scale and client breadth rather than a new capability: a bigger delivery organisation and a longer list of top-tier clients, which helps the combined firm qualify for larger deals. It also simplifies L&T's group structure by removing two separately listed competitors.",
        keyAssumptions: [
          "Clients see the combined firm as a credible vendor for larger deals, lifting deal sizes.",
          "Cross-selling across the two client bases outweighs any client overlap and attrition.",
          "Integration does not distract sales and delivery teams during a technology spending slowdown.",
        ],
        priceAndStructure:
          "A share-for-share merger between two listed companies under common control. The ratio is the price: it reflects the relative valuation of the two stocks. Minority shareholders of both companies bear the integration risk, while L&T keeps control of the merged entity.",
        risksAtAnnouncement: ["Culture clash between two delivery organisations", "Client and talent attrition during integration", "A slowdown in discretionary IT spending", "Governance questions for minority shareholders when a parent merges two subsidiaries"],
        falsifiers: ["Growth after the merger below the average of the two standalone companies", "Margin erosion from integration costs that does not reverse"],
      },
      whatWeKnowNow: {
        cutoff: "2026-09-25",
        facts: [
          { text: "The merger became effective on 14 November 2022; L&T held 68.73% of the merged company.", cites: [ws("bt-ltimindtree-effective-2022-11-14")] },
          { text: "In FY2025 the merged company grew revenue 4.8% in USD to US$4,492.5 million with a 14.5% EBIT margin.", cites: [ws("ltim-fy25-results-2025-04-23")] },
        ],
        interpretation: [
          "The merged firm reached a larger size tier, but growth in FY2025 was modest, reflecting both a weak demand environment and integration work.",
          "Separating merger effects from the industry slowdown requires comparison with peers over the same years.",
        ],
        evidenceLimits: "Deal-size mix, client overlap and attrition data were not verified; peer comparison is left to the user.",
      },
      analysis: {
        thesis: "A logical scale merger under common control. Its value depends on winning larger deals than either firm could alone — something to test with deal-win data rather than revenue alone, because the post-merger period coincided with an industry slowdown.",
        alternatives: ["Group simplification by L&T.", "Defensive scale-up against consolidation among global IT services firms."],
        risks: ["Integration distraction", "Client concentration", "Talent attrition"],
        falsifiers: ["No increase in large-deal wins versus the two firms' pre-merger history"],
      },
      prompts: PROMPTS,
      rubric: [
        { criterion: "Evidence", strong: "Uses the ratio, dates and post-merger revenue/margin with their period.", weak: "Cites the ‘$18 billion’ headline as a price." },
        { criterion: "Logic", strong: "Explains why scale matters for deal eligibility in IT services.", weak: "Assumes 1 + 1 = 3." },
        { criterion: "Valuation", strong: "Discusses relative valuation embedded in the exchange ratio.", weak: "Ignores minority shareholders." },
        { criterion: "Risk", strong: "Separates industry slowdown from integration effects.", weak: "Attributes all performance to the merger." },
      ],
    },
    tags: ["all-stock", "common control", "IT services", "scale"],
    researchCutoff: "2026-09-25",
    recordUpdated: "2026-09-25",
  },
  {
    id: "adani-ambuja-acc",
    title: "Adani family acquires Holcim’s stakes in Ambuja Cements and ACC",
    aliases: ["Adani–Holcim India", "Ambuja and ACC acquisition"],
    dealType: "control_acquisition",
    buyerType: "strategic",
    sector: "industrials",
    subsector: "Cement and building materials",
    acquirer: { companyId: "adani-group", name: "Adani family (through Endeavour Trade and Investment, a special purpose vehicle)", country: "IN", cites: [ws("adani-pr-2022-05-15"), ws("adani-pr-2022-09-16")] },
    target: { companyId: "ambuja-cements", name: "Ambuja Cements Limited (and its subsidiary ACC Limited)", country: "IN", cites: [ws("adani-pr-2022-05-15")] },
    otherParties: [
      { role: "seller", companyId: "holcim", name: "Holcim Ltd", country: "CH", cites: [ws("holcim-pr-2022-05-15")] },
      { role: "other", companyId: "acc", name: "ACC Limited", country: "IN", cites: [ws("adani-pr-2022-05-15")] },
    ],
    perimeter: "Holcim's entire holdings in Ambuja Cements (63.19%) and ACC (54.53%, held directly and through Ambuja), followed by mandatory open offers to public shareholders of both companies.",
    stake: { acquiredPct: 63.19, resultingPct: 63.15, note: "Holcim's 63.19% of Ambuja and 54.53% of ACC; after the transaction and open offers Adani held 63.15% of Ambuja and 56.69% of ACC.", cites: [ws("adani-pr-2022-05-15"), ws("adani-pr-2022-09-16")] },
    announced: { ...day("2022-05-15"), cites: [ws("adani-pr-2022-05-15"), ws("holcim-pr-2022-05-15")] },
    effective: { ...day("2022-09-16"), cites: [ws("adani-pr-2022-09-16")] },
    status: { value: "completed", asOf: "2022-09-16", cites: [ws("adani-pr-2022-09-16")] },
    terms: [
      { metric: "value_unclear_basis", label: "Holcim stakes plus open-offer consideration", amount: 10.5, currency: "USD", unit: "billion", valueBasis: "unclear", kind: "announced", asOf: "2022-05-15", status: "reported", headline: true, note: "Combines the price for Holcim's stakes with the maximum open-offer consideration; it is not an enterprise value of the companies.", cites: [ws("adani-pr-2022-05-15"), ws("latham-adani-2022-05")] },
      { metric: "offer_price_per_share", label: "Ambuja open offer price", amount: 385, currency: "INR", unit: "one", kind: "announced", asOf: "2022-05-15", status: "reported", cites: [ws("adani-pr-2022-05-15")] },
      { metric: "offer_price_per_share", label: "ACC open offer price", amount: 2300, currency: "INR", unit: "one", kind: "announced", asOf: "2022-05-15", status: "reported", cites: [ws("adani-pr-2022-05-15")] },
    ],
    payment: { mix: ["cash"], text: "Cash for Holcim's stakes and for shares tendered in the open offers.", cites: [ws("adani-pr-2022-05-15")] },
    financing: null,
    events: [
      { type: "announcement", date: day("2022-05-15"), publishedDate: "2022-05-15", title: "Definitive agreements to acquire Holcim's stakes", jurisdiction: "IN", statusAfter: "announced", cites: [ws("adani-pr-2022-05-15"), ws("holcim-pr-2022-05-15")] },
      { type: "completion", date: day("2022-09-16"), publishedDate: "2022-09-16", title: "Acquisition and open offers completed; Adani becomes India’s second-largest cement player", jurisdiction: "IN", statusAfter: "completed", cites: [ws("adani-pr-2022-09-16")] },
      { type: "subsequent", date: day("2025-12-23"), publishedDate: "2025-12-23", title: "Ambuja Cements board approves merger with ACC and Orient Cement", jurisdiction: "IN", cites: [ws("bs-ambuja-merger-2025-12-23", "Report headline")] },
    ],
    advisers: { disclosure: "partial", list: [{ side: "buyer", role: "legal", name: "Latham & Watkins", cites: [ws("latham-adani-2022-05")] }] },
    rationale: [{ text: "Enter the cement sector at scale, making Adani India's second-largest cement producer, with links to its infrastructure, logistics and energy businesses.", cites: [ws("adani-pr-2022-09-16"), ws("adani-pr-2022-05-15")] }],
    sectorContext:
      "Cement is a regional, freight-heavy business: plants sit near limestone and sell within a few hundred kilometres. Scale buys procurement power, logistics efficiency and pricing discipline in regional markets. Consolidation among India's largest producers has been driven by the cost of building new capacity versus buying existing plants.",
    comparables: [{ dealId: "tata-motors-iveco", reason: "Large Indian group buying an industrial business from a European seller." }],
    afterDeal: [{ date: "2025-12-23", kind: "fact", text: "Ambuja Cements' board approved merging ACC and Orient Cement into Ambuja, simplifying the listed structure created in 2022.", cites: [ws("bs-ambuja-merger-2025-12-23")] }],
    autopsy: {
      asAnnounced: {
        cutoff: "2022-05-15",
        situation:
          "Holcim decided to exit India, selling its controlling stakes in two listed cement makers, Ambuja and ACC (ACC itself a subsidiary of Ambuja). The Adani family agreed to buy the stakes and make mandatory open offers, entering cement in a single step instead of building plants.",
        whatBuyerIsBuying:
          "Operating capacity, limestone reserves, brands and dealer networks across India, plus control of two listed companies. It is buying time: new capacity takes years to permit and build.",
        keyAssumptions: [
          "Adani can lower costs using its ports, logistics and energy businesses.",
          "Cement demand keeps growing with infrastructure and housing spending.",
          "Capacity can be expanded quickly by debottlenecking and further acquisitions.",
        ],
        priceAndStructure:
          "Cash purchase of Holcim's controlling stakes plus open offers at ₹385 (Ambuja) and ₹2,300 (ACC). The widely quoted US$10.5 billion includes the maximum open-offer amount, so it overstates what is paid if few shareholders tender. Because ACC is controlled through Ambuja, the structure is a cascading control acquisition.",
        risksAtAnnouncement: ["Execution of an aggressive capacity expansion", "Group leverage and financing costs", "Cyclical cement pricing and fuel costs", "Minority-shareholder complexity with two listed companies"],
        falsifiers: ["Unit costs do not fall meaningfully relative to peers", "Capacity additions lag plans or return below the cost of capital"],
      },
      whatWeKnowNow: {
        cutoff: "2026-09-25",
        facts: [
          { text: "The acquisition and open offers completed on 16 September 2022; Adani held 63.15% of Ambuja and 56.69% of ACC afterwards.", cites: [ws("adani-pr-2022-09-16")] },
          { text: "In December 2025 Ambuja's board approved merging ACC and Orient Cement into Ambuja.", cites: [ws("bs-ambuja-merger-2025-12-23")] },
        ],
        interpretation: [
          "The cascading two-listed-company structure was always likely to be simplified; the 2025 merger proposal completes that step.",
          "Whether Adani's logistics advantages lowered unit costs needs company cost data, not verified here.",
        ],
        evidenceLimits: "Cost, capacity and financing outcomes were not verified from primary disclosures.",
      },
      analysis: {
        thesis: "A buy-not-build entry into a consolidating, regional industry where time-to-capacity matters. The value case rests on cost synergies with the group's infrastructure and on growth capital; the headline figure is inflated by open-offer arithmetic.",
        alternatives: ["Vertical integration with ports, logistics and power.", "Platform for roll-up acquisitions in cement."],
        risks: ["Leverage", "Cement cycle", "Execution of capacity growth"],
        falsifiers: ["Unit cost gap to leading peers does not narrow within three years"],
      },
      prompts: PROMPTS,
      rubric: [
        { criterion: "Evidence", strong: "Separates the stake price from open-offer amounts and cites dates.", weak: "Calls US$10.5 billion the enterprise value." },
        { criterion: "Logic", strong: "Explains why cement is regional and how logistics affect margins.", weak: "Assumes national scale automatically lowers costs." },
        { criterion: "Valuation", strong: "Uses capacity-based or EV/EBITDA comparisons with consistent bases.", weak: "Mixes equity and enterprise values." },
        { criterion: "Risk", strong: "Discusses leverage and the cement cycle with indicators.", weak: "Ignores financing." },
      ],
    },
    tags: ["open offer", "cascading control", "cement", "buy versus build"],
    researchCutoff: "2026-09-25",
    recordUpdated: "2026-09-25",
  },
  {
    id: "zomato-blinkit",
    title: "Zomato acquires Blinkit (Blink Commerce)",
    aliases: ["Zomato–Blinkit", "Grofers acquisition", "Eternal–Blinkit"],
    dealType: "control_acquisition",
    buyerType: "strategic",
    sector: "consumer",
    subsector: "Consumer internet — quick commerce",
    acquirer: { companyId: "eternal", name: "Zomato Limited (now Eternal Limited)", country: "IN", cites: [ws("zomato-letter-2022-06-24")] },
    target: { companyId: "blinkit", name: "Blink Commerce Private Limited (Blinkit, formerly Grofers)", country: "IN", cites: [ws("nse-zomato-blinkit-2022-06-24")] },
    otherParties: [],
    perimeter: "Equity shares of Blink Commerce Private Limited, the company operating the Blinkit quick-commerce business, acquired from its shareholders in exchange for new Zomato shares.",
    stake: { acquiredPct: null, resultingPct: 100, note: "Zomato had invested in Blinkit in 2021; after completion Blinkit became a wholly owned subsidiary. The exact percentage acquired in 2022 is not recorded here.", cites: [ws("zomato-letter-2022-06-24"), ws("inc42-zomato-blinkit-close-2022-08")] },
    announced: { ...day("2022-06-24"), cites: [ws("zomato-letter-2022-06-24"), ws("nse-zomato-blinkit-2022-06-24")] },
    effective: { ...day("2022-08-10"), cites: [ws("inc42-zomato-blinkit-close-2022-08")] },
    status: { value: "completed", asOf: "2022-08-10", cites: [ws("inc42-zomato-blinkit-close-2022-08")] },
    terms: [{ metric: "stake_consideration", label: "Consideration in Zomato shares", amount: 4447.48, currency: "INR", unit: "crore", valueBasis: "stake", kind: "announced", asOf: "2022-06-24", status: "reported", headline: true, note: "All-stock; about US$568 million at announcement. Paid for the shares Zomato did not already own.", cites: [ws("techcrunch-zomato-blinkit-2022-06-24"), ws("nse-zomato-blinkit-2022-06-24")] }],
    payment: { mix: ["stock"], text: "All-stock: new Zomato shares issued to Blinkit's selling shareholders.", cites: [ws("techcrunch-zomato-blinkit-2022-06-24")] },
    financing: null,
    events: [
      { type: "announcement", date: day("2022-06-24"), publishedDate: "2022-06-24", title: "Zomato board approves acquiring Blink Commerce", detail: "Some investors later complained to SEBI about the timing of the disclosure.", jurisdiction: "IN", statusAfter: "announced", cites: [ws("zomato-letter-2022-06-24"), ws("nse-zomato-blinkit-2022-06-24"), ws("inc42-zomato-sebi-2022-06")] },
      { type: "completion", date: day("2022-08-10"), publishedDate: "2022-08-10", title: "Acquisition completed", jurisdiction: "IN", statusAfter: "completed", cites: [ws("inc42-zomato-blinkit-close-2022-08")] },
      { type: "subsequent", date: day("2025-02-06"), publishedDate: "2025-02-06", title: "Zomato's board approves renaming the listed company Eternal, citing Blinkit's importance", jurisdiction: "IN", cites: [ws("bs-eternal-rename-2025-02-06")] },
    ],
    advisers: { disclosure: "not_researched", list: [] },
    rationale: [
      { text: "Quick commerce is a natural extension of food delivery: both are hyperlocal, and demand peaks are complementary (non-meal times versus meal times).", cites: [ws("zomato-letter-2022-06-24")] },
      { text: "Quick commerce enlarges the addressable market and profit pool and makes the business more defensible.", cites: [ws("zomato-letter-2022-06-24")] },
    ],
    sectorContext:
      "Quick commerce delivers groceries and essentials in minutes from dark stores. Unit economics depend on order density, average order value, take rates from brands and advertising, and dark-store utilisation — metrics that differ from marketplace GMV and must not be confused with revenue.",
    comparables: [{ dealId: "walmart-flipkart", reason: "Another large bet on Indian consumer internet distribution." }],
    afterDeal: [
      { date: "2025-02-06", kind: "fact", text: "The listed company was renamed Eternal because quick commerce had become a major driver alongside food delivery.", cites: [ws("bs-eternal-rename-2025-02-06")] },
      { date: null, kind: "fact", text: "Eternal's Q4 FY26 results were reported as the first quarter of positive EBITDA for Blinkit.", cites: [ws("eternal-q4fy26-letter"), ws("sahi-eternal-q4fy26")] },
    ],
    autopsy: {
      asAnnounced: {
        cutoff: "2022-06-24",
        situation:
          "Zomato, a listed food-delivery company, proposed to acquire Blinkit, a loss-making quick-commerce start-up it had already invested in, for about ₹4,447 crore in Zomato shares. Investors worried about paying for losses at a time when Zomato's own profitability was still emerging.",
        whatBuyerIsBuying:
          "A dark-store network, supply relationships and a quick-commerce customer base — an adjacency that shares riders, app users and local logistics with food delivery. It is buying an option on a new category.",
        keyAssumptions: [
          "Order density per dark store rises fast enough to cover fixed costs.",
          "Average order values and advertising income grow.",
          "Competition does not permanently depress take rates and delivery fees.",
        ],
        priceAndStructure:
          "All-stock, so Zomato preserved cash while diluting shareholders. Paying in shares also shared the risk with Blinkit's sellers, whose payoff depended on Zomato's share price.",
        risksAtAnnouncement: ["Cash burn in a capital-intensive, competitive category", "Governance and disclosure questions from investors", "Execution risk in dark-store expansion"],
        falsifiers: ["Contribution margins stay negative as order density rises", "Competitors match speed and prices indefinitely"],
      },
      whatWeKnowNow: {
        cutoff: "2026-09-25",
        facts: [
          { text: "The acquisition completed on 10 August 2022.", cites: [ws("inc42-zomato-blinkit-close-2022-08")] },
          { text: "In February 2025 the board approved renaming the company Eternal, reflecting that Blinkit had become a major business.", cites: [ws("bs-eternal-rename-2025-02-06")] },
          { text: "Q4 FY26 results were reported as Blinkit's first quarter of positive EBITDA.", cites: [ws("eternal-q4fy26-letter"), ws("sahi-eternal-q4fy26")] },
        ],
        interpretation: [
          "The category grew far faster than food delivery, validating the option value, though profitability took several years.",
          "Paying in shares let Zomato fund a loss-making business without depleting cash.",
        ],
        evidenceLimits: "Detailed unit economics (orders per store, contribution margin) were not verified from the shareholder letters in this build.",
      },
      analysis: {
        thesis: "The deal was an option bought with equity: controversial when announced because of losses, but it gave Zomato a second growth engine in a category with network-like density effects.",
        alternatives: ["Defensive: preventing a competitor from dominating a complementary hyperlocal category.", "Consolidation of an existing investment to control strategy."],
        risks: ["Price competition", "Dark-store cost inflation", "Regulatory scrutiny of quick commerce"],
        falsifiers: ["EBITDA turns negative again for a sustained period as competition intensifies"],
      },
      prompts: PROMPTS,
      rubric: [
        { criterion: "Evidence", strong: "Uses the consideration, dates and later disclosures with sources.", weak: "Relies on share-price narratives." },
        { criterion: "Logic", strong: "Explains density economics and complementary demand peaks.", weak: "Calls it synergy without mechanism." },
        { criterion: "Valuation", strong: "Discusses paying in stock and option value.", weak: "Uses GMV as if it were revenue." },
        { criterion: "Risk", strong: "Names competition and cost drivers with metrics.", weak: "Generic risks." },
      ],
    },
    tags: ["all-stock", "quick commerce", "option value", "consumer internet"],
    researchCutoff: "2026-09-25",
    recordUpdated: "2026-09-25",
  },
  {
    id: "zee-sony-merger",
    title: "Zee Entertainment–Sony Pictures Networks India merger (terminated)",
    aliases: ["Zee–Sony", "Culver Max–Zee merger", "ZEEL–SPNI"],
    dealType: "merger",
    buyerType: "strategic",
    sector: "tmt",
    subsector: "Media and broadcasting",
    acquirer: { companyId: "sony-group", name: "Culver Max Entertainment Private Limited (formerly Sony Pictures Networks India), a Sony Group company", country: "IN", cites: [ws("sony-6k-2024-01")] },
    target: { companyId: "zee-entertainment", name: "Zee Entertainment Enterprises Limited", country: "IN", cites: [ws("sony-6k-2024-01")] },
    otherParties: [],
    perimeter: "Proposed merger of Zee Entertainment Enterprises into Culver Max Entertainment (Sony Pictures Networks India), combining TV channels, content libraries and streaming platforms.",
    stake: { acquiredPct: null, resultingPct: null, note: "Terminated before completion; the planned post-merger ownership split is not recorded here.", cites: [ws("sony-6k-2024-01")] },
    announced: { ...day("2021-12-22"), cites: [ws("sony-6k-2024-01", "Background to termination notice"), ws("variety-sony-zee-2024-01-22")] },
    effective: null,
    status: { value: "terminated", asOf: "2024-01-22", cites: [ws("sony-6k-2024-01"), ws("variety-sony-zee-2024-01-22")] },
    terms: [
      { metric: "value_unclear_basis", label: "Reported size of the combined company", amount: 10, currency: "USD", unit: "billion", valueBasis: "unclear", kind: "reported_by_media", asOf: "2024-01-22", status: "reported", headline: true, note: "Media description of the combination, not a price paid.", cites: [ws("variety-sony-zee-2024-01-22"), ws("deadline-sony-zee-2024-01-22")] },
      { metric: "break_fee", label: "Termination fee claimed by Sony", amount: 90, currency: "USD", unit: "million", kind: "announced", asOf: "2024-01-22", status: "reported", note: "Claimed for alleged breaches of the merger cooperation agreement; disputed by Zee and later withdrawn in the August 2024 settlement.", cites: [ws("vro-sony-zee-2024"), ws("variety-sony-zee-2024-01-22")] },
    ],
    payment: { mix: ["stock"], text: "Planned as a share-based merger; never completed.", cites: [ws("sony-6k-2024-01")] },
    financing: null,
    events: [
      { type: "announcement", date: day("2021-12-22"), title: "Definitive merger agreements signed", jurisdiction: "IN", statusAfter: "announced", cites: [ws("variety-sony-zee-2024-01-22")] },
      { type: "court_approval", date: { date: "2023-08-01", precision: "month" }, title: "NCLT sanctions the merger scheme", jurisdiction: "IN", authority: "National Company Law Tribunal", statusAfter: "approved", cites: [ws("vro-sony-zee-2024")] },
      { type: "termination", date: day("2024-01-22"), publishedDate: "2024-01-22", title: "Sony terminates the merger agreements after closing conditions were not met by the end date", jurisdiction: "IN", statusAfter: "terminated", cites: [ws("sony-6k-2024-01"), ws("variety-sony-zee-2024-01-22")] },
      { type: "subsequent", date: { date: "2024-08-01", precision: "month" }, title: "The companies settle, withdrawing claims against each other", jurisdiction: "IN", cites: [ws("vro-sony-zee-2024")] },
    ],
    advisers: { disclosure: "not_researched", list: [] },
    rationale: [{ text: "Combine two large broadcasters' channels, libraries and streaming platforms to compete in Indian media.", cites: [ws("variety-sony-zee-2024-01-22")] }],
    sectorContext:
      "Indian broadcasting faces a shift of viewers and advertising to streaming and connected TV. Scale in content spending, sports rights and distribution was the main argument for consolidation — the same logic behind the later Reliance–Disney combination.",
    comparables: [{ dealId: "reliance-disney-star-india", reason: "The combination that did happen: scale in Indian media under Reliance control." }],
    afterDeal: [{ date: "2024-08-01", kind: "fact", text: "In August 2024 the two companies agreed to settle their disputes and withdraw all claims, with no continuing obligations.", cites: [ws("vro-sony-zee-2024")] }],
    autopsy: {
      asAnnounced: {
        cutoff: "2021-12-22",
        situation:
          "Sony's Indian TV business agreed to merge with Zee Entertainment, a listed broadcaster whose founding family had lost most of its shareholding. The combined company would have been among India's largest broadcasters; Zee's leadership was expected to run it.",
        whatBuyerIsBuying: "Content libraries, channel reach and advertising relationships, plus management continuity; for Zee shareholders, Sony's capital and global backing.",
        keyAssumptions: [
          "Regulators and courts approve the scheme within the agreed timeline.",
          "Leadership and governance arrangements satisfy both sides at closing.",
          "Scale improves advertising pricing and content economics against streaming competition.",
        ],
        priceAndStructure: "A share-based merger with closing conditions and an end date. Such agreements let either party walk away if conditions are not met by the deadline — a detail that later proved decisive.",
        risksAtAnnouncement: ["Regulatory and governance scrutiny of Zee's promoters and management", "Long approval chain (exchanges, CCI, NCLT)", "Advertising downturn and streaming disruption"],
        falsifiers: ["Failure to satisfy closing conditions by the end date", "Material governance findings affecting proposed leadership"],
      },
      whatWeKnowNow: {
        cutoff: "2026-09-25",
        facts: [
          { text: "The NCLT sanctioned the scheme in August 2023.", cites: [ws("vro-sony-zee-2024")] },
          { text: "Sony terminated the agreements on 22 January 2024, saying closing conditions were not satisfied by the end date and no extension was agreed.", cites: [ws("sony-6k-2024-01"), ws("variety-sony-zee-2024-01-22")] },
          { text: "Sony claimed a US$90 million termination fee; the parties settled in August 2024 and withdrew all claims.", cites: [ws("vro-sony-zee-2024")] },
        ],
        interpretation: [
          "Approval by the tribunal did not mean completion: closing conditions and the end date remained in the buyer's hands.",
          "Governance and leadership questions, not antitrust, were the practical deal-breakers.",
        ],
        evidenceLimits: "The detailed dispute arguments and arbitration filings were not reviewed.",
      },
      analysis: {
        thesis: "Industrial logic was sound but the deal depended on people and governance, which the contract's closing conditions and end date put at risk. It teaches that a signed merger with tribunal approval is still only as firm as its conditions.",
        alternatives: ["Sony may have re-evaluated the strategic value as the market shifted toward streaming and sports-rights consolidation."],
        risks: ["Governance", "Timeline risk", "Market shifts during a long approval process"],
        falsifiers: ["Evidence that all closing conditions were met but Sony still withdrew for price reasons"],
      },
      prompts: PROMPTS,
      rubric: [
        { criterion: "Evidence", strong: "Uses the termination notice and dates precisely.", weak: "Treats NCLT approval as completion." },
        { criterion: "Logic", strong: "Explains closing conditions, end dates and walk rights.", weak: "Blames one person without contractual context." },
        { criterion: "Valuation", strong: "Notes the US$10 billion figure is a size description.", weak: "Calls it the deal price." },
        { criterion: "Risk", strong: "Identifies governance and timeline risk at announcement.", weak: "Only mentions market risk." },
      ],
    },
    tags: ["failed deal", "termination", "closing conditions", "media consolidation"],
    researchCutoff: "2026-09-25",
    recordUpdated: "2026-09-25",
  },
];
