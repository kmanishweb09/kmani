/**
 * Grounding checks for AI output. Every citation must resolve to an evidence ID that was in the
 * input pack; every material number in a section must appear in the text of the evidence that
 * section cites. Sections that fail are held back (returned separately with a reason), never shown
 * as findings.
 */

export interface PackItem {
  id: string;
  label: string;
  text: string;
}

export interface Section {
  kind: "fact" | "analysis" | "question";
  text: string;
  citations: string[];
}

export interface HeldSection extends Section {
  reasons: string[];
}

const NUM_RE = /(?<![\w.])[-+]?\d[\d,]*(?:\.\d+)?/g;

/** Normalises "40,000.50" → "40000.5", "12.0" → "12". */
export function normaliseNumber(raw: string): string {
  let s = raw.replace(/,/g, "").replace(/^\+/, "");
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(/^(-?)0+(?=\d)/, "$1");
}

export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUM_RE)].map((m) => normaliseNumber(m[0]));
}

/**
 * A number is "material" unless it is a small counting word-like integer (0–10) used for structure
 * ("three risks", "step 2"). Years, amounts, percentages and ratios must be supported by evidence.
 */
export function isMaterial(n: string): boolean {
  if (/^-?\d$/.test(n) || n === "10") return false;
  return true;
}

const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

export function checkSection(section: Section, pack: Map<string, PackItem>): string[] {
  const reasons: string[] = [];
  const unknown = section.citations.filter((id) => !pack.has(id));
  if (unknown.length) reasons.push(`Cites evidence that was not in the input: ${unknown.slice(0, 5).join(", ")}`);
  if (section.kind === "fact" && !section.citations.length) reasons.push("A factual statement without a citation.");
  const cited = section.citations.map((id) => pack.get(id)?.text ?? "").join(" \n ");
  // ISO dates are checked as whole tokens so an invented date cannot pass on its parts.
  const dates = [...new Set(section.text.match(DATE_RE) ?? [])];
  const missingDates = dates.filter((d) => !cited.includes(d));
  if (missingDates.length) reasons.push(`Dates not found in the cited evidence: ${missingDates.slice(0, 4).join(", ")}`);
  // Parts of evidence dates (e.g. the year in 2023-07-01) count as available numbers for prose like "in 2023".
  const available = new Set([...numbersIn(cited), ...(cited.match(DATE_RE) ?? []).map((d) => d.slice(0, 4))]);
  const unsupported = [...new Set(numbersIn(section.text.replace(DATE_RE, " ")).filter(isMaterial))].filter((n) => !available.has(n));
  if (unsupported.length) reasons.push(`Numbers not found in the cited evidence: ${unsupported.slice(0, 6).join(", ")}`);
  return reasons;
}

export function groundSections(sections: Section[], pack: Map<string, PackItem>): { accepted: Section[]; held: HeldSection[] } {
  const accepted: Section[] = [];
  const held: HeldSection[] = [];
  for (const s of sections) {
    const clean: Section = { kind: s.kind, text: s.text.trim(), citations: [...new Set(s.citations.map((c) => c.trim()).filter(Boolean))] };
    if (!clean.text) continue;
    const reasons = checkSection(clean, pack);
    if (reasons.length) held.push({ ...clean, reasons });
    else accepted.push(clean);
  }
  return { accepted, held };
}

/** Removes control characters and caps length for untrusted text placed in a prompt. */
export function sanitiseForPrompt(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex -- untrusted text: drop control characters
  const t = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/<\/?evidence[^>]*>/gi, "");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
