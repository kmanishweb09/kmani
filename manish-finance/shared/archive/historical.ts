import type { ClaimView, DealDetail, TermView } from "../api";
import type { DateValue } from "../dates";
import { multiplesOf, pickHeadline, verificationSummary } from "./derive";

/**
 * Historical ("as announced") view of a deal. Everything shown must have been knowable at the
 * cutoff. A dated term is kept when at least one source published by the cutoff states it; text
 * fields (stake, consideration, financing, rationale, advisers) are kept only when every source
 * behind them was published by the cutoff, because their wording may reflect later documents. Month/quarter/year-precision dates count only once the whole period has ended.
 * Anything without contemporaneous evidence is withheld and listed as unavailable, never guessed.
 */

export interface HiddenField {
  /** Stable field key (used by the page to render "Unavailable at this cutoff"). */
  field: string;
  label: string;
  reason: string;
}

export interface HistoricalDeal {
  deal: DealDetail;
  cutoff: string;
  hidden: HiddenField[];
  hiddenFields: string[];
  /** True when the current title was replaced by a neutral or authored as-announced title. */
  titleReplaced: boolean;
}

const HEADLINE_METRICS = new Set(["enterprise_value", "equity_value", "stake_consideration", "value_unclear_basis"]);

function lastDayOfMonth(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Last calendar day of the period a date value denotes (`2017-12-01` month → `2017-12-31`). */
export function periodEnd(v: DateValue): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.date);
  if (!m) return v.date;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  switch (v.precision) {
    case "year":
      return `${y}-12-31`;
    case "quarter":
      return lastDayOfMonth(y, Math.floor((mo - 1) / 3) * 3 + 3);
    case "month":
      return lastDayOfMonth(y, mo);
    default:
      return v.date;
  }
}

/** Whether something dated `v` was knowable on `cutoff` (unknown dates are treated as not knowable). */
export function knownBy(v: DateValue | null | undefined, cutoff: string): boolean {
  return Boolean(v) && periodEnd(v as DateValue) <= cutoff;
}

/** A 4-digit year later than the cutoff year inside free text suggests hindsight wording. */
export function mentionsLaterYear(text: string | null | undefined, cutoff: string): boolean {
  if (!text) return false;
  const cy = Number(cutoff.slice(0, 4));
  for (const m of text.matchAll(/\b(19|20)\d{2}\b/g)) if (Number(m[0]) > cy) return true;
  return false;
}

