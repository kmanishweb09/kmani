import type { AsAnnouncedView, ClaimView, EventView, PartyView, TermView } from "../api";
import { type DateValue, formatDateValue } from "../dates";
import { formatAsReported, type ScaleUnit } from "../money/units";
import type {
  Brief,
  Cite,
  Company,
  Deal,
  GlossaryTerm,
  LearningModule,
  Question,
  Sector,
  SourceDocument,
  TrainingModel,
} from "../schemas/research";
import { DEAL_STATUS_LABEL, VALUE_BASIS_LABEL } from "../labels";
import { shortHash, stableStringify } from "../text/hash";

/**
 * Compiles the authored research archive (facts with inline citations) into a serialisable form
 * where each citation becomes a claim record with a stable ID. Runs at build time; the Worker
 * loads the compiled JSON.
 */

export interface CompiledClaim extends Omit<ClaimView, "document"> {
  documentId: string;
}

export interface CompiledDeal {
  id: string;
  title: string;
  aliases: string[];
  dealType: Deal["dealType"];
  buyerType: Deal["buyerType"];
  sector: Deal["sector"];
  subsector: string;
  peerGroup: Deal["peerGroup"] | null;
  acquirer: PartyView;
  target: PartyView;
  otherParties: Array<PartyView & { role: string }>;
  perimeter: string;
  stake: { acquiredPct: number | null; resultingPct: number | null; note: string | null; ev: string[] };
  announced: DateValue & { ev: string[] };
  effective: (DateValue & { ev: string[] }) | null;
  status: { value: Deal["status"]["value"]; asOf: string; note: string | null; ev: string[] };
  terms: TermView[];
  payment: { mix: Deal["payment"]["mix"]; text: string; ev: string[] };
  financing: { text: string; ev: string[] } | null;
  events: EventView[];
  advisers: { disclosure: string; list: Array<{ side: string; role: string; name: string; ev: string[] }>; note: string | null };
  rationale: Array<{ text: string; ev: string[] }>;
  sectorContext: string | null;
  comparables: Array<{ dealId: string; reason: string }>;
  afterDeal: Array<{ date: string | null; kind: "fact" | "interpretation"; text: string; ev: string[] }>;
  autopsy: CompiledAutopsy | null;
  asAnnounced: AsAnnouncedView | null;
  tags: string[];
  researchCutoff: string;
  recordUpdated: string;
}

export interface CompiledAutopsy {
  asAnnounced: NonNullable<Deal["autopsy"]>["asAnnounced"];
  whatWeKnowNow: {
    cutoff: string;
    facts: Array<{ text: string; ev: string[] }>;
    interpretation: string[];
    evidenceLimits: string | null;
  };
  analysis: NonNullable<Deal["autopsy"]>["analysis"];
  prompts: string[];
  rubric: NonNullable<Deal["autopsy"]>["rubric"];
}

export interface CompiledCompany extends Omit<Company, "identityCites" | "observations" | "ownership"> {
  identityEv: string[];
  observations: Array<Omit<Company["observations"][number], "cites"> & { id: string; ev: string[] }>;
  ownership: Array<Omit<Company["ownership"][number], "cites"> & { ev: string[] }>;
}

export interface CompiledSector extends Omit<Sector, "regulators" | "whatChanged"> {
  regulators: Array<Omit<Sector["regulators"][number], "cites"> & { ev: string[] }>;
  whatChanged: Array<Omit<Sector["whatChanged"][number], "cites"> & { ev: string[] }>;
}

export interface CompiledBrief extends Omit<Brief, "items"> {
  items: Array<Omit<Brief["items"][number], "cites"> & { ev: string[] }>;
}

export interface CompiledArchive {
  format: "manish-finance-archive";
  version: string;
  cutoff: string;
  documents: Record<string, SourceDocument>;
  claims: Record<string, CompiledClaim>;
  deals: CompiledDeal[];
  companies: CompiledCompany[];
  sectors: CompiledSector[];
  glossary: GlossaryTerm[];
  modules: LearningModule[];
  questions: Question[];
  briefs: CompiledBrief[];
  training: TrainingModel[];
}

