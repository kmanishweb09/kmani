# Finance Desk

A personal M&A deal terminal and sector-intelligence workspace for **kmanish.live/finance**, built for an
MBA student preparing for investment banking and FIG work. It answers one loop:

> Read the brief → inspect a transaction → understand its sector → test an assumption → write an opinion → recall it later.

This directory is the complete source of the finance module plus a prebuilt `release/` for the site owner's
deployment agent. It has **not** been deployed. Integration steps: [`docs/DEPLOYMENT_HANDOFF.md`](docs/DEPLOYMENT_HANDOFF.md).

## What is in it

| Area | Route | What works |
|---|---|---|
| Desk | `/finance` | Today's brief (or the latest available, labelled with its real date), session plans (10/30/60 min), watch alerts, due reviews, source-health summary |
| Deal Terminal | `/finance/deals` | 42 transactions (20 India-related, 9 APAC, 13 other global), filters by geography rule, sector, type, buyer, status, payment, dates and value disclosure; sortable columns; saved searches; CSV export; compare |
| Deal record | `/finance/deals/:id` | Terms with value basis (EV/equity/stake), status history, timeline, advisers, rationale, sector context, “as announced” vs “what we know now” (hindsight control), 10 deep autopsies, evidence behind every value |
| Sectors | `/finance/sectors/:slug` | Eight playbooks (FIG deepest): business models, value chain, players, metric dictionary, valuation guidance, M&A and diligence, dated regulatory changes, analyst primer, five practice questions, sector view and research-question notes |
| Companies | `/finance/companies/:id` | 55 dossiers (28 India) with dated, sourced observations; linked deals and sectors; owner corrections with evidence |
| Lab | `/finance/lab` | Comparables (NM handling, EV bridge, premium and minority calculators), DCF (5×5 sensitivity, waterfall), accretion/dilution (EPS bridge, sensitivities), FIG residual income and justified P/B with a sourced bank peer table; scenarios, CSV, print, owner save/reopen |
| Briefs | `/finance/briefs` | Historical archive examples and deterministically compiled daily/weekly briefs with explicit ranking and a “why this appears” line per item; Markdown export |
| Notebook | `/finance/notebook` | Notes with templates, autosave, conflict handling, Markdown/print export; Deal Memory cards; spaced review (1/3/7/14/30/60-day ladder); 12 learning modules, 92 practice questions, 98 glossary terms; timed interview practice with rubric |
| Sources | `/finance/sources` | Source registry and health, coverage and citation statistics; owner administration (connector tests, review queue, manual source links, jobs) |
| Settings | `/finance/settings` | Preferences, private export/import with preview and conflict handling, account and provider status, AI usage |

## Works with no paid key

Everything above works with **AI disabled and no paid API key**: research, evidence, deterministic models,
notes, Deal Memory, review, learning, interview practice (outline + self-review rubric) and compiled briefs.
Optional AI (Anthropic, off by default) adds grounded summaries, term explanations, note drafts, question
suggestions, interview feedback and extraction proposals — always previewed before sending, grounded in
stored evidence, budget-capped and logged. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md#optional-ai).

## Research content

- Research archive cutoff: **25 September 2026**. Every fact carries a claim with its source document,
  locator and a truthful verification status (`source_checked`, `search_corroborated`, `pending`,
  `conflict`, `human_reviewed`). Many claims are **search-corroborated**: matched to search-engine results
  that cite the source because the build environment could not retrieve publisher pages.
- Fictional training models (Lab) are labelled on screen and excluded from research statistics.
- Content checks: `npm run verify:content` (all SPEC §12 targets met; see `release/reports/content-verification.json`).

## Commands

Node 22 (see `.nvmrc`). Chromium for Playwright is expected at the Playwright browsers path.

| Command | What it does |
|---|---|
| `npm ci` | Install from the lockfile |
| `npm run dev` | Build (dev) and start the simulated host in workerd/Miniflare with a persistent local D1 at http://localhost:8787/finance. Local sign-in: `/signin-with-chatgpt` (development identity only) |
| `npm run typecheck` | TypeScript (browser/Worker and Node configs) |
| `npm run lint` | ESLint (TypeScript, React hooks, JSX a11y, Workers-only rules for server code) |
| `npm run test` | Unit tests plus Worker/D1 tests against the built release in the simulated host |
| `npm run test:e2e` | Production build, then Playwright journeys (with axe) and visual captures |
| `npm run verify:content` | Content targets and evidence rules |
| `npm run build` | Production build → `release/` |
| `npm run check:sources:live` | Fetch each connector endpoint once from this machine (needs network access) |
| `npm run package:handoff` | Clean production build, manifest, checksums, `manish-finance-handoff.zip` |

## Layout

```
src/         React UI (scoped under .finance-root; finance-* assets)
server/      Worker module: routes, auth adapter, D1 access, source connectors, jobs, optional AI
shared/      Schemas, calculations (shared/calc), dates, labels, archive compiler
data/        Research archive (data/archive) and fictional training models (data/training)
research/    Claim-level research ledger
migrations/  D1 SQL (0001_finance_init.sql) and Drizzle schema mirror (schema.finance.ts)
harness/     Simulated kmanish.live host used by tests and local preview (not the real site)
integration/ Host integration example and optional homepage link
tests/       unit/, worker/ (Miniflare + D1), e2e/ (Playwright), fixtures/
release/     Prebuilt assets, finance.mjs, migrations, integration, reports, manifest.json, SHA256SUMS
docs/        Deployment, API, data sources, data model, design system, operations, limitations
```

## Status

Built and verified in a simulated host (workerd + D1); **not tested on the live site**. No live source
connection has succeeded from the build environment (its network policy blocks publisher hosts). Details
and remaining activation steps: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) and
[`release/reports/ACCEPTANCE_REPORT.md`](release/reports/ACCEPTANCE_REPORT.md).
