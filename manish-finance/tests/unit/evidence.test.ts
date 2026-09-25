import { describe, expect, it } from "vitest";
import { expectedTokens, findEvidence, htmlToParagraphs, robotsAllows } from "../../scripts/lib/evidence-match.mjs";

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