export interface ArchiveSource {
  cutoff: string;
  documents: SourceDocument[];
  deals: Deal[];
  companies: Company[];
  sectors: Sector[];
  glossary: GlossaryTerm[];
  modules: LearningModule[];
  questions: Question[];
  briefs: Brief[];
  training: TrainingModel[];
}

const METRIC_LABEL: Record<string, string> = {
  enterprise_value: "Enterprise value",
  equity_value: "Equity value",
  stake_consideration: "Stake consideration",
  value_unclear_basis: "Reported value (basis unclear)",
  offer_price_per_share: "Offer price per share",
  share_exchange_ratio: "Share exchange ratio",
  offer_premium: "Offer premium",
  ev_revenue: "EV / Revenue",
  ev_ebitda: "EV / EBITDA",
  price_to_book: "P / B",
  price_to_earnings: "P / E",
  break_fee: "Break fee",
  earn_out: "Earn-out",
  capital_injection: "Capital injection",
  debt_assumed: "Debt assumed",
  other: "Other term",
};

export function termLabel(metric: string, label?: string | null): string {
  return label ?? METRIC_LABEL[metric] ?? metric;
}

export function termDisplay(t: { metric: string; amount: number | null; currency?: string | null; unit?: string | null; ratio?: number | null; text?: string | null; valueBasis?: string | null; ownershipPct?: number | null }): string {
  const parts: string[] = [];
  if (t.amount !== null && t.currency && t.unit) {
    parts.push(formatAsReported({ amount: t.amount, currency: t.currency, unit: t.unit as ScaleUnit }));
  } else if (t.ratio !== null && t.ratio !== undefined) {
    if (t.metric === "offer_premium") parts.push(`${(t.ratio * 100).toFixed(1)}%`);
    else parts.push(`${t.ratio.toFixed(2)}×`);
  }
  if (t.text) parts.push(t.text);
  if (t.valueBasis) parts.push(`(${VALUE_BASIS_LABEL[t.valueBasis as keyof typeof VALUE_BASIS_LABEL] ?? t.valueBasis}${t.ownershipPct !== null && t.ownershipPct !== undefined ? `, ${t.ownershipPct}%` : ""})`);
  return parts.join(" ") || "—";
}

class ClaimCollector {
  claims: Record<string, CompiledClaim> = {};
  constructor(private readonly docs: Record<string, SourceDocument>) {}

  add(subject: CompiledClaim["subject"], field: string, label: string, display: string, cites: Cite[] | undefined | null): string[] {
    if (!cites?.length) return [];
    return cites.map((c, i) => {
      if (!this.docs[c.doc]) throw new Error(`Unknown document ${c.doc} cited by ${subject.type}:${subject.id} ${field}`);
      let id = `ev-${shortHash(`${subject.type}|${subject.id}|${field}|${c.doc}|${i}`)}`;
      let n = 1;
      while (this.claims[id]) id = `ev-${shortHash(`${subject.type}|${subject.id}|${field}|${c.doc}|${i}|${n++}`)}`;
      this.claims[id] = {
        id,
        subject,
        field,
        label,
        display,
        documentId: c.doc,
        locator: c.locator ?? null,
        excerpt: c.excerpt ?? null,
        status: c.status,
        checkedAt: c.checkedAt,
        method: c.method,
        note: c.note ?? null,
      };
      return id;
    });
  }
}

function party(col: ClaimCollector, dealId: string, field: string, label: string, p: Deal["acquirer"]): PartyView {
  return { companyId: p.companyId ?? null, name: p.name, country: p.country, ev: col.add({ type: "deal", id: dealId }, field, label, p.name, p.cites) };
}

