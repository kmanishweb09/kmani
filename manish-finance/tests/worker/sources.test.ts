import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, idem, startTestHost, type TestHost } from "./helpers";

/**
 * Connector, review-queue and brief tests against FIXTURE upstream responses served by Miniflare's
 * outbound interceptor. These prove behaviour on inputs of the documented shape; they are not live
 * source tests (see tests/fixtures/sources/README.md).
 */

type Handler = (req: Request) => Response | Promise<Response>;
const routes = new Map<string, Handler>();
const calls: Array<{ url: string; ua: string | null; inm: string | null }> = [];
const SECRET_KEY = "sk-ant-test-SECRET-VALUE-0123456789";

let h: TestHost;
beforeAll(async () => {
  h = await startTestHost({
    bindings: { FINANCE_SEC_USER_AGENT: "FinanceDeskTest ops@example.com", FINANCE_AI_API_KEY: SECRET_KEY },
    outbound: async (req) => {
      calls.push({ url: req.url, ua: req.headers.get("user-agent"), inm: req.headers.get("if-none-match") });
      const handler = routes.get(req.url) ?? (req.url.startsWith("https://data.sec.gov/") ? routes.get("sec:*") : undefined);
      return handler ? handler(req) : new Response("no fixture route", { status: 599 });
    },
  });
});
afterAll(async () => {
  await h?.mf.dispose();
});

const rfc822 = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toUTCString();
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

