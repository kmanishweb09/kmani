# Finance API

All routes live under `/api/finance/` and are served by `finance.mjs`. Schemas are the zod definitions in
`shared/schemas/*` and the response types in `shared/api.ts`. The route table below is extracted from
`server/routes/*.ts` (79 routes).

## Conventions

**Responses.** Always JSON (`application/json; charset=utf-8`), except the explicit `.md`/`.csv` exports.
Unknown finance routes return a JSON 404; a known path with the wrong method returns 405 with `Allow`.
`HEAD` works wherever `GET` does.

**Errors.**

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Some fields are invalid.", "details": [{ "path": "title", "message": "Too small" }], "requestId": "r_x1y2z3" } }
```

| Status | Typical codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `INVALID_JSON`, `EMPTY_BODY`, `IDEMPOTENCY_KEY_REQUIRED`, `CONFIRMATION_REQUIRED` |
| 401 | `SIGN_IN_REQUIRED` (or no valid maintenance bearer) |
| 403 | `OWNER_ONLY`, `ORIGIN_MISMATCH`, `CROSS_SITE_REQUEST`, `CSRF_HEADER_MISSING` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` (stale revision; `details.current` holds the server version), `ALREADY_DECIDED`, `REQUEST_IN_PROGRESS` |
| 413 / 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `IDEMPOTENCY_KEY_REUSED`, `NO_MATERIAL` (brief), `AI_OUTPUT_REJECTED`, `AI_REFUSED` |
| 429 | `RATE_LIMITED`, `AI_BUDGET_EXHAUSTED`, `AI_RATE_LIMITED` (with `Retry-After` when known) |
| 503 | `OWNER_NOT_CONFIGURED`, `DATABASE_UNAVAILABLE`, `AI_DISABLED` (with `details.alternative`) |

**Access.** `public` — anyone. `owner` — the signed-in user whose host account ID equals
`FINANCE_OWNER_USER_ID` (401 signed out, 403 other users, 503 when no owner is configured).
`owner_or_maintenance` — owner session, or `Authorization: Bearer <FINANCE_JOB_SECRET>` (never a URL token).

**Writes** (POST/PATCH/PUT/DELETE, except the maintenance bearer): same-origin `Origin` (or `Referer`),
`Sec-Fetch-Site` not cross-site, header `X-Finance-Request: 1`, `Content-Type: application/json`,
body ≤ 256 KB unless noted. CORS is never enabled.

**Idempotency.** Create-style writes require `Idempotency-Key` (8–80 URL-safe characters). A retry with the
same key and body replays the stored response (`Idempotent-Replayed: true`); the same key with a different
body is rejected (422).

**Revisions.** Notes, models and preferences carry `revision`; send the revision you edited. A stale revision
returns 409 with the current server copy — nothing is overwritten silently. Partial updates change only the
fields you send.

**Caching.** Public research: `Cache-Control: public, max-age=30–300, stale-while-revalidate=300` with a strong
`ETag` (304 on `If-None-Match`). Anything viewer-dependent or private: `private, no-store` and
`Vary: Cookie, Authorization`. `/api/finance/status` and `/briefs/today` are always `no-store`.

**Pagination.** `/deals`: `page` (1-based) and `pageSize` (default 25); `/companies`: `page`, `pageSize` (≤ 100,
default 50); `/feed`: `page` with 50 per page; responses include `total`, `page`, `pageSize`.

## Public research

| Method | Path | Notes |
|---|---|---|
| GET | `/status` | App/archive/calc versions, viewer role (no raw user ID), capability flags, source summary, sign-in URLs. `no-store`. |
| GET | `/deals` | Filters: `q`, `sector` (repeatable), `subsector`, `geo` (`india`/`apac`/`global`), `geoMode` (`target`/`acquirer`/`either`), `dealType`, `buyerType`, `status`, `payment`, `from`, `to`, `crossBorder` (`yes`/`no`), `value` (`disclosed`/`undisclosed`), `autopsy=yes`, `sort`, `dir`, `page`, `pageSize`. |
| GET | `/deals/tape` | Recent status changes (`limit` ≤ 50). |
| GET | `/deals/export.csv` | CSV of the filtered list (same filters). |
| GET | `/deals/compare?ids=a,b[,c,d]` | Side-by-side rows; statistics exclude incompatible figures with reasons. |
| GET | `/deals/:id` | Full record with `evidence` map (claim → document). |
| GET | `/coverage` | Content and claim-status statistics. |
| GET | `/companies`, `/companies/:id` | Directory (`q`, `sector`, `country`, `page`, `pageSize`) and dossier with observations, corrections and linked deals. |
| GET | `/sectors`, `/sectors/:slug` | Playbooks with metric dictionary, players, deals, dated changes, practice questions. |
| GET | `/evidence/:id` | One claim with its source document. IDs: `ev-<hash>` (archive), `ev-u-…` (collected lead), `ev-p-…` (owner-published event), `ev-c-…` (owner correction). |
| GET | `/search?q=` | Deals, companies, sectors, glossary (`limit` ≤ 30). |
| GET | `/glossary`, `/learn`, `/learn/:id`, `/questions` | Learning content (`topicType`, `topicId` filters for questions). |
| GET | `/lab/bank-peers` | Latest sourced bank metrics (asset quality, capital, CASA, deposits) with evidence; P/B, P/E and ROE are not held. |
| GET | `/training-models` | Fictional Lab training inputs (labelled). |
| GET | `/sources` | Source registry and health (public-safe error summaries). |
| GET | `/feed` | Collected source-linked items (`days` ≤ 90, `sector`, `page`). Leads, not verified terms. |
| GET | `/briefs`, `/briefs/today`, `/briefs/:id`, `/briefs/:id/export.md` | Briefs (`kind`, `sector`, `scope=private` for the owner). Private brief IDs start `p_`. `today` returns `brief`, else `latest` with its real date, plus `lastError` from the last failed compile. |

