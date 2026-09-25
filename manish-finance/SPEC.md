# Manish Finance Desk: complete Claude Code build prompt

Prepared for Manish on 25 September 2026. The existing kmanish.live source was inspected for this brief. This is an implementation specification for Claude Code, not website code.

## How to use this file

Give Claude Code this entire file in a new project directory. Ask it to read the file, implement the application, verify it, and return the complete handoff ZIP specified below. Use the strongest coding model available in your friend's Claude Code account. The model used to build this application does not need to be the model used by its optional AI features.

Use this starting instruction:

> Read `Manish_Finance_Claude_Code_Master_Prompt.md` completely. Treat it as the product specification and acceptance contract. Build the working application and the exact integration package it requests. Work through the implementation milestones, maintain a requirement checklist, and continue through testing and packaging. Do not stop after a plan, design mockup, or partial frontend. Do not deploy to production. If a credential or external service is unavailable, finish and test all independent work, clearly document that dependency, and never simulate a successful live connection.

The handoff should substantially reduce later development. It cannot eliminate the final integration check, database migration, secret configuration, or deployment verification. A Claude subscription does not automatically provide runtime API credentials, a commercial financial database, or permission to redistribute publisher content.

---

# BEGIN IMPLEMENTATION SPECIFICATION

## 1. Your role and the required outcome

Act as a senior product engineer, financial research product designer, and careful M&A analyst. Build a complete, polished personal finance research application called **Finance Desk**, for Manish, intended to live at **https://kmanish.live/finance**.

Its two central products are:

1. **Personal Deal Terminal:** a searchable, source-linked M&A database with transaction details, status history, deal analysis, comparisons, and a personal deal-memory workflow.
2. **Sector Intelligence Engine:** a research workspace for understanding sectors, companies, sector-specific valuation, recent developments, and the implications for M&A.

Add the closely related features specified here: company dossiers, deal autopsies, a valuation and transaction lab, a daily briefing, research notes, spaced review, and interview preparation. These must connect to the same underlying companies, deals, sectors, and sources. Avoid isolated widgets that duplicate data.

The useful daily loop is:

**Read the brief → inspect a transaction → understand its sector → test an assumption → write an opinion → recall it later.**

This is a working research application. The initial screen must contain useful information and controls. No promotional landing page, oversized hero, artificial market ticker, or generic “Get started” screen.

### User context

- Manish is an Indian undergraduate at IIM Indore exploring investment banking, M&A, private equity, and sector specialization.
- He has introductory accounting knowledge and wants to develop real analytical ability, not only collect headlines.
- India is the default geography. APAC and global transactions provide context and comparisons.
- FIG deserves a particularly strong playbook because it is an area of interest. Do not assume it is his permanent specialization.
- Design for useful 10-minute, 30-minute, and 60-minute sessions.
- He values clean, distinctive interfaces, accurate numbers, credible sources, and concise explanations.
- His existing homepage, CAT Atlas, study tracker, data connections, and personal data must remain functional.
- Do not add CAT tasks, email, calendars, portfolio trading, brokerage execution, networking automation, or a general life dashboard to this finance build.

### What “complete” means

Every required visible action must work. Realistic empty, loading, error, stale-data, signed-out, and unavailable-provider states are part of completion. Buttons that merely show “coming soon,” randomly generated charts, unconnected forms, fake AI typing, and fabricated successful saves are unacceptable.

Complete the software and the source-grounded research content. External activation dependencies may remain only where they genuinely require account access, secrets, hosting configuration, or licensed data. Identify these exactly; do not silently redefine a required live feature as a static demo.

## 2. Verified host architecture and integration constraints

These facts were read from the existing kmanish.live source on 25 September 2026, at source commit `79e35517842ac4750585ade2d8eb34a0199fd8c0`. They are a compatibility baseline, not authorization to overwrite later changes.

| Area | Existing implementation | Requirement for this build |
|---|---|---|
| Hosting | Existing OpenAI Sites project, running a Cloudflare Worker | Deliver a Worker-compatible module; final publishing belongs to the site owner/deployment agent |
| Server | JavaScript ES modules; `server/worker.mjs` exports `createApp(assets, tasks, options)` | Add finance as an isolated module with a small, documented integration change |
| Frontend | Existing pages and assets are authored under `dist/` | Do not replace or clean this directory when integrating finance |
| Build | `node scripts/build.mjs`, using esbuild | Provide prebuilt finance assets and a reproducible separate source build |
| Asset handling | Build reads supported files directly in the top level of `dist/`, embeds them in a `SITE_ASSETS` map, and bundles the Worker | Deliver flat, uniquely prefixed assets; do not assume recursive directories are already served |
| Current supported asset extensions | `.html`, `.js`, `.css`, `.svg`, `.webp`; WebP is embedded as binary/base64 | Prefer HTML/JS/CSS/SVG only. Do not add unserved JSON, fonts, WASM, or nested chunks without an explicit build patch |
| Database | Cloudflare D1, binding name `DB` | Use additive, finance-prefixed tables and parameterized queries |
| Migrations | Drizzle schema in `db/schema.ts`; migrations and metadata in `drizzle/` | Provide schema additions, SQL, and a tested migration procedure; preserve migration history |
| Authentication | Existing trusted Sites dispatch identity, read by the server's `getUser(request)` helper | Inject and reuse this helper. Do not create another login system |
| Session entry | `/signin-with-chatgpt?return_to=...` and `/signout-with-chatgpt?return_to=...` | Return to a validated local finance route |
| Existing routes | `/`, `/Atlas`, `/Atlas/scores`, `/Atlas/planning`, `/Atlas/excel`, `/Atlas/analysis`, `/Atlas/today`, `/Study` | Preserve them, their redirect rules, and their behavior |
| Existing APIs | `/api/planner`, `/api/excel/*`, `/api/study*`, `/api/missions*` | Never intercept them with finance routing |
| Production output | `dist/server/index.js`, `dist/.openai/hosting.json`, and migration metadata | Do not replace the final server bundle with a finance-only server |

The existing root package has `type: "module"`. Its inspected dependencies include esbuild 0.28.2, drizzle-kit 0.31.10, drizzle-orm 0.45.2, linkedom 0.18.13, fast-xml-parser 5.11.1, fflate 0.8.3, and oauth4webapi 3.8.8. These are observations, not instructions to downgrade a newer supplied checkout.

### Standalone delivery is the default

You may not have the existing repository. Build in a new `manish-finance` directory and implement the contract above. Do not invent a Vercel, Next.js, Supabase, Docker, Express, or VPS dependency. Do not require a long-running Node server in production.

Use TypeScript and React for the isolated finance UI, esbuild for bundling, and scoped CSS. Use a small set of established libraries only where they help: a table library for sophisticated filtering, a chart library for real data, and schema validation for imported/provider data. Native controls and a well-made component system are also acceptable. Avoid a heavyweight UI framework or a second state-management stack when ordinary React state and a query cache suffice.

Compile all finance runtime dependencies into the supplied browser and Worker bundles. The deployment agent should not have to install a separate finance application server. Pin compatible versions in the lockfile, declare the Node version used to build, and verify a clean install. Do not use `latest` as a runtime dependency declaration.

If an actual site checkout is supplied, inspect its current instructions and architecture before making an integration patch. Preserve unrelated modifications. A supplied checkout overrides stale observations in this document; explain the difference in the handoff.

### Exact namespace boundaries

- Pages: `/finance` and its documented child routes only.
- APIs: `/api/finance` and `/api/finance/*` only.
- Public asset filenames: `finance-...` plus `finance.html` and `finance.css`.
- Database tables and indexes: `finance_...`.
- Browser storage: `manish.finance.v1.*`.
- CSS: finance-only pages with a `finance-root` wrapper, or `.mf-*`/CSS Modules conventions. Never change the shared Atlas stylesheet.
- Environment variables introduced by this app: `FINANCE_...`, apart from the host-provided `DB` binding.
- No finance service worker covering `/`, `/Atlas`, or `/Study`.

Use a small Worker integration adapter. The exported contract should be equivalent to:

```ts
export function createFinance({
  getUser,
  database,
  clock = () => new Date(),
  fetcher = fetch,
}) {
  return {
    async fetch(request, env, ctx) { /* finance APIs only */ },
    async runMaintenance(env, options) { /* bounded, idempotent jobs */ },
  };
}
```

`getUser` returns the trusted host identity or null. `database(env)` returns D1. Do not trust a user ID in JSON, query parameters, or browser-supplied identity headers. Production must use the host's identity helper. The host's existing `json` helper is private/no-store, so implement separate public and private finance response helpers if public data caching is needed.

Provide a short additive integration example showing how to construct this module, dispatch `/api/finance` before the existing generic `/api/` branch, and serve `/finance` routes from `finance.html`. Forward Worker execution context if your implementation uses it. All other requests must continue through the original application.

Do not create a root catch-all that returns the finance SPA for unrelated paths. Unknown APIs must return JSON 404s. Missing JS/CSS files must remain 404s, never return HTML with status 200. Handle HEAD correctly. Canonicalize `/finance/` to `/finance` while preserving query parameters; keep deep-link behavior consistent.

The existing site identity, domain settings, deployment credentials, production secrets, and hosting manifest remain under the deployment agent's control. Do not put placeholder project IDs into production configuration or ask Manish's friend for his ChatGPT session credentials.

## 3. Information architecture

Use seven primary navigation entries. Keep settings and source diagnostics secondary.

