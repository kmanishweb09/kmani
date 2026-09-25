import type { ClaimView } from "../shared/api";
import type { CompiledBrief } from "../shared/archive/compile";
import { formatDateValue, localDate } from "../shared/dates";
import { SECTOR_NAMES } from "../shared/labels";
import { parseJsonColumn } from "./db";
import { runtimeClaim } from "./feedStore";
import { archive, evidenceMap, type ResearchView } from "./research";
import type { D1Database, RequestContext } from "./types";

/** Brief read model shared by archive examples and generated (D1) briefs. */

export interface BriefItemOut {
  rank: number;
  headline: string;
  whatChanged: string;
  eventDate: { date: string; precision: "day" | "month" | "quarter" | "year" };
  publishedDate: string | null;
  whyItMatters: string;
  /** "item": written for this development; "generic": the general note for its event type. */
  whyBasis?: "item" | "generic";
  uncertainty: string;
  eventType: string;
  sectors: string[];
  entities: Array<{ type: "deal" | "company" | "sector"; id: string }>;
  whyThisAppears: string;
  newlyDiscovered: boolean;
  ev: string[];
  url?: string | null;
}

export interface BriefOut {
  id: string;
  kind: "daily" | "weekly";
  title: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  cutoffAt: string;
  generatedAt: string;
  method: string;
  scope: "public" | "private";
  origin: "archive_example" | "generated";
  version: number;
  correctionNote: string | null;
  items: BriefItemOut[];
  deepDive: { entity: { type: "deal" | "company"; id: string }; why: string; title?: string | null } | null;
  sectorImplication: { sector: string; causalChain: string[]; label: "Analysis" } | null;
  question: { text: string; template?: string | null } | null;
  weekly: { statusChanges: Array<{ dealId: string; change: string }>; openQuestions: string[]; reflectionPrompt: string } | null;
  evidence: Record<string, ClaimView>;
  provider?: string | null;
  model?: string | null;
}

export interface BriefRow {
  id: string;
  scope: string;
  user_key: string;
  kind: string;
  brief_date: string;
  period_start: string;
  period_end: string;
  cutoff_at: string;
  generated_at: string;
  method: string;
  provider: string | null;
  model: string | null;
  content_json: string;
  evidence_json: string;
  input_version: string;
  version: number;
  supersedes_id: string | null;
  correction_note: string | null;
  status: string;
}

export function archiveBriefOut(b: CompiledBrief, view: ResearchView): BriefOut {
  const ev = new Set(b.items.flatMap((i) => i.ev));
  const deepTitle = b.deepDive ? (b.deepDive.entity.type === "deal" ? view.dealById.get(b.deepDive.entity.id)?.title : view.companyById.get(b.deepDive.entity.id)?.displayName) : null;
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    label: b.label,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    cutoffAt: b.cutoffAt,
    generatedAt: b.generatedAt,
    method: b.method,
    scope: "public",
    origin: "archive_example",
    version: 1,
    correctionNote: null,
    items: b.items.map((i) => ({ ...i, publishedDate: i.publishedDate ?? null })),
    deepDive: b.deepDive ? { ...b.deepDive, title: deepTitle ?? null } : null,
    sectorImplication: b.sectorImplication ?? null,
    question: b.question ? { text: b.question.text, template: b.question.template ?? null } : null,
    weekly: b.weekly ?? null,
    evidence: evidenceMap(view, ev),
  };
}

export async function rowToBriefOut(row: BriefRow, view: ResearchView, db: D1Database | undefined): Promise<BriefOut> {
  const content = parseJsonColumn<Partial<BriefOut>>(row.content_json, {});
  const items = (content.items ?? []) as BriefItemOut[];
  const ids = new Set(items.flatMap((i) => i.ev));
  const evidence = evidenceMap(view, [...ids].filter((i) => !i.startsWith("ev-u-")));
  for (const id of ids) {
    if (id.startsWith("ev-u-")) {
      const cl = await runtimeClaim(db, id);
      if (cl) evidence[id] = cl;
    }
  }
  return {
    id: row.id,
    kind: row.kind as BriefOut["kind"],
    title: content.title ?? `${row.kind === "weekly" ? "Weekly review" : "Daily brief"} · ${formatDateValue(row.brief_date)}`,
    label: content.label ?? (row.method === "ai_synthesis" ? "AI-synthesised brief" : "Compiled brief"),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    cutoffAt: row.cutoff_at,
    generatedAt: row.generated_at,
    method: row.method,
    scope: row.scope as BriefOut["scope"],
    origin: "generated",
    version: row.version,
    correctionNote: row.correction_note,
    items,
    deepDive: content.deepDive ?? null,
    sectorImplication: content.sectorImplication ?? null,
    question: content.question ?? null,
    weekly: content.weekly ?? null,
    evidence,
    provider: row.provider,
    model: row.model,
  };
}

export function briefToMarkdown(b: BriefOut): string {
  const lines: string[] = [];
  lines.push(`# ${b.title}`, "");
  lines.push(`_${b.label}. Method: ${b.method}. Period ${b.periodStart} – ${b.periodEnd}. Evidence cutoff ${b.cutoffAt}. Generated ${b.generatedAt}${b.version > 1 ? `, version ${b.version}` : ""}._`, "");
  if (b.correctionNote) lines.push(`> Correction: ${b.correctionNote}`, "");
  lines.push("## Developments", "");
  for (const i of b.items) {
    lines.push(`### ${i.rank}. ${i.headline}`);
    lines.push(`- **Fact:** ${i.whatChanged}`);
    lines.push(`- **Analysis:** ${i.whyItMatters}`);
    lines.push(`- Event date: ${formatDateValue(i.eventDate)}${i.publishedDate ? `; published ${formatDateValue(i.publishedDate)}` : ""}${i.newlyDiscovered ? " (newly discovered, not newly announced)" : ""}`);
    lines.push(`- Uncertainty: ${i.uncertainty}`);
    lines.push(`- Why this appears: ${i.whyThisAppears}`);
    const srcs = i.ev.map((id) => b.evidence[id]).filter(Boolean) as ClaimView[];
    for (const s of srcs) lines.push(`- Source: ${s.document.publisher}, “${s.document.title}” — ${s.document.url}`);
    lines.push("");
  }
  if (b.deepDive) lines.push("## Worth understanding more deeply", "", `${b.deepDive.title ?? b.deepDive.entity.id}: ${b.deepDive.why}`, "");
  if (b.sectorImplication) {
    lines.push(`## Sector implication (${SECTOR_NAMES[b.sectorImplication.sector as keyof typeof SECTOR_NAMES] ?? b.sectorImplication.sector}) — Analysis`, "");
    b.sectorImplication.causalChain.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    lines.push("");
  }
  if (b.weekly) {
    lines.push("## Status changes", "", ...(b.weekly.statusChanges.length ? b.weekly.statusChanges.map((s) => `- ${s.dealId}: ${s.change}`) : ["- None in the covered universe."]), "");
    lines.push("## Open questions", "", ...b.weekly.openQuestions.map((q) => `- ${q}`), "", `What changed my view? ${b.weekly.reflectionPrompt}`, "");
  }
  if (b.question) lines.push("## Question to investigate", "", b.question.text, "");
  return `${lines.join("\n")}\n`;
}

export function todayLocal(c: Pick<RequestContext, "now">, tz = "Asia/Kolkata"): string {
  return localDate(c.now, tz);
}

export function archiveBriefs(): CompiledBrief[] {
  return archive.briefs;
}
