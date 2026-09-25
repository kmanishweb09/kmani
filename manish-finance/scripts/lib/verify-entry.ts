/**
 * Content verification (bundled and run by scripts/verify-content.mjs). Reports four things separately,
 * because one does not imply another:
 *  - counts:    quantity against the content targets in SPEC.md §12 (says nothing about verification);
 *  - integrity: schema, citations, duplicates, cross-references and claim-identifier stability;
 *  - evidence:  how claims were actually verified (source checked vs search corroborated vs pending);
 *  - coverage:  which numbers exist (observations, peer-set cells, multiples, advisers, linked parties).
 * Counts are completeness checks, not permission to invent facts: shortfalls are reported, never padded.
 */
import { findUnresolvedReferences } from "../../shared/archive/compile";
import { APAC_COUNTRIES } from "../../shared/geo";
import { buildPeerMatrix } from "../../shared/peers";
import { buildArchive } from "./archive-entry";
import { checkClaimRegistry, type ClaimRegistry, type RegistryResult } from "./claim-registry";
import { CHECKED_STATUSES, CONSEQUENTIAL_MAX_RANK, fieldRank } from "./evidence-priority.mjs";

export type Section = "counts" | "integrity" | "evidence" | "coverage";

export const SECTION_TITLE: Record<Section, string> = {
  counts: "Content counts (quantity against SPEC §12 targets; says nothing about verification)",
  integrity: "Integrity (schema, citations, duplicates, references, identifier stability)",
  evidence: "Evidence quality (how claims were actually verified)",
  coverage: "Numeric coverage (which numbers exist; separate from how they were verified)",
};

export interface Check {
  id: string;
  section: Section;
  label: string;
  target: string;
  actual: string;
  ok: boolean;
  /** "info" rows are reported figures with no pass/fail target. */
  severity: "error" | "warning" | "info";
  detail?: string[];
}

export interface RetrievalLog {
  attempts: Array<{ documentId: string; attemptedAt: string; outcome: string }>;
}

export interface VerifyOptions {
  registry: ClaimRegistry | null;
  acceptRelabel?: boolean;
  retrievalLog?: RetrievalLog | null;
}

const MULTIPLE_METRICS = new Set(["ev_revenue", "ev_ebitda", "price_to_book", "price_to_earnings"]);
const words = (s: string | null | undefined) => (s ?? "").split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const of = (n: number, d: number) => `${n.toLocaleString("en-US")} of ${d.toLocaleString("en-US")} (${pct(n, d)})`;

