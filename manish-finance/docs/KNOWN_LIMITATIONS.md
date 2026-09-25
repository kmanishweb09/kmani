# Known limitations

Specific gaps as of 25 September 2026. Nothing here is hidden in the UI: the app shows the corresponding
"Unverified", "Not configured", "Background schedule not configured", "AI is off" or "Search-corroborated"
states.

## Not verified live

- **No live source connection has succeeded.** The build container's egress policy blocks rbi.org.in,
  sebi.gov.in and data.sec.gov (`403 Host not in allowlist` from the sandbox proxy on 2026-09-25 15:23 UTC;
  `release/reports/live-source-check.json`). The four connectors are tested against fixtures only. Their
  first live test will be from the deployed Worker (Sources → Test connection) or `npm run check:sources:live`
  on a machine with access. RBI and SEBI may also block automated requests from Cloudflare's network; if so,
  the app shows "Access unavailable" and the manual source form is the fallback.
- **SEC EDGAR** stays "Not configured" until `FINANCE_SEC_USER_AGENT` holds an honest application name and a
  real contact address. None was invented.
- **Not tested on kmanish.live.** All integration checks ran in a simulated host (`harness/`) in workerd with
  D1, built from the host contract recorded in `SPEC.md` §2. The integration blocks are an example, not a
  patch applied to the real repository; file names such as the host's `getUser` module must be confirmed.
- **Owner identity field.** The module reads `id`, `sub`, `userId` or `user_id` from the host's user object;
  if the real object differs, pass `userIdOf` to `createFinance`.
- **No scheduler attached.** Background refresh and the 07:30 IST daily brief need a scheduler calling the
  maintenance endpoint; until then, refresh and brief compilation are owner-initiated.
- **Optional AI never called a real model.** The Anthropic adapter is tested against a local fake of the
  Messages API. No key was used. The model ID and price table must be verified and dated when enabling it.

## Research content

- **No archive claim is "source checked".** Publisher pages could not be retrieved, so 967 claims are
  *search-corroborated* (matched to search-engine results citing the source) and 30 are *pending*. Material
  figures were checked against search snippets and consistency (for example a units error in a secondary
  report on MUFG–Shriram is noted), not against retrieved passages. A human re-check of key figures against
  the primary documents is advisable; the app has no UI to upgrade an archive claim's status — edit the
  archive (and cite what was checked) instead.
- **Counterparties without dossiers.** 15 party references point to companies not in the 55 dossiers
  (e.g. Mindtree, Holcim, ACC, Blinkit, Sony Group, Temasek, Taro, Iveco, KKR, Activision Blizzard, VMware,
  Seagen, Pioneer Natural Resources, Adani Group). They show as names without links.
- **Market data is not held.** No live prices, P/B, P/E or ROE for listed banks; the Lab labels those inputs
  as assumptions. No FX table: amounts stay in the reported currency (no conversion is applied).
- **Adviser lists** are marked "not researched" or "partial" for many deals; some deal values carry
  "Basis unclear" because sources did not state EV vs equity vs stake.
- **Manual-only sources.** CCI orders, NSE/BSE disclosures and company IR pages have no automated connector
  (no documented feed, or anti-bot protections); use the manual source form.
- This is a curated archive of 42 deals and 55 companies, not a complete market database.

## Product

- Rate limiting applies to AI requests; other endpoints rely on the host/CDN for abuse protection (writes
  are owner-only and same-origin).
- Private weekly briefs list saved research-question notes as open questions; they do not summarise note
  bodies.
- Collected leads older than one year are pruned by the cleanup job unless referenced by the review queue.
- The review queue supports publish/reject; editing a proposal before publishing is not supported — reject
  and record a manual source instead.

## Checks not performed

- No run against the real host build, its D1 or its deployment size limit (the simulated combined Worker is
  ≈ 717 KB gzip).
- Browsers: Chromium (Playwright) only; Safari and Firefox not tested. Mobile checked by viewport emulation
  (390 px), not on devices.
- Accessibility: axe (WCAG 2.0/2.1 A/AA) on 10 key page states with no serious/critical findings; no manual
  screen-reader pass and no Lighthouse run.
- No load or performance testing beyond bundle-size measurement (initial JS ≈ 129 KB gzip).