function stakeDisplay(s: Deal["stake"]): string {
  const parts: string[] = [];
  if (s.acquiredPct !== null) parts.push(`${s.acquiredPct}% acquired`);
  if (s.resultingPct !== null) parts.push(`${s.resultingPct}% held after`);
  if (!parts.length) return s.note ?? "Stake not disclosed";
  return parts.join("; ");
}

export function compileDeal(d: Deal, col: ClaimCollector): CompiledDeal {
  const subject = { type: "deal" as const, id: d.id };
  const terms: TermView[] = d.terms.map((t, i) => {
    const label = termLabel(t.metric, t.label);
    return {
      id: `${d.id}-t${i}`,
      metric: t.metric,
      label,
      amount: t.amount ?? null,
      currency: t.currency ?? null,
      unit: t.unit ?? null,
      ratio: t.ratio ?? null,
      text: t.text ?? null,
      valueBasis: t.valueBasis ?? null,
      ownershipPct: t.ownershipPct ?? null,
      kind: t.kind,
      asOf: t.asOf,
      reference: t.reference ?? null,
      status: t.status,
      note: t.note ?? null,
      headline: t.headline ?? false,
      multipleBasis: t.multipleBasis ?? null,
      ev: col.add(subject, `terms.${i}`, label, termDisplay({ ...t, amount: t.amount ?? null }), t.cites),
    };
  });
  const events: EventView[] = d.events.map((e, i) => ({
    id: `${d.id}-e${i}`,
    type: e.type,
    date: { date: e.date.date, precision: e.date.precision },
    publishedDate: e.publishedDate ?? null,
    title: e.title,
    detail: e.detail ?? null,
    jurisdiction: e.jurisdiction ?? null,
    authority: e.authority ?? null,
    statusAfter: e.statusAfter ?? null,
    whyItMatters: e.whyItMatters ?? null,
    ev: col.add(subject, `events.${i}`, e.title, `${formatDateValue(e.date)}: ${e.title}`, e.cites),
    origin: "archive" as const,
  }));
  const autopsy: CompiledAutopsy | null = d.autopsy
    ? {
        asAnnounced: d.autopsy.asAnnounced,
        whatWeKnowNow: {
          cutoff: d.autopsy.whatWeKnowNow.cutoff,
          facts: d.autopsy.whatWeKnowNow.facts.map((f, i) => ({ text: f.text, ev: col.add(subject, `autopsy.facts.${i}`, "Outcome (fact)", f.text.slice(0, 160), f.cites) })),
          interpretation: d.autopsy.whatWeKnowNow.interpretation,
          evidenceLimits: d.autopsy.whatWeKnowNow.evidenceLimits ?? null,
        },
        analysis: d.autopsy.analysis,
        prompts: d.autopsy.prompts,
        rubric: d.autopsy.rubric,
      }
    : null;
  return {
    id: d.id,
    title: d.title,
    aliases: d.aliases,
    dealType: d.dealType,
    buyerType: d.buyerType,
    sector: d.sector,
    subsector: d.subsector,
    peerGroup: d.peerGroup,
    acquirer: party(col, d.id, "acquirer", "Acquirer", d.acquirer),
    target: party(col, d.id, "target", "Target", d.target),
    otherParties: d.otherParties.map((p, i) => ({ ...party(col, d.id, `otherParties.${i}`, `Party (${p.role.replace("_", " ")})`, p), role: p.role })),
    perimeter: d.perimeter,
    stake: {
      acquiredPct: d.stake.acquiredPct,
      resultingPct: d.stake.resultingPct,
      note: d.stake.note ?? null,
      ev: col.add(subject, "stake", "Stake", stakeDisplay(d.stake), d.stake.cites),
    },
    announced: { date: d.announced.date, precision: d.announced.precision, ev: col.add(subject, "announced", "Announcement date", formatDateValue(d.announced), d.announced.cites) },
    effective: d.effective
      ? { date: d.effective.date, precision: d.effective.precision, ev: col.add(subject, "effective", "Effective/completion date", formatDateValue(d.effective), d.effective.cites) }
      : null,
    status: { value: d.status.value, asOf: d.status.asOf, note: d.status.note ?? null, ev: col.add(subject, "status", "Status", `${DEAL_STATUS_LABEL[d.status.value]} (as of ${formatDateValue(d.status.asOf)})`, d.status.cites) },
    terms,
    payment: { mix: d.payment.mix, text: d.payment.text, ev: col.add(subject, "payment", "Consideration", d.payment.text, d.payment.cites) },
    financing: d.financing ? { text: d.financing.text, ev: col.add(subject, "financing", "Financing", d.financing.text, d.financing.cites) } : null,
    events,
    advisers: {
      disclosure: d.advisers.disclosure,
      list: d.advisers.list.map((a, i) => ({ side: a.side, role: a.role, name: a.name, ev: col.add(subject, `advisers.${i}`, `${a.side} ${a.role} adviser`, a.name, a.cites) })),
      note: d.advisers.note ?? null,
    },
    rationale: d.rationale.map((r, i) => ({ text: r.text, ev: col.add(subject, `rationale.${i}`, "Stated rationale", r.text.slice(0, 160), r.cites) })),
    sectorContext: d.sectorContext ?? null,
    comparables: d.comparables,
    afterDeal: d.afterDeal.map((a, i) => ({ date: a.date ?? null, kind: a.kind, text: a.text, ev: col.add(subject, `afterDeal.${i}`, a.kind === "fact" ? "Subsequent fact" : "Interpretation", a.text.slice(0, 160), a.cites) })),
    autopsy,
    asAnnounced: d.asAnnounced
      ? {
          title: d.asAnnounced.title ?? null,
          perimeter: d.asAnnounced.perimeter ?? null,
          payment: d.asAnnounced.payment
            ? { mix: d.asAnnounced.payment.mix, text: d.asAnnounced.payment.text, ev: col.add(subject, "asAnnounced.payment", "Consideration (as announced)", d.asAnnounced.payment.text, d.asAnnounced.payment.cites) }
            : null,
          stake: d.asAnnounced.stake
            ? {
                acquiredPct: d.asAnnounced.stake.acquiredPct,
                resultingPct: d.asAnnounced.stake.resultingPct,
                note: d.asAnnounced.stake.note ?? null,
                ev: col.add(subject, "asAnnounced.stake", "Stake (as announced)", stakeDisplay(d.asAnnounced.stake), d.asAnnounced.stake.cites),
              }
            : null,
          financing: d.asAnnounced.financing ? { text: d.asAnnounced.financing.text, ev: col.add(subject, "asAnnounced.financing", "Financing (as announced)", d.asAnnounced.financing.text, d.asAnnounced.financing.cites) } : null,
        }
      : null,
    tags: d.tags,
    researchCutoff: d.researchCutoff,
    recordUpdated: d.recordUpdated,
  };
}

