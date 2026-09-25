import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { backoffMs, classifyHttp, parseRetryAfter, redact } from "../../server/sources/collect";
import { canonicalizeUrl, checkPublicLink, checkUrl, FetchGuardError, guardedFetch } from "../../server/sources/fetchGuard";
import { classifyHeadline, clusterKey, dealEventTypeFor, linkEntities } from "../../server/sources/link";
import { FeedParseError, parseFeed, plainText } from "../../server/sources/rss";
import { parseSubmissions, secEventType } from "../../server/sources/sec";

// Fixture tests: inputs are authored to the documented formats (see tests/fixtures/sources/README.md).
const RSS = readFileSync("tests/fixtures/sources/rbi-press-releases.fixture.xml", "utf8");
const SEC = readFileSync("tests/fixtures/sources/sec-submissions.fixture.json", "utf8");

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof FetchGuardError || e instanceof FeedParseError ? e.code : String(e);
  }
  return "OK";
};

describe("fetch guard: URL checks", () => {
  const allow = ["data.sec.gov", "rbi.org.in"];
  it("accepts https URLs on the allowlist", () => {
    expect(checkUrl("https://data.sec.gov/submissions/CIK0000789019.json", allow).hostname).toBe("data.sec.gov");
    expect(checkUrl("https://RBI.org.in./x", allow).hostname).toBe("rbi.org.in");
  });
  it.each([
    ["http://data.sec.gov/x", "SCHEME_NOT_ALLOWED"],
    ["file:///etc/passwd", "SCHEME_NOT_ALLOWED"],
    ["ftp://data.sec.gov/x", "SCHEME_NOT_ALLOWED"],
    ["https://user:pw@data.sec.gov/x", "CREDENTIALS_IN_URL"],
    ["https://data.sec.gov:8443/x", "HOST_NOT_ALLOWED"],
    ["https://127.0.0.1/x", "IP_LITERAL"],
    ["https://2130706433/x", "IP_LITERAL"],
    ["https://0x7f.0.0.1/x", "IP_LITERAL"],
    ["https://[::1]/x", "IP_LITERAL"],
    ["https://169.254.169.254/latest/meta-data", "IP_LITERAL"],
    ["https://localhost/x", "PRIVATE_HOST"],
    ["https://metadata.internal/x", "PRIVATE_HOST"],
    ["https://intranet/x", "PRIVATE_HOST"],
    ["https://evil.example.com/x", "HOST_NOT_ALLOWED"],
    ["https://data.sec.gov.evil.example/x", "HOST_NOT_ALLOWED"],
    ["not a url", "INVALID_URL"],
  ])("rejects %s (%s)", (url, expected) => {
    expect(code(() => checkUrl(url, allow))).toBe(expected);
  });
  it("public-link check (stored, never fetched) applies the same rules without an allowlist", () => {
    expect(checkPublicLink("https://www.cci.gov.in/combination/order/details/1").hostname).toBe("www.cci.gov.in");
    expect(code(() => checkPublicLink("http://10.0.0.1/"))).toBe("SCHEME_NOT_ALLOWED");
    expect(code(() => checkPublicLink("https://10.0.0.1/"))).toBe("IP_LITERAL");
  });
  it("canonicalises tracking parameters, fragments and default ports", () => {
    expect(canonicalizeUrl("https://RBI.org.in:443/a/?prid=1&utm_source=rss&gclid=x#top")).toBe("https://rbi.org.in/a?prid=1");
  });
});

