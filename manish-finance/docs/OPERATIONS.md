# Operations

## Refresh behaviour

| Mechanism | What it does | When |
|---|---|---|
| Scheduler → `POST /api/finance/admin/jobs/run` | `refresh_sources` (each due connector once), `compile_briefs` (public daily brief once per IST date after 07:30; weekly on Sundays), `cleanup` | Only if a scheduler is attached (see `DEPLOYMENT_HANDOFF.md` §6). Until one call is observed the app says **Background schedule not configured**. |
| Owner → Sources → Refresh sources now | One bounded run of due connectors (backoff still applies); presses within two minutes share a run | On demand |
| Owner → Test connection | Runs one connector now, ignoring interval and backoff | On demand |
| Owner → Briefs → Compile my brief / Publish general brief | Deterministic compile; unchanged input returns the existing brief; changed input creates a new version (the earlier one is kept) | On demand |
| Open app (owner) | Re-reads cached status about every five minutes while the tab is visible; never fetches upstream sources | While open |

Per-source defaults: refresh every 6 hours; stale after 36 h (SEC) or 48 h (RSS). Data refreshed while the app is
closed happens only through the scheduler; browser polling never contacts upstream sites.

## Job authentication and safety

- `FINANCE_JOB_SECRET` (≥ 32 random characters) authorises only `/admin/jobs/run`, via
  `Authorization: Bearer`; it is never accepted in a URL and grants no access to private records.
- Each job run writes a `finance_jobs` row keyed by an idempotency key; a repeated scheduler call with the same
  `Idempotency-Key` returns the stored result. Leases (`finance_leases`) stop overlapping runs; per-source
  leases stop concurrent fetches of one source.
- Rotate the secret by setting a new value and updating the scheduler; old calls then fail with 401.

## Source failure handling

| Upstream result | Health shown | What happens |
|---|---|---|
| 200 / 304 | Working and current | Items stored/deduplicated; `live_verified_at` set on the first success |
| 401 / 403 / 451, HTML block page, redirect off the allowlist | Access unavailable | Backoff; cached items stay; nothing is bypassed — use the manual source form |
| 429, or 503 with `Retry-After` | Rate limited | Wait at least `Retry-After`, otherwise backoff |
| 404/410, 5xx, timeout, invalid XML/JSON, DTD in XML | Failed (cached if an earlier success exists) | Backoff 30 min, doubling to 24 h |

Owner diagnostics show the redacted error; public pages show a summary only. Configured secrets and bearer
tokens are removed from any stored message.

## Review queue

Collected items linked to a covered deal, manual source links with a deal, and AI extraction proposals wait
in Sources → Administration → Review queue. **Publish** appends an event with evidence and an owner-reviewed
claim; **Reject** keeps the item in history and removes the proposed link. Nothing reaches a deal record any
other way. Company corrections are entered with evidence and keep the previous value.

## Optional AI

Off unless `FINANCE_AI_PROVIDER=anthropic` and a model, key, positive daily budget and a dated price table are
all set. Owner only. Every request is previewable, reserves its worst-case cost against the daily budget before
the call (atomically), is limited to 30 per hour and `FINANCE_AI_DAILY_REQUESTS` per day, and is logged with
actual token usage (`finance_ai_usage`, visible in Settings). Costs are **estimates** from the configured
price table and its date; the provider's invoice is authoritative.

**Cost calculation (example).** Prices move — verify on Anthropic's pricing page before configuring. As an
illustration using the Claude API price list cached in the Claude API skill on 2026-06-24 for `claude-opus-5`
(US$5 per million input tokens, US$25 per million output tokens):

```
typical summary: ~4,000 input tokens + ~1,200 output tokens
= 4,000 × 5 / 1,000,000 + 1,200 × 25 / 1,000,000 = US$0.020 + US$0.030 ≈ US$0.05
worst case reserved per request (8,000 output tokens): 4,000 × 5e-6 + 8,000 × 25e-6 ≈ US$0.22
```

With `FINANCE_AI_DAILY_BUDGET=1`, at most about four worst-case requests can be reserved at once, and
typically about 20 summaries a day. Set the three price variables to the rates you verified and the date you
checked them. Zero-paid-API mode: leave `FINANCE_AI_PROVIDER=none`.

Other cost drivers: Worker requests and CPU, D1 reads/writes/storage (small: owner records, a few hundred
collected items a month), and any scheduler invocations. The application is not "free forever"; its costs
depend on the host plan.

## Backups

- Private data: Settings → Export (versioned JSON) at any time; keep a copy before major updates.
- D1: use the host's D1 backup/time-travel features for the whole database; `finance_*` tables are included.
- The research archive is in source control; a rebuild reproduces it exactly.

## Routine updates

1. Edit research content under `data/archive/` (every fact needs a citation with a truthful status).
2. `npm run verify:content`, `npm run test`, `npm run test:e2e`.
3. `npm run package:handoff`; hand the new `release/` to the deployment process (only changed assets and
   `finance.mjs` need copying; migrations only when a new numbered file appears).
4. Record source checks and new live verification dates in `docs/DATA_SOURCES.md`.

## Rollback

Redeploy the previous combined application. Keep the `finance_*` tables and their data — they are additive and
ignored by older code. Do not drop tables or delete private research to roll back UI code. Research archive
changes roll back with the code; owner-published changes stay in `finance_published_changes` and reappear when
the newer code returns.
