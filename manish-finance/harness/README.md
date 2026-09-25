# Simulated host harness

This directory is **not** the real kmanish.live source. It simulates the host contract described in
the specification (section 2) so the finance module can be exercised end to end in workerd with D1:

- `host-worker.mjs` mimics `server/worker.mjs` → `createApp(assets, tasks, options)` with sentinel
  responses for `/`, `/Atlas*`, `/Study`, `/api/planner`, `/api/excel/*`, `/api/study*`,
  `/api/missions*`, the generic `/api/` branch, redirects and sign-in/out routes.
- The block marked `FINANCE INTEGRATION` is the exact additive change documented in
  `docs/DEPLOYMENT_HANDOFF.md`.
- `dist/` holds sentinel pages; `scripts/build.mjs` copies release assets next to them and embeds
  every supported top-level file into a `SITE_ASSETS` map, like the host build.
- The harness identity (`harness_session` cookie) is a **local development adapter only**. It is not
  part of `release/server/finance.mjs`; production uses the host's trusted `getUser(request)`.

Results from this harness are reported as *simulated-host* checks, not as verification of the live site.
