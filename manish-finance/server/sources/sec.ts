import { SEC_FORMS_OF_INTEREST } from "./registry";

/**
 * Parser for SEC EDGAR "submissions" JSON (data.sec.gov/submissions/CIK##########.json). Returns
 * filing metadata only — the filing text is not fetched. A filing is a lead until a human reads it.
 */

export interface SecFiling {
  accession: string;
  form: string;
  filingDate: string;
  acceptedAt: string | null;
  primaryDocument: string | null;
  description: string | null;
  items: string | null;
  url: string;
}

export interface SecSubmissions {
  cik: string;
  name: string;
  filings: SecFiling[];
}

export class SecParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecParseError";
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function col(recent: Record<string, unknown>, key: string): unknown[] {
  const v = recent[key];
  return Array.isArray(v) ? v : [];
}

export function parseSubmissions(json: string, opts: { sinceDate: string; forms?: readonly string[]; max?: number }): SecSubmissions {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new SecParseError("Response is not JSON.");
  }
  const cikRaw = String(data.cik ?? "").replace(/^0+/, "");
  if (!/^\d{1,10}$/.test(cikRaw)) throw new SecParseError("Missing or invalid CIK in response.");
  const name = typeof data.name === "string" ? data.name.slice(0, 200) : "";
  const recent = ((data.filings as Record<string, unknown> | undefined)?.recent ?? null) as Record<string, unknown> | null;
  if (!recent) throw new SecParseError("No filings.recent block in response.");
  const forms = new Set(opts.forms ?? SEC_FORMS_OF_INTEREST);
  const acc = col(recent, "accessionNumber");
  const out: SecFiling[] = [];
  for (let i = 0; i < acc.length && out.length < (opts.max ?? 50); i++) {
    const accession = String(acc[i] ?? "");
    const form = String(col(recent, "form")[i] ?? "");
    const filingDate = String(col(recent, "filingDate")[i] ?? "");
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !DATE.test(filingDate) || !forms.has(form)) continue;
    if (filingDate < opts.sinceDate) continue;
    const primaryDocument = String(col(recent, "primaryDocument")[i] ?? "") || null;
    const safeDoc = primaryDocument && /^[A-Za-z0-9._-]{1,200}$/.test(primaryDocument) ? primaryDocument : null;
    const folder = `https://www.sec.gov/Archives/edgar/data/${cikRaw}/${accession.replace(/-/g, "")}`;
    out.push({
      accession,
      form,
      filingDate,
      acceptedAt: typeof col(recent, "acceptanceDateTime")[i] === "string" ? (col(recent, "acceptanceDateTime")[i] as string) : null,
      primaryDocument: safeDoc,
      description: String(col(recent, "primaryDocDescription")[i] ?? "").slice(0, 200) || null,
      items: String(col(recent, "items")[i] ?? "").slice(0, 100) || null,
      url: safeDoc ? `${folder}/${safeDoc}` : `${folder}/`,
    });
  }
  return { cik: cikRaw.padStart(10, "0"), name, filings: out };
}

/** 8-K item codes that commonly relate to M&A (1.01 material agreement, 2.01 completion, 5.01 change in control, 8.01 other). */
export const MNA_8K_ITEMS = ["1.01", "2.01", "5.01", "8.01", "7.01"];

export function secEventType(f: SecFiling): string {
  if (["S-4", "S-4/A", "F-4", "F-4/A", "425", "DEFM14A", "PREM14A", "DEFM14C"].includes(f.form)) return "merger_document";
  if (f.form.startsWith("SC TO") || f.form === "SC 14D9" || f.form === "SC 13E3") return "tender_offer";
  if (f.form.includes("13D")) return "ownership_filing";
  if (f.form.startsWith("8-K") && f.items && f.items.split(",").some((x) => x.trim() === "2.01")) return "completion_filing";
  if (f.form.startsWith("8-K") && f.items && f.items.split(",").some((x) => x.trim() === "1.01")) return "material_agreement";
  return "filing";
}