| Navigation | Canonical route | Main job |
|---|---|---|
| Desk | `/finance` | See what changed, read the brief, and resume research |
| Deals | `/finance/deals` | Explore and compare transactions |
| Sectors | `/finance/sectors` | Build sector understanding and monitor developments |
| Companies | `/finance/companies` | Understand a business and its relevant financial drivers |
| Lab | `/finance/lab` | Test valuation and transaction assumptions |
| Briefs | `/finance/briefs` | Read daily/weekly research summaries and their evidence |
| Notebook | `/finance/notebook` | Save analysis, build deal memory, review concepts, and prepare interviews |
| Utility: Sources | `/finance/sources` | Inspect coverage, freshness, citations, and source health |
| Utility: Settings | `/finance/settings` | Preferences, data export/import, account and provider status |

Detail routes include `/finance/deals/:id`, `/finance/sectors/:slug`, `/finance/companies/:id`, `/finance/briefs/:id`, and `/finance/notebook/:id`.

Notebook has tabs for Notes, Deal Memory, Review, Learn, and Interview. Lab has tabs for Comparables, DCF, Accretion/Dilution, and FIG. Do not add another top-level page for every small capability.

Support browser back/forward, deep links, refresh, and meaningful document titles. Shareable research links may contain public filters and entity IDs, never private note text or credentials.

### Default preferences

- Geography: India. Other choices: APAC, Global. APAC includes India; Global includes both. Explain this in filter help so overlapping views are not summed as separate markets.
- Cross-border filtering: explicit choice of target location, acquirer location, or either. Default is either, clearly labelled.
- Sector focus: FIG initially highlighted, with quick access to all sectors. Following a sector is optional.
- Display currency: original currency first; optional INR/USD converted display when a dated FX rate exists.
- Number format: Indian units for INR, international units otherwise; allow switching in settings.
- Timezone: Asia/Kolkata. Store timestamps in UTC; preserve date-only announcements as dates.
- Theme: dark initially; provide a complete light theme and remember the user's preference.
- News interval: last seven days. Deal database interval: all loaded history, with useful recent presets.

Do not force an onboarding questionnaire. A dismissible “Choose your sectors” control and immediately usable defaults are sufficient.

## 4. Design specification

### Visual direction

Create a compact, premium research workstation: strong typography, a disciplined grid, precise tables, and an evidence drawer that makes the source behind a claim easy to inspect. The experience should feel authored for an analyst, with its own visual identity. Do not imitate another vendor's logo, exact screen, or proprietary trade dress.

The distinctive interaction is **evidence on demand**. A deal value, valuation multiple, regulatory claim, or news conclusion can reveal its provenance in a side drawer without losing the research context. A transaction detail view also has a restrained horizontal or vertical event spine, depending on viewport width.

Avoid decorative stock-market photography, animated globe backgrounds, neon green text everywhere, glass panels on every surface, decorative graphs, confetti, and oversized gradients.

### Design tokens

| Token | Dark default | Light theme |
|---|---|---|
| Page | `#080C12` | `#F3F6FA` |
| Surface | `#101721` | `#FFFFFF` |
| Raised surface | `#16202C` | `#EAF0F6` |
| Border | `#2B3948` | `#CBD5E1` |
| Main text | `#EDF3F8` | `#172334` |
| Muted text | `#A8B6C6` | `#536477` |
| Primary accent | `#59D7F1` | `#006D88` |
| Attention | `#F4BA63` | `#885200` |
| Positive | `#55CEA2` | `#076A49` |
| Negative | `#FF7885` | `#B42336` |

Validate actual contrast combinations. A supplied hex value does not excuse an inaccessible small label. Use text and icons as well as color for statuses.

- Typography: a clean system sans-serif stack; use a system monospace stack for figures, formulas, timestamps, and compact identifiers. Set tabular numerals. No dependency on externally hosted fonts.
- Main body: 16px. Tables and regular control labels: at least 14px. Secondary metadata: 12–13px. No illegible 9px “terminal” text.
- Headings: approximately 24–30px for a page, 18–20px for a panel. Avoid uppercase paragraphs; small uppercase section labels are acceptable.
- Spacing: 4/8/12/16/24/32px scale. Borders 1px. Cards 10px radius; small controls 6px. Keep shadows restrained.
- Desktop sidebar: approximately 216px, collapsible to a labelled/tooltip icon rail. Top bar: approximately 60px.
- At a 1440px desktop viewport, the Desk uses a main research column and a narrower context column, approximately 2:1.
- Dense data tables should have 44–48px rows, a sticky header, visible sort/filter state, aligned numeric columns, and a readable selected-row state.
- Transitions: 120–180ms. Respect reduced motion. Avoid page-load animations that delay usable content.

Use icons consistently and give icon-only controls accessible names. Real company logos are optional; monograms are an acceptable, reliable default.

### Responsive and accessible behavior

- Verify approximately 390px, 768px, 1440px, and 1920px widths.
- Desktop: table/list and detail drawer can coexist. Mobile: a drawer becomes a full-screen sheet with an obvious back/close action.
- On mobile, put the most useful deal columns first and allow intentional horizontal scrolling within the table, not the entire page. Offer compact cards if that improves readability.
- Search and primary filters must remain accessible without hunting through settings.
- Support keyboard navigation, visible focus, semantic headings, labels, focus trapping in dialogs, escape-to-close, and focus restoration.
- Charts require units, meaningful titles, tooltips, and an accessible table or text equivalent.
- At 200% zoom, content must remain usable without overlapping letters or clipped controls.
- No chart may depend only on red versus green.

### Global interactions

- `Ctrl/Cmd + K`: command palette for deals, companies, sectors, concepts, notes, and actions.
- `/`: focus search when not typing into another field.
- `Esc`: close the active overlay.
- Keep shortcuts discoverable and do not hijack normal input, browser commands, or assistive technology.
- A source-status control shows last successful refresh and leads to Sources. It must not say “Live” merely because a timer is running.
- Use skeletons matching the final layout, inline validation, and truthful save states: Saving, Saved, Failed to save, or Saved on this device.

## 5. Desk: useful from the first viewport

Header: **Finance Desk**. A small secondary line may show the user's local date and research coverage cutoff. Add global search and a concise refresh/status control.

The first desktop viewport should contain:

1. **Today's brief:** approximately three to five ranked developments relevant to followed sectors. Each item shows what happened, why it may matter for deals or valuation, the publication date, and evidence links.
2. **Recent deal tape:** a useful table of recent transactions or status changes. Do not replace it with a collection of giant number cards.
3. **Continue research:** the last opened deal, unfinished note, or saved model for the signed-in user.
4. **Review due:** due deal-memory/concept cards, with a five-minute review action.

Below that, include a sector watchlist, saved search changes, and one focused learning action. Use at most three compact summary figures: new relevant items, watched deals with changes, and reviews due. Each must have a precise denominator and time window. Empty personal data must not be populated with fictional user progress.

If no source has produced a current brief, show “Latest available brief” with its real date, or “No brief for today yet.” Do not relabel an old sample as today's research.

Offer session chips:

- **10 min:** brief plus one recall question.
- **30 min:** brief plus one deal autopsy and a short note.
- **60 min:** sector deep dive plus a model exercise and reflection.

These select a bounded research sequence; they do not invent a calendar or notify anyone.

## 6. Personal Deal Terminal

### Deal list

Default columns: announcement date, acquirer, target, sector/subsector, target geography, disclosed value with its basis, stake, status, and source/verification indicator. Add optional columns for payment mix, sponsor/strategic buyer, financing, and eligible transaction multiples.

Required controls:

- Search by legal name, alias, ticker, deal title, and adviser where known.
- Multi-select filters for sector, geography, acquirer type, deal type, status, date, cross-border, payment type, and disclosed/undisclosed value.
- Distinguish mergers, control acquisitions, minority stakes, asset purchases, carve-outs, buyouts, joint ventures, and announced proposals.
- Sort, column visibility, URL-preserved public filters, pagination, clear filters, and meaningful no-results states.
- Save a search privately; mark changes since its last viewed cutoff.
- Select two to four deals for a comparison table.
- Export the current filtered view to CSV with currency, units, value basis, source links, and cutoff dates intact.

The amount column must distinguish **enterprise value**, **equity value**, **stake consideration**, and **value reported without a clear basis**. Never display a single ambiguous “deal size” figure as though all entries were comparable.

### Deal detail and autopsy

Use tabs or well-organized sections:

1. **Snapshot:** parties, exact assets/entity, announced/effective dates, structure, acquired stake, value basis, consideration, financing, status, countries, and evidence.
2. **Why this deal:** management's stated rationale; your analytical interpretation in a separate labelled block; plausible alternative explanations; key risks; what would falsify the thesis.
3. **Price and structure:** announced and revised terms, enterprise-to-equity bridge where supported, premium with its reference date, transaction multiples with eligible denominators, payment mix, earn-outs, and debt treatment.
4. **Timeline:** announcement, revisions, regulatory decisions, shareholder approvals, completion/termination, and subsequent events. Each has its own source and event date.
5. **Sector context:** relevant industry economics, consolidation patterns, company positioning, and comparable transactions.
6. **Advisers:** buyer/seller financial advisers and legal advisers, separately labelled; role and source required. “Not disclosed” is acceptable. Never guess the bank.
7. **After the deal:** observed integration outcomes and subsequent disclosures, where known; separate facts from interpretation.
8. **Your view:** a private note with “My thesis,” “Main risk,” “What I need to verify,” and “Interview talking point.”

Primary actions: Save, Follow status, Compare, Open in Lab, Add to Deal Memory, and Draft Deal Note.

Add **As announced / What we know now** mode for historical autopsies. In the first mode, do not leak later outcomes into the original decision case. If historical evidence is insufficient, say so and limit the case to verified information.

Before revealing an analytical interpretation, optional prompts can ask:

- What is the buyer actually buying: earnings, distribution, technology, customers, a licence, or control?
- Which two assumptions most affect the price?
- What evidence would make you reject the stated synergy case?
- Is the financing structure consistent with the buyer's constraints?

Do not grade an open-ended opinion as objectively correct. A structured rubric can assess evidence, logic, valuation, and risk coverage.

