# Build state

Resumable progress record for Finance Desk (see `SPEC.md` for the acceptance contract).

## Milestones

| Milestone | State | Notes |
|---|---|---|
| M1 Foundation | Done | Worker module (`createFinance`), D1 migration, simulated host harness in workerd/Miniflare, esbuild pipeline, calc library with tests |
| M2 Research core | Done | 42 deals (20 India, 9 APAC, 13 global), 10 autopsies, 55 companies (28 India), 8 sector playbooks + primers, evidence drawer, compare, exports |
| M3 Persistence | Done | Owner-only notes/watchlist/saved searches/models/preferences/memory/review/progress/interview, idempotency, revisions, export/import |
| M4 Intelligence | Done (fixture-tested) | Fetch guard, RSS/Atom + SEC parsers, collector (dedupe, linking, versioning), review queue → published changes, manual sources, corrections, leases, jobs, compiled briefs |
| M5 Learning & analysis | Done | Lab (comparables, DCF, accretion/dilution, FIG), Deal Memory + spaced review, 12 modules, 92 questions, 98 glossary terms, interview practice |
| M6 Optional AI | Pending | Off by default; Anthropic adapter with evidence-ID validation, budgets and usage log still to build |
| M7 Delivery | Pending | Lint config, e2e journeys + axe, screenshots, docs, verify-content, package-handoff |

## Last successful checks (2026-09-25)

- `npm run typecheck` — clean.
- `npx vitest run` — 139 tests passed (94 unit, 45 Worker/D1 on the simulated host).
- `node scripts/build.mjs` — release bundle built; `release/server/finance.mjs` 2.26 MB unminified (436 KB gzip).

## Source assumptions and blockers

- The build environment's egress policy blocks rbi.org.in, sebi.gov.in, data.sec.gov and other publisher hosts
  (CONNECT tunnel rejected with 403 by the sandbox proxy). **No live connector test has succeeded.** Connector
  behaviour is verified only against fixtures authored to the documented formats (`tests/fixtures/sources/`).
- SEC EDGAR needs `FINANCE_SEC_USER_AGENT` (a real contact) before it runs; without it the source reports
  "Not configured" and makes no request.
- RBI/SEBI RSS URLs come from the publishers' RSS directory pages; they stay "unverified" until a live fetch
  from the deployed Worker records `live_verified_at`.
- No background scheduler is attached. The protected endpoint `POST /api/finance/admin/jobs/run`
  (Bearer `FINANCE_JOB_SECRET`) and `module.runMaintenance(env)` are ready for the deployment agent.

## Next concrete tasks

1. M6: AI provider adapter (off by default) — evidence pack, citation-ID validation, budgets, usage log.
2. Drizzle schema mirror + migration test; `integration/` example.
3. ESLint config, `scripts/verify-content.mjs`, `scripts/check-sources-live.mjs`, `scripts/package-handoff.mjs`.
4. Playwright journeys with axe; screenshots at 390/768/1440/1920 in light and dark.
5. Docs: README, DEPLOYMENT_HANDOFF, API, DATA_SOURCES, DATA_MODEL, DESIGN_SYSTEM, OPERATIONS, KNOWN_LIMITATIONS, ACCEPTANCE_REPORT.
