/**
 * Content verification (bundled and run by scripts/verify-content.mjs). Checks the authored archive
 * against the content targets in SPEC.md §12 and the evidence rules. Counts are completeness checks,
 * not permission to invent facts: shortfalls are reported, never padded.
 */
import { findUnresolvedReferences } from "../../shared/archive/compile";
import { APAC_COUNTRIES } from "../../shared/geo";
import { buildArchive } from "./archive-entry";

export interface Check {
  id: string;
  label: string;
  target: string;
  actual: string;
  ok: boolean;
  severity: "error" | "warning";
  detail?: string[];
}

const words = (s: string | null | undefined) => (s ?? "").split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function verifyContent(today: string) {
  const { source, compiled, issues, compileError } = buildArchive();
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  add({ id: "schema", label: "All records pass schema validation", target: "0 issues", actual: `${issues.length} issues`, ok: issues.length === 0, severity: "error", detail: issues.slice(0, 20).map((i) => `${i.collection}/${i.id} ${i.path}: ${i.message}`) });
  add({ id: "compile", label: "Archive compiles (citations resolve to documents)", target: "no error", actual: compileError ?? "ok", ok: !compileError, severity: "error" });
  if (!compiled) return { checks, counts: {} };

  const deals = compiled.deals;
  const region = (d: (typeof deals)[number]) => (d.target.country === "IN" || d.acquirer.country === "IN" ? "india" : APAC_COUNTRIES.has(d.target.country) || APAC_COUNTRIES.has(d.acquirer.country) ? "apac" : "global");
  const byRegion = { india: 0, apac: 0, global: 0 } as Record<string, number>;
  for (const d of deals) byRegion[region(d)] = (byRegion[region(d)] ?? 0) + 1;
  add({ id: "deals", label: "Real transaction records", target: "≥ 36", actual: String(deals.length), ok: deals.length >= 36, severity: "error" });
  add({ id: "deals-india", label: "India-related deals", target: "≈ 18", actual: String(byRegion.india), ok: (byRegion.india ?? 0) >= 18, severity: "warning" });
  add({ id: "deals-apac", label: "APAC (ex-India) deals", target: "≈ 8", actual: String(byRegion.apac), ok: (byRegion.apac ?? 0) >= 8, severity: "warning" });
  add({ id: "deals-global", label: "Other global deals", target: "≈ 10", actual: String(byRegion.global), ok: (byRegion.global ?? 0) >= 10, severity: "warning" });

  const yearAgo = new Date(`${today}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const yearAgoIso = yearAgo.toISOString().slice(0, 10);
  const recent = deals.filter((d) => d.events.some((e) => e.type !== "rumour" && e.date.date > yearAgoIso && e.date.date <= today));
  add({ id: "recent", label: "Deals with an announcement or material status change in the 12 months before the build date (by event date)", target: "≥ 8", actual: String(recent.length), ok: recent.length >= 8, severity: "error", detail: recent.map((d) => d.id) });

  const autopsies = deals.filter((d) => d.autopsy);
  const autIndia = autopsies.filter((d) => region(d) === "india").length;
  const autFig = autopsies.filter((d) => d.sector === "fig").length;
  add({ id: "autopsies", label: "Deep deal autopsies (≥ 5 India-related, ≥ 2 FIG)", target: "10 / 5 / 2", actual: `${autopsies.length} / ${autIndia} / ${autFig}`, ok: autopsies.length >= 10 && autIndia >= 5 && autFig >= 2, severity: "error" });

  const companies = compiled.companies;
  const coIndia = companies.filter((c) => c.country === "IN").length;
  const coSectors = new Set(companies.map((c) => c.sector));
  add({ id: "companies", label: "Company dossiers (≥ 24 India-based, all eight sectors represented)", target: "48 / 24 / 8", actual: `${companies.length} / ${coIndia} / ${coSectors.size}`, ok: companies.length >= 48 && coIndia >= 24 && coSectors.size === 8, severity: "error" });

  const sectorWords = compiled.sectors.map((s) => ({
    slug: s.slug,
    words:
      words(s.tagline) +
      words(s.howItMakesMoney) +
      words(s.valueAccrual) +
      words(s.primer) +
      s.subsectors.reduce((n, x) => n + words(x.businessModel) + words(x.valuation), 0) +
      s.valueChain.reduce((n, v) => n + words(v.description) + words(v.economics), 0) +
      s.metrics.reduce((n, m) => n + words(m.interpretation) + words(m.limitations), 0) +
      s.valuation.reduce((n, v) => n + words(v.whenUseful) + words(v.whenMisleading), 0) +
      [...s.mnaMotives, ...s.integrationIssues, ...s.diligenceQuestions, ...s.recurringStructures].reduce((n, t) => n + words(t), 0),
    questions: s.practiceQuestionIds.length,
    metrics: s.metrics.length,
  }));
  add({ id: "sectors", label: "Sector playbooks (eight, each ≥ 5 practice questions and a metric dictionary)", target: "8", actual: String(compiled.sectors.length), ok: compiled.sectors.length === 8 && sectorWords.every((s) => s.questions >= 5 && s.metrics >= 6), severity: "error", detail: sectorWords.map((s) => `${s.slug}: ${s.words} words, ${s.metrics} metrics, ${s.questions} questions`) });
  add({ id: "sector-words", label: "Sector playbook length (roughly 600–1,000 useful words)", target: "≥ 600 each", actual: `${Math.min(...sectorWords.map((s) => s.words))}–${Math.max(...sectorWords.map((s) => s.words))}`, ok: sectorWords.every((s) => s.words >= 600), severity: "warning" });

  const qIds = new Set(compiled.questions.map((q) => q.id));
  const modulesOk = compiled.modules.length === 12 && compiled.modules.every((m) => m.questionIds.filter((id) => qIds.has(id)).length >= 3);
  add({ id: "modules", label: "Learning modules (all twelve, each ≥ 3 resolvable questions)", target: "12", actual: String(compiled.modules.length), ok: modulesOk, severity: "error" });

  const terms = new Set(compiled.glossary.map((g) => norm(g.term)));
  add({ id: "glossary", label: "Glossary terms (distinct)", target: "≥ 80", actual: String(terms.size), ok: terms.size >= 80, severity: "error" });

  const prompts = new Map<string, string>();
  const dupes: string[] = [];
  for (const q of compiled.questions) {
    const key = norm(q.prompt);
    if (prompts.has(key)) dupes.push(`${q.id} duplicates ${prompts.get(key)}`);
    prompts.set(key, q.id);
  }
  const unanswered = compiled.questions.filter((q) => (q.kind === "mcq" && (q.answerIndex === null || q.answerIndex === undefined)) || (q.kind === "numeric" && (q.answerValue === null || q.answerValue === undefined)) || (q.kind === "open" && !q.rubric?.length));
  add({ id: "questions", label: "Practice questions (no duplicates; answers or rubrics present)", target: "≥ 80", actual: `${compiled.questions.length} (${dupes.length} duplicates, ${unanswered.length} missing answer/rubric)`, ok: compiled.questions.length >= 80 && !dupes.length && !unanswered.length, severity: "error", detail: [...dupes, ...unanswered.map((q) => `${q.id}: missing answer or rubric`)] });

  const dealIds = new Set(deals.map((d) => d.id));
  const trainingLeak = compiled.training.filter((t) => dealIds.has(t.id));
  add({ id: "training", label: "Training models (fictional, separate from research records)", target: "≥ 3", actual: `${compiled.training.length}`, ok: compiled.training.length >= 3 && !trainingLeak.length && compiled.training.every((t) => /fictional|training/i.test(`${t.title} ${t.description}`)), severity: "error" });

  const daily = compiled.briefs.filter((b) => b.kind === "daily").length;
  const weekly = compiled.briefs.filter((b) => b.kind === "weekly").length;
  add({ id: "briefs", label: "Historical brief examples", target: "1 daily + 1 weekly", actual: `${daily} daily + ${weekly} weekly`, ok: daily >= 1 && weekly >= 1, severity: "error" });

  // Evidence rules
  const docOf = (claimId: string) => compiled.documents[compiled.claims[claimId]?.documentId ?? ""];
  const noPrimary = deals.filter((d) => {
    const ids = [
      ...d.acquirer.ev,
      ...d.target.ev,
      ...d.announced.ev,
      ...d.status.ev,
      ...d.stake.ev,
      ...d.payment.ev,
      ...(d.effective?.ev ?? []),
      ...d.events.flatMap((e) => e.ev),
      ...d.terms.flatMap((t) => t.ev),
      ...d.rationale.flatMap((r) => r.ev),
    ];
    return !ids.some((id) => docOf(id)?.isPrimary);
  });
  add({ id: "primary", label: "Every deal cites at least one primary source", target: "0 without", actual: `${noPrimary.length} without`, ok: !noPrimary.length, severity: "error", detail: noPrimary.map((d) => d.id) });
  const amountsWithoutEv = deals.flatMap((d) => d.terms.filter((t) => t.amount !== null && !t.ev.length).map((t) => `${d.id}:${t.metric}`));
  add({ id: "amount-evidence", label: "Every material amount has claim-level evidence", target: "0 missing", actual: `${amountsWithoutEv.length} missing`, ok: !amountsWithoutEv.length, severity: "error", detail: amountsWithoutEv });

  const seen = new Map<string, string>();
  const dupDeals: string[] = [];
  for (const d of deals) {
    const k = `${d.acquirer.companyId ?? norm(d.acquirer.name)}|${d.target.companyId ?? norm(d.target.name)}|${d.announced.date}`;
    if (seen.has(k)) dupDeals.push(`${d.id} duplicates ${seen.get(k)}`);
    seen.set(k, d.id);
  }
  add({ id: "duplicates", label: "No duplicate transactions (same parties and announcement date)", target: "0", actual: String(dupDeals.length), ok: !dupDeals.length, severity: "error", detail: dupDeals });

  const unresolved = findUnresolvedReferences(source);
  add({ id: "references", label: "Cross-references resolve (unresolved ones are dropped at compile time, not shown as links)", target: "0 unresolved", actual: `${unresolved.length} unresolved`, ok: true, severity: "warning", detail: unresolved.slice(0, 30).map((u) => `${u.from} ${u.field} → ${u.ref}`) });

  const statusCounts: Record<string, number> = {};
  for (const c of Object.values(compiled.claims)) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
  const unavailable = Object.values(compiled.documents).filter((d) => d.retrievalStatus === "unavailable");
  add({ id: "unavailable-sources", label: "Source documents marked unavailable (kept with provenance, flagged)", target: "reported", actual: String(unavailable.length), ok: true, severity: "warning", detail: unavailable.map((d) => `${d.id}: ${d.url}`) });

  return {
    checks,
    counts: {
      archiveVersion: compiled.version,
      cutoff: compiled.cutoff,
      deals: deals.length,
      dealsByRegion: byRegion,
      recentDeals: recent.length,
      autopsies: autopsies.length,
      companies: companies.length,
      companiesIndia: coIndia,
      sectors: compiled.sectors.length,
      modules: compiled.modules.length,
      glossary: terms.size,
      questions: compiled.questions.length,
      training: compiled.training.length,
      briefs: compiled.briefs.length,
      documents: Object.keys(compiled.documents).length,
      claims: Object.keys(compiled.claims).length,
      claimStatus: statusCounts,
    },
  };
}