### Comparisons and charts

- Compare transaction structures, value bases, ownership percentages, period definitions, and eligible valuation measures side by side.
- Exclude incompatible or missing records from numerical medians, explain exclusions, and show sample size.
- Aggregate value charts require a consistent value basis and dated currency conversion. Never sum equity values, enterprise values, minority consideration, and rumours into one total.
- Label charts “Within this database” or “Covered transactions.” Do not imply comprehensive market share or market-wide deal activity from a curated sample.
- Stock reaction is optional and appears only with a verified, licensed price source, corporate-action treatment, benchmark, timezone, and specified event window. Otherwise say “Price reaction unavailable”; never draw a plausible-looking chart.

## 7. Sector Intelligence Engine

Cover eight sectors: **FIG; TMT; Healthcare; Consumer; Industrials; Energy & Infrastructure; Business Services; Real Estate**. Use subsectors so unlike business models are not collapsed into misleading comparisons.

Each sector must contain:

- A concise explanation of how the sector makes money and where value accrues.
- A useful value-chain/market-structure view. Use clear diagrams or grouped tables, not a decorative force-directed graph.
- Major covered players, grouped by business model and geography, with source dates.
- A glossary and metric dictionary with formulas, denominators, interpretation, and limitations.
- Typical valuation approaches and the situations in which they become misleading.
- M&A motives, integration issues, diligence questions, and recurring deal structures.
- Relevant recent deals, IPO/capital-raising context where available, and regulatory developments.
- A dated “What changed” feed with evidence and a clear distinction between a proposal, consultation, rule, approval, and effective requirement.
- A five-question sector practice set with answer explanations.
- A “Build a sector view” notebook template: thesis, drivers, valuation, consolidation, risks, and open questions.

Each page must be meaningfully researched and authored, not the same six generic sentences with the sector name substituted.

### Sector-specific content requirements

| Sector | Required segmentation and operating questions | Metrics and valuation coverage | M&A and diligence themes |
|---|---|---|---|
| FIG | Banks, NBFCs/lenders, life insurance, general insurance, asset managers, exchanges/brokers, payments; how funding, distribution, risk and regulation differ | For banks/lenders: NIM, loan/deposit growth, GNPA/NNPA definitions, credit costs, ROA/ROE, capital ratios, P/B and P/E. Life insurance: APE, VNB, VNB margin, embedded value and P/EV where disclosed. General insurance: claims and combined ratio. Asset managers: AUM, net flows, fee yield and earnings. Payments: transaction volume, take rate and contribution economics | Deposits and funding access; branch/customer overlap; cross-sell; credit quality; capital and ownership constraints; regulatory approvals; distribution; integration of technology and risk systems |
| TMT | IT services, SaaS/software, internet/platforms, telecom, media, semiconductors; distinguish recurring revenue from projects, advertising and hardware cycles | ARR/MRR definitions, net revenue retention, churn, gross margin, customer concentration, bookings/backlog, EV/revenue, EV/EBITDA and FCF where meaningful. Telecom: ARPU, subscribers, churn, capex and leverage. Do not compare software ARR with telecom revenue as interchangeable | Product versus distribution acquisitions; IP and talent; customer overlap; platform dependence; acquisition of recurring revenue; antitrust; integration and culture; stock compensation |
| Healthcare | Hospitals, pharmaceuticals, diagnostics, devices, contract research/manufacturing; distinguish regulated products from service delivery | Hospitals: occupied beds, occupancy, ARPOB, ALOS, mature versus new capacity. Diagnostics: volume and realization. Pharma: product/geography mix, R&D, pipeline and patent exposure. EV/EBITDA and other methods by subsector | Geographic expansion, doctor retention, payer mix, compliance, product approvals, clinical/pipeline risk, quality systems, licensing, intellectual property, integration of acquired facilities |
| Consumer | Staples, discretionary, retail, brands, QSR, consumer platforms; distinguish sell-in from sell-through and GMV from revenue | Volume versus price/mix, gross margin, distribution reach, same-store sales, store economics, inventory turns, cash conversion, brand contribution. EBITDA/revenue multiples only with business-model context | Brand/IP acquisition, distribution access, premiumization, channel conflict, working capital, customer retention, store overlap, procurement synergies and integration of founders |
| Industrials | Capital goods, manufacturing, auto components, specialty chemicals and logistics assets where appropriate; identify project versus recurring demand | Order book/backlog definitions, book-to-bill, utilization, operating leverage, EBITDA margin, ROCE, working-capital days, capex and cash conversion; normalize cyclical earnings | Capacity, technology, localization, customer concentration, commodity pass-through, environmental liabilities, maintenance capex, labor, customer certification and plant integration |
| Energy & Infrastructure | Renewables, power utilities, oil/gas, transport infrastructure and contracted assets; distinguish operating companies from project/SPV ownership | Capacity and utilization, contracted versus merchant exposure, PLF/CUF as appropriate, tariff/offtake, project cash flow, debt service and concession life; project DCF, equity returns and relevant asset measures | Offtake quality, permitting, concessions, construction/operating risks, refinancing, counterparty concentration, decommissioning and change-of-control provisions |
| Business Services | BPO, professional services, testing/inspection/certification, staffing and recurring outsourced services | Organic growth, utilization, billing rates, employee attrition, revenue per employee, renewal, client concentration, margins, working capital and recurring cash flow | Buy-and-build strategies, talent retention, cross-selling, client conflicts, billing quality, founder dependence and integration of acquired teams |
| Real Estate | Developers, rental assets, REITs and property platforms; do not use one valuation template for all | Pre-sales versus recognized revenue, collections, net debt, leased occupancy, rental growth, NOI, cap rates, NAV and jurisdiction-specific REIT cash-flow measures | Land/title and approvals, project liabilities, rent-roll quality, lease expiries, tenant concentration, asset versus share acquisition, leverage and tax/structure differences |

For each metric, preserve the issuer's definition where practices differ. Do not create current market multiples, growth forecasts, regulatory thresholds, or sector rankings from memory. Source and date them, or keep the field unavailable.

### FIG must have a distinct analytical workflow

The banking view must not default to industrial-company EV/EBITDA or subtract deposits as if they were ordinary financing debt. Explain that bank funding and capital constraints make equity-focused valuation more useful in many cases. Include P/B versus ROE comparisons, a book-value bridge where supported, and a simplified residual-income model in the Lab. Not every financial company is a bank: apply the correct model to an asset manager, exchange, insurer, lender, or payment processor.

The primer should help the user answer: Where does this institution earn money? What risk creates that return? What limits its growth? Which balance-sheet and regulatory-capital measures matter? How would an acquisition affect distribution, risk concentration and capital?

Include India-specific source pointers to RBI, SEBI, IRDAI and CCI where relevant, with current rules verified at build time. Distinguish accounting measures from regulatory measures. Never imply that a high P/B or ROE alone proves a good investment.

## 8. Company dossiers

Build a company directory and detail pages linked from deals, briefs and sector views. Avoid a giant equity-screening product unrelated to the core workflow.

Required sections:

- Legal name, display name, aliases, ticker/exchange where relevant, country, sector/subsector, official website and investor-relations links.
- A clear business-model explanation: customers, product/service, revenue model, cost drivers, competitive positioning and principal risks.
- Dated financial/KPI observations, with fiscal period, units, currency, consolidation scope, and source.
- A compact three-year historical view when verified data is available; never fill absent years by interpolation.
- Ownership/major shareholders and executives only where current, sourced, relevant and dated. Do not make these mandatory if reliable evidence is missing.
- Acquisition/divestment history from the deal database, relevant competitors and a reason for each peer relationship.
- Follow action, compare up to four companies, and private research notes.

Normalize identities carefully. A parent, listed subsidiary, business unit, former entity and acquired target are not interchangeable. Preserve aliases without merging distinct legal entities. An acquired company remains available as a historical entity with its applicable dates.

Allow an owner to add or correct a company through validated structured fields. A correction should preserve evidence/history rather than overwrite a sourced historical observation silently.

## 9. Valuation and Transaction Lab

All calculations must be deterministic TypeScript/JavaScript functions with explicit unit conventions and tests. An LLM may explain a result but must not be the calculator. Inputs, formula, assumptions, result and limitations should all be visible.

Every exercise must distinguish:

- **Reported:** sourced actual figures.
- **Calculated:** outputs derived from specified inputs.
- **Assumed:** user-entered scenario assumptions.
- **Training example:** fictional, deliberately constructed data.

Reported values must not silently change when the user moves a scenario slider. Save a separate model snapshot with the source version, assumptions and calculation version. Provide reset, duplicate scenario, compare scenarios, CSV export and a print layout.

### 9.1 Enterprise/equity bridge and comparables

For an ordinary non-financial company, support this simplified starting bridge, with explicit adjustments:

`Enterprise value = equity value + interest-bearing debt + preferred equity + non-controlling interests − excess cash − separately valued non-operating investments`

Avoid double-counting leases, cash or investments. State the actual treatment and whether book or market values are being used. An incomplete bridge is incomplete; absent debt is not zero debt. Reconcile bridge outputs to any disclosed transaction EV instead of replacing it automatically.

- `EV / Revenue = EV ÷ comparable-period revenue`.
- `EV / EBITDA = EV ÷ comparable-period EBITDA`.
- `P/E = common equity value ÷ earnings attributable to common shareholders`, with diluted share consistency where using per-share values.
- `P/B = common equity value ÷ common book equity`.
- `Offer premium = offer price per share ÷ unaffected reference price per share − 1`.

Offer-premium references must state date and convention, such as prior unaffected close or a particular VWAP. Do not use a post-announcement price as the unaffected baseline.

