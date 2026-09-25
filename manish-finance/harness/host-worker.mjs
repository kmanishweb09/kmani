/**
 * Simulated kmanish.live `server/worker.mjs` for local integration tests (see harness/README.md).
 * Everything outside the FINANCE INTEGRATION block stands in for existing host behaviour.
 */
// --- FINANCE INTEGRATION (1/2): import the prebuilt module ---
import { classifyFinanceRequest, createFinance } from "../release/server/finance.mjs";
// --- END FINANCE INTEGRATION (1/2) ---

const HARNESS_USERS = {
  owner: { id: "dev-owner", name: "Local owner (dev identity)" },
  visitor: { id: "dev-visitor", name: "Local signed-in visitor (dev identity)" },
};

/** Stand-in for the host's trusted getUser(request). Local development adapter only. */
function getUser(request) {
  const cookie = request.headers.get("Cookie") ?? "";
  const m = /(?:^|;\s*)harness_session=([a-z]+)/.exec(cookie);
  return m ? (HARNESS_USERS[m[1]] ?? null) : null;
}

function safeLocalPath(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
}

function assetResponse(asset, request) {
  const body = asset.text !== undefined ? asset.text : Uint8Array.from(atob(asset.base64), (ch) => ch.charCodeAt(0));
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: { "Content-Type": asset.type, "Cache-Control": "public, max-age=300" } });
}

export function createApp(assets, tasks, options = {}) {
  void tasks;
  void options;
  // --- FINANCE INTEGRATION (2/2a): construct once per isolate ---
  const finance = createFinance({ getUser: (request) => getUser(request), database: (env) => env.DB });
  // --- END FINANCE INTEGRATION (2/2a) ---

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const p = url.pathname;

      // Existing redirect rules (sentinels).
      if (p === "/atlas") return Response.redirect(new URL(`/Atlas${url.search}`, url).toString(), 301);
      if (p === "/study") return Response.redirect(new URL(`/Study${url.search}`, url).toString(), 301);

      // Existing session entry points (harness implementation of the host's sign-in).
      if (p === "/signin-with-chatgpt") {
        const as = url.searchParams.get("as");
        const returnTo = safeLocalPath(url.searchParams.get("return_to"));
        if (as === "owner" || as === "visitor") {
          return new Response(null, { status: 302, headers: { Location: returnTo, "Set-Cookie": `harness_session=${as}; Path=/; HttpOnly; SameSite=Lax` } });
        }
        const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
        const link = (who) => `/signin-with-chatgpt?as=${who}&return_to=${encodeURIComponent(returnTo)}`;
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>Local sign-in</title><body style="font-family:system-ui;padding:2rem"><h1>Local harness sign-in</h1><p>Development identity only; production uses the host's ChatGPT sign-in.</p><p><a id="as-owner" href="${esc(link("owner"))}">Continue as owner (dev-owner)</a></p><p><a id="as-visitor" href="${esc(link("visitor"))}">Continue as non-owner (dev-visitor)</a></p></body>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      if (p === "/signout-with-chatgpt") {
        return new Response(null, { status: 302, headers: { Location: safeLocalPath(url.searchParams.get("return_to")), "Set-Cookie": "harness_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" } });
      }

      // Existing APIs (sentinels).
      if (p === "/api/planner") return json({ sentinel: "planner", user: getUser(request)?.id ?? null });
      if (p.startsWith("/api/excel/")) return json({ sentinel: "excel", path: p });
      if (p.startsWith("/api/study")) return json({ sentinel: "study", path: p });
      if (p.startsWith("/api/missions")) return json({ sentinel: "missions", path: p });

      // --- FINANCE INTEGRATION (2/2b): finance APIs before the generic /api/ branch; finance pages only ---
      const financeRoute = classifyFinanceRequest(request);
      if (financeRoute?.kind === "api") return finance.fetch(request, env, ctx);
      if (financeRoute) return finance.page(request, assets["finance.html"]?.text ?? null);
      // --- END FINANCE INTEGRATION (2/2b) ---

      // Existing generic API branch.
      if (p.startsWith("/api/")) return json({ error: "Not found" }, 404);

      // Existing pages.
      const pages = { "/": "index.html", "/Atlas": "atlas.html", "/Atlas/scores": "atlas.html", "/Atlas/planning": "atlas.html", "/Atlas/excel": "atlas.html", "/Atlas/analysis": "atlas.html", "/Atlas/today": "atlas.html", "/Study": "study.html" };
      if (pages[p] && assets[pages[p]]) return assetResponse(assets[pages[p]], request);

      // Existing flat asset serving from SITE_ASSETS.
      const name = p.slice(1);
      if (name && !name.includes("/") && assets[name]) return assetResponse(assets[name], request);
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    },
  };
}
