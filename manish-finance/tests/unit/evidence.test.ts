import { describe, expect, it } from "vitest";
import { expectedTokens, findEvidence, htmlToParagraphs, robotsAllows } from "../../scripts/lib/evidence-match.mjs";
import { chunkImportItems, mergeImportItems, retrieveDocuments } from "../../scripts/lib/evidence-retrieve.mjs";

// Synthetic fixture (not a real publisher's page): exercises the parser and matcher used by
// `npm run evidence:retrieve`, which proposes source checks only where the recorded value is found.
const HTML = `<!doctype html><html><head><title>x</title><script>var price = "71.3";</script></head><body>
<nav>Menu Home About</nav>
<h1>Example Corp to acquire Target Co for $52.4 billion in stock</h1>
<p>BURBANK, Calif., December 14, 2017 &ndash; Example Corp today announced a definitive agreement to acquire Target Co for approximately $52.4&nbsp;billion in stock.</p>
<p>Under the terms, holders will receive 0.2745 shares for each share, valued at about $28 per share.</p>
<p>The board of directors has approved the transaction, which is subject to customary conditions.</p>
</body></html>`;

describe("evidence matching", () => {
  const paras = htmlToParagraphs(HTML);
  it("extracts visible paragraphs and drops scripts and short navigation", () => {
    expect(paras.some((p) => p.includes("var price"))).toBe(false);
    expect(paras[1]).toMatch(/^BURBANK/);
    expect(paras.join(" ")).toContain("$52.4 billion");
  });
  it("finds a paragraph containing every number of the recorded value, with a locator and a ≤300-char excerpt", () => {
    const m = findEvidence(paras, "US$52.4 billion (Equity value)");
    expect(m).not.toBeNull();
    expect(m?.locator).toMatch(/^Paragraph \d+/);
    expect(m?.excerpt.length).toBeLessThanOrEqual(300);
    expect(m?.excerpt).toContain("52.4");
    expect(findEvidence(paras, "0.2745 shares per share, about $28")?.checkedValue).toBe("0.2745, 28");
  });
  it("does not match a value the text does not state (no partial or substring matches)", () => {
    expect(findEvidence(paras, "US$71.3 billion")).toBeNull();
    expect(findEvidence(paras, "US$2.4 billion")).toBeNull();
    expect(findEvidence(paras, "US$52 billion")).toBeNull();
  });
  it("matches day-precision dates in common written forms", () => {
    expect(expectedTokens("14 Dec 2017")).toMatchObject({ kind: "date" });
    expect(findEvidence(paras, "14 Dec 2017")?.checkedValue).toBe("December 14, 2017");
    expect(findEvidence(paras, "15 Dec 2017")).toBeNull();
  });
});

describe("robots.txt", () => {
  const robots = "User-agent: *\nDisallow: /private/\nAllow: /private/press/\n\nUser-agent: BadBot\nDisallow: /\n";
  it("honours the most specific rule for our agent and the * group", () => {
    expect(robotsAllows(robots, "FinanceDesk-evidence", "/news/a")).toBe(true);
    expect(robotsAllows(robots, "FinanceDesk-evidence", "/private/x")).toBe(false);
    expect(robotsAllows(robots, "FinanceDesk-evidence", "/private/press/x")).toBe(true);
    expect(robotsAllows(robots, "BadBot/1.0", "/news/a")).toBe(false);
    expect(robotsAllows("", "FinanceDesk-evidence", "/any")).toBe(true);
  });
});

