import { z } from "zod";
import type { EventView, TermView } from "../shared/api";
import { ClaimCollector, type CompiledClaim, type CompiledCompany, type CompiledDeal, compileCompany, compileDeal, compileDealFields, compileEvent, compileObservation, compileTerm } from "../shared/archive/compile";
import { normalizeSearchText } from "../shared/dealQuery";
import { daysBetween } from "../shared/dates";
import { DEAL_STATUS_LABEL } from "../shared/labels";
import {
  type Cite,
  DOCUMENT_TYPES,
  type SourceDocument,
  zCite,
  zCompany,
  zDateValue,
  zDeal,
  zDealEvent,
  zDealTerm,
  zObservation,
  zTimestamp,
} from "../shared/schemas/research";
import { stableStringify } from "../shared/text/hash";
import { sha256Hex } from "./http";
import { COMPANY_EDITABLE, DEAL_EDITABLE, changeFields, entityFieldSeq, type ResearchView } from "./research";
import { canonicalizeUrl, checkPublicLink, FetchGuardError } from "./sources/fetchGuard";

/**
 * Owner research maintenance. A draft is a proposed change to the published research: a new company or
 * deal, an edit to either, a revised deal term, a dated company observation, a deal event, or a claim
 * verification. Drafts are validated and previewed (errors, warnings, duplicates, before/after) and can
 * be edited before publishing. Publishing appends one row to finance_published_changes — the same
 * append-only overlay used by the review queue — so history and rollback work the same way for all.
 */

export const DRAFT_KINDS = ["company_create", "company_edit", "deal_create", "deal_edit", "term_revision", "observation", "deal_event", "claim_verification"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  company_create: "New company",
  company_edit: "Company edit",
  deal_create: "New deal",
  deal_edit: "Deal edit",
  term_revision: "Revised deal term",
  observation: "Dated company observation",
  deal_event: "Deal event",
  claim_verification: "Claim verification",
};

const zRef = z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/, "lowercase reference");

/** A source document supplied with a draft. `ref` is what the draft's citations use in `doc`. */
export const zDraftDocument = z.object({
  ref: zRef,
  url: z.string().max(2000),
  publisher: z.string().trim().min(2).max(120),
  title: z.string().trim().min(3).max(300),
  documentType: z.enum(DOCUMENT_TYPES),
  isPrimary: z.boolean(),
  publishedDate: zDateValue.nullable(),
  /** When the owner actually retrieved and read the document (UTC). Required for "source checked". */
  retrievedAt: zTimestamp.nullish(),
  retrievalNote: z.string().trim().max(400).nullish(),
});
export type DraftDocument = z.infer<typeof zDraftDocument>;
export const zDraftEvidence = z.object({ documents: z.array(zDraftDocument).max(20).default([]) });
export type DraftEvidence = z.infer<typeof zDraftEvidence>;

const partialOf = <K extends string>(shape: Record<string, z.ZodTypeAny>, keys: readonly K[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, (shape[k] as z.ZodTypeAny).optional()])) as Record<K, z.ZodOptional<z.ZodTypeAny>>).strict();

export const PAYLOAD_SCHEMAS = {
  company_create: z.object({ company: zCompany }),
  company_edit: z.object({ companyId: zRef, fields: partialOf(zCompany.shape, COMPANY_EDITABLE), cites: z.array(zCite).min(1, "An edit needs at least one citation.") }),
  deal_create: z.object({ deal: zDeal }),
  deal_edit: z.object({ dealId: zRef, fields: partialOf(zDeal.shape, DEAL_EDITABLE), cites: z.array(zCite).default([]) }),
  term_revision: z.object({ dealId: zRef, term: zDealTerm, supersedesTermId: z.string().max(120).nullish() }),
  observation: z.object({ companyId: zRef, observation: zObservation, supersedesObservationId: z.string().max(120).nullish() }),
  deal_event: z.object({ dealId: zRef, event: zDealEvent }),
  claim_verification: z.object({
    claimId: z.string().regex(/^ev-[A-Za-z0-9_-]{6,80}$/),
    status: z.enum(["source_checked", "human_reviewed", "conflict", "pending"]),
    /** The value the owner found in the document (for source checks). */
    checkedValue: z.string().trim().max(300).nullish(),
    locator: z.string().trim().max(200).nullish(),
    excerpt: z.string().trim().max(300).nullish(),
    retrievedAt: zTimestamp.nullish(),
    note: z.string().trim().max(400).nullish(),
  }),
} as const;

export interface Issue {
  path: string;
  code: string;
  message: string;
}

