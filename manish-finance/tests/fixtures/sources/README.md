# Source fixtures

These files are **authored to the published formats** (RSS 2.0 / Atom 1.0 and the SEC EDGAR
`data.sec.gov/submissions/CIK##########.json` layout). They were **not captured from the live
endpoints**: the build environment's egress policy blocks rbi.org.in, sebi.gov.in and data.sec.gov.
Titles are fictional test strings prefixed with "Test fixture"; accession numbers are synthetic.

Tests that use them are **fixture tests**. They show that the parsers, deduplication, linking and
review flow behave as designed on inputs of the documented shape. They are not evidence that any
particular live source works — that is recorded only by a successful fetch from the deployed Worker
(`live_verified_at` in `finance_source_state`) or by `npm run check:sources:live` where egress allows.