function rss(items: Array<{ title: string; link: string; guid?: string; days?: number; desc?: string }>): string {
  return `<?xml version="1.0"?><!-- TEST FIXTURE --><rss version="2.0"><channel><title>Fixture</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.guid ? `<guid>${i.guid}</guid>` : ""}<pubDate>${rfc822(i.days ?? 1)}</pubDate>${i.desc ? `<description>${i.desc}</description>` : ""}</item>`)
    .join("")}</channel></rss>`;
}

const RBI = "https://rbi.org.in/pressreleases_rss.xml";
const RBI_N = "https://rbi.org.in/notifications_rss.xml";
const SEBI = "https://www.sebi.gov.in/sebirss.xml";

const PRESS = rss([
  { title: "Test fixture: Scheme of amalgamation of HDFC Ltd with HDFC Bank – status note", link: "https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=900001&amp;utm_source=rss", guid: "fx-1", desc: "Fixture summary." },
  { title: "Test fixture: Draft directions on acquisition finance – comments invited", link: "https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=900002", guid: "fx-2" },
  { title: "Test fixture: Monetary penalty imposed on a co-operative bank", link: "https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=900003", guid: "fx-3", days: 30 },
]);

type Outcome = { status: string; inserted: number; updated: number; duplicates: number; reviewItems: number; httpStatus: number | null; message: string | null };
const test = (id: string) => api<{ outcome: Outcome; source: { health: string; error: string | null } }>(h, `/api/finance/admin/sources/${id}/test`, { method: "POST", as: "owner", body: {}, idem: idem() });

describe("RSS connector (fixture responses)", () => {
  it("stores items as leads, links entities and queues deal-linked items for review", async () => {
    routes.set(RBI, () => new Response(PRESS, { headers: { "content-type": "application/rss+xml", etag: '"v1"' } }));
    const r = await test("rbi-press-releases");
    expect(r.json.outcome).toMatchObject({ status: "working", inserted: 3, duplicates: 0, reviewItems: 1 });
    expect(r.json.source.health).toBe("working");
    expect(calls.find((c) => c.url === RBI)?.ua).toMatch(/^FinanceDesk\//);

    const feed = await api<{ items: Array<{ title: string; url: string; eventType: string; verification: string; newlyDiscovered: boolean; entities: Array<{ type: string; id: string; confidence: string }> }> }>(h, "/api/finance/feed?days=7");
    const amalg = feed.json.items.find((i) => i.title.includes("amalgamation"));
    expect(amalg?.url).toBe("https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=900001");
    expect(amalg?.verification).toBe("linked");
    expect(amalg?.entities).toEqual(expect.arrayContaining([expect.objectContaining({ type: "deal", id: "hdfc-hdfc-bank-merger", confidence: "ambiguous" }), expect.objectContaining({ type: "company", id: "hdfc-bank", confidence: "exact_alias" })]));
    expect(feed.json.items.find((i) => i.title.includes("Draft"))?.eventType).toBe("proposed_rule");
    // Published 30 days ago, discovered today → newly discovered, not newly announced.
    expect(feed.json.items.find((i) => i.title.includes("penalty"))?.newlyDiscovered).toBe(true);
  });

  it("uses conditional requests and deduplicates repeats", async () => {
    routes.set(RBI, (req) => (req.headers.get("if-none-match") === '"v1"' ? new Response(null, { status: 304 }) : new Response(PRESS)));
    const r = await test("rbi-press-releases");
    expect(r.json.outcome).toMatchObject({ status: "not_modified", inserted: 0 });
    expect(calls.filter((c) => c.url === RBI).at(-1)?.inm).toBe('"v1"');
    routes.set(RBI, () => new Response(PRESS));
    const again = await test("rbi-press-releases");
    expect(again.json.outcome).toMatchObject({ status: "working", inserted: 0, duplicates: 3 });
  });

  it("versions a changed item instead of duplicating it", async () => {
    routes.set(RBI, () => new Response(PRESS.replace("status note", "status note (revised)")));
    const r = await test("rbi-press-releases");
    expect(r.json.outcome).toMatchObject({ inserted: 0, updated: 1 });
    const row = await h.db.prepare("SELECT version, title FROM finance_source_documents WHERE provider_item_id = 'fx-1'").first<{ version: number; title: string }>();
    expect(row).toMatchObject({ version: 2, title: expect.stringContaining("revised") });
  });

  it("deduplicates the same canonical URL across sources", async () => {
    routes.set(RBI_N, () => new Response(rss([{ title: "Test fixture: same document via another feed", link: "https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=900002&amp;utm_medium=x", guid: "other-guid" }])));
    const r = await test("rbi-notifications");
    expect(r.json.outcome).toMatchObject({ status: "working", inserted: 0, duplicates: 1 });
  });
});

describe("connector failures are visible and keep cached data", () => {
  it("403 → access unavailable with backoff; public diagnostics are summarised", async () => {
    routes.set(SEBI, () => new Response("Forbidden", { status: 403 }));
    const r = await test("sebi-rss");
    expect(r.json.outcome).toMatchObject({ status: "access_unavailable", httpStatus: 403 });
    const state = await h.db.prepare("SELECT next_allowed_at, consecutive_failures FROM finance_source_state WHERE source_id = 'sebi-rss'").first<{ next_allowed_at: string; consecutive_failures: number }>();
    expect(Date.parse(state?.next_allowed_at ?? "")).toBeGreaterThan(Date.now());
    const pub = await api<{ items: Array<{ id: string; health: string; error: string | null }> }>(h, "/api/finance/sources");
    const s = pub.json.items.find((x) => x.id === "sebi-rss");
    expect(s?.health).toBe("access_unavailable");
    expect(s?.error).not.toMatch(/HTTP 403/);
    // A scheduled run respects the backoff and does not contact the source again.
    const before = calls.filter((c) => c.url === SEBI).length;
    await api(h, "/api/finance/admin/jobs/run", { method: "POST", noCsrf: true, headers: { Authorization: `Bearer ${h.jobSecret}` }, body: { jobs: ["refresh_sources"] } });
    expect(calls.filter((c) => c.url === SEBI).length).toBe(before);
    // Cached items from other sources are still served.
    expect((await api<{ total: number }>(h, "/api/finance/feed?days=7")).json.total).toBeGreaterThan(0);
  });

  it("429 with Retry-After → rate limited", async () => {
    routes.set(RBI_N, () => new Response("slow down", { status: 429, headers: { "retry-after": "7200" } }));
    const r = await test("rbi-notifications");
    expect(r.json.outcome.status).toBe("rate_limited");
    const state = await h.db.prepare("SELECT next_allowed_at FROM finance_source_state WHERE source_id = 'rbi-notifications'").first<{ next_allowed_at: string }>();
    expect(Date.parse(state?.next_allowed_at ?? "") - Date.now()).toBeGreaterThan(6_000_000);
  });

  it("a redirect off the allowlist is refused and never followed", async () => {
    routes.set(SEBI, () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    const r = await test("sebi-rss");
    expect(r.json.outcome.status).toBe("access_unavailable");
    expect(calls.some((c) => c.url.startsWith("https://evil.example"))).toBe(false);
  });

  it("an HTML block page is reported as access unavailable, not parsed", async () => {
    routes.set(SEBI, () => new Response("<html><body>Please verify you are human</body></html>", { headers: { "content-type": "text/html" } }));
    expect((await test("sebi-rss")).json.outcome.status).toBe("access_unavailable");
  });

  it("a feed with a DTD is rejected", async () => {
    routes.set(SEBI, () => new Response(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&e;</title></item></channel></rss>`));
    const r = await test("sebi-rss");
    expect(r.json.outcome.status).toBe("failed");
    expect(r.json.outcome.message).toMatch(/DTD_NOT_ALLOWED/);
  });

  it("a held lease makes a concurrent run back off", async () => {
    await h.db.prepare("INSERT INTO finance_leases (name, holder, expires_at) VALUES ('source:rbi-press-releases', 'other', ?) ON CONFLICT(name) DO UPDATE SET holder = 'other', expires_at = excluded.expires_at").bind(new Date(Date.now() + 60_000).toISOString()).run();
    expect((await test("rbi-press-releases")).json.outcome.status).toBe("busy");
    await h.db.prepare("DELETE FROM finance_leases WHERE name = 'source:rbi-press-releases'").run();
  });
});