const OBS_LABEL: Record<string, string> = {
  revenue: "Revenue",
  total_income: "Total income",
  ebitda: "EBITDA",
  ebit: "EBIT",
  net_income: "Net income",
  pat_attributable: "PAT attributable to owners",
  total_assets: "Total assets",
  net_worth: "Net worth",
  total_deposits: "Total deposits",
  gross_advances: "Gross advances",
  net_advances: "Net advances",
  nim: "Net interest margin",
  gnpa_ratio: "Gross NPA ratio",
  nnpa_ratio: "Net NPA ratio",
  casa_ratio: "CASA ratio",
  crar: "Capital adequacy ratio (CRAR)",
  cet1_ratio: "CET1 ratio",
  roa: "Return on assets",
  roe: "Return on equity",
  aum: "Assets under management",
  vnb: "Value of new business",
  vnb_margin: "VNB margin",
  ape: "Annualised premium equivalent",
  embedded_value: "Embedded value",
  combined_ratio: "Combined ratio",
  gross_written_premium: "Gross written premium",
  employees: "Employees",
  customers: "Customers",
  subscribers: "Subscribers",
  arpu: "ARPU",
  beds: "Beds",
  occupancy: "Occupancy",
  arpob: "ARPOB",
  capacity_mw: "Installed capacity",
  order_book: "Order book",
  pre_sales: "Pre-sales (bookings)",
  leased_area: "Leased area",
  occupancy_commercial: "Committed occupancy",
  gmv: "Gross merchandise value",
  orders: "Orders",
  other: "Other",
};