export interface Duplicate {
  against: "published" | "draft";
  id: string;
  label: string;
  /** Exact duplicates block publishing; near duplicates are warnings. */
  exact: boolean;
  reason: string;
}

export interface Evaluation {
  kind: DraftKind;
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  duplicates: Duplicate[];
  entity: { type: "company" | "deal" | "claim"; id: string; label: string; exists: boolean };
  fields: string[];
  diff: Array<{ field: string; before: unknown; after: unknown }>;
  /** Compiled change payload and evidence as they would be published (claims use preview IDs). */
  change: { changeType: string; payload: Record<string, unknown>; evidence: { documents: SourceDocument[]; claims: CompiledClaim[] } } | null;
  dedupeKey: string;
  /** Latest effective change sequence among the touched fields (for revision-conflict checks). */
  currentSeq: number;
}

export interface EvalContext {
  view: ResearchView;
  today: string;
  nowIso: string;
  /** Short ID used for claim and record IDs (the change ID at publish time, "preview" otherwise). */
  idStem: string;
}

const OWNER_NOTE = "Recorded by the site owner through research maintenance.";

function zodIssues(prefix: string, e: z.ZodError): Issue[] {
  return e.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join("."), code: "INVALID", message: i.message }));
}

function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((x) => x.replace(/,/g, ""));
}

/** Resolves draft documents into source-document records keyed by the draft's refs. */
async function resolveDocuments(evidence: DraftEvidence, view: ResearchView, errors: Issue[], nowIso: string): Promise<Map<string, SourceDocument>> {
  const out = new Map<string, SourceDocument>();
  const seen = new Set<string>();
  for (const [i, d] of evidence.documents.entries()) {
    const path = `evidence.documents.${i}`;
    if (seen.has(d.ref)) errors.push({ path: `${path}.ref`, code: "DUPLICATE_REF", message: `Reference “${d.ref}” is used twice.` });
    seen.add(d.ref);
    let url: string;
    try {
      checkPublicLink(d.url);
      url = canonicalizeUrl(d.url);
    } catch (e) {
      errors.push({ path: `${path}.url`, code: "INVALID_URL", message: e instanceof FetchGuardError ? e.message : "Enter a public https URL." });
      continue;
    }
    if (d.retrievedAt && d.retrievedAt > nowIso) errors.push({ path: `${path}.retrievedAt`, code: "FUTURE_RETRIEVAL", message: "The retrieval time cannot be in the future." });
    const id = `own-${await sha256Hex(url, 20)}`;
    const existing = view.documents[id] ?? Object.values(view.documents).find((x) => x.url === url);
    out.set(
      d.ref,
      existing
        ? { ...existing, ...(d.retrievedAt && !existing.retrievedAt ? { retrievedAt: d.retrievedAt, retrievalStatus: "retrieved" as const, retrievalNote: d.retrievalNote ?? "Retrieved by the site owner." } : {}) }
        : {
            id,
            publisher: d.publisher,
            url,
            title: d.title,
            documentType: d.documentType,
            isPrimary: d.isPrimary,
            publishedDate: d.publishedDate,
            retrievedAt: d.retrievedAt ?? null,
            retrievalStatus: d.retrievedAt ? "retrieved" : "not_retrieved",
            retrievalNote: d.retrievalNote ?? (d.retrievedAt ? "Retrieved and read by the site owner." : "Cited by the site owner; the server did not fetch the document."),
            contentHash: null,
            language: "en",
          },
    );
  }
  return out;
}

/**
 * Checks and rewrites every citation in a payload: `doc` must name a draft document ref or an existing
 * document; statuses follow the evidence rules (a "source checked" citation needs a retrieved document,
 * a locator and an excerpt; "conflict" is set only through claim verification).
 */
function rewriteCites(node: unknown, path: string, docs: Map<string, SourceDocument>, view: ResearchView, today: string, errors: Issue[], used: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((x, i) => rewriteCites(x, `${path}.${i}`, docs, view, today, errors, used));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if ((k === "cites" || k === "identityCites") && Array.isArray(v)) {
      out[k] = v.map((c: Cite, i: number) => {
        const p = `${path}.cites.${i}`;
        const doc = docs.get(c.doc) ?? view.documents[c.doc];
        if (!doc) {
          errors.push({ path: `${p}.doc`, code: "UNKNOWN_DOCUMENT", message: `Citation refers to “${c.doc}”, which is neither a document in this draft nor an existing source.` });
          return c;
        }
        used.add(doc.id);
        if (c.status === "conflict") errors.push({ path: `${p}.status`, code: "CONFLICT_VIA_VERIFICATION", message: "Mark a conflict through claim verification, with a note." });
        if (c.status === "source_checked" && (!doc.retrievedAt || !c.locator || !c.excerpt)) {
          errors.push({ path: `${p}.status`, code: "SOURCE_CHECK_EVIDENCE", message: "“Source checked” needs a retrieved document (retrieval time), an exact locator and a short excerpt." });
        }
        if (c.status === "human_reviewed" && c.method !== "owner_entry") errors.push({ path: `${p}.method`, code: "METHOD_MISMATCH", message: "Owner-reviewed citations use the owner_entry method." });
        return { ...c, doc: doc.id, checkedAt: c.checkedAt ?? (c.status === "pending" ? null : today), note: c.note ?? OWNER_NOTE };
      });
    } else out[k] = rewriteCites(v, `${path}.${k}`, docs, view, today, errors, used);
  }
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}

