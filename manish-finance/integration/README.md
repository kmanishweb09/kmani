# Integration files

Adapter example and exact host changes for kmanish.live. Full procedure: `docs/DEPLOYMENT_HANDOFF.md`.

| File | Purpose |
|---|---|
| `worker-integration.example.mjs` | The three additive blocks for `server/worker.mjs` (import, construct, dispatch). Example against the recorded host contract — not applied to the real repository. |
| `homepage-link.snippet.html` | Optional link to `/finance` for the homepage. |
| `../migrations/0001_finance_init.sql` | Additive D1 SQL (finance_* tables only). |
| `../migrations/schema.finance.ts` | The same schema for the host's Drizzle `db/schema.ts`; generate the migration with the host's drizzle-kit workflow. |

These blocks are the ones exercised by `harness/host-worker.mjs` in every Worker test (simulated host, not the live site).