export function observationLabel(metric: string, label?: string | null): string {
  return label ?? OBS_LABEL[metric] ?? metric;
}

export function observationDisplay(o: { value: number | null; unit: string; currency?: string | null; scale?: string | null; nullReason?: string | null }): string {
  if (o.value === null) return o.nullReason ? `Not available (${o.nullReason})` : "Not available";
  if (o.unit === "currency" && o.currency && o.scale) return formatAsReported({ amount: o.value, currency: o.currency, unit: o.scale as ScaleUnit });
  if (o.unit === "percent") return `${o.value}%`;
  if (o.unit === "ratio") return `${o.value}×`;
  if (o.unit === "mw") return `${o.value.toLocaleString("en-US")} MW`;
  if (o.unit === "sq_ft_million") return `${o.value} million sq ft`;
  return o.scale && o.scale !== "one" ? `${o.value} ${o.scale}` : o.value.toLocaleString("en-US");
}

export function compileCompany(c: Company, col: ClaimCollector): CompiledCompany {
  const subject = { type: "company" as const, id: c.id };
  const { identityCites, observations, ownership, ...rest } = c;
  return {
    ...rest,
    identityEv: col.add(subject, "identity", "Identity (legal name, listing, country)", `${c.legalName} (${c.country})`, identityCites),
    observations: observations.map((o, i) => {
      const { cites, ...ob } = o;
      const label = `${observationLabel(o.metric, o.label)} — ${o.period.label}`;
      return { ...ob, id: `${c.id}-o${i}`, ev: col.add(subject, `observations.${i}`, label, observationDisplay(o), cites) };
    }),
    ownership: ownership.map((o, i) => {
      const { cites, ...ow } = o;
      return { ...ow, ev: col.add(subject, `ownership.${i}`, "Shareholding", `${o.holder}: ${o.pct ?? "?"}% (as of ${o.asOf})`, cites) };
    }),
  };
}

export function compileSector(s: Sector, col: ClaimCollector): CompiledSector {
  const subject = { type: "sector" as const, id: s.slug };
  const { regulators, whatChanged, ...rest } = s;
  return {
    ...rest,
    regulators: regulators.map((r, i) => {
      const { cites, ...rr } = r;
      return { ...rr, ev: col.add(subject, `regulators.${i}`, `Regulator: ${r.body}`, r.role, cites) };
    }),
    whatChanged: whatChanged.map((w, i) => {
      const { cites, ...ww } = w;
      return { ...ww, ev: col.add(subject, `whatChanged.${i}`, w.title, `${w.date}: ${w.title}`, cites) };
    }),
  };
}

export function compileBrief(b: Brief, col: ClaimCollector): CompiledBrief {
  const subject = { type: "brief" as const, id: b.id };
  return {
    ...b,
    items: b.items.map((it, i) => {
      const { cites, ...rest } = it;
      return { ...rest, ev: col.add(subject, `items.${i}`, it.headline, it.whatChanged.slice(0, 160), cites) };
    }),
  };
}

