# Finance Desk — durable working notes

Full product brief: `SPEC.md` (acceptance contract). Progress and next task: `BUILD_STATE.md`.

## Commands
- `npm ci` · `npm run dev` (build + simulated host in workerd/Miniflare at http://localhost:8787, local D1 in `.local/`)
- `npm run typecheck` · `npm run lint` · `npm run test` (unit + Worker/D1 tests) · `npm run test:e2e` (Playwright, pre-installed Chromium)
- `npm run verify:content` · `npm run build` · `npm run package:handoff`

## Constraints (never violate)
- Namespaces: pages `/finance*`, APIs `/api/finance*`, assets `finance-*`/`finance.html`/`finance.css`, tables `finance_*`, storage `manish.finance.v1.*`, env `FINANCE_*`.
- `release/server/finance.mjs` must use Workers APIs only (no Node built-ins, no `process.env`).
- Identity only from the host `getUser`; owner = `FINANCE_OWNER_USER_ID`; fail closed. Every private query filters by user_id.
- Calculations live in `shared/calc` as deterministic functions with tests; missing is null, never zero.
- Never fabricate facts, sources, endpoints, reviewer names or live-connection success. Verification statuses must be truthful.
- Fictional training data stays in `data/training` and out of research statistics.
- Build network note: this environment's egress policy blocks sec.gov, rbi.org.in, sebi.gov.in, cci.gov.in, exchanges and company sites.