export function dealAsOf(deal: DealDetail, cutoff: string): HistoricalDeal {
  const evidence = deal.evidence;
  const hidden: HiddenField[] = [];
  const hide = (field: string, label: string, reason: string) => hidden.push({ field, label, reason });
  const claimKnown = (id: string): boolean => {
    const c: ClaimView | undefined = evidence[id];
    return Boolean(c) && knownBy(c?.document.publishedDate, cutoff);
  };
  const allKnown = (ids: string[]) => ids.length > 0 && ids.every(claimKnown);
  const knownIds = (ids: string[]) => ids.filter(claimKnown);
  const alt = deal.asAnnounced;
  const LATER = "Only sources published after the cutoff support it";

  // Title: authored as-announced title, else a neutral party-based title (current titles may carry hindsight).
  const title = alt?.title ?? `${deal.acquirer.name} / ${deal.target.name}`;

  // Terms: dated on or before the cutoff, not final, and supported by contemporaneous evidence.
  // A supersession published after the cutoff had not happened yet.
  let laterTerms = 0;
  let unsupportedTerms = 0;
  const terms: TermView[] = [];
  for (const t of deal.terms) {
    if (t.asOf > cutoff || t.kind === "final") {
      laterTerms += 1;
      continue;
    }
    // A number dated on or before the cutoff is knowable if any contemporaneous source states it;
    // later sources that repeat it are dropped from its evidence.
    const ev = knownIds(t.ev);
    if (!ev.length) {
      unsupportedTerms += 1;
      continue;
    }
    const base = t.correction && t.correction.publishedAt.slice(0, 10) > cutoff ? { ...t, correction: null } : t;
    terms.push({ ...base, ev });
  }
  if (laterTerms) hide("terms.later", `${laterTerms} later term${laterTerms === 1 ? "" : "s"}`, "Revised or final terms dated after the cutoff");
  if (unsupportedTerms) hide("terms.unsupported", `${unsupportedTerms} term${unsupportedTerms === 1 ? "" : "s"} dated before the cutoff`, LATER);

  // Events: occurred by the cutoff and supported by a contemporaneous source.
  let laterEvents = 0;
  let unsupportedEvents = 0;
  const events = deal.events.filter((e) => {
    if (!knownBy(e.date, cutoff) || (e.publishedDate !== null && e.publishedDate > cutoff)) {
      laterEvents += 1;
      return false;
    }
    if (!e.ev.some(claimKnown)) {
      unsupportedEvents += 1;
      return false;
    }
    return true;
  }).map((e) => ({ ...e, ev: knownIds(e.ev) }));
  if (laterEvents) hide("events.later", `${laterEvents} later event${laterEvents === 1 ? "" : "s"}`, "Dated after the cutoff");
  if (unsupportedEvents) hide("events.unsupported", `${unsupportedEvents} earlier event${unsupportedEvents === 1 ? "" : "s"}`, LATER);

  // Status at the cutoff: the last known event that moved the status, else "announced".
  const statusEvent = [...events].reverse().find((e) => e.statusAfter);
  const announcedEv = knownIds(deal.announced.ev);
  const status = statusEvent?.statusAfter ?? "announced";
  const statusAsOf = statusEvent ? statusEvent.date.date : deal.announced.date;
  const statusEv = statusEvent ? statusEvent.ev : announcedEv;

  // Completion.
  let effective = deal.effective;
  if (effective && !(knownBy(effective, cutoff) && allKnown(effective.ev))) {
    effective = null;
    hide("effective", "Completion date", "Not reached, or not sourced, by the cutoff");
  }

  // Parties: names of the two principals are part of the announcement; other parties need evidence.
  const otherParties = deal.otherParties.filter((p) => p.ev.some(claimKnown)).map((p) => ({ ...p, ev: knownIds(p.ev) }));
  const droppedParties = deal.otherParties.length - otherParties.length;
  if (droppedParties) hide("otherParties", `${droppedParties} other part${droppedParties === 1 ? "y" : "ies"}`, "First sourced after the cutoff");

  // Stake.
  let stake = deal.stake;
  let stakeEv = deal.stakeEv;
  let stakeNote = deal.stakeNote;
  if (alt?.stake) {
    stake = { acquiredPct: alt.stake.acquiredPct, resultingPct: alt.stake.resultingPct };
    stakeEv = alt.stake.ev;
    stakeNote = alt.stake.note;
  } else if (!allKnown(deal.stakeEv) || mentionsLaterYear(deal.stakeNote, cutoff)) {
    stake = { acquiredPct: null, resultingPct: null };
    stakeEv = [];
    stakeNote = null;
    hide("stake", "Stake", LATER);
  }

  // Consideration.
  let payment = deal.payment;
  if (alt?.payment) payment = alt.payment;
  else if (!allKnown(deal.payment.ev) || mentionsLaterYear(deal.payment.text, cutoff)) {
    payment = { mix: [], text: "", ev: [] };
    hide("payment", "Consideration", LATER);
  }

  // Financing.
  let financing = deal.financing;
  if (alt?.financing) financing = alt.financing;
  else if (financing && (!allKnown(financing.ev) || mentionsLaterYear(financing.text, cutoff))) {
    financing = null;
    hide("financing", "Financing", LATER);
  }

  // Perimeter has no evidence of its own; withhold it when a later revision could have changed it.
  let perimeter = deal.perimeter;
  if (alt?.perimeter) perimeter = alt.perimeter;
  else if (deal.events.some((e) => e.type === "revision" && !knownBy(e.date, cutoff)) || mentionsLaterYear(perimeter, cutoff)) {
    perimeter = "";
    hide("perimeter", "Perimeter", "The recorded perimeter reflects a revision after the cutoff");
  }

  const rationale = deal.rationale.filter((r) => allKnown(r.ev) && !mentionsLaterYear(r.text, cutoff));
  if (rationale.length < deal.rationale.length) hide("rationale", `${deal.rationale.length - rationale.length} stated rationale item(s)`, LATER);

  const adviserList = deal.advisers.list.filter((a) => allKnown(a.ev));
  if (adviserList.length < deal.advisers.list.length) hide("advisers", `${deal.advisers.list.length - adviserList.length} adviser role(s)`, LATER);

  if (deal.sectorContext) hide("sectorContext", "Deal-specific sector note", "Written with hindsight");
  if (deal.afterDeal.length) hide("afterDeal", "After-the-deal observations", "After the cutoff by definition");

  const comparables = deal.comparables.filter((c) => c.announced !== null && c.announced !== undefined && c.announced <= cutoff);
  if (comparables.length < deal.comparables.length) hide("comparables", `${deal.comparables.length - comparables.length} comparable deal(s)`, "Announced after the cutoff");

  const headline = pickHeadline(terms);
  const acquirer = { ...deal.acquirer, ev: knownIds(deal.acquirer.ev) };
  const target = { ...deal.target, ev: knownIds(deal.target.ev) };
  const ids = new Set<string>([
    ...acquirer.ev,
    ...target.ev,
    ...otherParties.flatMap((p) => p.ev),
    ...stakeEv,
    ...announcedEv,
    ...(effective?.ev ?? []),
    ...statusEv,
    ...terms.flatMap((t) => t.ev),
    ...payment.ev,
    ...(financing?.ev ?? []),
    ...events.flatMap((e) => e.ev),
    ...adviserList.flatMap((a) => a.ev),
    ...rationale.flatMap((r) => r.ev),
  ]);
  const shownEvidence: Record<string, ClaimView> = {};
  for (const id of ids) {
    const c = evidence[id];
    if (c) shownEvidence[id] = c;
  }
  const latest = events.length ? events[events.length - 1] : null;

  const shown: DealDetail = {
    ...deal,
    title,
    acquirer,
    target,
    announced: { ...deal.announced, ev: announcedEv },
    status,
    statusAsOf,
    statusEv,
    stake,
    stakeEv,
    stakeNote,
    headline,
    valueDisclosed: terms.some((t) => HEADLINE_METRICS.has(t.metric) && t.amount !== null),
    paymentMix: payment.mix,
    payment,
    financing,
    perimeter,
    effective,
    otherParties,
    terms,
    events,
    advisers: { ...deal.advisers, list: adviserList },
    adviserNames: adviserList.map((a) => a.name),
    rationale,
    sectorContext: null,
    afterDeal: [],
    comparables,
    latestEvent: latest ? { type: latest.type, date: latest.date, title: latest.title } : null,
    ...multiplesOf(terms),
    verification: verificationSummary([...ids], shownEvidence),
    evidence: shownEvidence,
  };
  return { deal: shown, cutoff, hidden, hiddenFields: hidden.map((h) => h.field), titleReplaced: title !== deal.title };
}

/** The as-announced cutoff for a deal: the autopsy's information cutoff, else the announcement date. */
export function announcedCutoff(deal: Pick<DealDetail, "announced" | "autopsy">): string {
  const a = deal.autopsy as { asAnnounced?: { cutoff?: string } } | null;
  return a?.asAnnounced?.cutoff ?? deal.announced.date;
}
