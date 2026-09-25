import type { ClaimView, DealDetail } from "../../shared/api";
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

export function dealNoteDraft(d: DealDetail, cutoff: string): { title: string; body: string; evidenceIds: string[] } {
  const h = headlineText(d.headline);
  const ids = new Set<string>([...d.acquirer.ev, ...d.target.ev, ...d.announced.ev, ...d.statusEv, ...(d.headline?.ev ?? []), ...d.payment.ev, ...d.rationale.flatMap((r) => r.ev)]);
  const body = `_Research cutoff: ${cutoff}. Facts are from the Finance Desk archive with evidence IDs in brackets; analysis and opinions below are mine._

## Transaction facts
- Acquirer: ${d.acquirer.name} (${countryName(d.acquirer.country)})${cite(d.acquirer.ev)}
- Target: ${d.target.name} (${countryName(d.target.country)})${cite(d.target.ev)}
- Perimeter: ${d.perimeter}
- Structure: ${DEAL_TYPE_LABEL[d.dealType]}; stake acquired ${d.stake.acquiredPct ?? "not disclosed"}%${d.stake.resultingPct !== null ? `, held after ${d.stake.resultingPct}%` : ""}${cite(d.stakeEv)}
- Announced: ${formatDateValue(d.announced)}${cite(d.announced.ev)}; status: ${DEAL_STATUS_LABEL[d.status]} as of ${formatDateValue(d.statusAsOf)}${cite(d.statusEv)}
- Value: ${d.headline ? `${h.value} (${h.basis})` : "Undisclosed"}${cite(d.headline?.ev ?? [])}
- Consideration: ${d.paymentMix.map((p) => PAYMENT_LABEL[p]).join(", ")} — ${d.payment.text}${cite(d.payment.ev)}

## Strategic rationale
${d.rationale.length ? d.rationale.map((r) => `- Stated: ${r.text}${cite(r.ev)}`).join("\n") : "- No stated rationale recorded."}
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
  return { title: `Deal note: ${d.title}`, body, evidenceIds: [...ids] };
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
      answer: `${d.acquirer.name} → ${d.target.name}: ${DEAL_TYPE_LABEL[d.dealType].toLowerCase()}${d.stake.acquiredPct !== null ? ` of ${d.stake.acquiredPct}%` : ""}. Perimeter: ${d.perimeter}`,
      sourceRefs: claims([...d.acquirer.ev, ...d.target.ev, ...d.stakeEv]),
    },
    {
      cardType: "consideration_structure",
      prompt: `How was “${d.title}” paid for and structured?`,
      answer: `${d.payment.text}${d.headline ? ` Headline value: ${h.value} (${h.basis}).` : " Value undisclosed."}${d.financing ? ` Financing: ${d.financing.text}` : ""}`,
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
