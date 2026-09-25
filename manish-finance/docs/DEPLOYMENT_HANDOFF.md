# Deployment handoff

For the agent that integrates Finance Desk into kmanish.live. **Nothing here has been applied to the real
site repository.** The integration is an additive adapter written against the host contract recorded in
`SPEC.md` §2 (inspected at source commit `79e35517842ac4750585ade2d8eb34a0199fd8c0`) and exercised in a
*simulated* host (`harness/host-worker.mjs`) in workerd with D1. Treat every step as "verify against the
current checkout first".

## 0. Before you start

1. Open the current kmanish.live source and record its revision.
2. Compare it with the baseline in `SPEC.md` §2: `server/worker.mjs` exporting `createApp(assets, tasks, options)`,
   flat `dist/` assets embedded into `SITE_ASSETS`, D1 binding `DB`, Drizzle schema in `db/schema.ts` with
   migrations in `drizzle/`, trusted `getUser(request)`, sign-in at `/signin-with-chatgpt?return_to=…`.
   If anything differs, adapt the three integration blocks below; do not restructure the host.
3. Run `npm ci && npm run package:handoff` in this directory (or use the prebuilt `release/`), and check
   `release/SHA256SUMS`.

## 1. File map

| From this package | To the host | Notes |
|---|---|---|
| `release/assets/finance.html` | `dist/finance.html` | Served only through `finance.page()` (adds the finance CSP). Do not link it directly. |
| `release/assets/finance.css` | `dist/finance.css` | Scoped to `.finance-root`; the shared Atlas stylesheet is not touched. |
| `release/assets/finance-*.js` | `dist/finance-*.js` | Entry plus route chunks; every file listed in `release/manifest.json` must be copied (flat, no subdirectories). |
| `release/server/finance.mjs` | `server/finance.mjs` | Standalone ES module; Workers APIs only (no Node built-ins, no `process.env`). |
| `release/migrations/0001_finance_init.sql` | host migration workflow | Additive `finance_*` tables only. |
| `release/migrations/schema.finance.ts` | merge into `db/schema.ts` | Drizzle mirror of the SQL (tested equal, see §4). |
| `release/integration/*` | reference only | Example blocks and optional homepage link. |