describe("SEC EDGAR connector (fixture responses)", () => {
  it("sends the configured User-Agent, keeps M&A-relevant forms and links the company", async () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/sources/sec-submissions.fixture.json", "utf8"));
    const dates = [iso(2), iso(3), iso(5), iso(20), iso(120), iso(4)];
    fixture.filings.recent.filingDate = dates;
    routes.set("https://data.sec.gov/submissions/CIK0000789019.json", () => new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } }));
    routes.set("sec:*", (req) => {
      const cik = /CIK(\d{10})/.exec(req.url)?.[1] ?? "0";
      return new Response(JSON.stringify({ cik: cik.replace(/^0+/, ""), name: "FIXTURE", filings: { recent: { accessionNumber: [], filingDate: [], form: [] } } }));
    });
    const r = await test("sec-edgar-submissions");
    expect(r.json.outcome.status).toBe("working");
    // 8-K item 2.01 (kept), 8-K item 2.02 (dropped), 425 and S-4 (kept); the 120-day-old 8-K is outside the window.
    expect(r.json.outcome.inserted).toBe(3);
    const secCalls = calls.filter((c) => c.url.startsWith("https://data.sec.gov/"));
    expect(secCalls.length).toBeGreaterThanOrEqual(13);
    expect(new Set(secCalls.map((c) => c.ua))).toEqual(new Set(["FinanceDeskTest ops@example.com"]));
    const feed = await api<{ items: Array<{ title: string; eventType: string; eventDate: string; entities: Array<{ id: string }> }> }>(h, "/api/finance/feed?days=7");
    const merger = feed.json.items.find((i) => i.title.includes("Form 425"));
    expect(merger).toMatchObject({ eventType: "merger_document", eventDate: dates[2] });
    expect(merger?.entities.map((e) => e.id)).toContain("microsoft");
  });

  it("is not configured without FINANCE_SEC_USER_AGENT and makes no request", async () => {
    const h2 = await startTestHost({ outbound: () => new Response("should not be called", { status: 599 }) });
    try {
      const r = await api<{ outcome: Outcome }>(h2, "/api/finance/admin/sources/sec-edgar-submissions/test", { method: "POST", as: "owner", body: {}, idem: idem() });
      expect(r.json.outcome.status).toBe("not_configured");
      const s = await api<{ items: Array<{ id: string; health: string; endpointVerification: { status: string } }> }>(h2, "/api/finance/sources");
      expect(s.json.items.find((x) => x.id === "sec-edgar-submissions")).toMatchObject({ health: "not_configured", endpointVerification: { status: "unverified" } });
    } finally {
      await h2.mf.dispose();
    }
  });
});