function titleTokens(t: string): Set<string> {
  return new Set(normalizeSearchText(t).split(" ").filter((w) => w.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return a.size + b.size - n ? n / (a.size + b.size - n) : 0;
}

const MULTIPLE_METRICS = new Set(["ev_revenue", "ev_ebitda", "price_to_book", "price_to_earnings"]);

/** Validates a draft against the current research view and builds the change it would publish. */
export async function evaluateDraft(kind: DraftKind, rawPayload: unknown, rawEvidence: unknown, ctx: EvalContext): Promise<Evaluation> {
  const { view, today, nowIso, idStem } = ctx;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const duplicates: Duplicate[] = [];
  const diff: Evaluation["diff"] = [];
  const base = (entity: Evaluation["entity"], fields: string[], dedupeKey: string): Evaluation => ({
    kind,
    ok: false,
    errors,
    warnings,
    duplicates,
    entity,
    fields,
    diff,
    change: null,
    dedupeKey,
    currentSeq: entityFieldSeq(view, `${entity.type}:${entity.id}`, fields),
  });

  const ev = zDraftEvidence.safeParse(rawEvidence ?? {});
  if (!ev.success) {
    errors.push(...zodIssues("evidence", ev.error));
    return base({ type: "deal", id: "unknown", label: "Unknown", exists: false }, [], `${kind}:invalid`);
  }
  const docs = await resolveDocuments(ev.data, view, errors, nowIso);
  const parsed = PAYLOAD_SCHEMAS[kind].safeParse(rawPayload);
  if (!parsed.success) {
    errors.push(...zodIssues("payload", parsed.error));
    return base({ type: kind.startsWith("company") || kind === "observation" ? "company" : kind === "claim_verification" ? "claim" : "deal", id: "unknown", label: "Invalid draft", exists: false }, [], `${kind}:invalid:${await sha256Hex(stableStringify(rawPayload ?? null), 16)}`);
  }
  const used = new Set<string>();
  const data = parsed.data as Record<string, unknown>;
  // Zod fills defaults for omitted optional fields; an edit changes only the fields the owner supplied.
  if ((kind === "deal_edit" || kind === "company_edit") && data.fields && typeof data.fields === "object") {
    const rawFields = ((rawPayload as Record<string, unknown>)?.fields ?? {}) as Record<string, unknown>;
    data.fields = Object.fromEntries(Object.entries(data.fields as Record<string, unknown>).filter(([k]) => k in rawFields));
  }
  const payload = rewriteCites(data, "payload", docs, view, today, errors, used) as Record<string, unknown>;
  const allDocs: Record<string, SourceDocument> = { ...view.documents };
  for (const d of docs.values()) allDocs[d.id] = d;
  const col = new ClaimCollector(allDocs, idStem);
  const usedDocs = () => [...used].map((id) => allDocs[id] as SourceDocument).filter((d) => d && (!view.documents[d.id] || d !== view.documents[d.id]));
  const hash = async (x: unknown) => sha256Hex(stableStringify(x), 16);
  const finish = (e: Evaluation, changeType: string, changePayload: Record<string, unknown>): Evaluation => {
    if (!errors.length) {
      try {
        e.change = { changeType, payload: changePayload, evidence: { documents: usedDocs(), claims: Object.values(col.claims) } };
      } catch (err) {
        errors.push({ path: "payload", code: "COMPILE_FAILED", message: err instanceof Error ? err.message : "Could not compile the draft." });
      }
    }
    for (const d of duplicates) if (d.exact) errors.push({ path: "payload", code: "DUPLICATE", message: `Duplicate of ${d.label}: ${d.reason}` });
    e.ok = errors.length === 0;
    return e;
  };
  if (!docs.size && kind !== "claim_verification" && !used.size) errors.push({ path: "evidence.documents", code: "EVIDENCE_REQUIRED", message: "Add at least one source document; nothing is published without evidence." });

  try {
    return await evaluateKind();
  } catch (err) {
    // Compilation fails only on inputs already reported above (e.g. a citation to an unknown document).
    if (!errors.length) errors.push({ path: "payload", code: "COMPILE_FAILED", message: err instanceof Error ? err.message : "Could not compile the draft." });
    const e = base({ type: kind.startsWith("company") || kind === "observation" ? "company" : kind === "claim_verification" ? "claim" : "deal", id: String((payload.companyId ?? payload.dealId ?? payload.claimId ?? (payload.company as { id?: string })?.id ?? (payload.deal as { id?: string })?.id ?? "unknown") as string), label: "Draft with errors", exists: false }, [], `${kind}:${await hash(payload)}`);
    e.ok = false;
    return e;
  }

  async function evaluateKind(): Promise<Evaluation> {
  switch (kind) {
    case "company_create": {
      const c = (payload as { company: z.infer<typeof zCompany> }).company;
      const e = base({ type: "company", id: c.id, label: c.displayName, exists: view.companyById.has(c.id) }, ["*"], `company_create:${c.id}`);
      if (view.companyById.has(c.id)) duplicates.push({ against: "published", id: c.id, label: `company ${c.id}`, exact: true, reason: "a company with this ID already exists" });
      const names = new Set([c.displayName, c.legalName, ...c.aliases].map(normalizeSearchText).filter((n) => n.length >= 3));
      for (const other of view.companies) {
        if (other.id === c.id) continue;
        const otherNames = new Set([other.displayName, other.legalName, ...other.aliases].map(normalizeSearchText));
        const sameName = [...names].find((n) => otherNames.has(n));
        const sameTicker = c.tickers.find((t) => other.tickers.some((o) => o.exchange.toUpperCase() === t.exchange.toUpperCase() && o.symbol.toUpperCase() === t.symbol.toUpperCase()));
        if (sameTicker) duplicates.push({ against: "published", id: other.id, label: other.displayName, exact: true, reason: `same listing ${sameTicker.exchange}:${sameTicker.symbol}` });
        else if (sameName) duplicates.push({ against: "published", id: other.id, label: other.displayName, exact: other.country === c.country, reason: `same name “${sameName}”${other.country === c.country ? " in the same country" : " (different country)"}` });
      }
      const unknownPeers = c.peers.filter((p) => !view.companyById.has(p.companyId));
      if (unknownPeers.length) warnings.push({ path: "payload.company.peers", code: "UNRESOLVED_PEER", message: `Peers not in the database are dropped: ${unknownPeers.map((p) => p.companyId).join(", ")}.` });
      const compiled = compileCompany({ ...c, peers: c.peers.filter((p) => view.companyById.has(p.companyId)) }, col);
      diff.push({ field: "*", before: null, after: { displayName: c.displayName, legalName: c.legalName, country: c.country, sector: c.sector, observations: c.observations.length } });
      return finish(e, "company_create", { company: compiled });
    }
    case "company_edit": {
      const p = payload as { companyId: string; fields: Record<string, unknown>; cites: Cite[] };
      const co = view.companyById.get(p.companyId);
      const fields = Object.keys(p.fields);
      const e = base({ type: "company", id: p.companyId, label: co?.displayName ?? p.companyId, exists: Boolean(co) }, fields, `company_edit:${p.companyId}:${await hash(p.fields)}`);
      if (!co) {
        errors.push({ path: "payload.companyId", code: "NOT_FOUND", message: "No company with this ID." });
        return finish(e, "company_edit", {});
      }
      if (!fields.length) errors.push({ path: "payload.fields", code: "NO_FIELDS", message: "Choose at least one field to change." });
      const previous: Record<string, unknown> = {};
      for (const f of fields) {
        const before = (co as unknown as Record<string, unknown>)[f] ?? null;
        previous[f] = before;
        if (sameJson(before, p.fields[f])) errors.push({ path: `payload.fields.${f}`, code: "NO_CHANGE", message: `${f} already has this value.` });
        diff.push({ field: f, before, after: p.fields[f] });
      }
      if (Array.isArray(p.fields.peers)) {
        const bad = (p.fields.peers as Array<{ companyId: string }>).filter((x) => !view.companyById.has(x.companyId));
        if (bad.length) errors.push({ path: "payload.fields.peers", code: "UNKNOWN_PEER", message: `Unknown peer companies: ${bad.map((b) => b.companyId).join(", ")}.` });
      }
      col.add({ type: "company", id: co.id }, `edit.${fields.join(",")}`, `Edit: ${fields.join(", ")}`, fields.map((f) => `${f}: ${JSON.stringify(p.fields[f]).slice(0, 120)}`).join("; "), p.cites);
      return finish(e, "company_edit", { fields: p.fields, previous });
    }
    case "deal_create": {
      const d = (payload as { deal: z.infer<typeof zDeal> }).deal;
      const e = base({ type: "deal", id: d.id, label: d.title, exists: view.dealById.has(d.id) }, ["*"], `deal_create:${d.id}`);
      if (view.dealById.has(d.id)) duplicates.push({ against: "published", id: d.id, label: `deal ${d.id}`, exact: true, reason: "a deal with this ID already exists" });
      const acq = normalizeSearchText(d.acquirer.name);
      const tgt = normalizeSearchText(d.target.name);
      const tt = titleTokens(d.title);
      for (const o of view.deals) {
        if (o.id === d.id) continue;
        const sameParties = (normalizeSearchText(o.acquirer.name) === acq || (d.acquirer.companyId && o.acquirer.companyId === d.acquirer.companyId)) && (normalizeSearchText(o.target.name) === tgt || (d.target.companyId && o.target.companyId === d.target.companyId));
        const near = Math.abs(daysBetween(o.announced.date, d.announced.date)) <= 180;
        if (sameParties && near) duplicates.push({ against: "published", id: o.id, label: o.title, exact: true, reason: "same acquirer and target announced within 180 days" });
        else if (overlap(tt, titleTokens(o.title)) >= 0.7 || o.aliases.some((a) => normalizeSearchText(a) === normalizeSearchText(d.title)))
          duplicates.push({ against: "published", id: o.id, label: o.title, exact: false, reason: "very similar title or alias" });
      }
      for (const cmp of d.comparables) if (!view.dealById.has(cmp.dealId)) errors.push({ path: "payload.deal.comparables", code: "UNKNOWN_DEAL", message: `Comparable deal “${cmp.dealId}” is not in the database.` });
      for (const [role, pr] of [["acquirer", d.acquirer], ["target", d.target]] as const) {
        if (pr.companyId && !view.companyById.has(pr.companyId)) warnings.push({ path: `payload.deal.${role}.companyId`, code: "UNRESOLVED_COMPANY", message: `${pr.companyId} has no dossier; the name is shown without a link.` });
      }
      if (d.events.some((ev2) => ev2.date.date > today)) errors.push({ path: "payload.deal.events", code: "FUTURE_EVENT", message: "Events must have happened (dated today or earlier)." });
      const compiled: CompiledDeal = compileDeal(d, col);
      for (const pr of [compiled.acquirer, compiled.target, ...compiled.otherParties]) if (pr.companyId && !view.companyById.has(pr.companyId)) pr.companyId = null;
      compiled.events = compiled.events.map((x) => ({ ...x, origin: "published_update" as const }));
      diff.push({ field: "*", before: null, after: { title: d.title, announced: d.announced.date, status: d.status.value, terms: d.terms.length, events: d.events.length } });
      return finish(e, "deal_create", { deal: compiled });
    }
    case "deal_edit": {
      const p = payload as { dealId: string; fields: Record<string, unknown>; cites: Cite[] };
      const d = view.dealById.get(p.dealId);
      const fields = Object.keys(p.fields);
      const e = base({ type: "deal", id: p.dealId, label: d?.title ?? p.dealId, exists: Boolean(d) }, fields, `deal_edit:${p.dealId}:${await hash(p.fields)}`);
      if (!d) {
        errors.push({ path: "payload.dealId", code: "NOT_FOUND", message: "No deal with this ID." });
        return finish(e, "deal_edit", {});
      }
      if (!fields.length) errors.push({ path: "payload.fields", code: "NO_FIELDS", message: "Choose at least one field to change." });
      const PLAIN = ["title", "aliases", "subsector", "peerGroup", "perimeter", "sectorContext", "tags", "comparables"];
      if (fields.some((f) => PLAIN.includes(f)) && !p.cites.length) errors.push({ path: "payload.cites", code: "EVIDENCE_REQUIRED", message: "Edits to uncited fields (title, perimeter, peer group, …) need at least one citation." });
      if (Array.isArray(p.fields.comparables)) for (const cmp of p.fields.comparables as Array<{ dealId: string }>) if (!view.dealById.has(cmp.dealId) || cmp.dealId === d.id) errors.push({ path: "payload.fields.comparables", code: "UNKNOWN_DEAL", message: `Comparable deal “${cmp.dealId}” is not valid.` });
      const compiledFields: Record<string, unknown> = { ...compileDealFields(d.id, p.fields as Parameters<typeof compileDealFields>[1], col) };
      for (const f of fields) if (!(f in compiledFields)) compiledFields[f] = p.fields[f];
      if (Array.isArray(compiledFields.otherParties)) for (const pr of compiledFields.otherParties as Array<{ companyId: string | null }>) if (pr.companyId && !view.companyById.has(pr.companyId)) pr.companyId = null;
      const previous: Record<string, unknown> = {};
      for (const f of fields) {
        const before = (d as unknown as Record<string, unknown>)[f] ?? null;
        previous[f] = before;
        const comparable = (x: unknown) => JSON.parse(stableStringify(x ?? null).replace(/"ev":\[[^\]]*\]/g, '"ev":[]'));
        if (sameJson(comparable(before), comparable(compiledFields[f]))) errors.push({ path: `payload.fields.${f}`, code: "NO_CHANGE", message: `${f} already has this value.` });
        diff.push({ field: f, before, after: compiledFields[f] });
      }
      if (p.cites.length) col.add({ type: "deal", id: d.id }, `edit.${fields.join(",")}`, `Edit: ${fields.join(", ")}`, fields.filter((f) => PLAIN.includes(f)).map((f) => `${f}: ${JSON.stringify(p.fields[f]).slice(0, 120)}`).join("; ") || "Deal edit", p.cites);
      return finish(e, "deal_edit", { fields: compiledFields, previous });
    }
    case "term_revision": {
      const p = payload as { dealId: string; term: z.infer<typeof zDealTerm>; supersedesTermId?: string | null };
      const d = view.dealById.get(p.dealId);
      const e = base({ type: "deal", id: p.dealId, label: d?.title ?? p.dealId, exists: Boolean(d) }, ["terms"], `term_revision:${p.dealId}:${await hash(p.term)}`);
      if (!d) {
        errors.push({ path: "payload.dealId", code: "NOT_FOUND", message: "No deal with this ID." });
        return finish(e, "term_revision", {});
      }
      const t = p.term;
      if (t.asOf > today) errors.push({ path: "payload.term.asOf", code: "FUTURE_DATE", message: "A term cannot be dated in the future." });
      if (MULTIPLE_METRICS.has(t.metric)) {
        if (!t.multipleBasis) errors.push({ path: "payload.term.multipleBasis", code: "MULTIPLE_BASIS_REQUIRED", message: "A transaction multiple needs its denominator period, accounting basis and perimeter." });
        if (t.ratio === null || t.ratio === undefined || t.ratio <= 0) errors.push({ path: "payload.term.ratio", code: "INVALID_MULTIPLE", message: "Enter the multiple as a positive ratio (e.g. 12.5 for 12.5×)." });
      }
      const current = d.terms.filter((x) => !x.correction);
      const same = current.find((x) => x.metric === t.metric && x.kind === t.kind && x.asOf === t.asOf && x.amount === (t.amount ?? null) && (x.ratio ?? null) === (t.ratio ?? null) && (x.text ?? null) === (t.text ?? null));
      if (same) duplicates.push({ against: "published", id: same.id, label: same.label, exact: true, reason: "the same term is already recorded" });
      let old: TermView | undefined;
      if (p.supersedesTermId) {
        old = d.terms.find((x) => x.id === p.supersedesTermId);
        if (!old) errors.push({ path: "payload.supersedesTermId", code: "NOT_FOUND", message: "The term to supersede is not on this deal." });
        else if (old.correction) errors.push({ path: "payload.supersedesTermId", code: "ALREADY_SUPERSEDED", message: "That term was already superseded." });
        else if (old.metric !== t.metric) errors.push({ path: "payload.supersedesTermId", code: "METRIC_MISMATCH", message: "A revision must supersede a term of the same metric." });
        else if (old.asOf > t.asOf) errors.push({ path: "payload.term.asOf", code: "REVISION_OLDER", message: `A revision must be dated on or after the term it supersedes (${old.asOf}).` });
      }
      const newer = current.find((x) => x.metric === t.metric && x.asOf > t.asOf);
      if (newer) warnings.push({ path: "payload.term.asOf", code: "OLDER_THAN_CURRENT", message: `A later ${newer.label} (${newer.asOf}) exists; this term is added to the history but will not become the headline.` });
      const term = compileTerm(d.id, t, `${d.id}-r-${idStem}`, "terms.revision", col);
      diff.push({ field: "terms", before: old ?? null, after: term });
      return finish(e, "term_revision", { term, supersedesTermId: p.supersedesTermId ?? null });
    }
    case "observation": {
      const p = payload as { companyId: string; observation: z.infer<typeof zObservation>; supersedesObservationId?: string | null };
      const co = view.companyById.get(p.companyId);
      const o = p.observation;
      const e = base({ type: "company", id: p.companyId, label: co?.displayName ?? p.companyId, exists: Boolean(co) }, ["observations"], `observation:${p.companyId}:${o.metric}:${o.period.type}:${o.period.end}:${o.scope}:${o.basis}:${await hash(o.value)}`);
      if (!co) {
        errors.push({ path: "payload.companyId", code: "NOT_FOUND", message: "No company with this ID." });
        return finish(e, "company_observation", {});
      }
      if (o.period.end > today) errors.push({ path: "payload.observation.period.end", code: "FUTURE_PERIOD", message: "Reported observations must be for a period that has ended." });
      if (o.value === null && !o.nullReason) errors.push({ path: "payload.observation.nullReason", code: "NULL_REASON_REQUIRED", message: "Say why the value is not available (never enter zero for missing)." });
      if (o.unit === "currency" && (!o.currency || !o.scale)) errors.push({ path: "payload.observation.currency", code: "CURRENCY_REQUIRED", message: "Currency values need a currency and a scale (e.g. INR crore)." });
      for (const c of o.cites) {
        const doc = allDocs[c.doc];
        if (doc?.publishedDate && doc.publishedDate.date < o.period.end) warnings.push({ path: "payload.observation.cites", code: "DOC_BEFORE_PERIOD_END", message: `${doc.title} is dated before the period ended; check the period.` });
      }
      const current = (co.observations as Array<CompiledCompany["observations"][number] & { supersededBy?: unknown }>).filter((x) => !x.supersededBy);
      const clash = current.find((x) => x.metric === o.metric && x.period.type === o.period.type && x.period.end === o.period.end && x.scope === o.scope && x.basis === o.basis);
      if (clash && clash.value === o.value) duplicates.push({ against: "published", id: clash.id, label: `${clash.metric} ${clash.period.label}`, exact: true, reason: "the same value is already recorded for this period, scope and basis" });
      else if (clash && p.supersedesObservationId !== clash.id)
        errors.push({ path: "payload.supersedesObservationId", code: "OBSERVATION_EXISTS", message: `A different value (${clash.value}) is recorded for this period; set supersedesObservationId to “${clash.id}” to revise it, keeping the old value in history.` });
      if (p.supersedesObservationId && !current.some((x) => x.id === p.supersedesObservationId)) errors.push({ path: "payload.supersedesObservationId", code: "NOT_FOUND", message: "The observation to supersede is not current on this company." });
      const obs = compileObservation(co.id, o, `${co.id}-p-${idStem}`, "observations.new", col);
      diff.push({ field: "observations", before: clash ?? null, after: obs });
      return finish(e, "company_observation", { observation: obs, supersedesObservationId: p.supersedesObservationId ?? null });
    }
    case "deal_event": {
      const p = payload as { dealId: string; event: z.infer<typeof zDealEvent> };
      const d = view.dealById.get(p.dealId);
      const x = p.event;
      const e = base({ type: "deal", id: p.dealId, label: d?.title ?? p.dealId, exists: Boolean(d) }, x.statusAfter ? ["events", "status"] : ["events"], `deal_event:${p.dealId}:${x.date.date}:${x.type}:${await hash(x.title)}`);
      if (!d) {
        errors.push({ path: "payload.dealId", code: "NOT_FOUND", message: "No deal with this ID." });
        return finish(e, "event_append", {});
      }
      if (x.date.date > today) errors.push({ path: "payload.event.date", code: "FUTURE_EVENT", message: "Events must have happened (dated today or earlier)." });
      const tokens = titleTokens(x.title);
      const evDocs = new Set(x.cites.map((c) => c.doc));
      for (const o of d.events) {
        const sameDay = Math.abs(daysBetween(o.date.date, x.date.date)) <= 1;
        const sameDoc = o.ev.some((id) => evDocs.has(view.claims[id]?.documentId ?? ""));
        if (sameDay && (o.type === x.type || sameDoc) && (sameDoc || overlap(tokens, titleTokens(o.title)) >= 0.5)) duplicates.push({ against: "published", id: o.id, label: `${o.date.date} ${o.title}`, exact: true, reason: sameDoc ? "same date and same source document" : "same date, type and a very similar title" });
      }
      if (x.statusAfter && x.date.date < d.status.asOf) {
        warnings.push({
          path: "payload.event.statusAfter",
          code: "HISTORICAL_STATUS",
          message: `This event is dated before the current status (${DEAL_STATUS_LABEL[d.status.value]} as of ${d.status.asOf}). It will be added to the timeline, but the current status will not change.`,
        });
      }
      const event: EventView = { ...compileEvent(d.id, x, `pe-${idStem}`, "events.new", col), origin: "published_update" };
      diff.push({ field: "events", before: null, after: event });
      if (x.statusAfter && x.date.date >= d.status.asOf) diff.push({ field: "status", before: `${d.status.value} (${d.status.asOf})`, after: `${x.statusAfter} (${x.date.date})` });
      return finish(e, "event_append", { event });
    }
    case "claim_verification": {
      const p = payload as z.infer<(typeof PAYLOAD_SCHEMAS)["claim_verification"]>;
      const claim = view.claims[p.claimId];
      const doc = claim ? view.documents[claim.documentId] : undefined;
      const e = base({ type: "claim", id: p.claimId, label: claim ? `${claim.label}: ${claim.display}`.slice(0, 160) : p.claimId, exists: Boolean(claim) }, ["status"], `claim_verification:${p.claimId}:${p.status}`);
      if (!claim || !doc) {
        errors.push({ path: "payload.claimId", code: "NOT_FOUND", message: "No claim with this ID." });
        return finish(e, "claim_status", {});
      }
      if (p.status === "source_checked") {
        if (!p.retrievedAt) errors.push({ path: "payload.retrievedAt", code: "RETRIEVAL_REQUIRED", message: "Record when you retrieved the document (UTC); a source check means the document itself was read." });
        else if (p.retrievedAt > nowIso) errors.push({ path: "payload.retrievedAt", code: "FUTURE_RETRIEVAL", message: "The retrieval time cannot be in the future." });
        else if (doc.publishedDate && p.retrievedAt.slice(0, 10) < doc.publishedDate.date) errors.push({ path: "payload.retrievedAt", code: "RETRIEVAL_BEFORE_PUBLICATION", message: "The retrieval time is before the document's publication date." });
        if (!p.locator) errors.push({ path: "payload.locator", code: "LOCATOR_REQUIRED", message: "Give an exact locator (page, section, paragraph or table)." });
        if (!p.excerpt) errors.push({ path: "payload.excerpt", code: "EXCERPT_REQUIRED", message: "Quote a short excerpt (at most 300 characters) that supports the value." });
        if (!p.checkedValue) errors.push({ path: "payload.checkedValue", code: "CHECKED_VALUE_REQUIRED", message: "Enter the value as it appears in the document." });
        else {
          const want = numbersIn(claim.display);
          const got = new Set(numbersIn(`${p.checkedValue} ${p.excerpt ?? ""}`));
          if (want.length && !want.some((n) => got.has(n))) warnings.push({ path: "payload.checkedValue", code: "VALUE_MISMATCH", message: `The recorded claim is “${claim.display}”; none of its numbers appear in the checked value or excerpt. If the document differs, mark a conflict instead.` });
        }
      } else if (!p.note) errors.push({ path: "payload.note", code: "NOTE_REQUIRED", message: p.status === "conflict" ? "Describe the conflict and which sources disagree." : "Explain the review." });
      if (claim.status === p.status && p.status !== "source_checked") errors.push({ path: "payload.status", code: "NO_CHANGE", message: `The claim is already ${p.status.replace("_", " ")}.` });
      if (claim.status === "source_checked" && p.status !== "source_checked" && p.status !== "conflict") warnings.push({ path: "payload.status", code: "DOWNGRADE", message: "This lowers a source-checked claim; the previous check stays in the history." });
      const method = p.status === "source_checked" ? "document_retrieval" : p.status === "pending" ? claim.method : "owner_entry";
      const changePayload = {
        claimId: claim.id,
        status: p.status,
        checkedAt: p.status === "pending" ? null : today,
        method,
        note: p.note ?? (p.status === "source_checked" ? `Source checked by the site owner against the retrieved document; value found: ${p.checkedValue}.` : null),
        locator: p.locator ?? null,
        excerpt: p.excerpt ?? null,
        checkedValue: p.checkedValue ?? null,
        document: p.status === "source_checked" && p.retrievedAt ? { id: doc.id, retrievedAt: p.retrievedAt, retrievalNote: "Retrieved and read by the site owner for a source check." } : null,
      };
      diff.push({ field: "status", before: { status: claim.status, method: claim.method, checkedAt: claim.checkedAt }, after: { status: p.status, method, checkedAt: changePayload.checkedAt } });
      return finish(e, "claim_status", changePayload);
    }
  }
  }
}

/** The fields a draft touches, as recorded in history (same rule as for published changes). */
export function draftFields(e: Evaluation): string[] {
  return e.change ? changeFields(e.change.changeType, e.change.payload) : e.fields;
}