export function compileArchive(src: ArchiveSource): CompiledArchive {
  const documents: Record<string, SourceDocument> = {};
  for (const d of src.documents) {
    if (documents[d.id]) throw new Error(`Duplicate document id ${d.id}`);
    documents[d.id] = d;
  }
  const col = new ClaimCollector(documents);
  const deals = src.deals.map((d) => compileDeal(d, col));
  const companies = src.companies.map((c) => compileCompany(c, col));
  const sectors = src.sectors.map((s) => compileSector(s, col));
  const briefs = src.briefs.map((b) => compileBrief(b, col));
  resolveReferences(deals, companies, sectors);
  const body = { documents, claims: col.claims, deals, companies, sectors, glossary: src.glossary, modules: src.modules, questions: src.questions, briefs, training: src.training };
  const version = `archive-${src.cutoff}-${shortHash(stableStringify(body), 10)}`;
  return { format: "manish-finance-archive", version, cutoff: src.cutoff, ...body };
}

export interface UnresolvedReference {
  from: string;
  field: string;
  ref: string;
}

/**
 * Links between records must resolve, so the UI never links to a missing dossier. Unresolved company
 * links are dropped to plain names; unresolved comparables and sector players are removed.
 * `findUnresolvedReferences` reports the same set so `verify:content` can list them.
 */
function resolveReferences(deals: CompiledDeal[], companies: CompiledCompany[], sectors: CompiledSector[]): void {
  const companyIds = new Set(companies.map((c) => c.id));
  const dealIds = new Set(deals.map((d) => d.id));
  const fix = (p: PartyView) => {
    if (p.companyId && !companyIds.has(p.companyId)) p.companyId = null;
  };
  for (const d of deals) {
    fix(d.acquirer);
    fix(d.target);
    d.otherParties.forEach(fix);
    d.comparables = d.comparables.filter((c) => dealIds.has(c.dealId) && c.dealId !== d.id);
  }
  for (const c of companies) {
    c.peers = c.peers.filter((p) => companyIds.has(p.companyId));
    if (c.lifecycle.successorId && !companyIds.has(c.lifecycle.successorId)) c.lifecycle.successorId = null;
    if (c.lifecycle.parentId && !companyIds.has(c.lifecycle.parentId)) c.lifecycle.parentId = null;
  }
  for (const s of sectors) {
    s.players = s.players.filter((p) => companyIds.has(p.companyId));
    for (const v of s.valueChain) v.examples = v.examples.filter((id) => companyIds.has(id));
  }
}

export function findUnresolvedReferences(src: ArchiveSource): UnresolvedReference[] {
  const companyIds = new Set(src.companies.map((c) => c.id));
  const dealIds = new Set(src.deals.map((d) => d.id));
  const out: UnresolvedReference[] = [];
  const party = (from: string, field: string, id: string | null | undefined) => {
    if (id && !companyIds.has(id)) out.push({ from, field, ref: id });
  };
  for (const d of src.deals) {
    party(`deal:${d.id}`, "acquirer", d.acquirer.companyId);
    party(`deal:${d.id}`, "target", d.target.companyId);
    d.otherParties.forEach((p, i) => party(`deal:${d.id}`, `otherParties.${i}`, p.companyId));
    for (const c of d.comparables) if (!dealIds.has(c.dealId)) out.push({ from: `deal:${d.id}`, field: "comparables", ref: c.dealId });
  }
  for (const c of src.companies) {
    for (const p of c.peers) if (!companyIds.has(p.companyId)) out.push({ from: `company:${c.id}`, field: "peers", ref: p.companyId });
    party(`company:${c.id}`, "lifecycle.successorId", c.lifecycle.successorId);
    party(`company:${c.id}`, "lifecycle.parentId", c.lifecycle.parentId);
  }
  for (const s of src.sectors) {
    for (const p of s.players) if (!companyIds.has(p.companyId)) out.push({ from: `sector:${s.slug}`, field: "players", ref: p.companyId });
    for (const v of s.valueChain) for (const id of v.examples ?? []) if (!companyIds.has(id)) out.push({ from: `sector:${s.slug}`, field: "valueChain.examples", ref: id });
  }
  return out;
}