describe("review queue: the only path from collected material to published research", () => {
  it("publishing a feed lead appends an owner-reviewed event without touching terms or status", async () => {
    const before = await api<{ status: string; events: unknown[]; terms: unknown[] }>(h, "/api/finance/deals/hdfc-hdfc-bank-merger");
    const q = await api<{ items: Array<{ id: string; kind: string; subjectId: string }> }>(h, "/api/finance/admin/review?status=pending", { as: "owner" });
    const item = q.json.items.find((i) => i.kind === "feed_lead" && i.subjectId === "hdfc-hdfc-bank-merger");
    expect(item).toBeTruthy();
    const key = idem("pub");
    const pub = await api(h, `/api/finance/admin/review/${item?.id}/decision`, { method: "POST", as: "owner", body: { decision: "publish", note: "Read the release" }, idem: key });
    expect(pub.status).toBe(200);
    const replay = await api(h, `/api/finance/admin/review/${item?.id}/decision`, { method: "POST", as: "owner", body: { decision: "publish", note: "Read the release" }, idem: key });
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    const again = await api(h, `/api/finance/admin/review/${item?.id}/decision`, { method: "POST", as: "owner", body: { decision: "reject" }, idem: idem() });
    expect(again.status).toBe(409);

    const after = await api<{ status: string; events: Array<{ id: string; origin: string; ev: string[]; type: string }>; terms: unknown[] }>(h, "/api/finance/deals/hdfc-hdfc-bank-merger");
    expect(after.json.status).toBe(before.json.status);
    expect(after.json.terms).toEqual(before.json.terms);
    const added = after.json.events.find((e) => e.origin === "published_update");
    expect(added?.type).toBe("subsequent");
    const ev = await api<{ status: string; method: string; note: string; document: { url: string } }>(h, `/api/finance/evidence/${added?.ev[0]}`);
    expect(ev.json).toMatchObject({ status: "human_reviewed", method: "owner_entry" });
    expect(ev.json.note).toMatch(/site owner/);
    expect(ev.json.document.url).toContain("prid=900001");
  });

  it("manual source: validates the link, never fetches it, and queues a proposal", async () => {
    const bad = await api(h, "/api/finance/admin/manual-source", { method: "POST", as: "owner", body: { url: "https://10.0.0.5/order.pdf", publisher: "CCI", title: "Order", eventType: "regulatory_approval" }, idem: idem() });
    expect(bad.status).toBe(400);
    const n = calls.length;
    const ok = await api<{ documentId: string; reviewItemId: string }>(h, "/api/finance/admin/manual-source", {
      method: "POST",
      as: "owner",
      body: { url: "https://www.cci.gov.in/combination/order/details/test-fixture", publisher: "Competition Commission of India", title: "Test fixture: combination approval", publishedDate: iso(1), eventDate: iso(1), excerpt: "Fixture excerpt.", dealId: "hdfc-hdfc-bank-merger", eventType: "regulatory_approval", statusAfter: null },
      idem: idem(),
    });
    expect(ok.status).toBe(201);
    expect(calls.length).toBe(n);
    const rej = await api(h, `/api/finance/admin/review/${ok.json.reviewItemId}/decision`, { method: "POST", as: "owner", body: { decision: "reject" }, idem: idem() });
    expect(rej.json).toMatchObject({ status: "rejected" });
    const hist = await api<{ items: Array<{ id: string; status: string }> }>(h, "/api/finance/admin/review?status=rejected", { as: "owner" });
    expect(hist.json.items.map((i) => i.id)).toContain(ok.json.reviewItemId);
  });

  it("company corrections need evidence and keep the previous value", async () => {
    const bad = await api(h, "/api/finance/admin/corrections", { method: "POST", as: "owner", body: { companyId: "hdfc-bank", field: "website", next: "javascript:alert(1)", note: "fix", evidence: { url: "https://www.hdfcbank.com/", publisher: "HDFC Bank", title: "Home" } }, idem: idem() });
    expect(bad.status).toBe(400);
    const ok = await api(h, "/api/finance/admin/corrections", { method: "POST", as: "owner", body: { companyId: "hdfc-bank", field: "subsector", next: "Banks – private sector (test)", note: "Test correction", evidence: { url: "https://www.hdfcbank.com/", publisher: "HDFC Bank", title: "Home page" } }, idem: idem() });
    expect(ok.status).toBe(201);
    const co = await api<{ subsector: string; corrections: Array<{ field: string; previous: unknown; next: unknown }> }>(h, "/api/finance/companies/hdfc-bank");
    expect(co.json.subsector).toBe("Banks – private sector (test)");
    expect(co.json.corrections?.[0]).toMatchObject({ field: "subsector", next: "Banks – private sector (test)" });
    expect(co.json.corrections?.[0]?.previous).toBeTruthy();
  });
});