// Fixture fetch (no network): drives the same retrieval loop `npm run evidence:retrieve` uses, including
// robots.txt, access restrictions, egress blocks, PDFs and the cumulative import files.
describe("retrieval loop (fixture responses, not a live connection)", () => {
  type Route = { status?: number; type?: string; body: string; headers?: Record<string, string> };
  const fixtureFetch = (routes: Record<string, Route>, seen: string[]) => async (url: string) => {
    seen.push(url);
    const r = routes[url] ?? { status: 404, body: "not found" };
    return new Response(r.body, { status: r.status ?? 200, headers: { "content-type": r.type ?? "text/html; charset=utf-8", ...(r.headers ?? {}) } });
  };
  const claims = { c1: { display: "US$52.4 billion (Enterprise value, 100%)" }, c2: { display: "0.2745 shares" }, c3: { display: "US$99.9 billion" } };
  const noSleep = async () => {};

  it("proposes a source check only where the value is found, with locator, short excerpt and the real attempt time", async () => {
    const seen: string[] = [];
    const before = new Date().toISOString();
    const run = await retrieveDocuments({
      docs: [{ documentId: "d1", url: "https://pub.example/news/deal", claims: ["c2", "c3"] }],
      claims,
      ua: "FinanceDesk-evidence/test",
      fetchImpl: fixtureFetch({ "https://pub.example/robots.txt": { body: "User-agent: *\nDisallow: /private/", type: "text/plain" }, "https://pub.example/news/deal": { body: HTML } }, seen),
      sleepImpl: noSleep,
    });
    expect(run.attempts[0]).toMatchObject({ outcome: "retrieved", httpStatus: 200 });
    expect(run.attempts[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((run.attempts[0]?.attemptedAt ?? "") >= before).toBe(true);
    expect(run.candidates).toHaveLength(1);
    expect(run.candidates[0]).toMatchObject({ claimId: "c2", documentId: "d1", checkedValue: "0.2745", locator: expect.stringMatching(/^Paragraph \d+ of the retrieved page text$/) });
    expect(run.candidates[0]?.excerpt.length).toBeLessThanOrEqual(300);
    expect(run.needsHuman.map((x) => x.claimId)).toEqual(["c3"]);
    expect(seen).toEqual(["https://pub.example/robots.txt", "https://pub.example/news/deal"]);
  });

  it("honours robots.txt, records paywalls and egress blocks, and never retries them another way", async () => {
    const seen: string[] = [];
    const run = await retrieveDocuments({
      docs: [
        { documentId: "r1", url: "https://robots.example/private/doc", claims: ["c1"] },
        { documentId: "p1", url: "https://paywall.example/story", claims: ["c1"] },
        { documentId: "e1", url: "https://blocked.example/a", claims: ["c1"] },
        { documentId: "e2", url: "https://blocked.example/b", claims: ["c1"] },
        { documentId: "f1", url: "https://pdf.example/filing.pdf", claims: ["c1"] },
      ],
      claims,
      ua: "FinanceDesk-evidence/test",
      fetchImpl: fixtureFetch(
        {
          "https://robots.example/robots.txt": { body: "User-agent: *\nDisallow: /private/", type: "text/plain" },
          "https://paywall.example/robots.txt": { body: "", type: "text/plain" },
          "https://paywall.example/story": { status: 403, body: "Subscribe to continue reading" },
          "https://blocked.example/robots.txt": { status: 403, body: "Host not in allowlist", headers: { "x-deny-reason": "host_not_allowed" } },
          "https://pdf.example/robots.txt": { body: "", type: "text/plain" },
          "https://pdf.example/filing.pdf": { body: "%PDF-1.7 fixture", type: "application/pdf" },
        },
        seen,
      ),
      sleepImpl: noSleep,
    });
    expect(run.attempts.map((a) => a.outcome)).toEqual(["robots_disallowed", "access_restricted", "egress_blocked", "egress_blocked", "retrieved_pdf_unparsed"]);
    expect(seen).not.toContain("https://robots.example/private/doc");
    expect(seen.filter((u) => u.startsWith("https://blocked.example"))).toEqual(["https://blocked.example/robots.txt"]);
    expect(run.candidates).toEqual([]);
    expect(run.needsHuman.map((x) => x.reason)).toEqual(["PDF not parsed"]);
  });

  it("keeps earlier proposals with their original retrieval time and splits import files at 100 items", () => {
    const cand = (claimId: string, retrievedAt: string) => ({ claimId, documentId: "d1", retrievedAt, locator: "Paragraph 2 of the retrieved page text", excerpt: "…", checkedValue: "1", matchKind: "numbers", recordedValue: "1" });
    const first = mergeImportItems([], [cand("c1", "2026-09-01T10:00:00.123Z")]);
    const second = mergeImportItems(first, [cand("c1", "2026-09-20T10:00:00.000Z"), cand("c2", "2026-09-20T10:00:00.000Z")]);
    expect(second.map((x) => [x.payload.claimId, x.payload.retrievedAt])).toEqual([
      ["c1", "2026-09-01T10:00:00Z"],
      ["c2", "2026-09-20T10:00:00Z"],
    ]);
    const many = mergeImportItems([], Array.from({ length: 205 }, (_, i) => cand(`k${i}`, "2026-09-20T10:00:00Z")));
    const files = chunkImportItems(many);
    expect(files.map((f) => [f.name, f.items.length])).toEqual([
      ["claim-verifications.import-01.json", 100],
      ["claim-verifications.import-02.json", 100],
      ["claim-verifications.import-03.json", 5],
    ]);
    expect(chunkImportItems([]).map((f) => f.name)).toEqual(["claim-verifications.import.json"]);
  });
});