function fakeFetch(routes: Record<string, () => Response>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    const r = routes[u];
    if (!r) throw new Error(`unexpected fetch ${u}`);
    return r();
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

describe("fetch guard: guarded fetch", () => {
  const allowedHosts = ["rbi.org.in", "www.rbi.org.in"];
  it("re-checks each redirect hop and follows allowed ones", async () => {
    const f = fakeFetch({
      "https://rbi.org.in/feed.xml": () => new Response(null, { status: 301, headers: { location: "https://www.rbi.org.in/feed.xml" } }),
      "https://www.rbi.org.in/feed.xml": () => new Response("<rss/>", { status: 200, headers: { etag: '"v1"' } }),
    });
    const r = await guardedFetch("https://rbi.org.in/feed.xml", { allowedHosts, fetcher: f });
    expect(r.finalUrl).toBe("https://www.rbi.org.in/feed.xml");
    expect(r.etag).toBe('"v1"');
    expect(f.calls).toHaveLength(2);
  });
  it("refuses redirects off the allowlist without contacting the new host", async () => {
    const f = fakeFetch({ "https://rbi.org.in/feed.xml": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }) });
    await expect(guardedFetch("https://rbi.org.in/feed.xml", { allowedHosts, fetcher: f })).rejects.toMatchObject({ code: "REDIRECT_NOT_ALLOWED" });
    expect(f.calls).toEqual(["https://rbi.org.in/feed.xml"]);
  });
  it("stops after the redirect limit", async () => {
    const f = fakeFetch({
      "https://rbi.org.in/a": () => new Response(null, { status: 302, headers: { location: "/b" } }),
      "https://rbi.org.in/b": () => new Response(null, { status: 302, headers: { location: "/a" } }),
    });
    await expect(guardedFetch("https://rbi.org.in/a", { allowedHosts, fetcher: f, maxRedirects: 3 })).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });
  it("enforces the response size limit (declared and streamed)", async () => {
    const declared = fakeFetch({ "https://rbi.org.in/big": () => new Response("x", { headers: { "content-length": "999999" } }) });
    await expect(guardedFetch("https://rbi.org.in/big", { allowedHosts, fetcher: declared, maxBytes: 1000 })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    const streamed = fakeFetch({ "https://rbi.org.in/big": () => new Response("y".repeat(5000)) });
    await expect(guardedFetch("https://rbi.org.in/big", { allowedHosts, fetcher: streamed, maxBytes: 1000 })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
  it("times out slow responses", async () => {
    const slow = (async (_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      })) as typeof fetch;
    await expect(guardedFetch("https://rbi.org.in/slow", { allowedHosts, fetcher: slow, timeoutMs: 20 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("sends conditional headers and reports 304 as not modified", async () => {
    let seen: Headers | null = null;
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response(null, { status: 304 });
    }) as typeof fetch;
    const r = await guardedFetch("https://rbi.org.in/feed.xml", { allowedHosts, fetcher: f, etag: '"v1"', lastModified: "Wed, 23 Sep 2026 10:00:00 GMT" });
    expect(r.notModified).toBe(true);
    expect((seen as unknown as Headers).get("if-none-match")).toBe('"v1"');
  });
});

describe("RSS/Atom parser (bounded, no DTDs)", () => {
  it("parses the RSS fixture into plain-text items with safe links", () => {
    const f = parseFeed(RSS);
    expect(f.format).toBe("rss");
    // Untitled items are dropped; a javascript: link becomes null.
    expect(f.items).toHaveLength(4);
    const first = f.items[0];
    expect(first?.guid).toBe("fixture-900001");
    expect(first?.publishedAt).toBe("2026-09-24T13:00:00.000Z");
    expect(first?.summary).toBe("Fixture summary with markup & an entity reference.");
    expect(first?.summary).not.toContain("alert");
    expect(f.items[3]?.link).toBeNull();
  });
  it("rejects DOCTYPE and ENTITY declarations (XXE / entity expansion)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&x;</title></item></channel></rss>`;
    expect(code(() => parseFeed(xxe))).toBe("DTD_NOT_ALLOWED");
    const bomb = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><rss/>`;
    expect(code(() => parseFeed(bomb))).toBe("DTD_NOT_ALLOWED");
  });
  it("rejects oversize input and non-feeds", () => {
    expect(code(() => parseFeed(`<rss>${"x".repeat(2 * 1024 * 1024 + 1)}</rss>`))).toBe("TOO_LARGE");
    expect(code(() => parseFeed("<html><body>Access denied</body></html>"))).toBe("NOT_A_FEED");
  });
  it("parses Atom entries and caps item count", () => {
    const entries = Array.from({ length: 250 }, (_, i) => `<entry><id>urn:x:${i}</id><title>Entry ${i}</title><link rel="alternate" href="https://sebi.gov.in/e/${i}"/><updated>2026-09-2${i % 5}T10:00:00Z</updated></entry>`).join("");
    const f = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>${entries}</feed>`);
    expect(f.format).toBe("atom");
    expect(f.items).toHaveLength(200);
    expect(f.items[0]?.link).toBe("https://sebi.gov.in/e/0");
  });
  it("plainText strips markup and control characters and truncates", () => {
    expect(plainText("<b>A</b>\u0007 &amp; B", 50)).toBe("A & B");
    expect(plainText("x".repeat(20), 10)).toHaveLength(10);
  });
});

describe("SEC submissions parser", () => {
  it("keeps forms of interest since the cut-off date with safe document URLs", () => {
    const s = parseSubmissions(SEC, { sinceDate: "2026-07-01" });
    expect(s.cik).toBe("0000789019");
    expect(s.filings.map((f) => f.accession)).toEqual(["0000950170-26-000101", "0000950170-26-000102", "0001193125-26-000103", "0001193125-26-000104"]);
    expect(s.filings[0]?.url).toBe("https://www.sec.gov/Archives/edgar/data/789019/000095017026000101/msft-8k_20260920.htm");
    // Path traversal in primaryDocument is not turned into a URL.
    expect(s.filings[3]?.url).toBe("https://www.sec.gov/Archives/edgar/data/789019/000119312526000104/");
  });
  it("classifies filing types", () => {
    const s = parseSubmissions(SEC, { sinceDate: "2026-01-01" });
    expect(s.filings.map(secEventType)).toEqual(["completion_filing", "filing", "merger_document", "merger_document", "material_agreement"]);
  });
  it("rejects malformed responses", () => {
    expect(() => parseSubmissions("<html>", { sinceDate: "2026-01-01" })).toThrow(/not JSON/);
    expect(() => parseSubmissions(JSON.stringify({ cik: "x" }), { sinceDate: "2026-01-01" })).toThrow(/CIK/);
  });
});

describe("connector failure handling", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  it("maps HTTP statuses to health categories", () => {
    expect(classifyHttp({ status: 200, retryAfter: null }, now)).toBeNull();
    expect(classifyHttp({ status: 304, retryAfter: null }, now)).toBeNull();
    expect(classifyHttp({ status: 429, retryAfter: "120" }, now)).toMatchObject({ status: "rate_limited", retryAfterMs: 120_000 });
    expect(classifyHttp({ status: 503, retryAfter: "60" }, now)).toMatchObject({ status: "rate_limited" });
    expect(classifyHttp({ status: 503, retryAfter: null }, now)).toMatchObject({ status: "failed" });
    expect(classifyHttp({ status: 403, retryAfter: null }, now)).toMatchObject({ status: "access_unavailable" });
    expect(classifyHttp({ status: 404, retryAfter: null }, now)?.message).toMatch(/may have moved/);
  });
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfter("30", now)).toBe(30_000);
    expect(parseRetryAfter("Fri, 25 Sep 2026 00:10:00 GMT", now)).toBe(600_000);
    expect(parseRetryAfter("soon", now)).toBeNull();
  });
  it("backs off exponentially from 30 minutes to a 24-hour cap", () => {
    expect(backoffMs(1)).toBe(30 * 60_000);
    expect(backoffMs(2)).toBe(60 * 60_000);
    expect(backoffMs(4)).toBe(240 * 60_000);
    expect(backoffMs(20)).toBe(24 * 3_600_000);
  });
  it("redacts configured secrets from stored messages", () => {
    const env = { FINANCE_AI_API_KEY: "sk-test-secret-value-123", FINANCE_JOB_SECRET: "j".repeat(40), FINANCE_PUBLIC_ORIGIN: "https://kmanish.live" };
    const msg = redact(`failed with sk-test-secret-value-123 and Bearer ${"j".repeat(40)} at https://kmanish.live`, env);
    expect(msg).not.toContain("sk-test-secret");
    expect(msg).not.toContain("j".repeat(40));
    expect(msg).toContain("https://kmanish.live");
  });
});