describe("compiled briefs", () => {
  it("compiles a public brief with ranked, cited items and explains why each appears", async () => {
    const r = await api<{ brief: { id: string; created: boolean } }>(h, "/api/finance/briefs/compile", { method: "POST", as: "owner", body: { kind: "daily", scope: "public" }, idem: idem() });
    expect(r.status).toBe(201);
    const b = await api<{ method: string; label: string; items: Array<{ rank: number; whyThisAppears: string; ev: string[]; uncertainty: string }>; evidence: Record<string, { status: string }>; sectorImplication: { label: string } | null; question: { text: string } | null }>(h, `/api/finance/briefs/${r.json.brief.id}`);
    expect(b.json.method).toBe("compiled");
    expect(b.json.label).toMatch(/no AI/);
    expect(b.json.items.length).toBeGreaterThanOrEqual(1);
    expect(b.json.items.length).toBeLessThanOrEqual(5);
    for (const i of b.json.items) {
      expect(i.whyThisAppears).toMatch(/^Appears because/);
      expect(i.ev.length).toBeGreaterThan(0);
      for (const id of i.ev) expect(b.json.evidence[id]).toBeTruthy();
    }
    const lead = Object.values(b.json.evidence).find((e) => e.status === "pending");
    expect(lead).toBeTruthy();
    expect(b.json.sectorImplication?.label).toBe("Analysis");
    expect(b.json.question?.text).toBeTruthy();
    // Same inputs → same brief, not a new version.
    const again = await api<{ brief: { id: string; created: boolean } }>(h, "/api/finance/briefs/compile", { method: "POST", as: "owner", body: { kind: "daily", scope: "public" }, idem: idem() });
    expect(again.json.brief).toMatchObject({ id: r.json.brief.id, created: false });
    const today = await api<{ brief: { id: string } | null }>(h, "/api/finance/briefs/today");
    expect(today.json.brief?.id).toBe(r.json.brief.id);
  });

  it("private briefs are visible only to the owner", async () => {
    const r = await api<{ brief: { id: string } }>(h, "/api/finance/briefs/compile", { method: "POST", as: "owner", body: { kind: "daily", scope: "private" }, idem: idem() });
    expect(r.json.brief.id).toMatch(/^p_/);
    expect((await api(h, `/api/finance/briefs/${r.json.brief.id}`)).status).toBe(401);
    expect((await api(h, `/api/finance/briefs/${r.json.brief.id}`, { as: "visitor" })).status).toBe(403);
    expect((await api(h, `/api/finance/briefs/${r.json.brief.id}`, { as: "owner" })).status).toBe(200);
    const pub = await api<{ items: Array<{ id: string }> }>(h, "/api/finance/briefs");
    expect(pub.json.items.some((i) => i.id === r.json.brief.id)).toBe(false);
  });
});

describe("maintenance runner", () => {
  it("replays a repeated scheduler call with the same Idempotency-Key", async () => {
    const headers = { Authorization: `Bearer ${h.jobSecret}`, "Idempotency-Key": "sched-2026-09-25T01" };
    const a = await api<{ jobs: Array<{ jobId: string; replayed?: boolean }> }>(h, "/api/finance/admin/jobs/run", { method: "POST", noCsrf: true, headers, body: { jobs: ["cleanup"] } });
    const b = await api<{ jobs: Array<{ jobId: string; replayed?: boolean }> }>(h, "/api/finance/admin/jobs/run", { method: "POST", noCsrf: true, headers, body: { jobs: ["cleanup"] } });
    expect(b.json.jobs[0]).toMatchObject({ jobId: a.json.jobs[0]?.jobId, replayed: true });
    const unknown = await api(h, "/api/finance/admin/jobs/run", { method: "POST", noCsrf: true, headers: { Authorization: `Bearer ${h.jobSecret}` }, body: { jobs: ["drop_tables"] } });
    expect(unknown.status).toBe(400);
  });
  it("scheduler runs are recorded, so the UI can say a schedule is observed", async () => {
    const s = await api<{ capabilities: { maintenance: { scheduler: string } } }>(h, "/api/finance/status");
    expect(s.json.capabilities.maintenance.scheduler).toBe("observed");
  });
  it("owner refresh presses within two minutes share one run", async () => {
    const a = await api<{ jobs: Array<{ jobId: string }> }>(h, "/api/finance/admin/refresh", { method: "POST", as: "owner", body: {}, idem: idem() });
    const b = await api<{ jobs: Array<{ jobId: string; replayed?: boolean }> }>(h, "/api/finance/admin/refresh", { method: "POST", as: "owner", body: {}, idem: idem() });
    expect(b.json.jobs[0]).toMatchObject({ jobId: a.json.jobs[0]?.jobId, replayed: true });
  });
  it("no secret appears in public or owner diagnostics", async () => {
    for (const path of ["/api/finance/status", "/api/finance/sources", "/api/finance/admin/sources"]) {
      const r = await api(h, path, { as: "owner" });
      expect(r.text).not.toContain(SECRET_KEY);
      expect(r.text).not.toContain(h.jobSecret);
    }
  });
});
