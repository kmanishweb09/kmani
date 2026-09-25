// Pure helpers for primary-evidence retrieval: turn a retrieved HTML/text document into numbered
// paragraphs, derive the tokens a claim's value must show, and find a paragraph that states them.
// No network access here; see scripts/evidence.mjs.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", rupee: "₹" };

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Visible text split into paragraphs (block elements and line breaks), scripts/styles removed. */
export function htmlToParagraphs(html) {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td|th|br|blockquote)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  return text
    .split(/\n+/)
    .map((p) => p.replace(/[ \t\r\f\v\u00a0]+/g, " ").trim())
    .filter((p) => p.length >= 20);
}

export function plainTextToParagraphs(text) {
  return text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 20);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Tokens that must appear for a claim's recorded value to count as found. Numbers are compared without
 * thousands separators; a day-precision date may appear as "14 December 2017", "December 14, 2017" or
 * "2017-12-14". Claims with no number or date (e.g. a party name) return their significant words.
 */
export function expectedTokens(display) {
  const d = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{4})\b/.exec(display);
  if (d) {
    const m = MONTHS.findIndex((x) => x.startsWith(d[2]));
    const day = Number(d[1]);
    return { kind: "date", alternatives: [`${day} ${MONTHS[m]} ${d[3]}`, `${MONTHS[m]} ${day}, ${d[3]}`, `${d[3]}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, `${day}${day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th"} ${MONTHS[m]} ${d[3]}`] };
  }
  const numbers = [...display.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, "")).filter((n) => !/^(19|20)\d{2}$/.test(n) || display.trim() === n);
  if (numbers.length) return { kind: "numbers", numbers: [...new Set(numbers)] };
  const words = display
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["limited", "corporation", "company", "group", "holdings", "the", "inc", "plc", "and"].includes(w));
  return { kind: "words", words: [...new Set(words)].slice(0, 4) };
}

function normalizeNumbers(s) {
  // "71,300" → "71300"; "₹ 40,000" → "₹ 40000"
  return s.replace(/(\d),(?=\d{2,3}\b)/g, "$1");
}

function numberPresent(text, n) {
  const re = new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d]|\\.\\d)`);
  return re.test(text);
}

/** Finds the first paragraph that states the claim's value. Returns a locator, a ≤300-char excerpt and the matched value text. */
export function findEvidence(paragraphs, display) {
  const want = expectedTokens(display);
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const norm = normalizeNumbers(p);
    let hit = null;
    if (want.kind === "date") hit = want.alternatives.find((a) => p.toLowerCase().includes(a.toLowerCase())) ?? null;
    else if (want.kind === "numbers") hit = want.numbers.every((n) => numberPresent(norm, n)) ? want.numbers.join(", ") : null;
    else if (want.words.length) hit = want.words.every((w) => p.toLowerCase().includes(w)) ? want.words.join(" ") : null;
    if (!hit) continue;
    const anchor = want.kind === "numbers" ? norm.search(new RegExp(`(?<![\\d.])${want.numbers[0].replace(".", "\\.")}`)) : p.toLowerCase().indexOf(String(hit).toLowerCase().split(" ")[0]);
    const start = Math.max(0, anchor - 140);
    const source = want.kind === "numbers" ? norm : p;
    let excerpt = source.slice(start, start + 290).trim();
    if (start > 0) excerpt = `…${excerpt}`;
    if (start + 290 < source.length) excerpt = `${excerpt}…`;
    return { locator: `Paragraph ${i + 1} of the retrieved page text`, excerpt: excerpt.slice(0, 300), checkedValue: String(hit), matchKind: want.kind };
  }
  return null;
}

/** Minimal robots.txt check for one user-agent token (longest-match Allow/Disallow, "*" group fallback). */
export function robotsAllows(robotsTxt, uaToken, path) {
  const groups = [];
  let cur = null;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || cur.rules.length) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && cur) cur.rules.push({ allow: key === "allow", path: val });
  }
  const token = uaToken.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    const pattern = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    if (pattern.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}
