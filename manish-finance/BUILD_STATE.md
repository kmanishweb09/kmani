# Build state

Resumable progress record for Finance Desk (see `SPEC.md` for the acceptance contract).

## Milestones

| Milestone | State | Notes |
|---|---|---|
| M1 Foundation | Done | Worker module (`createFinance`), D1 migration, simulated host harness in workerd/Miniflare, esbuild pipeline, calc library |
| M2 Research core | Done | 42 deals, 10 autopsies, 55 companies, 8 sector playbooks + primers, evidence drawer, compare, exports |
| M3 Persistence | Done | Owner-only notes/watchlist/saved searches/models/preferences/memory/review/progress/interview, idempotency, revisions, export/import |
| M4 Intelligence | Done (fixture-tested) | Fetch guard, RSS/Atom + SEC connectors, dedupe/versioning/linking, review queue → published changes, manual sources, corrections, leases, jobs, compiled briefs |
| M5 Learning & analysis | Done | Lab (comparables, DCF, accretion/dilution, FIG), Deal Memory + spaced review, 12 modules, 92 questions, 98 terms, interview practice |
| M6 Optional AI | Done (fake-provider tested) | Anthropic SDK adapter, previews, grounding (citations, numbers, dates), budget reservation, usage log; off by default |
| M7 Delivery | Done | Lint, Drizzle mirror + migration tests, verify:content, live check script, Playwright journeys + axe + visual captures, docs, manifest, checksums, handoff ZIP |

## Last successful checks (2026-09-25, final run 15:55 UTC)

`npm ci`, `lint`, `typecheck`, `verify:content` (21/21), `npm test` (160 passed), `test:e2e` (44 passed),
`check:sources:live` (ran; 0/4 reachable — sandbox egress policy), `package:handoff` (264 files, 7.3 MB).
Details: `release/reports/ACCEPTANCE_REPORT.md`, `release/reports/command-log.txt`.

## Source assumptions and blockers

- Build environment egress blocks publisher hosts; no live connector test succeeded. First live test belongs
  to the deployed Worker or `npm run check:sources:live` on a machine with access.
- SEC connector needs `FINANCE_SEC_USER_AGENT` (real contact). Optional AI needs a key, model ID, budget and
  dated price table. No scheduler is attached.
- Host integration follows the recorded contract (SPEC §2); not applied to the real repository.

## Next concrete tasks (for whoever continues)

1. Integrate into the real host per `docs/DEPLOYMENT_HANDOFF.md`; run the smoke checks there.
2. Run Sources → Test connection on each connector from the deployed Worker; record results in `docs/DATA_SOURCES.md`.
3. Re-check key figures against retrieved primary documents and upgrade claim statuses in the archive where verified.
4. Add dossiers for the 15 unlinked counterparties if they matter for study.
