# Data model

Two layers:

1. **Research archive** — authored TypeScript under `data/archive/`, validated with the zod schemas in
   `shared/schemas/research.ts` at build time and compiled (`shared/archive/compile.ts`) into
   `finance.mjs`. Immutable per release; identical for every viewer.
2. **D1 runtime data** — `finance_*` tables (`migrations/0001_finance_init.sql`, mirrored in
   `migrations/schema.finance.ts`): private owner records and collected/published updates.

The published research view = compiled archive + rows of `finance_published_changes`, rebuilt only when the
highest change sequence moves (`server/research.ts`).

## Archive entities

| Entity | Key fields |
|---|---|
| Source document | `id`, publisher, `url` (https), title, `documentType`, `isPrimary`, published date + precision, `retrievedAt`, `retrievalStatus` (`retrieved`/`not_retrieved`/`unavailable`) with a note, content hash |
| Claim (`ev-<hash>`) | subject (deal/company/sector/brief/module + id), field, label, display value, `documentId`, locator, ≤ 300-char excerpt, status, `checkedAt`, method (`document_retrieval`, `web_search_index`, `owner_entry`, `calculation`, `builder_background`), note |
| Company | id, legal/display names, aliases, former names, country, identifiers/tickers, sector/subsector, lifecycle, links, business model, **observations**, ownership |
| Financial observation | metric, value (**null when not disclosed, never 0**, with `nullReason`), unit (`currency`/`percent`/`ratio`/`count`/…), currency, scale (`one`…`crore`…`trillion`), period (`FY`/`CY`/`H`/`Q`/`YTD`/`LTM`/`point`, end date, months, label), scope (`consolidated`/`standalone`/`segment`/`not_stated`), basis (`reported`/`company_adjusted`/`regulatory`/`operating_kpi`), definition, citations |
| Deal | id, title, aliases, type, buyer type, sector/subsector, acquirer/target/other parties (company refs or sourced names), perimeter, stake (acquired/resulting %), announced date, effective date, status + as-of, **terms**, payment mix, financing, **events**, advisers (with disclosure state), rationale, sector context, comparables, after-deal facts vs interpretation, optional autopsy, research cutoff |
| Deal term | metric (EV, equity value, stake consideration, per-share price, ratio, premium, multiples…), amount, currency, scale unit, **value basis**, ownership %, kind (`announced`/`revised`/`final`/`implied`/`reported_by_media`), as-of, reference convention, status (`reported`/`calculated`/`derived`), citations, note; superseded terms are kept and marked |
| Deal event | type (rumour … completion/termination/withdrawal/subsequent), date + precision, publication date, title, detail, jurisdiction, authority, `statusAfter`, citations |
| Sector | slug, playbook text, subsectors, value chain, metric dictionary (formula, denominator, interpretation, limitations, unit), valuation guidance, M&A motives, diligence questions, regulators, dated changes (`proposal`/`consultation`/`rule`/`approval`/`effective`/`market_event`), players, practice questions, primer |
| Learning | 12 modules, 92 questions (answers or rubrics), 98 glossary terms |
| Brief (archive example) | kind, period, cutoff, method `compiled_archive_example`, ranked items with evidence |
| Training model | fictional inputs, labelled, excluded from research statistics (`data/training/`) |

**Units and periods.** Amounts keep the reported currency and scale (e.g. INR crore, US$ billion). The UI can
show INR in lakh/crore or million/billion grouping (1 crore = 10 million) but never converts currencies: there
is no dated, sourced FX table, and historical terms are not restated at today's rates. `shared/money/units.ts`
provides a tested conversion helper that requires an explicit dated rate and labels assumed FX as assumed.
Percentages are stored as decimals in calculations and shown as % or bps (a change from 10% to 12% is
+200 bps). Ratios and multiples record their denominator period. Mixed-currency totals are never summed.

## D1 tables

All private tables carry `user_id`, and every private query filters by the authenticated owner's ID.

| Group | Tables |
|---|---|
| Meta and sources | `finance_meta` (schema version, brief compile errors), `finance_source_state` (enabled, last attempt/success, status, redacted error, HTTP status, validators, failures, next allowed time, item count, `live_verified_at`), `finance_source_documents` (dedupe key unique, provider ID, canonical URL, publisher, document type, content hash, version), `finance_feed_items` (one per document; event type/date, published date, discovered time, sectors, entities, verification, newly-discovered flag, cluster key) |
| Review and publication | `finance_review_queue` (kind `feed_lead`/`deal_event`/`ai_extraction`, proposal, evidence, origin, status, dedupe key), `finance_published_changes` (sequence, entity, change type `event_append`/`term_revision`/`new_deal`/`company_correction`/`claim_status`, payload, evidence documents + claims, note, review item) |
| Briefs and jobs | `finance_briefs` (scope public/private, user key, kind, date, period, cutoff, generated time, method, content, evidence IDs, input version, version, supersedes, correction note), `finance_jobs` (idempotency key unique), `finance_leases` |
| Owner research | `finance_notes` (+ `finance_note_links`), `finance_watches`, `finance_saved_searches`, `finance_models`, `finance_memory_records`, `finance_memory_cards`, `finance_review_log`, `finance_preferences`, `finance_progress`, `finance_interview_attempts` |
| Safety and usage | `finance_idempotency`, `finance_rate_limits`, `finance_imports`, `finance_ai_usage` (operation, model, status, tokens, estimated cost, price date, subject, evidence version, result, error) |

Relationships are by ID (no foreign-key constraints, so the additive migration cannot interfere with host
tables): notes ↔ entities through `finance_note_links`; memory cards → memory record → deal/concept; review
log → card; published change → review item; feed item → source document; review item evidence → document.

## Migrations

- `0001_finance_init.sql`: 24 tables and 25 indexes, all `CREATE … IF NOT EXISTS`, idempotent.
- `schema.finance.ts`: Drizzle mirror generated from the SQL; `tests/unit/migration.test.ts` checks column
  names/types/nullability/defaults/keys/indexes against the SQL and against drizzle-kit's generated SQL.
- Procedure for the host: `docs/DEPLOYMENT_HANDOFF.md` §4. Future changes must be new additive migrations.

## Export and import

`GET /api/finance/export` returns `{ "format": "manish-finance-export", "version": 1, "exportedAt": …,
"notes", "watches", "savedSearches", "models", "memory" (records, cards and review log), "progress",
"interviewAttempts", "preferences" }` — the owner's records only, never cached. `POST /import/preview` validates a bundle with the
same schema and lists each record as **new**, **duplicate** or **conflict**; `POST /import/commit` applies the
chosen records and never deletes existing ones. Markdown (`/export/notes.md`, per-note `export.md`) and CSV
(`/export/reviews.csv`) exports are convenience formats.
