#!/usr/bin/env node
/**
 * Serves the built release through the simulated host with a fresh in-memory D1 (used by Playwright).
 * Requires a prior `node scripts/build.mjs`. Environment:
 *   PORT (default 8790)
 *   FINANCE_E2E_FIXTURE_SOURCES=1 — upstream fetches are answered by local fixtures so a source failure can be
 *     simulated deterministically: the RBI press-release feed returns a fixture feed once, then HTTP 503;
 *     every other upstream host returns HTTP 403. Nothing reaches the network in this mode.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "./lib/miniflare-host.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8790);
const fixtures = process.env.FINANCE_E2E_FIXTURE_SOURCES === "1";
let rbiCalls = 0;
const day = (n) => new Date(Date.now() - n * 86_400_000).toUTCString();
const FEED = `<?xml version="1.0"?><!-- TEST FIXTURE: not a real RBI feed --><rss version="2.0"><channel><title>Fixture</title>
<item><title>Test fixture: Scheme of amalgamation of HDFC Ltd with HDFC Bank – status note</title><link>https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=990001</link><guid>e2e-1</guid><pubDate>${day(1)}</pubDate></item>
<item><title>Test fixture: Draft directions on acquisition finance – comments invited</title><link>https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=990002</link><guid>e2e-2</guid><pubDate>${day(1)}</pubDate></item>
</channel></rss>`;

const outboundService = fixtures
  ? (req) => {
      if (req.url === "https://rbi.org.in/pressreleases_rss.xml") {
        rbiCalls += 1;
        return rbiCalls === 1 ? new Response(FEED, { headers: { "content-type": "application/rss+xml" } }) : new Response("Service unavailable (fixture)", { status: 503 });
      }
      return new Response("Forbidden (fixture)", { status: 403 });
    }
  : undefined;

// With fixtures, the Worker is told so: a fixture response must never count as live verification.
const host = await startHost({ root: ROOT, port: PORT, bindings: { FINANCE_PUBLIC_ORIGIN: `http://localhost:${PORT}`, ...(fixtures ? { FINANCE_UPSTREAM_FIXTURES: "1" } : {}) }, ...(outboundService ? { outboundService } : {}) });
console.log(`Finance Desk release (simulated host, in-memory D1${fixtures ? ", fixture sources" : ""}) → http://localhost:${PORT}/finance`);
const stop = async () => {
  await host.mf.dispose();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