describe("entity linking and classification", () => {
  const dealById = new Map([["hdfc-hdfc-bank-merger", { id: "hdfc-hdfc-bank-merger", title: "HDFC Ltd merges into HDFC Bank", acquirer: { companyId: "hdfc-bank" }, target: { companyId: "hdfc-ltd" } }]]);
  const view = {
    aliasIndex: [
      { alias: "hdfc bank", type: "company" as const, id: "hdfc-bank", name: "HDFC Bank" },
      { alias: "hdfc", type: "company" as const, id: "hdfc-ltd", name: "HDFC Ltd (historical)" },
      { alias: "hdfc ltd", type: "company" as const, id: "hdfc-ltd", name: "HDFC Ltd (historical)" },
      { alias: "ubs", type: "company" as const, id: "ubs", name: "UBS" },
      { alias: "ubs", type: "company" as const, id: "ubs-asset", name: "UBS Asset (test duplicate)" },
      { alias: "bank", type: "company" as const, id: "generic", name: "Generic" },
      { alias: "hdfc twins merger", type: "deal" as const, id: "hdfc-hdfc-bank-merger", name: "HDFC Ltd merges into HDFC Bank" },
    ],
    dealById,
  } as unknown as Parameters<typeof linkEntities>[1];

  it("prefers the longer alias and does not double-count the shorter one", () => {
    const e = linkEntities("HDFC Bank raises deposits", view);
    expect(e).toEqual([{ type: "company", id: "hdfc-bank", name: "HDFC Bank", confidence: "exact_alias" }]);
  });
  it("suggests a deal (ambiguous) when both parties are mentioned but the deal is not named", () => {
    const e = linkEntities("Test fixture: Scheme of amalgamation of HDFC Ltd with HDFC Bank", view);
    expect(e.find((x) => x.type === "deal")).toMatchObject({ id: "hdfc-hdfc-bank-merger", confidence: "ambiguous" });
    expect(e.filter((x) => x.type === "company").map((x) => x.id).sort()).toEqual(["hdfc-bank", "hdfc-ltd"]);
  });
  it("links a named deal exactly", () => {
    expect(linkEntities("Five years after the HDFC twins merger", view).find((x) => x.type === "deal")?.confidence).toBe("exact_alias");
  });
  it("marks aliases shared by several companies as ambiguous and ignores generic words", () => {
    const e = linkEntities("UBS said the bank would…", view);
    expect(e.every((x) => x.confidence === "ambiguous")).toBe(true);
    expect(e.some((x) => x.id === "generic")).toBe(false);
  });
  it("matches whole words only", () => {
    expect(linkEntities("Subsidiary news from hdfcbank.example", view)).toEqual([]);
  });
  it("classifies headlines, keeping proposals apart from rules", () => {
    expect(classifyHeadline("Draft directions on acquisition finance – comments invited")).toBe("proposed_rule");
    expect(classifyHeadline("Master Direction on KYC amended")).toBe("rule");
    expect(classifyHeadline("RBI imposes monetary penalty on XYZ Bank")).toBe("enforcement");
    expect(classifyHeadline("Scheme of amalgamation sanctioned")).toBe("deal_news");
    expect(classifyHeadline("Monetary Policy Statement, 2026-27")).toBe("monetary_policy");
    expect(dealEventTypeFor("merger_document")).toBe("regulatory_filing");
    expect(dealEventTypeFor("approval")).toBe("regulatory_approval");
    expect(dealEventTypeFor("deal_news")).toBe("subsequent");
  });
  it("clusters repeated coverage of one event by normalised words and date", () => {
    expect(clusterKey("RBI approves HDFC merger", "2026-09-24")).toBe(clusterKey("HDFC merger approves — RBI", "2026-09-24"));
    expect(clusterKey("RBI approves HDFC merger", "2026-09-24")).not.toBe(clusterKey("RBI approves HDFC merger", "2026-09-25"));
  });
});