export function verifyContent(today: string, opts: VerifyOptions = { registry: null }) {
  const { source, compiled, issues, compileError } = buildArchive();
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  add({ id: "schema", section: "integrity", label: "All records pass schema validation", target: "0 issues", actual: `${issues.length} issues`, ok: issues.length === 0, severity: "error", detail: issues.slice(0, 20).map((i) => `${i.collection}/${i.id} ${i.path}: ${i.message}`) });
  add({ id: "compile", section: "integrity", label: "Archive compiles (citations resolve to documents)", target: "no error", actual: compileError ?? "ok", ok: !compileError, severity: "error" });
  if (!compiled) return { checks, counts: {}, evidence: {}, coverage: {}, registry: null as RegistryResult | null };

  // ------------------------------------------------------------------ content counts
  const deals = compiled.deals;
  const region = (d: (typeof deals)[number]) => (d.target.country === "IN" || d.acquirer.country === "IN" ? "india" : APAC_COUNTRIES.has(d.target.country) || APAC_COUNTRIES.has(d.acquirer.country) ? "apac" : "global");
  const byRegion = { india: 0, apac: 0, global: 0 } as Record<string, number>;
  for (const d of deals) byRegion[region(d)] = (byRegion[region(d)] ?? 0) + 1;
  add({ id: "deals", section: "counts", label: "Real transaction records", target: "≥ 36", actual: String(deals.length), ok: deals.length >= 36, severity: "error" });
  add({ id: "deals-india", section: "counts", label: "India-related deals", target: "≈ 18", actual: String(byRegion.india), ok: (byRegion.india ?? 0) >= 18, severity: "warning" });
  add({ id: "deals-apac", section: "counts", label: "APAC (ex-India) deals", target: "≈ 8", actual: String(byRegion.apac), ok: (byRegion.apac ?? 0) >= 8, severity: "warning" });
  add({ id: "deals-global", section: "counts", label: "Other global deals", target: "≈ 10", actual: String(byRegion.global), ok: (byRegion.global ?? 0) >= 10, severity: "warning" });

  const yearAgo = new Date(`${today}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const yearAgoIso = yearAgo.toISOString().slice(0, 10);
  const recent = deals.filter((d) => d.events.some((e) => e.type !== "rumour" && e.date.date > yearAgoIso && e.date.date <= today));
  add({ id: "recent", section: "counts", label: "Deals with an announcement or material status change in the 12 months before the build date (by event date)", target: "≥ 8", actual: String(recent.length), ok: recent.length >= 8, severity: "error", detail: recent.map((d) => d.id) });

  const autopsies = deals.filter((d) => d.autopsy);
  const autIndia = autopsies.filter((d) => region(d) === "india").length;
  const autFig = autopsies.filter((d) => d.sector === "fig").length;
  add({ id: "autopsies", section: "counts", label: "Deep deal autopsies (≥ 5 India-related, ≥ 2 FIG)", target: "10 / 5 / 2", actual: `${autopsies.length} / ${autIndia} / ${autFig}`, ok: autopsies.length >= 10 && autIndia >= 5 && autFig >= 2, severity: "error" });

  const companies = compiled.companies;
  const coIndia = companies.filter((c) => c.country === "IN").length;
  const coSectors = new Set(companies.map((c) => c.sector));
  add({ id: "companies", section: "counts", label: "Company dossiers (≥ 24 India-based, all eight sectors represented)", target: "48 / 24 / 8", actual: `${companies.length} / ${coIndia} / ${coSectors.size}`, ok: companies.length >= 48 && coIndia >= 24 && coSectors.size === 8, severity: "error" });

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
  add({ id: "sectors", section: "counts", label: "Sector playbooks (eight, each ≥ 5 practice questions and a metric dictionary)", target: "8", actual: String(compiled.sectors.length), ok: compiled.sectors.length === 8 && sectorWords.every((s) => s.questions >= 5 && s.metrics >= 6), severity: "error", detail: sectorWords.map((s) => `${s.slug}: ${s.words} words, ${s.metrics} metrics, ${s.questions} questions`) });
  add({ id: "sector-words", section: "counts", label: "Sector playbook length (roughly 600–1,000 useful words)", target: "≥ 600 each", actual: `${Math.min(...sectorWords.map((s) => s.words))}–${Math.max(...sectorWords.map((s) => s.words))}`, ok: sectorWords.every((s) => s.words >= 600), severity: "warning" });

  const qIds = new Set(compiled.questions.map((q) => q.id));
  const modulesOk = compiled.modules.length === 12 && compiled.modules.every((m) => m.questionIds.filter((id) => qIds.has(id)).length >= 3);
  add({ id: "modules", section: "counts", label: "Learning modules (all twelve, each ≥ 3 resolvable questions)", target: "12", actual: String(compiled.modules.length), ok: modulesOk, severity: "error" });

  const terms = new Set(compiled.glossary.map((g) => norm(g.term)));
  add({ id: "glossary", section: "counts", label: "Glossary terms (distinct)", target: "≥ 80", actual: String(terms.size), ok: terms.size >= 80, severity: "error" });

  const prompts = new Map<string, string>();
  const dupes: string[] = [];
  for (const q of compiled.questions) {
    const key = norm(q.prompt);
    if (prompts.has(key)) dupes.push(`${q.id} duplicates ${prompts.get(key)}`);
    prompts.set(key, q.id);
  }
  const unanswered = compiled.questions.filter((q) => (q.kind === "mcq" && (q.answerIndex === null || q.answerIndex === undefined)) || (q.kind === "numeric" && (q.answerValue === null || q.answerValue === undefined)) || (q.kind === "open" && !q.rubric?.length));
  add({ id: "questions", section: "counts", label: "Practice questions (no duplicates; answers or rubrics present)", target: "≥ 80", actual: `${compiled.questions.length} (${dupes.length} duplicates, ${unanswered.length} missing answer/rubric)`, ok: compiled.questions.length >= 80 && !dupes.length && !unanswered.length, severity: "error", detail: [...dupes, ...unanswered.map((q) => `${q.id}: missing answer or rubric`)] });

  const dealIds = new Set(deals.map((d) => d.id));
  const trainingLeak = compiled.training.filter((t) => dealIds.has(t.id));
  add({ id: "training", section: "counts", label: "Training models (fictional, separate from research records)", target: "≥ 3", actual: `${compiled.training.length}`, ok: compiled.training.length >= 3 && !trainingLeak.length && compiled.training.every((t) => /fictional|training/i.test(`${t.title} ${t.description}`)), severity: "error" });

  const daily = compiled.briefs.filter((b) => b.kind === "daily").length;
  const weekly = compiled.briefs.filter((b) => b.kind === "weekly").length;
  add({ id: "briefs", section: "counts", label: "Historical brief examples", target: "1 daily + 1 weekly", actual: `${daily} daily + ${weekly} weekly`, ok: daily >= 1 && weekly >= 1, severity: "error" });

  // ------------------------------------------------------------------ integrity
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
  add({ id: "primary", section: "integrity", label: "Every deal cites at least one primary source", target: "0 without", actual: `${noPrimary.length} without`, ok: !noPrimary.length, severity: "error", detail: noPrimary.map((d) => d.id) });
  const amountsWithoutEv = deals.flatMap((d) => d.terms.filter((t) => t.amount !== null && !t.ev.length).map((t) => `${d.id}:${t.metric}`));
  add({ id: "amount-evidence", section: "integrity", label: "Every material amount has claim-level evidence", target: "0 missing", actual: `${amountsWithoutEv.length} missing`, ok: !amountsWithoutEv.length, severity: "error", detail: amountsWithoutEv });

  const seen = new Map<string, string>();
  const dupDeals: string[] = [];
  for (const d of deals) {
    const k = `${d.acquirer.companyId ?? norm(d.acquirer.name)}|${d.target.companyId ?? norm(d.target.name)}|${d.announced.date}`;
    if (seen.has(k)) dupDeals.push(`${d.id} duplicates ${seen.get(k)}`);
    seen.set(k, d.id);
  }
  add({ id: "duplicates", section: "integrity", label: "No duplicate transactions (same parties and announcement date)", target: "0", actual: String(dupDeals.length), ok: !dupDeals.length, severity: "error", detail: dupDeals });

  // Unresolved references are dropped at compile time (never shown as broken links) but must be visible here.
  const unresolved = findUnresolvedReferences(source);
  add({ id: "references", section: "integrity", label: "Cross-references resolve (unresolved ones are dropped at compile time, not shown as links)", target: "0 unresolved", actual: `${unresolved.length} unresolved`, ok: unresolved.length === 0, severity: "warning", detail: unresolved.slice(0, 30).map((u) => `${u.from} ${u.field} → ${u.ref}`) });

  const multiplesNoBasis = deals.flatMap((d) => d.terms.filter((t) => MULTIPLE_METRICS.has(t.metric) && !t.multipleBasis).map((t) => `${d.id}: ${t.label}`));
  add({ id: "multiple-basis", section: "integrity", label: "Transaction multiples record their denominator period, accounting basis and perimeter", target: "0 without", actual: `${multiplesNoBasis.length} without`, ok: !multiplesNoBasis.length, severity: "error", detail: multiplesNoBasis });

  const registry = checkClaimRegistry(opts.registry, compiled, { acceptRelabel: opts.acceptRelabel });
  add({
    id: "claim-ids",
    section: "integrity",
    label: "Claim IDs stable: every registered ID still describes the same claim (research/claim-registry.json)",
    target: "0 missing, 0 relabelled",
    actual: `${registry.missing.length} missing, ${registry.relabelled.length} relabelled${opts.acceptRelabel && registry.relabelled.length ? " (accepted)" : ""}; ${registry.registered} registered${registry.added.length ? `, ${registry.added.length} new` : ""}${registry.created ? " (registry created)" : ""}`,
    ok: !registry.missing.length && (!registry.relabelled.length || Boolean(opts.acceptRelabel)),
    severity: "error",
    detail: [
      ...registry.missing.map((m) => `${m.id} missing (was ${m.entry.subject} ${m.entry.field} “${m.entry.label}”): restore the record order, or retire the ID in the registry with a reason`),
      ...registry.relabelled.map((r) => `${r.id}: ${r.from} → ${r.to}; if this is a deliberate rewording of the same claim, rerun with --accept-relabel`),
    ],
  });
  add({ id: "claim-values", section: "integrity", label: "Claim values changed at an existing ID since last registered (logged under revisions in the registry)", target: "0", actual: String(registry.valueChanged.length), ok: registry.valueChanged.length === 0, severity: "warning", detail: registry.valueChanged.map((v) => `${v.id} (${v.subject}): “${v.from}” → “${v.to}”; published checks recorded against the old value are withheld until re-checked`) });
  if (registry.reused.length) add({ id: "claim-ids-reused", section: "integrity", label: "Retired claim IDs produced again by the archive", target: "0", actual: String(registry.reused.length), ok: false, severity: "warning", detail: registry.reused });

  const unavailable = Object.values(compiled.documents).filter((d) => d.retrievalStatus === "unavailable");
  add({ id: "unavailable-sources", section: "integrity", label: "Source documents marked unavailable (kept with provenance, flagged)", target: "reported", actual: String(unavailable.length), ok: true, severity: "info", detail: unavailable.map((d) => `${d.id}: ${d.url}`) });

  // ------------------------------------------------------------------ evidence quality
  const claims = Object.values(compiled.claims);
  const statusCounts: Record<string, number> = {};
  for (const c of claims) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
  const checkedAll = claims.filter((c) => CHECKED_STATUSES.has(c.status)).length;
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const dealClaims = claims.filter((c) => c.subject.type === "deal" && dealById.has(c.subject.id));
  const rankOf = (c: (typeof claims)[number]) => fieldRank(dealById.get(c.subject.id) as never, c);
  const consequential = dealClaims.filter((c) => rankOf(c) <= CONSEQUENTIAL_MAX_RANK);
  const consequentialChecked = consequential.filter((c) => CHECKED_STATUSES.has(c.status)).length;
  const autopsyClaims = dealClaims.filter((c) => dealById.get(c.subject.id)?.autopsy);
  const autopsyChecked = autopsyClaims.filter((c) => CHECKED_STATUSES.has(c.status)).length;
  // A field supported only by secondary documents (no claim for the same field cites a primary source).
  const fieldDocs = new Map<string, boolean>();
  for (const c of claims) fieldDocs.set(`${c.subject.type}:${c.subject.id}|${c.field}`, (fieldDocs.get(`${c.subject.type}:${c.subject.id}|${c.field}`) ?? false) || Boolean(compiled.documents[c.documentId]?.isPrimary));
  // Counted per unchecked claim, as in the evidence worklist (research/primary-evidence/WORKLIST.md).
  const onlySecondary = consequential.filter((c) => !CHECKED_STATUSES.has(c.status) && !fieldDocs.get(`deal:${c.subject.id}|${c.field}`));
  const docs = Object.values(compiled.documents);
  const retrieved = docs.filter((d) => d.retrievedAt || d.retrievalStatus === "retrieved");
  const pending = claims.filter((c) => c.status === "pending");
  const conflicts = claims.filter((c) => c.status === "conflict");

  add({ id: "status-breakdown", section: "evidence", label: "Claims by verification status", target: "reported", actual: `source checked ${statusCounts.source_checked ?? 0} · human reviewed ${statusCounts.human_reviewed ?? 0} · search corroborated ${statusCounts.search_corroborated ?? 0} · pending ${statusCounts.pending ?? 0} · conflict ${statusCounts.conflict ?? 0}`, ok: true, severity: "info" });
  add({ id: "source-checked", section: "evidence", label: "Claims matched to a retrieved document (source checked) or reviewed by a named human", target: "all claims", actual: of(checkedAll, claims.length), ok: checkedAll === claims.length, severity: "warning" });
  add({ id: "consequential-checked", section: "evidence", label: "Consequential deal claims checked (headline value, material terms, status, key events, stake, consideration)", target: "all", actual: of(consequentialChecked, consequential.length), ok: consequentialChecked === consequential.length, severity: "warning" });
  add({ id: "autopsy-checked", section: "evidence", label: "Claims in the ten deep autopsies checked", target: "all", actual: of(autopsyChecked, autopsyClaims.length), ok: autopsyChecked === autopsyClaims.length, severity: "warning" });
  add({ id: "only-secondary", section: "evidence", label: "Unchecked consequential deal claims supported only by secondary sources (a primary document still has to be found)", target: "0", actual: String(onlySecondary.length), ok: onlySecondary.length === 0, severity: "warning", detail: onlySecondary.slice(0, 40).map((c) => `deal:${c.subject.id} ${c.field}: ${c.label}`) });
  add({ id: "documents-retrieved", section: "evidence", label: "Source documents retrieved and read (recorded retrieval time)", target: "all cited documents", actual: of(retrieved.length, docs.length), ok: retrieved.length === docs.length, severity: "warning" });
  add({ id: "pending", section: "evidence", label: "Claims pending (builder background or leads; shown as Pending in the app)", target: "0", actual: String(pending.length), ok: pending.length === 0, severity: "warning", detail: pending.slice(0, 30).map((c) => `${c.subject.type}:${c.subject.id} ${c.field}: ${c.label}`) });
  add({ id: "conflicts", section: "evidence", label: "Claims with conflicting sources", target: "0 unresolved", actual: String(conflicts.length), ok: conflicts.length === 0, severity: "warning", detail: conflicts.map((c) => `${c.subject.type}:${c.subject.id} ${c.field}: ${c.label}`) });
  const log = opts.retrievalLog;
  const outcomes: Record<string, number> = {};
  for (const a of log?.attempts ?? []) outcomes[a.outcome] = (outcomes[a.outcome] ?? 0) + 1;
  const attempted = new Set((log?.attempts ?? []).map((a) => a.documentId));
  const lastAttempt = (log?.attempts ?? []).map((a) => a.attemptedAt).sort().pop() ?? null;
  add({
    id: "retrieval-attempts",
    section: "evidence",
    label: "Primary-evidence retrieval attempts (research/primary-evidence/retrieval-log.json)",
    target: "reported",
    actual: log ? `${log.attempts.length} attempts on ${attempted.size} documents${lastAttempt ? `, last ${lastAttempt}` : ""}: ${Object.entries(outcomes).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}` : "no retrieval log",
    ok: true,
    severity: "info",
  });

  // ------------------------------------------------------------------ numeric coverage
  const withObs = companies.filter((c) => c.observations.some((o) => o.value !== null));
  const indiaWithObs = withObs.filter((c) => c.country === "IN").length;
  add({ id: "companies-with-figures", section: "coverage", label: "Company dossiers with at least one dated, sourced financial observation", target: "reported", actual: `${of(withObs.length, companies.length)}; India ${indiaWithObs} of ${coIndia}`, ok: true, severity: "info", detail: companies.filter((c) => !withObs.includes(c)).map((c) => c.id) });

  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const peerSetSummaries: Array<Record<string, unknown>> = [];
  for (const set of source.peerSets) {
    const range = set.sector === "fig" ? [6, 8] : [4, 6];
    const members = set.companyIds.filter((id) => companyMap.has(id)).length;
    add({ id: `peer-size-${set.id}`, section: "coverage", label: `Peer set “${set.name}” size (${set.sector === "fig" ? "6–8 banks" : "4–6 non-financial peers in one subsector"})`, target: `${range[0]}–${range[1]}`, actual: String(members), ok: members >= (range[0] as number) && members <= (range[1] as number), severity: "error" });
    const m = buildPeerMatrix(set, companyMap);
    const missing: string[] = [];
    for (const co of m.companies) for (const metric of set.metrics) for (const p of set.periods) if (!m.cells.some((x) => x.companyId === co.id && x.metric === metric && x.periodEnd === p.end)) missing.push(`${co.id} ${metric} ${p.label}`);
    add({ id: `peer-cells-${set.id}`, section: "coverage", label: `Peer set “${set.name}”: sourced values (company × metric × year)`, target: "all", actual: of(m.coverage.filled, m.coverage.expected), ok: m.coverage.filled === m.coverage.expected, severity: "warning", detail: missing });
    const threeYear = m.companies.filter((co) => set.metrics.some((metric) => set.periods.every((p) => m.cells.some((x) => x.companyId === co.id && x.metric === metric && x.periodEnd === p.end))));
    add({ id: `peer-3y-${set.id}`, section: "coverage", label: `Peer set “${set.name}”: members with a complete three-year series for at least one metric`, target: "all members", actual: `${threeYear.length} of ${m.companies.length}`, ok: threeYear.length === m.companies.length, severity: "warning", detail: m.companies.filter((co) => !threeYear.includes(co)).map((co) => co.id) });
    peerSetSummaries.push({ id: set.id, members, filled: m.coverage.filled, expected: m.coverage.expected, threeYearMembers: threeYear.length, missing });
  }

  const withMultiple = deals.filter((d) => d.terms.some((t) => MULTIPLE_METRICS.has(t.metric) && !t.correction && t.multipleBasis));
  add({ id: "deal-multiples", section: "coverage", label: "Deals with a transaction multiple and its recorded basis (disclosed or third-party calculation)", target: "reported", actual: of(withMultiple.length, deals.length), ok: true, severity: "info", detail: withMultiple.map((d) => `${d.id}: ${d.terms.filter((t) => MULTIPLE_METRICS.has(t.metric)).map((t) => `${t.metric} ${t.ratio}× (${t.status})`).join(", ")}`) });
  const advisersRecorded = deals.filter((d) => d.advisers.list.length > 0);
  const advisersNotResearched = deals.filter((d) => d.advisers.disclosure === "not_researched");
  add({ id: "deal-advisers", section: "coverage", label: "Deals with adviser roles recorded", target: "every deal researched", actual: `${of(advisersRecorded.length, deals.length)}; ${advisersNotResearched.length} not yet researched`, ok: advisersNotResearched.length === 0, severity: "warning", detail: advisersNotResearched.map((d) => d.id) });
  const principal = deals.flatMap((d) => [d.acquirer, d.target].map((p) => ({ deal: d.id, p })));
  const principalLinked = principal.filter((x) => x.p.companyId);
  const others = deals.flatMap((d) => d.otherParties.map((p) => ({ deal: d.id, p })));
  add({ id: "deal-parties", section: "coverage", label: "Acquirers and targets linked to a company dossier (unlinked ones are mostly carve-outs, consortia or funds)", target: "reported", actual: `${of(principalLinked.length, principal.length)}; other parties ${others.filter((x) => x.p.companyId).length} of ${others.length}`, ok: true, severity: "info", detail: principal.filter((x) => !x.p.companyId).map((x) => `${x.deal}: ${x.p.name}`) });

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
      documents: docs.length,
      claims: claims.length,
    },
    evidence: {
      claimStatus: statusCounts,
      claimsChecked: checkedAll,
      consequentialDealClaims: consequential.length,
      consequentialChecked,
      autopsyClaims: autopsyClaims.length,
      autopsyChecked,
      consequentialOnlySecondary: onlySecondary.length,
      documents: docs.length,
      documentsRetrieved: retrieved.length,
      pending: pending.length,
      conflicts: conflicts.length,
      retrievalAttempts: log ? { attempts: log.attempts.length, documents: attempted.size, outcomes, lastAttempt } : null,
    },
    coverage: {
      companiesWithObservations: withObs.length,
      companies: companies.length,
      peerSets: peerSetSummaries,
      dealsWithMultiples: withMultiple.length,
      dealsWithAdvisers: advisersRecorded.length,
      dealsAdvisersNotResearched: advisersNotResearched.length,
      principalPartiesLinked: principalLinked.length,
      principalParties: principal.length,
    },
    registry,
  };
}