Copy files into `dist/`; **do not** replace or clean the directory. Asset names are unique and prefixed;
extensions are `.html`, `.css`, `.js` only (all supported by the host's embedding build). Source maps are in
`release/debug-sourcemaps/` for debugging and must not be published as site assets.

## 2. Worker change (three additive blocks)

See `release/integration/worker-integration.example.mjs`. In `server/worker.mjs`:

```js
// (1) import — top of file
import { classifyFinanceRequest, createFinance } from "./finance.mjs";

// (2a) construct once per isolate — inside createApp(), before the returned handler
const finance = createFinance({
  getUser: (request) => getUser(request), // the host's existing trusted helper
  database: (env) => env.DB,              // the existing D1 binding
});

// (2b) dispatch — inside fetch(), BEFORE the generic `/api/` branch, after existing API routes
const financeRoute = classifyFinanceRequest(request);
if (financeRoute?.kind === "api") return finance.fetch(request, env, ctx);
if (financeRoute) return finance.page(request, assets["finance.html"]?.text ?? null);
```

- `classifyFinanceRequest` returns `null` for every non-finance path, so `/`, `/Atlas*`, `/Study`, the
  existing redirects and `/api/planner`, `/api/excel/*`, `/api/study*`, `/api/missions*` are untouched.
  Look-alikes such as `/financex` and `/api/financex` are not claimed (tested).
- Page handling: documented `/finance` routes → 200 with the app shell; unknown extension-less `/finance/*`
  → the shell with status 404 (the app renders "not found"); trailing slashes → 308 to the canonical path;
  `/finance/…/*.ext` asset misses → plain 404 (never the SPA shell). Finance APIs always answer JSON,
  including 404/405, and support `HEAD`.
- `createFinance` options: `getUser` (required), `database` (required), `userIdOf(user)` if the account ID
  is not in `id`/`sub`/`userId`/`user_id`, `signInPath`/`signOutPath` (default `/signin-with-chatgpt`,
  `/signout-with-chatgpt`), `log(event)` for redacted structured logs, `clock`/`fetcher` for tests only.

## 3. Identity and owner

- The module trusts only `getUser(request)`. It never reads user IDs from JSON, query strings or
  client-supplied headers (tested with forged `X-User-Id`, `?userId=` and body fields).
- Set `FINANCE_OWNER_USER_ID` to the owner's account ID exactly as the host's user object reports it.
  Until it is set, `/finance` works as a public reference app and every private/admin/AI route fails closed
  with `503 OWNER_NOT_CONFIGURED`; the first visitor is never treated as owner (tested).
- Signed-in non-owners get published research only (`403 OWNER_ONLY` on private routes).
- Writes need same-origin `Origin`/`Referer`, `Sec-Fetch-Site` not cross-site, and the `X-Finance-Request: 1`
  header; CORS preflights are refused. Set `FINANCE_PUBLIC_ORIGIN=https://kmanish.live`.

## 4. Database

The migration is additive and idempotent: 24 tables and 25 indexes, all prefixed `finance_`; no `DROP`,
no changes to existing tables (tested by applying it twice over a database that already has host tables).

Using the host's Drizzle workflow (preferred, preserves migration history):

1. Append the exports of `release/migrations/schema.finance.ts` to `db/schema.ts` (or import them from a
   new `db/finance.schema.ts` referenced by the Drizzle config).
2. Run the host's usual `drizzle-kit generate`. Review the new file in `drizzle/`: it must contain only
   `CREATE TABLE finance_*` / `CREATE INDEX finance_*` statements.
3. Apply it with the host's normal D1 migration command against a preview database first, then production.

`tests/unit/migration.test.ts` shows that drizzle-kit's output from this schema produces exactly the same
tables, columns, defaults, keys and indexes as `0001_finance_init.sql`. If the host does not use Drizzle for
this, apply `0001_finance_init.sql` as a new numbered migration. Never reset D1 or rewrite applied migrations.

**Seed data.** The research archive (deals, companies, sectors, learning content, evidence) is compiled into
`finance.mjs`; there is no seed import and nothing to re-run. D1 holds only runtime data: owner records,
collected source items, review decisions, published updates, briefs and jobs.

## 5. Configuration

All names are also in `.env.example`.

| Name | Kind | Purpose / default |
|---|---|---|
| `DB` | host binding | Existing D1 binding. Never hardcode a database ID. |
| `FINANCE_OWNER_USER_ID` | config | Owner account ID. Absent → private features fail closed. |
| `FINANCE_PUBLIC_ORIGIN` | config | `https://kmanish.live` — origin checks and links. |
| `FINANCE_JOB_SECRET` | secret | ≥ 32 random characters. Bearer credential for the maintenance endpoint only. |
| `FINANCE_SEC_USER_AGENT` | config | Honest app name + real contact for SEC EDGAR fair access. Empty → SEC connector "Not configured". |
| `FINANCE_SCHEDULE_EXPECTED_MINUTES` | optional | Expected scheduler interval (default 360) used to label the schedule observed/stale. |
| `FINANCE_AI_PROVIDER` | optional | `none` (default) or `anthropic`. |
| `FINANCE_AI_MODEL` | optional | Explicit model ID, verified against Anthropic's model list at activation time. |
| `FINANCE_AI_API_KEY` | secret, optional | Server-side only. Never in the browser, storage, URLs, exports or logs. |
| `FINANCE_AI_DAILY_BUDGET` | optional | USD/day cap; 0 keeps paid AI off. |
| `FINANCE_AI_PRICE_INPUT_PER_MTOK`, `FINANCE_AI_PRICE_OUTPUT_PER_MTOK`, `FINANCE_AI_PRICE_DATE` | optional | Dated price table for cost estimates (all three required to enable AI). |
| `FINANCE_AI_MAX_OUTPUT_TOKENS` | optional | Per-request output ceiling (default 8000). |
| `FINANCE_AI_DAILY_REQUESTS` | optional | Requests/day cap (default 60). |

Do not put placeholder IDs into production configuration.

## 6. Scheduler (optional, recommended)

Background refresh is **not attached**. Until a scheduler call is observed, the app says "Background schedule
not configured" and sources refresh only when the owner presses Refresh or Test connection.

Contract (any scheduler that can send an authenticated POST):

```
POST https://kmanish.live/api/finance/admin/jobs/run
Authorization: Bearer <FINANCE_JOB_SECRET>
Content-Type: application/json
Idempotency-Key: <slot id, e.g. 2026-09-26T00>      (optional; a repeat returns the stored result)

{"jobs": ["refresh_sources", "compile_briefs", "cleanup"]}   (optional; default runs all three)
```

- `refresh_sources` runs each due connector once (interval 6 h per source, backoff after failures, leases).
- `compile_briefs` compiles the public daily brief once per IST date at or after 07:30 IST (and the weekly
  review on Sundays). Call at least every 6 hours; one call at 02:05 UTC lands just after 07:30 IST.
- `cleanup` prunes expired leases, idempotency keys, rate-limit buckets, old job rows and year-old
  unreviewed leads.
- The secret is never accepted in a URL. Response: JSON job report (status per job).

If the hosting platform supports a scheduled handler for this project, the equivalent is
`ctx.waitUntil(finance.runMaintenance(env, { requestedBy: "scheduler" }))`. Hosting-managed schedules and
Cloudflare Cron Triggers are different capabilities; confirm which one exists before relying on either.

Verification: after the first call, `/finance/sources` shows "Scheduler observed" and the job appears in
Sources → Administration → Recent jobs.

## 7. Build and check the combined application

1. Build the host as usual (it embeds the new `dist/finance*` files).
2. Measured sizes of this release (gzip): finance.mjs ≈ 530 KB; initial browser JS ≈ 129 KB; all browser
   assets ≈ 179 KB; the simulated combined host Worker ≈ 717 KB. Compare the real combined bundle with the
   host plan's Worker size limit.
3. Smoke checks against a preview deployment:
   - `/`, `/Atlas` and each Atlas sub-route, `/Study`, `/atlas → /Atlas` and `/study → /Study` redirects, and
     existing APIs behave as before.
   - `GET /api/finance/status` → 200 JSON, `Cache-Control: private, no-store`.
   - `/finance/deals/hdfc-hdfc-bank-merger` renders; the evidence icon next to Status opens a source.
   - Signed out: `GET /api/finance/notes` → 401. Signed in as owner: create a note, reload, it persists.
   - `/finance/sources`: registry visible; with `FINANCE_SEC_USER_AGENT` set, Administration → Test connection
     on each connector records a real outcome (this is the first live test of the connectors).

## 8. Publish and rollback

Publish through the site's normal process, keeping its project identity, domain and audience. To roll back,
redeploy the previous combined application; keep the `finance_*` tables (they are additive and unused by the
old code). Do not drop tables or erase private research to roll back UI code. The first migration has no
destructive counterpart and needs none.

## 9. Optional homepage link

`release/integration/homepage-link.snippet.html` is a small inline-styled link to `/finance`. Adding it is
optional; the app works at its route without it. Do not change the homepage art, animation, layout or the
Atlas link.