For minority transactions, show consideration and ownership percentage. Only calculate an implied 100% equity value if the structure supports proportional extrapolation, and mark it as implied. Do not assume control premiums, differential share rights, earn-outs or capital injections scale linearly. Distinguish pre-money and post-money values where relevant.

Comparables need explicit eligibility filters: subsector, geography, size, profitability, reporting period, business model, growth and accounting treatment. Show mean, median, quartiles, sample size, source cutoff and exclusions. Use “NM” for economically non-meaningful negative/zero-denominator multiples. Distinguish NM, not disclosed, not available and not applicable.

### 9.2 DCF for non-financial businesses

Provide a five-year editable forecast with revenue growth, EBIT margin, tax, depreciation, capex, and changes in operating working capital. Offer an advanced direct-FCFF input mode.

`FCFF = EBIT × (1 − tax rate) + depreciation & amortization − capital expenditure − increase in operating working capital`

`WACC = E/(D+E) × cost of equity + D/(D+E) × pre-tax cost of debt × (1 − tax rate)`

Use market-value weights where available, label simplifications, and state whether a tax shield is assumed usable. Annual end-of-year discounting is the default:

`PV of forecast FCFF = Σ FCFF[t] / (1 + WACC)^t`

`Terminal value at year N = FCFF[N] × (1 + g) / (WACC − g)`

`Enterprise value = PV of forecast FCFF + terminal value / (1 + WACC)^N`

Then apply the explicit enterprise-to-equity bridge and share count. Warn/block when `WACC <= g`; reject NaN/infinite values, invalid share counts and inconsistent currencies. Explain the chosen nominal/real and currency assumptions. Do not automatically claim a plausible-looking growth rate is economically sustainable.

Required visuals: forecast table, FCFF chart, EV-to-equity waterfall, percentage of valuation from terminal value, and a WACC × terminal-growth sensitivity grid. Invalid cells remain invalid, not zero. Provide a sourced or fictional training case rather than automatically populating a real company's future forecasts.

### 9.3 Simplified accretion/dilution

Inputs: buyer net income, diluted shares and share price; target net income; equity purchase consideration; funding from buyer cash, new borrowing and new shares; financing rate; foregone cash yield; incremental pretax synergies; incremental recurring costs; incremental D&A/PPA charge; tax rate; and optional one-time costs.

The funding split must reconcile to equity consideration. Fees and debt refinancing need separate, visible treatment; do not conflate purchase equity value with enterprise value. The basic model assumes 100% acquisition and a full-year contribution. Label those assumptions and block unsupported partial-acquisition math rather than pretending it works.

`New shares = equity consideration funded with stock ÷ buyer issue price`

`Adjusted combined NI = buyer NI + target NI + (pretax synergies − incremental recurring costs − new interest expense − foregone interest income − incremental D&A/PPA) × (1 − tax rate)`

`Pro forma EPS = adjusted combined NI ÷ (buyer diluted shares + new shares)`

`Accretion/dilution = pro forma EPS ÷ standalone buyer EPS − 1`

This simplified formula treats buyer and target NI as after-tax amounts. Do not tax them again. Explain the assumed deductibility and common tax rate for incremental adjustments; allow overrides or disable the shortcut when they do not hold. Show one-time costs separately from run-rate EPS. If standalone EPS is zero or negative, explain why percentage accretion may not be meaningful.

Show funding mix, EPS bridge, key sensitivities and a “What changed?” explanation. State that EPS accretion alone does not establish value creation. Do not label this a complete merger model or claim it captures purchase accounting in full.

### 9.4 FIG lab

- Bank peer table with P/B, P/E, ROE, asset quality and capital measures only where defined and sourced.
- Residual-income training model: `equity value = opening common book equity + PV of future residual income`; `residual income[t] = NI[t] − cost of equity × opening book equity[t]`.
- Roll book equity consistently: opening book + earnings − common distributions + specified capital changes. Explain the clean-surplus simplification and keep accounting adjustments visible.
- Forecast three to five years; use a clear finite-horizon/no-further-excess-return terminal assumption initially, rather than inventing a terminal formula.
- Explain why growth consumes capital and why a high accounting ROE can reflect risk or leverage.
- Offer definitions/tooltips for insurance and asset-management metrics, but do not pretend this bank model values every FIG business.

### Mandatory calculation fixtures

All monetary values below use a common arbitrary “millions” unit and describe fictional training inputs.

| Test | Inputs | Expected result |
|---|---|---|
| EV bridge | Equity 1,000; debt 300; preferred 50; NCI 100; excess cash 150; non-operating investments 50 | EV 1,250 |
| EV/EBITDA | EV 1,250; eligible EBITDA 100 | 12.5× |
| Negative EBITDA | EV 1,250; EBITDA −10 | NM, excluded from aggregate multiple statistics |
| DCF | Years 1–5 FCFF = 100 each; WACC 10%; terminal growth 2%; year-end discounting | Forecast PV 379.078677; terminal value at year 5 = 1,275; terminal PV 791.674687; EV 1,170.753364 |
| Invalid DCF | WACC 2%; terminal growth 2% | Validation error; no numeric valuation |
| Accretion | Buyer NI 20, shares 10, price 20; target NI 5; equity purchase 70 funded by debt 30 and stock 40; debt cost 10%; synergy 2; tax 30%; other adjustments zero | New shares 2; combined NI 24.3; PF EPS 2.025; accretion 1.25% |
| FIG residual income | Opening book 100; NI 15; cost of equity 10%; one-year horizon; zero residual income beyond year 1 | RI 5; equity value 104.545455 |
| Currency conversion | USD 1 million; explicitly assumed INR 83 per USD | INR 83 million = INR 8.3 crore; labelled assumed FX, not current FX |
| Units | INR 1 crore; INR 100 crore | INR 10 million; INR 1 billion respectively |
| Percentage versus bps | Margin changes from 10% to 12% | +2 percentage points = +200 bps, not +2 bps |

Use tolerance appropriate to displayed precision. Keep internal computation precision separate from display rounding. Include tests for missing values, division by zero, stock/cash/debt mix totals, source-currency mismatches and minor-stake extrapolation restrictions.

## 10. Briefs and the ongoing intelligence feed

### Daily brief

Aim for a five- to ten-minute read, approximately 450–700 words when there is enough relevant evidence. A quiet day can be shorter. Do not pad it with generic macro filler.

Structure:

1. Three to five relevant developments, ranked by explicit relevance rules.
2. One transaction or company worth understanding more deeply.
3. One sector implication, with the causal chain stated and labelled as analysis.
4. One question to investigate, linked to a note or learning exercise.

Every item includes what changed, event date, publication date, why it may matter, cited evidence, and uncertainty. If an old announcement is newly indexed, label it as newly discovered, not newly announced. Merge repeated coverage of the same event into one item with multiple sources.

Implement deterministic ranking based on followed sectors/companies, recency, primary-source quality and event type. Show a concise “Why this appears” explanation. Do not invent an opaque AI relevance percentage.

Separate **fact**, **analysis**, and **question** in the writing. Regulation entries distinguish proposed versus effective changes. A filing search result is a lead until the underlying evidence is read and checked.

### Weekly review

Generate a seven-day view of developments in the covered universe, meaningful deal-status changes, saved insights, and open research questions. Personal reflections remain private. Include a short “What changed my view?” prompt. No inflated skill score or guaranteed career outcome.

### Generation behavior

- Without an AI API: assemble a usable brief from validated structured items and concise researched summaries. Label it as a compiled brief.
- With an enabled AI provider: synthesize only from the retrieved evidence pack, enforce citation IDs, validate structured output, and retain the input/source versions.
- A model's pretrained knowledge is not a live financial data feed.
- Historical briefs are immutable snapshots unless corrected; corrections should be versioned and explained.
- A failed generation must preserve the last good brief, with its original timestamp and a visible error state.
- Archive by date, filter by sector/geography, save items to a notebook, and export a clean Markdown or print view with source links.

In-app watch alerts are sufficient. Do not implement emails, WhatsApp messages, Slack messages, brokerage actions, or push notifications without a separate request.

## 11. Notebook, Deal Memory, learning and interviews

### Research notebook

Support create, edit, autosave, tag, search, archive, delete with confirmation, and JSON/Markdown export. Notes link to entities and evidence. Offer plain Markdown or a simple rich-text editor with safe sanitization; avoid an elaborate document editor.

Templates:

**One-page deal note:** transaction facts; strategic rationale; price and structure; sector context; synergies and risks; my view; unanswered questions; sources; research cutoff.

**Sector thesis:** business models; value drivers; key players; valuation logic; consolidation thesis; catalysts; disconfirming evidence; watchlist; sources and dates.

**Company research note:** how it makes money; operating KPIs; financial quality; competitive position; valuation approach; recent corporate actions; risks; questions for management.

**Weekly reflection:** three things learned; one assumption revised; one deal I can explain; one topic to revisit; next research question.

Provide an A4 print stylesheet, with readable black-on-white output, selectable text, sensible page breaks, visible source URLs and no navigation chrome. Browser Print to PDF is acceptable; do not add a heavyweight server PDF dependency merely for this.

### Deal Memory

Saving a deal should create or update one memory record for that deal, not duplicate it. Allow cards for: who bought what; consideration/structure; rationale; one valuation insight; one risk; and a 60-second explanation.

Require active recall before revealing the answer. Give self-assessment buttons Again, Hard, Good, Easy. State that this is self-assessed recall, not an externally verified measure of expertise.

Use a documented, simple spaced-review algorithm. An acceptable first version is an interval ladder of 1, 3, 7, 14, 30, 60 days: Good advances one stage, Easy two stages, Hard stays at the stage with a shorter repeat, Again resets to a one-day review. Specify exact scheduling and boundary behavior, store the review history, and test it. Dates follow the user's local calendar, not a drifting client clock. The algorithm can be improved later without losing history.

