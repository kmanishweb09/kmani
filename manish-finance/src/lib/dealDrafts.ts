import type { ClaimView, DealDetail } from "../../shared/api";
import type { HistoricalDeal } from "../../shared/archive/historical";
import { formatDateValue } from "../../shared/dates";
import { countryName } from "../../shared/geo";
import { DEAL_STATUS_LABEL, DEAL_TYPE_LABEL, type CardTypeValue, PAYMENT_LABEL, SECTOR_NAMES } from "../../shared/labels";
import { headlineText } from "./format";

/** Deterministic drafts built only from sourced deal facts (no AI). */

function cite(ids: string[]): string {
  return ids.length ? ` [${ids.slice(0, 3).join(", ")}]` : "";
}

export function sourcesList(evidence: Record<string, ClaimView>, ids: string[]): string {
  const docs = new Map<string, ClaimView["document"]>();
  for (const id of ids) {
    const c = evidence[id];
    if (c) docs.set(c.document.id, c.document);
  }
  return [...docs.values()].map((d) => `- ${d.publisher}, “${d.title}”${d.publishedDate ? ` (${formatDateValue(d.publishedDate)})` : ""}: ${d.url}`).join("\n");
}

const UNAVAILABLE = "unavailable at this cutoff";

/**
 * Draft note from sourced facts. With `historical`, `d` must be the as-of view (dealAsOf) and the
 * note is labelled with the information cutoff and lists what was withheld.
 */
export function dealNoteDraft(d: DealDetail, cutoff: string, historical?: Pick<HistoricalDeal, "cutoff" | "hidden" | "hiddenFields"> | null): { title: string; body: string; evidenceIds: string[] } {
  const h = headlineText(d.headline);
  const hiddenField = (f: string) => Boolean(historical?.hiddenFields.includes(f));
  const ids = new Set<string>([...d.acquirer.ev, ...d.target.ev, ...d.announced.ev, ...d.statusEv, ...(d.headline?.ev ?? []), ...d.payment.ev, ...d.rationale.flatMap((r) => r.ev)]);
  const intro = historical
    ? `_Historical view: information cutoff ${historical.cutoff} (as announced). Only facts from sources published by then are included; later revisions and outcomes are excluded. Evidence IDs in brackets; analysis and opinions below are mine._${historical.hidden.length ? `\n\n_Withheld at this cutoff: ${historical.hidden.map((x) => `${x.label} (${x.reason.toLowerCase()})`).join("; ")}._` : ""}`
    : `_Research cutoff: ${cutoff}. Facts are from the Finance Desk archive with evidence IDs in brackets; analysis and opinions below are mine._`;
  const stake = hiddenField("stake") ? UNAVAILABLE : `stake acquired ${d.stake.acquiredPct ?? "not disclosed"}%${d.stake.resultingPct !== null ? `, held after ${d.stake.resultingPct}%` : ""}${cite(d.stakeEv)}`;
  const consideration = hiddenField("payment") ? UNAVAILABLE : `${d.paymentMix.map((p) => PAYMENT_LABEL[p]).join(", ")} — ${d.payment.text}${cite(d.payment.ev)}`;
  const body = `${intro}

## Transaction facts
- Acquirer: ${d.acquirer.name} (${countryName(d.acquirer.country)})${cite(d.acquirer.ev)}
- Target: ${d.target.name} (${countryName(d.target.country)})${cite(d.target.ev)}
- Perimeter: ${d.perimeter || UNAVAILABLE}
- Structure: ${DEAL_TYPE_LABEL[d.dealType]}; ${stake}
- Announced: ${formatDateValue(d.announced)}${cite(d.announced.ev)}; status: ${DEAL_STATUS_LABEL[d.status]} as of ${formatDateValue(d.statusAsOf)}${cite(d.statusEv)}
- Value: ${d.headline ? `${h.value} (${h.basis})` : historical ? `Not disclosed in sources available at the cutoff` : "Undisclosed"}${cite(d.headline?.ev ?? [])}
- Consideration: ${consideration}

## Strategic rationale
${d.rationale.length ? d.rationale.map((r) => `- Stated: ${r.text}${cite(r.ev)}`).join("\n") : hiddenField("rationale") ? "- No stated rationale in sources available at the cutoff." : "- No stated rationale recorded."}
- My interpretation:

## Price and structure
-

## Sector context (${SECTOR_NAMES[d.sector]} · ${d.subsector})
-

## Synergies and risks
-

## My view
-

## Unanswered questions
-

## Sources
${sourcesList(d.evidence, [...ids])}
`;
  return { title: historical ? `Deal note (as announced, ${historical.cutoff}): ${d.title}` : `Deal note: ${d.title}`, body, evidenceIds: [...ids] };
}

export interface CardDraft {
  cardType: CardTypeValue;
  prompt: string;
  answer: string;
  sourceRefs: Array<{ kind: "claim" | "note"; id: string }>;
}

export function memoryDrafts(d: DealDetail): CardDraft[] {
  const h = headlineText(d.headline);
  const claims = (ids: string[]) => ids.slice(0, 6).map((id) => ({ kind: "claim" as const, id }));
  const drafts: CardDraft[] = [
    {
      cardType: "who_bought_what",
      prompt: `Who bought what in “${d.title}”?`,
      answer: `${d.acquirer.name} → ${d.target.name}: ${DEAL_TYPE_LABEL[d.dealType].toLowerCase()}${d.stake.acquiredPct !== null ? ` of ${d.stake.acquiredPct}%` : ""}. Perimeter: ${d.perimeter || UNAVAILABLE}`,
      sourceRefs: claims([...d.acquirer.ev, ...d.target.ev, ...d.stakeEv]),
    },
    {
      cardType: "consideration_structure",
      prompt: `How was “${d.title}” paid for and structured?`,
      answer: `${d.payment.text || `Consideration ${UNAVAILABLE}.`}${d.headline ? ` Headline value: ${h.value} (${h.basis}).` : " Value undisclosed."}${d.financing ? ` Financing: ${d.financing.text}` : ""}`,
      sourceRefs: claims([...d.payment.ev, ...(d.headline?.ev ?? []), ...(d.financing?.ev ?? [])]),
    },
  ];
  if (d.rationale.length) {
    drafts.push({
      cardType: "rationale",
      prompt: `What rationale did management state for “${d.title}”?`,
      answer: d.rationale.map((r) => r.text).join(" "),
      sourceRefs: claims(d.rationale.flatMap((r) => r.ev)),
    });
  }
  return drafts;
}
