/**
 * EXAMPLE — the additive change to kmanish.live `server/worker.mjs` (export createApp(assets, tasks, options)).
 *
 * This file is an adapter example written against the host contract recorded in SPEC.md (inspected at
 * source commit 79e35517842ac4750585ade2d8eb34a0199fd8c0). It has NOT been applied to the real host
 * repository. It is exercised end to end by the simulated host in harness/host-worker.mjs, whose
 * FINANCE INTEGRATION blocks are identical to the blocks below.
 *
 * Only the three marked blocks are new. Everything else stands for existing host code and must not change.
 */

// --- FINANCE INTEGRATION (1/2): import the prebuilt module (copy release/server/finance.mjs next to worker.mjs) ---
import { classifyFinanceRequest, createFinance } from "./finance.mjs";
// --- END FINANCE INTEGRATION (1/2) ---

// Existing host helper that reads the trusted Sites dispatch identity. Reuse it; do not add a login system.
import { getUser } from "./auth.mjs"; // ← the host's existing module/path

export function createApp(assets, tasks, options = {}) {
  void tasks; // existing host parameters, unchanged
  void options;
  // --- FINANCE INTEGRATION (2/2a): construct once per isolate ---
  const finance = createFinance({
    getUser: (request) => getUser(request), // trusted identity only; never headers/body/query from the client
    database: (env) => env.DB, // the existing D1 binding
  });
  // --- END FINANCE INTEGRATION (2/2a) ---

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      // ... existing redirects (/atlas → /Atlas, /study → /Study), sign-in/out routes and existing APIs
      //     (/api/planner, /api/excel/*, /api/study*, /api/missions*) stay exactly as they are ...

      // --- FINANCE INTEGRATION (2/2b): finance APIs before the generic /api/ branch; finance pages only ---
      const financeRoute = classifyFinanceRequest(request); // null for every non-finance path
      if (financeRoute?.kind === "api") return finance.fetch(request, env, ctx);
      if (financeRoute) return finance.page(request, assets["finance.html"]?.text ?? null);
      // --- END FINANCE INTEGRATION (2/2b) ---

      // ... existing generic /api/ branch, pages and flat SITE_ASSETS serving continue unchanged ...
      void url;
      return new Response("Not found", { status: 404 });
    },

    // OPTIONAL — only if the hosting platform supports a scheduled handler for this project. Hosting-managed
    // schedules and Cloudflare Cron Triggers are different capabilities; do not assume either is attached.
    // async scheduled(_event, env, ctx) {
    //   ctx.waitUntil(finance.runMaintenance(env, { requestedBy: "scheduler" }));
    // },
  };
}