Cards must cite their source or refer to the user's own note. When a linked deal fact changes, retain the original card snapshot and offer an update; do not silently rewrite past answers.

### Learning library

Provide these twelve authored modules, each with a concise explanation, one worked example, common mistakes, at least three practice questions, answer explanations, and source pointers:

1. The three financial statements and how they connect.
2. Enterprise value, equity value, cash, debt and non-controlling interests.
3. Working capital, cash conversion and cash versus earnings.
4. Comparable companies versus precedent transactions.
5. DCF intuition, discount rates and terminal value.
6. The M&A process, buyer types and transaction stages.
7. Consideration, financing, ownership and control.
8. Synergies, integration risks and value creation.
9. Accretion/dilution and why EPS is not the whole story.
10. FIG basics and why bank valuation differs.
11. Reading announcements, filings and regulatory decisions critically.
12. Writing a defensible one-page deal or sector view.

Do not gate core research behind completing lessons. The user can jump into a case and open definitions contextually. Progress shows actual module completion and answered questions, not a pseudo-scientific “finance mastery 63.7%.”

### Interview preparation

Build from saved deals and sector notes:

- “Walk me through a deal you followed.”
- “Why this buyer and this target?”
- “How was it valued and financed?”
- “What is the strongest argument against the transaction?”
- “What is happening in a sector you follow?”
- “Which metric would you use here, and which would mislead you?”

Offer a timer, typed response, answer outline and a rubric covering factual accuracy, structure, evidence, valuation understanding and risk. A no-AI mode must still provide the outline and self-review rubric. Optional AI feedback must cite the underlying deal facts, state uncertainty, and assess the answer rather than inventing a hiring probability.

Do not add voice recording or send user responses to an external model without the user choosing that action. A typed interface is sufficient.

## 12. Content to ship with the application

Do not deliver an empty database that requires Manish to spend a week entering research before it is useful. Also do not manufacture facts to meet a row count.

### Initial content targets

| Deliverable | Target | Quality requirement |
|---|---|---|
| Real transaction records | 36: approximately 18 India-related, 8 APAC outside India, 10 other global | Distinct transactions; verified identity, structure, status, dates, and at least one primary source; any material amount needs claim-level evidence |
| Recent coverage | At least 8 of those records have a verified announcement or material status change in the 12 months before the actual build date | Use event date, not the date an old article was crawled |
| Deep deal autopsies | 10, including at least 5 India-related and 2 FIG cases | Structured rationale, valuation/structure discussion, risks, evidence, analytical questions and hindsight controls |
| Company dossiers | 48, with at least 24 India-based and useful representation across all eight sectors | Business-model detail and dated source pointers; financial fields may be missing when unavailable |
| Sector playbooks | All eight | Roughly 600–1,000 useful words per sector plus metric dictionary, companies, deals and five practice questions |
| Learning modules | All twelve | Worked examples, questions and explanations as specified |
| Glossary | At least 80 distinct terms | Short definition, context, common confusion, and a linked example where useful |
| Practice questions | At least 80 across modules, sectors, deals and technical drills | Correct answer/explanation for objective questions; rubric for open-ended questions; no duplicates disguised by changing names |
| Training models | At least 3 | A fictional non-financial acquisition, a DCF, and a FIG equity model; visibly fictional and excluded from real research statistics |
| Brief examples | 1 historical daily brief and 1 historical weekly brief | Actual cutoff dates; source-grounded; explicitly separate from newly generated current briefs |

Aim to meet all targets. If verified content falls short, report the exact shortfall and continue research where access allows. Do not replace missing real records with unlabeled fake records. Counts are a content-completeness test, not permission to invent facts.

### Research candidate list

The following are suggested research subjects, not pre-approved records. Verify the exact parties, chronology, structure, amounts and latest status yourself. Names may refer to historical businesses or former names.

- HDFC and HDFC Bank.
- Axis Bank and Citi's India consumer business.
- LTI and Mindtree.
- Reliance/Disney's India media combination.
- Adani's acquisition involving Ambuja Cements and ACC.
- Zomato and Blinkit, retaining historical and current-name distinctions.
- Walmart and Flipkart.
- Temasek and Manipal Hospitals.
- Microsoft's acquisition of Activision Blizzard.
- Broadcom and VMware.
- Salesforce and Slack.
- Disney and 21st Century Fox.
- Pfizer and Seagen.
- ExxonMobil and Pioneer Natural Resources.
- UBS and Credit Suisse.
- DBS and Citi's Taiwan consumer business.
- Grab and Uber's Southeast Asian business.
- Renesas and Altium.

Add recent, smaller and sector-diverse transactions so the database is not solely famous megadeals. Include minority investments, a carve-out, an asset deal, a sponsor transaction and a failed/withdrawn transaction if reliable sources support them. These categories teach different analytical issues.

### Research process and provenance

For each record, keep a machine-readable research ledger with claim, value, source URL, publisher, document title, publication date, retrieval timestamp, relevant passage/page/section and verification status. Store only permitted excerpts; full copyrighted articles are not required.

Primary sources take precedence: exchange filings, company announcements, annual reports, regulator decisions and merger documents. Credible reporting may provide context or help discover a primary document. Avoid aggregators and search snippets as the only evidence for a material deal term.

Use “Source checked” for a claim actually matched to retrieved evidence. Use “Human reviewed” only when a human actually reviewed it. Do not generate fake reviewer names, approval dates or expert endorsements.

Historical seed records are a **researched archive as of a stated cutoff**. Runtime feeds are a separate source of updates. Fictional training fixtures live in a separate namespace and must never appear in real deal counts, sector statistics or “recent news.”

## 13. Live data, sources and refresh behavior

### Be precise about data availability

This application is not a licensed replacement for Bloomberg, Capital IQ, PitchBook or a comprehensive M&A database. Build useful coverage from permitted sources and disclose its boundaries. Do not imply that public sources guarantee complete deal values, adviser lists, private-company EBITDA, current valuation multiples or every global transaction.

A source being publicly viewable does not automatically mean unrestricted automated access or redistribution is allowed. Source connectors must respect the current access terms, rate limits and any applicable reuse restrictions. Do not bypass paywalls, sign-in gates, CAPTCHA or access blocks. Use a link/manual-entry workflow when automated retrieval is unavailable.

### Source hierarchy and connector registry

| Source category | Examples to investigate | Purpose | Required caveat |
|---|---|---|---|
| Company/investor relations | Acquirer and target press releases, results, annual reports, official RSS where offered | Deal terms, stated rationale, results and company facts | Verify each actual feed/page and its reuse/access conditions |
| Indian competition and financial regulators | CCI combinations/press releases, SEBI, RBI, IRDAI | Approval history, consultations, rules and sector context | An approval does not prove completion; automated access may be blocked |
| Indian exchanges | NSE and BSE official corporate disclosures | Announcements and issuer evidence | Do not rely on undocumented anti-bot endpoints or assume redistribution rights |
| US filings | SEC EDGAR submissions and company facts | Public filings and financial observations | Server-side retrieval, declared user agent, current fair-access compliance; not a normalized global deal feed |
| APAC disclosures | HKEX, SGX, ASX and relevant national regulators | Local exchange/regulatory evidence | Verify each permitted access method rather than inventing a universal API |
| Other jurisdictions | Company filings, competition authorities and securities regulators | Cross-border approvals and terms | Preserve jurisdiction and stage; proposals and approvals differ |
| Established financial reporting | Permitted RSS or licensed feeds from reputable publishers | Discovery and contextual reporting | Link to originals; do not scrape paywalls or republish full stories |
| Academic/reference material | Damodaran/NYU and authoritative accounting/finance references | Methodology and learning content | Educational reference material is not a current transaction dataset |
| Optional commercial providers | A licensed company-data, market-price, FX or news API selected by the owner | Fill explicit data gaps | Connector and display rights depend on the owner's actual plan |

The source registry must store the actual verified URL or endpoint, supported capabilities, geographic coverage, access method, licensing/reuse notes, configured refresh interval, last attempt, last success, current error and expected freshness.

Implement at least two genuinely working permitted public-source connectors during development, ideally one India-relevant and one international, and verify them against actual responses when network access is available. Generic RSS/Atom support should be reusable, but a parser alone is not evidence that any particular source works. Also implement manual structured import and a validated source-link/excerpt workflow.

Do not fabricate API endpoints. Mark a source as “Manual source” or “Unavailable from this environment” when appropriate. Ship recorded, permitted/minimal fixtures for repeatable parser tests, while clearly distinguishing fixture tests from successful live-source tests.

The SEC's public data APIs do not require an API key and do not support browser CORS. Retrieve them through the Worker, identify the application with an appropriate configured user agent, and obey current fair-access requirements. Use caching and a conservative request rate; do not design around the published maximum as a target. Verify current requirements against the official documentation before implementation.

### Separate source collection from verified deal records

1. Fetch permitted source documents or metadata.
2. Normalize timestamps and URLs, identify the publisher and retain provenance.
3. Deduplicate source items by stable provider ID, canonical URL and content fingerprint.
4. Link likely entities and transactions, with an uncertainty state for ambiguous matches.
5. Extract structured candidate claims.
6. Validate types, units, currencies, dates and source references.
7. Route uncertain, conflicting or AI-extracted material terms into an owner review queue.
8. Publish validated updates under clear verification rules and append status history.

Source feeds may refresh automatically without every discovered headline becoming a verified transaction. A news item can appear as a source-linked lead; uncertain monetary terms must not enter the canonical database automatically.

Never overwrite a previously sourced value solely because a newer article says something different. Record revised terms, corrections or conflicts, retain both sources and indicate the active interpretation. A repeat announcement about the same deal must not create a duplicate transaction.

### Refresh policy

