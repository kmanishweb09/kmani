# Acceptance report — Finance Desk 0.1.0

Prepared 25 September 2026 in a Claude Code cloud build container. Verification ran against the built release
(`release/server/finance.mjs` and `release/assets/`) inside a **simulated** kmanish.live host (workerd via
Miniflare, with D1). **Nothing was deployed, and nothing was tested on the live site.** Raw command output:
`command-log.txt`. Machine-readable results: `e2e-results.json`, `content-verification.json`,
`live-source-check.json`, `bundle-sizes.json`, `axe/*.json`, `screenshots/`.

## Commands and actual results (final run 2026-09-25 15:55 UTC, Node v22.22.2)

| Command | Result |
|---|---|
| `npm ci` | exit 0 (clean install from `package-lock.json`) |
| `npm run lint` | exit 0 — no findings |
| `npm run typecheck` | exit 0 |
| `npm run verify:content` | exit 0 — 21 checks passed, 0 warnings, 0 failed |
| `npm test` | exit 0 — **160 tests passed** in 8 files (unit: calculations, review scheduler, fetch guard, parsers, entity linking, AI grounding, migration/Drizzle parity; Worker/D1: access, routing, private data, connectors, review queue, briefs, maintenance, optional AI) |
| `npm run test:e2e` | exit 0 — **44 Playwright tests passed** (10 required journeys with axe checks + 34 visual captures), 0 flaky |
| `npm run check:sources:live` | exit 0 — **0 of 4 connectors reachable** from this machine: each got `403 Host not in allowlist` from the sandbox's egress proxy (not from the publishers) |
| `npm run package:handoff` | exit 0 — clean production build, `manifest.json`, `SHA256SUMS`, `manish-finance-handoff.zip` (264 files, 7.3 MB) |

**Packaged-release check.** The handoff ZIP was extracted into an empty directory outside the workspace;
`sha256sum -c release/SHA256SUMS` matched every file, and `npm ci`, `npm test` (160 passed) and
`npm run verify:content` (21/21) passed from the extracted copy alone.

The packaged tree is identified in `manifest.json` by Git commit `274fb236…` plus a deterministic source-tree
SHA-256. The tree had uncommitted changes at packaging time (this report and the last tests), so use the
tree hash; the same content is committed on branch `claude/new-session-ycazlk` right after packaging.

## Required automated checks (SPEC §19)

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Calculations match the §9 fixtures; invalid/missing inputs handled | `tests/unit/calc.test.ts` "Section 9 mandatory fixtures" (EV bridge, EV/EBITDA, negative EBITDA NM, DCF, invalid WACC ≤ g, accretion, FIG RI, currency, units, bps) plus edge cases | Pass |
| 2 | Currency scaling, crore/million, bps, fiscal periods, eligible-multiple aggregation | calc tests: units, LTM/YTD, period alignment, totals by currency, FX pair checks, NM/n.d. handling, quartiles | Pass |
| 3 | No unauthenticated/non-owner access to private records, imports, admin, paid AI, maintenance | `tests/worker/access.test.ts`, `ai.test.ts`, e2e "signed-out, non-owner and owner states" | Pass |
| 4 | No access via other users' IDs or body/query/header user IDs | access test with forged `X-User-Id`, `?userId=`, body `userId`; every private query filters by the authenticated ID | Pass |
| 5 | Private responses `private, no-store`; never publicly cached | access/private tests assert headers on status, notes, export | Pass |
| 6 | Untrusted text sanitised; unsafe URLs and fetch destinations rejected | fetch-guard tests (schemes, credentials, ports, IP literals incl. decimal/hex/IPv6, metadata IP, internal names, allowlist, redirect hops, size, timeout); feed text stripped of markup/scripts; manual-source and correction URLs validated and never fetched | Pass |
| 7 | Repeated imports, refresh jobs and review submissions are idempotent | Idempotency-Key replay tests (notes, memory, review ratings, review decisions, AI), scheduler key replay, owner refresh window, import preview duplicates (e2e) | Pass |
| 8 | Conflicting edits produce a clear conflict | stale-revision 409 with current copy (notes); preferences/models revisions | Pass |
| 9 | Timeouts, stale data, rate limits, invalid XML/JSON, partial failures keep the last good state | connector tests: 403, 429 + Retry-After, 503, HTML block page, DTD, off-allowlist redirect, per-CIK partial failure, backoff; e2e "source failure" shows Cached and keeps feed items | Pass |
| 10 | Fictional citation IDs and ungrounded AI claims rejected or held | grounding unit tests; AI Worker tests (invented IDs, unsupported numbers, invented dates held; all-ungrounded → 422) | Pass |
| 11 | Draft/training data cannot enter published totals or real news | `verify:content` training check (fictional, IDs distinct from deals); training models served separately and badged; feed/briefs draw only from sources, published changes and archive | Pass |
| 12 | Review scheduling respects timezone and documented algorithm | `tests/unit/scheduler.test.ts` (ladder 1/3/7/14/30/60, Hard/Again rules, local-date boundaries); e2e review persists next due date | Pass |
| 13 | Production module runs in a Worker-style environment with D1 | all Worker tests and e2e load `release/server/finance.mjs` in workerd with D1; build check forbids Node APIs in finance code | Pass (simulated host) |
| 14 | JSON API responses; asset misses not SPA HTML; HEAD and canonicalisation | access test "routing contract" (JSON 404/405, `.js` miss → text 404, unknown page → shell 404, trailing slash → 308 keeping query, HEAD without body) | Pass |