## Owner (private)

| Method | Path | Notes |
|---|---|---|
| GET, POST | `/notes` | List (`q`, `tag`, `template`, `archived=1`, `entityType`+`entityId`, `limit`) / create (idempotent). |
| GET, PUT | `/notes/view` | One personal "view" note per deal (upsert). |
| GET, PATCH, DELETE | `/notes/:id` | PATCH with `revision`; DELETE requires `?confirm=true`. |
| GET | `/notes/:id/export.md` | Markdown with citations and source URLs. |
| GET, PUT | `/watchlist`; POST `/watchlist/viewed` | Saved/followed deals, companies, sectors; view watermarks. |
| GET, POST | `/saved-searches`; POST `/saved-searches/:id/viewed`; DELETE `/saved-searches/:id` | Deal filters as saved searches. |
| GET, POST | `/models`; GET, PATCH, DELETE `/models/:id` | Saved Lab models with scenarios and source snapshot. |
| GET, POST | `/memory`; PATCH `/memory/cards/:id`; DELETE `/memory/:id` | Deal Memory: one record per deal/concept; cards cite claims or notes. |
| GET, POST | `/review`; GET `/review/history` | Due cards (owner's timezone) and ratings (`again`/`hard`/`good`/`easy`, idempotent). |
| GET, PATCH | `/preferences` | Partial update with `revision`. |
| GET, POST | `/progress` | Module and question progress. |
| GET, POST | `/interview`; DELETE `/interview/:id` | Timed attempts, self-rubric, stored AI feedback. |
| GET | `/desk` | Desk summary (alerts, due counts, session plan). |
| GET | `/export`, `/export/notes.md`, `/export/reviews.csv` | Versioned private export (JSON) and convenience exports. |
| POST | `/import/preview`, `/import/commit` | Preview shows new/duplicate/conflict per record; commit never deletes. |

## Owner administration

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/sources` | Registry with owner diagnostics (redacted), recent jobs, pending review count. |
| PATCH | `/admin/sources/:id` | `{ "enabled": false }` for automated connectors. |
| POST | `/admin/sources/:id/test` | Runs the connector once now (ignores interval/backoff) and returns the outcome. |
| POST | `/admin/refresh` | One bounded refresh of due connectors; presses within 2 minutes share one run. Idempotent. |
| GET | `/admin/review?status=pending|published|rejected|all` | Review queue. |
| POST | `/admin/review/:id/decision` | `{ "decision": "publish" | "reject", "note"?: "…" }`. Publishing appends an event with an owner-reviewed claim; it never edits terms or status unless the item was a manual proposal with an explicit status. |
| POST | `/admin/manual-source` | `{ url, publisher, title, publishedDate?, eventDate?, excerpt? (≤ 300), documentType?, dealId?, eventType, statusAfter? }`. The URL is validated and stored, never fetched. |
| POST | `/admin/corrections` | `{ companyId, field: displayName|website|irUrl|aliases|subsector, next, note, evidence: { url, publisher, title, publishedDate?, excerpt? } }`. Previous value kept. |
| POST | `/briefs/compile` | `{ "kind": "daily"|"weekly", "scope": "private"|"public" }`. 201 new version, 200 unchanged, 422 `NO_MATERIAL`. |
| POST | `/admin/jobs/run` | `owner_or_maintenance`. Optional body `{ "jobs": ["refresh_sources","compile_briefs","cleanup"] }` (≤ 4 KB), optional `Idempotency-Key`. |

## Optional AI (owner, off by default)

| Method | Path | Notes |
|---|---|---|
| GET | `/ai/status` | Enabled flag and reason, model, budget, today's estimated spend and request count, operations with their deterministic alternatives. |
| GET | `/ai/history` | Last 50 requests: tokens, estimated cost, evidence version, outcome, stored result. |
| POST | `/ai/:op/preview` | Exactly what would be sent (evidence items, private flags, instruction, token and worst-case cost estimate). No provider call; works while AI is off. |
| POST | `/ai/:op` | `op`: `summarize`, `explain`, `draft_note`, `questions`, `interview_feedback`, `extract`. Body: `{ subject?: { type: "deal"|"company"|"sector", id }, termId?, noteIds? (≤ 5, sent only when listed), attemptId?, documentId? }`. Requires `Idempotency-Key`. |

## Examples (dummy values)

```bash
# Public: filtered deals
curl -s 'https://example.test/api/finance/deals?geo=india&sector=fig&sort=announced&dir=desc&page=1'

# Owner: create a note (cookie from the host's sign-in)
curl -s -X POST https://example.test/api/finance/notes \
  -H 'Origin: https://example.test' -H 'X-Finance-Request: 1' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: note-2026-09-25-0001' -H 'Cookie: session=<host session cookie>' \
  -d '{"title":"HDFC merger view","template":"deal_note","links":[{"type":"deal","id":"hdfc-hdfc-bank-merger"}]}'

# Scheduler
curl -s -X POST https://example.test/api/finance/admin/jobs/run \
  -H 'Authorization: Bearer <FINANCE_JOB_SECRET>' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sched-2026-09-26T00' -d '{"jobs":["refresh_sources","compile_briefs"]}'
```