- Default public-source collection target: every six hours, subject to source-specific permissions and rate limits.
- Daily brief target: 07:30 Asia/Kolkata, based on available validated material. This is a requested product schedule, not a claim that a production scheduler is already attached.
- While the signed-in owner has the app open, poll the app's cached status approximately every five minutes while visible; stop needless polling in background tabs.
- User Refresh requests one bounded, deduplicated server refresh; it does not directly trigger unrestricted parallel upstream requests from every browser.
- Use locks/leases to avoid concurrent refresh storms, exponential backoff, bounded retries, per-source timeouts, ETags/Last-Modified where supported, and last-good snapshots.
- No fake timestamp updates: `lastAttemptAt`, `lastSuccessAt`, `publishedAt`, `eventDate`, `dataAsOf` and `generatedAt` have different meanings.
- Source-specific stale thresholds should be configurable. A stale record remains readable with its cutoff; a newly fetched old document is not fresh financial data.

Provide a protected, idempotent maintenance endpoint and a small runner that an actual scheduler can call. Hosting-managed schedules and ordinary Cloudflare Cron Triggers are different capabilities: do not assume putting a cron expression in a Wrangler file attaches a schedule to this existing Sites project. Supply the endpoint contract, authentication requirements, desired schedule and verification instructions so the deployment agent can connect a supported scheduler.

Until a scheduler is connected and an invocation is observed, show “Background schedule not configured.” Authenticated on-demand refresh and owner-session refresh should still work. Documentation must distinguish background refresh while closed from browser polling while open.

If an upstream source blocks the production runtime, fail visibly and keep cached data. A generic proxy intended to evade the block is not an acceptable fallback.

### Source status UI

Show a small summary in the Desk and a fuller table in Sources:

- Working and current.
- Cached, with last successful update.
- Stale.
- Manual source.
- Not configured.
- Rate limited.
- Access unavailable.
- Failed, with a concise actionable explanation.

Never display API keys, access tokens, internal stack traces or private user information in public diagnostics. Detailed provider errors belong in owner-only diagnostics with secret redaction.

## 14. Data model and financial semantics

Use explicit schemas shared between frontend, API validation and imports. Separate public/reference research from private user material.

### Core entities

| Entity | Important fields and relationships |
|---|---|
| Source | ID, publisher, canonical domain, URL/endpoint, access method, rights notes, capabilities, refresh policy, status |
| Source document | ID, source ID, canonical URL, title, published timestamp/date, retrieved timestamp, content hash, allowed excerpt/locator, version |
| Evidence/claim | Entity/field reference, value, source document ID, passage/page locator, reported/calculated/assumed status, checked timestamp, conflicts/supersedes |
| Company | Stable ID, legal/display names, aliases, country, identifiers, sector/subsector, lifecycle status, official links |
| Financial observation | Company ID, metric ID, numeric/text value, units/currency, fiscal period and end date, flow/stock type, consolidated/standalone scope, reported/adjusted basis, evidence |
| Sector | Stable slug, taxonomy, playbook content, KPI dictionary, valuation guidance, source references |
| Deal | Stable ID, title, type, announcement date, current status plus as-of date, transaction perimeter, stake, acquirer/target references, relevant geographies |
| Deal term | Deal ID, metric/type, amount/currency/unit, value basis, ownership scope, announcement/revision/effective date, evidence, status |
| Deal party/adviser | Deal ID, company/person/entity ID or sourced name, role, side, evidence |
| Deal event | Deal ID, event type/date, publication date, description, sources, superseded/corrected state |
| Feed item | Source document, entities, topic, event date, discovery date, dedupe key, verification status |
| Brief | Scope, period, cutoff, generation method, content version, evidence IDs, correction history |
| Private note | User ID, ID, title/body, template, tags, entity links, revision, timestamps, archive state |
| Private watch/search | User ID, canonical filter/entity, created/last-viewed dates, update watermark |
| Private model | User ID, model type/version, source snapshot, assumptions, outputs, timestamps |
| Memory/review | User ID, linked concept/deal, prompt/answer snapshot, source version, interval stage, due date, review history |
| Preferences | User ID, timezone, theme, sectors, currency/display settings, learning settings |
| Job/usage log | Job ID, idempotency key, source/provider, status, attempt/success times, retry state, redacted error, counts and optional usage cost |

Implementation may combine compatible private entities or normalize further. Choose a practical schema, not a needlessly elaborate microservice design. Index the fields used for filtering, entity lookup, latest events, jobs and user-scoped access. Use parameterized D1 queries and transactions/batches where needed.

### Mandatory semantics

- Keep original reported currencies and units. Store normalized numeric values separately from display strings.
- Any converted figure retains original value, FX pair, rate, rate date, source and conversion method. Do not use today's FX to silently rewrite historical deal terms.
- No monetary total across currencies without a documented conversion policy. Without FX, show grouped totals by currency.
- Store dates with their precision. A day-only announcement must not become a fabricated midnight timestamp in another timezone.
- Fiscal years, calendar years, quarters, YTD and LTM are not interchangeable. Require period alignment before computing multiples.
- Do not sum four YTD observations to create LTM. Derive LTM only from compatible annual/YTD or discrete-quarter data, with the derivation shown.
- Separate GAAP/IFRS/Ind AS figures from company-adjusted measures. Retain the company's reconciliation where supplied; do not silently relabel adjusted EBITDA as reported EBITDA.
- A balance-sheet observation is a point in time; earnings and revenue cover a period.
- Keep bank deposits and ordinary corporate debt distinct in the taxonomy.
- Missing data is `null` plus a reason, not numeric zero or a dash that breaks sorting.
- Rumoured, proposed, announced, pending approvals, approved, completed, withdrawn and terminated are distinct states. Sources may support only some transitions.
- Persist revisions and record merges so links do not break. Merging duplicate transactions should retain aliases and evidence.
- Curated database counts must not be represented as the total market.
- Forecasts, analyst interpretation, management claims, reported facts and user assumptions remain separately labelled.

## 15. Optional AI assistance

The core application must be useful with **AI disabled and no paid API key**. Implement one real optional provider integration, preferably Anthropic to suit the build workflow, behind a provider interface. Do not spend scope implementing five untested provider SDKs.

Allowed uses:

- Summarize an evidence pack with claim-level citations.
- Explain a financial term in the context of a selected deal.
- Draft a research note from supplied facts and the user's selected notes.
- Suggest analytical questions.
- Give feedback on an interview answer.
- Propose structured extraction into a review queue.

AI must not generate missing deal prices, EBITDA, adviser names, regulatory thresholds, current market data or source URLs from memory. Any returned citation must resolve to an input evidence ID. Reject invented source IDs and unsupported numerical claims. Store the generation method, provider/model ID, timestamp and evidence versions.

Treat external documents as untrusted input. Instructions embedded in an article or filing must never override application instructions, reveal keys, change settings or cause additional privileged actions. No tool execution based on retrieved article text.

Provider keys live only in server-side secrets. A key must never appear in the browser bundle, browser storage, URL, export, error trace or test fixture. Configuring a model name is not proof of a working API connection.

AI endpoints require authenticated owner authorization, request limits, input/output size limits, timeouts, per-user/global quotas and a configurable spending cap. Default AI is off; no paid requests occur until configured and enabled. Record actual token usage when returned and label estimated costs as estimates, based on a dated configured price table. No unlimited background generation on page load.

Private notes are sent only when the user explicitly requests an AI operation and selects the relevant material. Show what content will be used. No automatic upload of the whole notebook. When AI is unavailable, offer the deterministic template, explanation or rubric already implemented.

## 16. Backend, API and private-data behavior

### Authentication and ownership

The root site is public. Preserve its audience. Public visitors may read published reference research and use local training calculations. Personal notes, watchlists, review history, saved models, private briefs and settings must never be included in the public bundle or public cache.

Reuse the host's trusted identity and sign-in routes. This app is intended for Manish; authorize private/admin functionality against a server-configured owner identity. Never claim the first visitor as owner. Do not embed Manish's email or account ID in frontend code. If owner configuration is absent, public/reference mode works and owner-only functions fail closed with a clear setup state.

Separate permissions:

| Role/state | Allowed |
|---|---|
| Signed out | Published research, documented public filters, transient/local training calculations |
| Signed in but not the configured owner | Published research; no access to Manish's private records, administrative actions, paid AI or ingestion jobs |
| Configured owner | Private research, saves/reviews/models, permitted imports, source administration and optional AI |
| Authenticated maintenance caller | Only the bounded maintenance job contract; no access to private notebook APIs |

Each private query must include the authenticated user ID even when the app currently has only one owner. Object IDs alone are not authorization. Recheck ownership on update, delete, export and attachment/source associations. No “hide the button” authorization.

A local development identity adapter may be used only in an explicitly local preview. It must be excluded or disabled in release builds and production. The release must not trust request headers that an arbitrary client can set unless they arrive through the host's established trusted dispatch boundary.

### Suggested API contract

Implement these resources or a closely equivalent coherent REST contract, and document actual paths and request/response schemas:

| API | Methods / purpose | Access |
|---|---|---|
| `/api/finance/status` | GET readiness, public freshness, and authenticated capability flags | Public with no secret/private-data leakage |
| `/api/finance/deals` | GET search, filters, sort and pagination | Published research |
| `/api/finance/deals/:id` | GET terms, events and evidence | Published research |
| `/api/finance/companies` and `/:id` | GET directory/dossiers/observations | Published research |
| `/api/finance/sectors` and `/:slug` | GET playbooks, KPIs, covered entities | Published research |
| `/api/finance/feed` | GET source-linked developments | Published research |
| `/api/finance/briefs` and `/:id` | GET published general briefs; private personalization via a distinct authorized scope | Scope-dependent; cache safely |
| `/api/finance/evidence/:id` | GET allowed excerpt, locator, URL and provenance | Only evidence for accessible research |
| `/api/finance/search` | GET public entity/concept search; private search separately authorized | Explicit scope |
| `/api/finance/notes`, `/models`, `/watchlist`, `/saved-searches` | GET/POST and item PATCH/DELETE | Owner only |
| `/api/finance/review` | GET due queue and POST completed review | Owner only |
| `/api/finance/preferences` | GET/PATCH | Owner only |
| `/api/finance/export` | GET complete private-data export | Owner only, no-store |
| `/api/finance/import/preview` and `/commit` | POST validation preview and confirmed import | Owner only |
| `/api/finance/ai/*` | POST bounded optional AI operations | Owner only and provider enabled |
| `/api/finance/admin/sources` | Inspect/update tested source registry | Owner only |
| `/api/finance/admin/review` | Review proposed claims/conflicts and publish corrections | Owner only |
| `/api/finance/admin/refresh` | POST deduplicated refresh request | Owner only |
| `/api/finance/admin/jobs/run` | POST bounded maintenance invocation | Owner or verified maintenance credential with restricted scope |

Use server-side validation, bounded pagination, explicit sort/filter allowlists and maximum body sizes. Return stable error codes with actionable messages. Do not leak stack traces. Return appropriate 400, 401, 403, 404, 409, 413, 429 and 503 states rather than returning 200 for every outcome.

Use revision numbers or ETags for editing conflicts and idempotency keys for imports, job requests and review submissions. A network retry must not duplicate a note, review or imported deal. A multi-tab conflict should offer reconciliation rather than silently discarding the older draft.

### Persistence and backups

- D1 is the authoritative store for private saved records. localStorage is acceptable for harmless display preferences, not as the only implementation of cross-device notes.
- Maintain recoverable local drafts on save failure, labelled as device-local, and offer retry/export. Do not display a successful server save when offline.
- Isolate and clear private client caches on sign-out/account change. Do not cache private API responses publicly.
- Export notes, models, watches, preferences and review history as versioned JSON; include Markdown/CSV convenience exports where useful.
- Import is a preview-and-confirm operation showing schema errors, duplicates, conflicts and proposed changes. Preserve IDs or map them safely; do not overwrite all existing data blindly.
- Neutralize spreadsheet formula injection in CSV exports, including values starting with `=`, `+`, `-` or `@` where treated as text.
- Development seed/reset commands must target only the local finance database. Production imports must be idempotent and must not reset other applications' tables.

### Security requirements tied to actual features

- Use parameterized SQL, strict schemas and output escaping/sanitization for Markdown and external excerpts.
- Enforce same-origin protections for state-changing browser requests, along with authentication and appropriate CSRF protection for the host's session model.
- Validate local `return_to` destinations; reject open redirects.
- Server-side fetches must use an owner-managed allowlist of verified public source hosts. Reject IP literals, loopback/private targets, unsafe schemes, credential-bearing URLs, excessive redirects and redirects outside the permitted host set. Account for encoded and IPv6 representations. Do not introduce an unrestricted URL-proxy endpoint.
- For arbitrary external links, store the link without server fetching; require explicit source registration or pasted evidence for import.
- Disable XML external-entity resolution and bound XML/document parsing, decompression, response size and execution time.
- Sanitize imported records and source content. Treat content as data, never executable HTML or application instructions.
- Apply sensible security headers to finance responses without imposing a site-wide policy that breaks existing Atlas/Study functionality.
- Keep secrets and personal data out of logs, analytics, public diagnostics and build artifacts. No third-party advertising or behavioral analytics are needed.
- Do not weaken the host's authentication or use an unsafe public admin endpoint to make the demo appear complete.

## 17. Implementation and performance requirements

### Practical code organization

Use an understandable structure, for example:

```text
manish-finance/
  README.md
  SPEC.md
  CLAUDE.md
  BUILD_STATE.md
  package.json
  package-lock.json
  tsconfig.json
  src/                 finance UI, routes, components and scoped styles
  server/              Worker-compatible APIs, auth adapter, providers and jobs
  shared/              schemas, types, currency/period logic and calculations
  data/                verified research content and separate fictional fixtures
  research/            sources and claim-verification ledger
  migrations/          finance schema and migration instructions
  scripts/             build, local preview, seed, checks and packaging
  tests/               calculations, permissions, data rules and critical flows
  docs/                API, data, integration, operations and design documentation
  release/
    assets/            finance.html, finance.css, finance-*.js, optional finance-*.svg
    server/            finance.mjs: standalone bundled finance module
    migrations/        additive SQL plus schema additions/merge instructions
    integration/       adapter example and precisely documented host changes
    reports/           verification results and screenshots
    manifest.json
    SHA256SUMS
```

This tree is a suggested concrete layout, not a reason to rewrite a supplied existing project. Avoid giant single-file application code. Keep financial calculation functions independent of components and network calls. Keep provider adapters independent of business-domain schemas.

`CLAUDE.md` should be short and contain only durable commands and constraints. Put this full brief in `SPEC.md`. Maintain `BUILD_STATE.md` with completed requirements, source assumptions, known blockers, the last successful checks and the next concrete task so work can resume across context limits.

### Development commands

Supply working commands for:

- `npm ci`
- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:e2e`
- `npm run verify:content`
- `npm run build`
- `npm run package:handoff`

Use a local Worker/D1 emulator or equivalent faithful environment for backend testing, and a local host harness for route integration. A Node-only mock server is not enough to establish Worker compatibility. It can support focused tests, but execute the real bundle in the target-style runtime before claiming that it works.

The default local command should open a usable seeded research app without production secrets. Locally seeded records must retain truthful archive/training labels. A development identity can exercise private features in local mode. Include a signed-out and non-owner test mode.

### Bundles and assets

- Output flat asset paths compatible with the existing embedding build.
- Use absolute prefixed asset URLs, such as `/finance-app.<hash>.js`; do not assume a root `/assets` route.
- Include all imported chunks in the release and manifest. Prefer route-level loading for the Lab and larger research content.
- Do not distribute `node_modules`, a nested `.git`, real `.env` files, production databases, provider credentials or personal records.
- Keep source maps in the source/debug handoff, not automatically in public production assets.
- The standalone Worker module must use Workers-compatible APIs and have no runtime dependency on Node filesystem/process APIs, native add-ons, a local database file or a spawned process.
- Remember that the host embeds frontend assets into its Worker output. Measure the combined integration bundle against the actual host deployment limit; don't assess only the finance browser bundle.
- No custom font or image work is required. Use typography, layout and truthful data visuals for the design.

### Performance goals

Keep ordinary research actions responsive on a mid-range laptop and mobile phone. Avoid fetching every company, article and note before displaying the Desk. Paginate large lists, debounce search, use cached query results sensibly, and load heavy chart/editor code only when needed.

Aim for an initial finance browser JavaScript payload around or below 300 KB gzip before optional routes and research chunks, and investigate material overages. Treat this as a measured budget, not permission to hide broken functionality. Track actual bundle sizes in the report.

Use no network-dependent financial data for a deterministic calculation once the inputs are loaded. Avoid external API calls on every keystroke. Distinguish connection speed and provider latency from app rendering performance.

## 18. Environment and activation contract

Provide `.env.example` with descriptions and safe placeholders, never real secrets. Document which values are public, secret, optional, development-only, or supplied by the host. Avoid baking environment-specific values into the frontend.

Expected configuration concepts include:

| Name/concept | Purpose | Default/handling |
|---|---|---|
| `DB` | Existing D1 binding | Supplied by host; never replace it with a hardcoded database ID |
| `FINANCE_OWNER_USER_ID` | Trusted host account allowed private/admin access | Deployment configuration; fail closed if absent |
| `FINANCE_PUBLIC_ORIGIN` | Origin validation and links | Local origin in development; actual site origin at deployment |
| `FINANCE_AI_PROVIDER` | Optional AI selection | `none` by default |
| `FINANCE_AI_MODEL` | Explicit enabled provider model ID | Verify against provider documentation; do not assume the builder model is a runtime model |
| `FINANCE_AI_API_KEY` | Server-side provider credential | Secret; absent is a supported core-app state |
| `FINANCE_AI_DAILY_BUDGET` | Owner-configured paid-use cap | Zero/disabled until explicitly enabled; units documented |
| `FINANCE_JOB_SECRET` | Restricted maintenance invocation authentication where supported | Secret; never a URL query parameter or browser-visible token |
| `FINANCE_SEC_USER_AGENT` | Appropriate real application/contact identification for SEC access | Configure honestly; do not invent a contact address |
| Provider-specific optional secrets | Licensed market/news/FX data if enabled | Server-side only; document exact capability unlocked |

Use only the variables your implementation actually needs and keep names consistent across code, docs and examples. Additional variables need explanations. Do not force the user to purchase a commercial service to see the application function.

Document operational cost drivers: hosting/database usage, optional AI requests, optional licensed data, and any scheduler usage. Do not claim that the app is free forever. Do not quote provider prices without verifying and dating them. Provide a zero-paid-API operating mode and a small, explicit model-cost calculation if paid AI is configured.

## 19. Verification and acceptance gates

Create a requirement-to-evidence checklist. Check the actual outcome of commands and interactions. Do not write “tested” for a command that was never run or passed only with production-critical behavior mocked away.

### Required automated checks

1. Financial calculations match the fixtures in section 9 and handle invalid/missing inputs.
2. Currency scaling, crore/million conversion, bps, fiscal-period validation and eligible-multiple aggregation behave correctly.
3. No unauthenticated/non-owner access to private records, imports, source admin, paid AI or maintenance jobs.
4. A private-record request cannot use another user's object ID or body-supplied user ID to read/write data.
5. Private responses have appropriate no-store/cache controls and never enter a public response cache.
6. Untrusted external text is sanitized; unsupported URLs and unsafe fetch destinations are rejected.
7. Repeated imports, refresh jobs and review submissions are idempotent.
8. Conflicting edits produce a clear conflict rather than silent data loss.
9. Source timeouts, stale data, rate limits, invalid XML/JSON and partial provider failures preserve the last good state.
10. Unsupported/fictional citation IDs and ungrounded AI claims are rejected or held for review.
11. Draft and training data cannot enter published deal totals or real news views.
12. Review scheduling respects the configured timezone and documented algorithm.
13. The production finance module runs in a Worker-style environment with D1 semantics.
14. Financial API responses are JSON; asset misses are not SPA HTML; HEAD and route canonicalization work.

### Required end-to-end user journeys

- Open `/finance`, filter deals to an India-related sector, open a deal, inspect the source behind a value, save a note, reload and recover it as the owner.
- Compare two compatible deals and see incompatible metrics excluded with reasons.
- Follow a company, view a linked sector page, and save a research question.
- Load a training DCF, change WACC, inspect the sensitivity grid, save a scenario and reopen it.
- Complete a deal-memory review and see the next due date persist.
- Draft a one-page deal note and export/print it with citations.
- Export private data, preview an import, handle a duplicate and verify no unintended deletion.
- Disable paid AI and confirm that research, deterministic models, notes, review and compiled briefs remain usable.
- Simulate a source failure and show accurate freshness and last-good data.
- Verify signed-out, non-owner and configured-owner states.

### Integration regression checks

With an actual host checkout, run relevant existing route/API tests as well as finance checks. Verify the homepage, all documented Atlas routes, Study, existing redirects, sign-in return destinations and existing private connections are untouched except for an optional approved finance link.

Without that checkout, create a small integration harness with existing-route sentinels, test the dispatch and asset contract, and report this as a harness check. Do not claim to have tested live Atlas, Microsoft or Toggl connections. Clearly distinguish actual-host verification from simulated-host verification.

### Visual QA

Capture and inspect screenshots of the Desk, Deal Terminal, deal detail/evidence drawer, FIG page, one Lab model, and Notebook at desktop width. Check at least the Desk, deal view and Lab at mobile width. Inspect light and dark themes, long names, long citations, undisclosed values, wide tables, empty states, loading states and error states.

Fix clipping, unreadable text, generic default component styling, accidental whitespace and inaccessible controls. Screenshots are evidence, not substitutes for working functions.

### Content QA

Check every seed record has its mandatory evidence and correct real/training classification. Check material figures and status dates against the cited passages. Flag broken/unavailable source links without deleting provenance. Check aliases, duplicate deals, units and period consistency. Confirm the content targets or report exact gaps.

Run a clean build from the supplied lockfile and generate the release from that same source state. Test the packaged release, not only the development server.

## 20. Work sequence and continuation

Proceed through these milestones in order, with brief progress reports. Implementation choices that preserve this specification do not require repeated user confirmation.

1. **Foundation:** inspect supplied context, document architecture, set up the separate project, schemas, navigation, theme, Worker adapter, local preview and initial source registry.
2. **Research core:** implement deals, companies, sectors, evidence drawer, honest seed data and search/filtering. Complete the first coherent vertical slice.
3. **Persistence:** implement host-auth injection, owner checks, D1 migrations, notebook, watchlists, exports/imports and revision handling.
4. **Intelligence:** implement and verify source connectors, normalization/deduplication, review queue, refresh jobs, source health and briefs.
5. **Learning and analysis:** implement tested valuation tools, deal autopsies, learning modules, review scheduling and interview workflows.
6. **Optional AI:** implement the bounded provider adapter and evidence validation, while preserving no-key behavior.
7. **Polish and delivery:** finish content, inspect screenshots, run required tests, build, test the release and create the handoff package.

Do not spend the entire session planning before a working slice exists. Do not stop after that slice either. Maintain the full acceptance checklist throughout. If the session needs to resume, update `BUILD_STATE.md`, including remaining requirements, and continue from it without rewriting completed work.

Ask only when an unresolved fact materially blocks authorized work. Missing runtime secrets do not prevent building the adapter, empty/error states, fixtures and unrelated capabilities. Do not disable permission controls or bypass access restrictions to make progress.

## 21. Exact handoff package

Produce **`manish-finance-handoff.zip`**, containing the complete source project and its `release/` directory. The user should be able to send this ZIP to the deployment agent without copying files out of a chat transcript.

Required documents and reports:

| File | Must contain |
|---|---|
| `README.md` | Product overview, local start/build/test commands, actual implemented capabilities, seed cutoff and no-key behavior |
| `docs/DEPLOYMENT_HANDOFF.md` | Exact integration steps for the inspected host, file map, route dispatch, assets, database, auth, environment, scheduler activation and verification |
| `docs/API.md` | Actual routes, schemas, permissions, errors, pagination, cache policy and example requests with dummy values |
| `docs/DATA_SOURCES.md` | Tested connectors, source registry, provenance policy, coverage limits, terms/access notes and last live test dates |
| `docs/DATA_MODEL.md` | Tables, relationships, user scoping, financial units/periods, migrations and import/export formats |
| `docs/DESIGN_SYSTEM.md` | Tokens, layout, typography, components, responsive rules and interaction conventions |
| `docs/OPERATIONS.md` | Refresh behavior, job authentication, source failure handling, budgets, backups, routine updates and rollback procedure |
| `docs/KNOWN_LIMITATIONS.md` | Specific remaining limitations, unavailable sources, missing credentials, content gaps and unperformed checks |
| `release/reports/ACCEPTANCE_REPORT.md` | Requirement checklist, actual commands and results, bundle sizes, content counts and screenshot references |
| `release/manifest.json` | Release version, source commit/hash if available, build time, build/runtime assumptions, exact asset/module/migration paths, required configuration names and file checksums |
| `release/SHA256SUMS` | Checksums for deployable files; do not create self-referential checksums |
| `.env.example` | Safe documented configuration placeholders |

The release manifest must be machine-readable and must not contain credentials, personal account IDs, signed URLs or production secrets. Include a deterministic source-tree hash when a Git commit is unavailable. Avoid a fabricated commit SHA.

### Deployment-agent integration procedure to document

1. Open the current existing kmanish.live source and record its current revision.
2. Compare the current architecture with the inspected baseline and review the small integration change.
3. Copy only the prefixed finance assets into the existing `dist/`; do not replace the directory or run a build cleaner over it.
4. Add the bundled `finance.mjs` module and its documented import/factory call.
5. Add the finance API dispatch before the existing generic API handler and add only finance page-route handling.
6. Merge additive finance schema changes using the existing project's migration workflow. Do not reset the existing D1 database or rewrite applied migrations.
7. Configure owner identity and any enabled optional secrets through the host's secure configuration mechanism.
8. Perform an idempotent seed import using the supported mechanism. Protect seed/admin operations and never ship an unauthenticated production reset endpoint.
9. Build the combined application and run route, privacy, calculation and migration smoke checks against the exact release.
10. Attach a supported refresh schedule if available, verify an authenticated invocation, and leave the product's scheduling status truthful otherwise.
11. Publish through the existing site's normal deployment process, preserving its project identity, custom domain and audience.
12. Verify the deployment result, `/finance`, an evidence-backed record, a private save as the owner, and preserved existing routes; report any external activation gap.

If you have the actual repository, supply a reviewed additive patch against its specific base revision. If you do not, supply the tested adapter and precise integration instructions, explicitly labelled as such. Do not fake a patch that claims to have applied to unseen files.

For rollback, restore the prior combined application version while retaining finance data and additive tables. Do not instruct the operator to drop tables or erase private research just to roll back UI code. Document any migration that cannot be rolled back safely; prefer additive backward-compatible schema changes for the first release.

### Keep homepage changes optional and small

Provide an optional “Finance” navigation/card link to `/finance` that can be inserted into the existing homepage without redesigning it. The app is usable by its route even before that link is added. Do not alter the homepage art, animation, layout or Atlas link.

### Your final response as the builder

Return:

1. The complete handoff ZIP and source location.
2. A brief list of working features.
3. What functions with no paid keys.
4. Which live connectors were actually tested, when and with what outcome.
5. The exact remaining activation requirements, if any.
6. Actual build/test results and any failures or checks you could not run.
7. Screenshots or a local preview reference, without treating them as the deliverable itself.

Do not say “production ready,” “fully live,” “all tests passed,” “real-time,” or “human verified” unless the evidence supports that exact claim. Do not deploy, change DNS, change the existing site's sharing, or spend money to finish the build. Return the complete implementation for the site owner to integrate and publish.

## 22. Useful official references

These references informed the brief or are starting points for implementation. Recheck the current documentation and access terms when building. URLs here are documentation/source directories, not a promise that each is a working machine-readable feed.

- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Cloudflare Workers static assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare asset/Worker routing: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- Cloudflare routing and subdirectory considerations: https://developers.cloudflare.com/workers/static-assets/routing/advanced/
- SEC public EDGAR data API documentation: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC fair-access/user-agent guidance: https://www.sec.gov/about/webmaster-frequently-asked-questions
- SEC public data entry point: https://data.sec.gov/
- CCI combinations: https://www.cci.gov.in/combination
- CCI combination press releases: https://www.cci.gov.in/combination/press-release
- RBI RSS directory, subject to actual access availability: https://rbi.org.in/Scripts/rss.aspx
- SEBI official information: https://www.sebi.gov.in/
- Damodaran, *Valuing Financial Service Firms*, April 2009: https://pages.stern.nyu.edu/~adamodar/pdfiles/papers/finfirm09.pdf

The host-specific architecture in section 2 was established through direct source inspection. Public Cloudflare examples do not override the existing site's asset embedding, authentication, migration or deployment contracts.

# END IMPLEMENTATION SPECIFICATION