## Required end-to-end journeys (Playwright, built release, simulated host)

| Journey | Result |
|---|---|
| Open `/finance/deals`, filter India + FIG, open a deal, inspect the source behind the status | Pass (+ axe on deal page and evidence drawer) |
| Save a note as the owner, reload, recover it; export Markdown with source URLs | Pass (server copy polled after autosave; axe on editor) |
| Compare two deals; incompatible metrics excluded with reasons | Pass (+ axe) |
| Follow a company, open its sector, save a research question | Pass (+ axe on FIG sector) |
| Training DCF: change WACC, sensitivity grid, save, reopen | Pass (+ axe) |
| Deal Memory: add cards, review, next due date persists after reload | Pass (+ axe) |
| Export private data, preview an import with duplicates, nothing deleted | Pass |
| AI disabled: research, models, notes, review and compiled briefs work | Pass (brief compiled without AI; "why this appears" shown) |
| Simulated source failure: accurate freshness and last-good data | Pass (fixture upstream: success then HTTP 503 → Cached; feed items kept) |
| Signed-out, non-owner and owner states | Pass (+ axe on owner Desk) |

Accessibility: axe-core WCAG 2.0/2.1 A and AA on 10 page states — **0 serious/critical and 0 minor/moderate
violations** (`axe/`). Found and fixed during QA: tab/panel ARIA references, deal-row link names.

## Integration regression (simulated host only)

Existing-route sentinels in `harness/host-worker.mjs`: `/api/planner`, `/api/excel/*`, `/api/study*`,
`/api/missions*`, generic `/api/*` 404, `/atlas → /Atlas` redirect, finance look-alikes (`/financex`,
`/api/financex`) not claimed. **This is a harness check, not a test of the live Atlas, Study, Microsoft or
Toggl connections.**

## Visual QA

34 captures in `screenshots/`: Desk, Deal Terminal, deal detail, evidence drawer, FIG sector, Lab DCF and FIG,
Notebook (review, learn), Briefs and Sources at 1440 px in dark and light; Desk, deals, deal detail and Lab at
390 px in both themes; tablet 768 px and wide 1920 px samples. Inspected; fixes made: owner theme capture,
FIG results table width, sector tab overflow ("My view"), scenario rename dialog.

## Content QA (`verify:content`, build date 2026-09-25)

| Target | Required | Actual |
|---|---|---|
| Real transactions | 36 (≈18 India, 8 APAC, 10 global) | 42 (20 / 9 / 13) |
| Material event in last 12 months | ≥ 8 | 14 |
| Deep autopsies (India, FIG) | 10 (≥ 5, ≥ 2) | 10 (7, 4) |
| Company dossiers (India, sectors) | 48 (≥ 24, all 8) | 55 (28, 8) |
| Sector playbooks | 8, ~600–1,000 words, 5 questions | 8 (604–1,525 words), 5 each |
| Learning modules | 12 | 12 (each ≥ 3 resolvable questions) |
| Glossary | ≥ 80 | 98 distinct |
| Practice questions | ≥ 80, no duplicates | 92, 0 duplicates, all with answers/rubrics |
| Training models | ≥ 3, fictional | 4 |
| Brief examples | 1 daily + 1 weekly | 1 + 1 |
| Primary source per deal | all | all 42 |
| Material amounts with claim evidence | all | all |
| Duplicate transactions | 0 | 0 |

Claims: 997 total — 967 search-corroborated, 30 pending, **0 source-checked** (publisher pages could not be
retrieved from the build environment), 0 human-reviewed. 15 party references have no dossier and render as
plain names. Figures were checked against search snippets and internal consistency, not against retrieved
documents.

## Bundle sizes (production build)

| Item | Size |
|---|---|
| Initial browser JS (entry + preloaded chunks) | 132.6 KB gzip (budget ~300 KB) |
| All browser assets (JS + CSS + HTML) | 179.7 KB gzip |
| `finance.mjs` (includes the compiled research archive and the Anthropic SDK) | 2.83 MB raw, 542 KB gzip |
| Simulated combined host Worker (host sentinels + embedded assets + finance module) | 718.5 KB gzip — compare with the real host's plan limit |

## Not verified / open items

- No live source connection (egress blocked); SEC needs a real `FINANCE_SEC_USER_AGENT`.
- No real AI call (adapter tested against a local fake); AI is off by default.
- Not integrated into, built with, or deployed on the real kmanish.live repository; no scheduler attached.
- Chromium only; no manual screen-reader pass; no Lighthouse; no device testing.

Details: `docs/KNOWN_LIMITATIONS.md`.
