# Data sources

## Summary of what was actually tested

| Connector | Endpoint | Fixture tests | Live test |
|---|---|---|---|
| SEC EDGAR submissions | `https://data.sec.gov/submissions/CIK{cik}.json` (13 covered CIKs) | Pass (parser, form filtering, User-Agent, per-CIK conditional requests, partial failures) | **Not verified.** 2026-09-25 15:23 UTC from the build container: `403 Host not in allowlist: data.sec.gov` (the sandbox's egress policy, not the SEC). Needs `FINANCE_SEC_USER_AGENT`. |
| RBI press releases (RSS) | `https://rbi.org.in/pressreleases_rss.xml` | Pass (parse, dedupe, versioning, linking, 304, 403, 429, 503, HTML block page, DTD rejection, off-allowlist redirect) | **Not verified.** Same run: `403 Host not in allowlist: rbi.org.in` (sandbox policy). |
| RBI notifications (RSS) | `https://rbi.org.in/notifications_rss.xml` | Pass (shared RSS path) | **Not verified.** Same run: blocked by sandbox policy. |
| SEBI updates (RSS) | `https://www.sebi.gov.in/sebirss.xml` | Pass (shared RSS path) | **Not verified.** Same run: `403 Host not in allowlist: www.sebi.gov.in`. |

The endpoint URLs come from the publishers' own documentation/RSS directory pages. A parser passing fixture
tests is not evidence that a live feed works. Each source shows **Unverified** in the app until the deployed
Worker records a successful fetch (`live_verified_at`), and `npm run check:sources:live` repeats the check from
any machine with network access (`release/reports/live-source-check.json` holds the build-container result).
Fixtures in `tests/fixtures/sources/` are authored to the documented formats and labelled as such.

## Source registry

Defined in `server/sources/registry.ts` (reviewed code). Runtime state lives in `finance_source_state`.

| ID | Publisher | Access | Refresh | Rights / access notes |
|---|---|---|---|---|
| `sec-edgar-submissions` | U.S. SEC | API (JSON) | 6 h, stale after 36 h | Public data, no key, server-side only (no CORS). Declared User-Agent with a real contact; requests spaced 250 ms; filings are metadata leads until read. |
| `rbi-press-releases` | Reserve Bank of India | RSS | 6 h, stale after 48 h | Link to originals; store title, date, short summary only. Blocks are shown, never bypassed. |
| `rbi-notifications` | Reserve Bank of India | RSS | 6 h, stale after 48 h | Distinguish draft directions from final rules. |
| `sebi-rss` | SEBI | RSS | 6 h, stale after 48 h | Consultation papers are proposals, not rules. |
| `cci-combinations` | Competition Commission of India | Manual | — | No documented machine-readable feed found; use manual links. An approval does not prove completion. |
| `nse-bse-disclosures` | NSE / BSE | Manual | — | Exchange sites use anti-bot protection and undocumented endpoints; not automated. |
| `company-ir` | Issuers | Manual | — | Press releases and reports; short excerpts only. |
| `owner-manual` | Recorded by the owner | Manual | — | Links and ≤ 300-character excerpts; the server stores, never fetches. |
| `damodaran-reference` | NYU Stern | Link only | — | Methodology reference, not a transaction dataset. |

## Collection pipeline (`server/sources/collect.ts`)

1. **Fetch** through the fetch guard: HTTPS only, no credentials in URLs, port 443 only, no IP literals
   (dotted/decimal/hex/octal/IPv6), no localhost or internal names, exact-host allowlist per source,
   every redirect hop re-checked (max 3), 2–4 MB response cap, 12–20 s timeout, ETag/Last-Modified.
2. **Parse** with bounded parsers: XML with DOCTYPE/ENTITY rejected before parsing and entity processing
   off; ≤ 200 items; plain text only (markup and control characters stripped). SEC: forms of interest only;
   8-K kept only for items 1.01, 2.01 and 5.01; at most 10 recent 6-Ks per company.
3. **Deduplicate** by provider ID, canonical URL (tracking parameters removed) across sources, and content
   fingerprint. A changed item with the same provider ID becomes a new version of one document.
4. **Link** entities by whole-word aliases (the longer alias wins); ambiguous aliases and deals inferred
   from party co-mentions are marked `ambiguous`.
5. **Store** a source document and a feed item (verification `lead` or `linked`). Items published more than
   seven days before discovery are labelled **newly discovered**, not newly announced.
6. **Queue** deal-linked items for owner review. Nothing collected edits a deal record automatically.
7. **Publish** only from the review queue: the owner's decision appends an event with a `human_reviewed`
   claim ("reviewed by the site owner") and the stored document as evidence. Terms and status change only
   through an owner's manual proposal that states them.

Failures keep the last good data: 401/403/451 → *Access unavailable*, 429 or 503 with `Retry-After` →
*Rate limited*, other errors → *Failed*; backoff 30 min doubling to 24 h; leases prevent concurrent runs.
Stored error messages are redacted (configured secrets and bearer tokens removed); public views show a
summary only.

## Provenance and verification statuses

Every displayed fact is a **claim** (`ev-…`) pointing to one **source document** with a locator and, where
permitted, a ≤ 300-character excerpt.

| Status | Meaning | Count in the shipped archive |
|---|---|---|
| Source checked | Matched against the text of a retrieved document | 0 |
| Search-corroborated | Matched to search-engine results that cite the source; the document itself was not retrieved by the build environment | 967 |
| Pending | Recorded but not yet matched to retrieved evidence (a lead) | 30 |
| Conflict | Sources disagree; both are kept with the active interpretation | 0 |
| Human reviewed | Reviewed by the site owner in the app (set only by an owner action) | 0 |

No reviewer names, approval dates or endorsements are generated. The build environment's network policy
blocked publisher sites, so no archive claim is marked "source checked"; each document records that it was
not retrieved and why.

## Brief ranking (deterministic, `server/briefCompiler.ts`, `rank-v1`)

| Signal | Weight |
|---|---|
| On the owner's watchlist (private briefs) | +4 |
| In a followed sector (private) or the desk focus sector FIG (public) | +3 |
| Linked to a covered deal (exact match) | +3 |
| Mentions a covered company (exact match) | +1 |
| Only name-matched (ambiguous) entities | −1 |
| Curated archive research / primary-source feed item | +2 |
| Event type: completion, termination, withdrawal, approvals, decisions, open/tender offers, merger documents, revised terms | +3 |
| Event type: announcements, deal news, material agreements, proposed and issued rules, shareholder/court steps | +2 |
| Event type: enforcement, monetary policy, ownership filings, other filings/subsequent events | +1 or 0 |
| Dated within one day / three days | +2 / +1 |
| Old document newly discovered | −2 |

Each brief item shows the reasons behind its score ("Appears because…"), what changed (fact), why it may
matter (analysis) and the uncertainty. Repeated coverage of the same event is merged into one item with
several sources. No opaque relevance percentage is shown.

## Coverage limits

This is a curated research archive, not a licensed replacement for Bloomberg, Capital IQ or PitchBook.
It holds 42 transactions and 55 companies chosen for an India/FIG-focused learner; it does not claim complete
deal values, adviser lists, private-company EBITDA, current market multiples or every transaction. Current
market data (prices, live P/B) is not held; the Lab labels those inputs as assumptions.