describe("AI grounding checks", async () => {
  const { groundSections, normaliseNumber } = await import("../../server/ai/grounding");
  const pack = new Map([
    ["ev-a1", { id: "ev-a1", label: "Deal value", text: "Enterprise value: INR 40,000 crore. Effective 2023-07-01. Stake 100%." }],
    ["ev-b2", { id: "ev-b2", label: "Status", text: "Completed on 2023-07-01." }],
  ]);
  it("normalises numbers", () => {
    expect(normaliseNumber("40,000.50")).toBe("40000.5");
    expect(normaliseNumber("12.0")).toBe("12");
  });
  it("accepts cited, supported statements and analysis with small counting numbers", () => {
    const r = groundSections(
      [
        { kind: "fact", text: "Enterprise value was INR 40000 crore, effective 2023-07-01.", citations: ["ev-a1"] },
        { kind: "fact", text: "The merger completed in 2023.", citations: ["ev-b2"] },
        { kind: "analysis", text: "Three risks matter; the first is funding cost.", citations: [] },
      ],
      pack,
    );
    expect(r.held).toEqual([]);
    expect(r.accepted).toHaveLength(3);
  });
  it("holds invented citations, uncited facts, unsupported numbers and invented dates", () => {
    const r = groundSections(
      [
        { kind: "fact", text: "Advisers were X.", citations: ["ev-zz9"] },
        { kind: "fact", text: "It closed quickly.", citations: [] },
        { kind: "fact", text: "EV/EBITDA was 12.5x.", citations: ["ev-a1"] },
        { kind: "fact", text: "It completed on 2023-10-01.", citations: ["ev-b2"] },
        { kind: "analysis", text: "Worth 2012 crore more than peers.", citations: ["ev-a1"] },
      ],
      pack,
    );
    expect(r.accepted).toEqual([]);
    expect(r.held.map((h) => h.reasons[0])).toEqual([
      expect.stringMatching(/not in the input/),
      expect.stringMatching(/without a citation/),
      expect.stringMatching(/Numbers not found.*12\.5/),
      expect.stringMatching(/Dates not found.*2023-10-01/),
      expect.stringMatching(/Numbers not found.*2012/),
    ]);
  });
});
