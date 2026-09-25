import { useMemo } from "react";
import type { DealDetail, DealSummary, Page } from "../../../shared/api";
import { enterpriseValueFromEquity, reconcileEnterpriseValue } from "../../../shared/calc/bridge";
import { impliedValueFromStake } from "../../../shared/calc/stake";
import { evToEbitda, evToRevenue, formatMultiple, type MultipleValue, offerPremium, type PremiumConvention, priceToBook, priceToEarnings, summarizeMultiples } from "../../../shared/calc/multiples";
import { trainingModels } from "../../../data/training/models";
import { PEER_GROUP_LABEL, VALUE_BASIS_SHORT } from "../../../shared/labels";
import { useQuery } from "../../app/query";
import { Link } from "../../app/router";
import { Ev, useRegisterEvidence } from "../../components/Evidence";
import { ProvTag } from "../../components/ui";
import { asReported, dateLabel, headlineText } from "../../lib/format";
import { Formula, fmtNum, fmtPct, fmtX, IssueList, LabSection, NumField, ResultFigure } from "./fields";
import type { ScenarioApi } from "./useScenarios";

export interface PeerRow {
  id: string;
  name: string;
  equityValue: number | null;
  netDebt: number | null;
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
  bookEquity: number | null;
  include: boolean;
  excludeReason: string;
}

export interface CompsAssumptions {
  peers: PeerRow[];
  target: { name: string; revenue: number | null; ebitda: number | null; netIncome: number | null; bookEquity: number | null; netDebt: number | null; dilutedShares: number | null };
  bridge: { equityValue: number | null; debt: number | null; preferredEquity: number | null; nonControllingInterests: number | null; excessCash: number | null; nonOperatingInvestments: number | null; disclosedEv: number | null };
  premium: { offerPrice: number | null; refPrice: number | null; refDate: string; convention: PremiumConvention; announcementDate: string };
  minority: { consideration: number | null; stakePct: number | null; structure: "secondary" | "primary" };
}

export const COMPS_TRAINING = trainingModels.find((m) => m.kind === "comparables");

export function compsBase(): CompsAssumptions {
  const inputs = COMPS_TRAINING?.inputs as {
    target: CompsAssumptions["target"];
    peers: Array<Omit<PeerRow, "id" | "include" | "excludeReason">>;
  };
  return {
    peers: inputs.peers.map((p, i) => ({ ...p, id: `p${i + 1}`, include: true, excludeReason: "" })),
    target: { ...inputs.target },
    bridge: { equityValue: 1000, debt: 300, preferredEquity: 50, nonControllingInterests: 100, excessCash: 150, nonOperatingInvestments: 50, disclosedEv: null },
    premium: { offerPrice: 120, refPrice: 96, refDate: "2026-06-30", convention: "prior_close", announcementDate: "2026-07-01" },
    minority: { consideration: 500, stakePct: 25, structure: "secondary" },
  };
}

const MULTIPLES = [
  { key: "evRevenue", label: "EV / Revenue" },
  { key: "evEbitda", label: "EV / EBITDA" },
  { key: "pe", label: "P / E" },
  { key: "pb", label: "P / B" },
] as const;

function peerMultiples(p: PeerRow): Record<(typeof MULTIPLES)[number]["key"], MultipleValue> {
  const ev = p.equityValue !== null && p.netDebt !== null ? p.equityValue + p.netDebt : null;
  return {
    evRevenue: evToRevenue(ev, p.revenue),
    evEbitda: evToEbitda(ev, p.ebitda),
    pe: priceToEarnings(p.equityValue, p.netIncome),
    pb: priceToBook(p.equityValue, p.bookEquity),
  };
}

export function computeComps(a: CompsAssumptions) {
  const rows = a.peers.map((p) => ({ peer: p, ev: p.equityValue !== null && p.netDebt !== null ? p.equityValue + p.netDebt : null, m: peerMultiples(p) }));
  const stats = Object.fromEntries(
    MULTIPLES.map((mm) => [
      mm.key,
      summarizeMultiples(
        rows.map((r) => ({
          id: r.peer.id,
          label: r.peer.name,
          value: r.peer.include ? r.m[mm.key] : ({ kind: "not_applicable", reason: r.peer.excludeReason || "Excluded by eligibility filter" } as MultipleValue),
        })),
      ),
    ]),
  ) as Record<(typeof MULTIPLES)[number]["key"], ReturnType<typeof summarizeMultiples>>;
  const t = a.target;
  const implied = (mult: number | null, metric: number | null, isEv: boolean) => {
    if (mult === null || metric === null || metric <= 0) return null;
    const v = mult * metric;
    if (!isEv) return v;
    return t.netDebt === null ? null : v - t.netDebt;
  };
  const range = (key: "evEbitda" | "pe", metric: number | null, isEv: boolean) => ({
    q1: implied(stats[key].q1, metric, isEv),
    median: implied(stats[key].median, metric, isEv),
    q3: implied(stats[key].q3, metric, isEv),
  });
  const bridge = enterpriseValueFromEquity({ ...a.bridge, leaseTreatment: "excluded", valueBasis: "market" });
  const recon = bridge.ok && a.bridge.disclosedEv !== null ? reconcileEnterpriseValue(bridge.value.enterpriseValue, a.bridge.disclosedEv) : null;
  const premium =
    a.premium.refPrice !== null ? offerPremium(a.premium.offerPrice, { price: a.premium.refPrice, date: a.premium.refDate, convention: a.premium.convention, announcementDate: a.premium.announcementDate }) : null;
  const minority = impliedValueFromStake(a.minority);
  return {
    rows,
    stats,
    impliedEquityFromEbitda: range("evEbitda", t.ebitda, true),
    impliedEquityFromPe: range("pe", t.netIncome, false),
    bridge,
    recon,
    premium,
    minority,
  };
}

function MultCell({ v }: { v: MultipleValue }) {
  if (v.kind === "value") return <span className="mf-num">{formatMultiple(v)}</span>;
  const label = v.kind === "NM" ? "NM" : v.kind === "not_disclosed" ? "n.d." : v.kind === "not_applicable" ? "n.a." : "—";
  return (
    <span className="mf-muted" title={"reason" in v && v.reason ? v.reason : v.kind}>
      {label}
    </span>
  );
}

export function ComparablesTab({ sc, dealId }: { sc: ScenarioApi<CompsAssumptions>; dealId: string | null }) {
  const a = sc.current.assumptions;
  const unit = `${COMPS_TRAINING?.currency ?? "USD"} ${COMPS_TRAINING?.unit ?? "million"}`;
  const r = useMemo(() => computeComps(a), [a]);
  const setPeer = (id: string, patch: Partial<PeerRow>) => sc.update((x) => ({ ...x, peers: x.peers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setGroup = <G extends "target" | "bridge" | "premium" | "minority">(g: G, patch: Partial<CompsAssumptions[G]>) => sc.update((x) => ({ ...x, [g]: { ...x[g], ...patch } }));

  return (
    <div className="mf-stack">
      {dealId ? <DealContext dealId={dealId} /> : null}
      <LabSection
        title="Trading comparables"
        id="comps-peers"
        actions={
          <span className="mf-xsmall mf-muted">
            <ProvTag kind="training" /> {COMPS_TRAINING?.title}
          </span>
        }
      >
        <div className="mf-table-wrap">
          <table className="mf-table compact">
            <caption className="mf-sr-only">Peer set with calculated multiples ({unit})</caption>
            <thead>
              <tr>
                <th scope="col">Include</th>
                <th scope="col">Peer</th>
                <th scope="col" className="num">
                  Equity value
                </th>
                <th scope="col" className="num">
                  Net debt
                </th>
                <th scope="col" className="num">
                  EV <ProvTag kind="calculated" />
                </th>
                <th scope="col" className="num">
                  Revenue
                </th>
                <th scope="col" className="num">
                  EBITDA
                </th>
                {MULTIPLES.map((m) => (
                  <th scope="col" key={m.key} className="num">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map(({ peer, ev, m }) => (
                <tr key={peer.id} className={peer.include ? undefined : "mf-row-muted"}>
                  <td>
                    <input type="checkbox" aria-label={`Include ${peer.name}`} checked={peer.include} onChange={(e) => setPeer(peer.id, { include: e.target.checked })} />
                  </td>
                  <td>
                    {peer.name}
                    {!peer.include ? (
                      <input className="mf-input mf-inline-input" aria-label={`Exclusion reason for ${peer.name}`} placeholder="Reason (e.g. different business model)" value={peer.excludeReason} onChange={(e) => setPeer(peer.id, { excludeReason: e.target.value })} />
                    ) : null}
                  </td>
                  <td className="num">{fmtNum(peer.equityValue, 0)}</td>
                  <td className="num">{fmtNum(peer.netDebt, 0)}</td>
                  <td className="num">{fmtNum(ev, 0)}</td>
                  <td className="num">{fmtNum(peer.revenue, 0)}</td>
                  <td className="num">{fmtNum(peer.ebitda, 0)}</td>
                  {MULTIPLES.map((mm) => (
                    <td key={mm.key} className="num">
                      <MultCell v={m[mm.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(["median", "mean", "q1", "q3"] as const).map((stat) => (
                <tr key={stat}>
                  <th scope="row" colSpan={7}>
                    {stat === "q1" ? "25th percentile" : stat === "q3" ? "75th percentile" : stat[0]?.toUpperCase() + stat.slice(1)}
                  </th>
                  {MULTIPLES.map((mm) => (
                    <td key={mm.key} className="num">
                      {fmtX(r.stats[mm.key][stat])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" colSpan={7}>
                  Sample size (n)
                </th>
                {MULTIPLES.map((mm) => (
                  <td key={mm.key} className="num">
                    {r.stats[mm.key].n}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <ul className="mf-list mf-small" aria-label="Excluded observations">
          {MULTIPLES.flatMap((mm) => r.stats[mm.key].excluded.map((x) => ({ ...x, mult: mm.label }))).map((x, i) => (
            <li key={i}>
              {x.mult}: {x.label ?? x.id} excluded — {x.kind === "NM" ? "NM" : x.kind.replace("_", " ")} ({x.reason})
            </li>
          ))}
        </ul>
        <p className="mf-xsmall mf-muted">
          NM = not meaningful (zero/negative denominator) · n.d. = not disclosed · n.a. = not applicable/excluded · — = not available. Quartiles use linear interpolation (inclusive). Eligibility: same subsector, similar size and profitability, same reporting period (LTM), consistent accounting.
        </p>
      </LabSection>

      <div className="mf-lab-grid">
        <LabSection title="Apply to the target" id="comps-target">
          <div className="mf-lab-row">
            <NumField label="Target EBITDA" value={a.target.ebitda} onChange={(v) => setGroup("target", { ebitda: v })} unit={unit} kind="training" />
            <NumField label="Target net income" value={a.target.netIncome} onChange={(v) => setGroup("target", { netIncome: v })} unit={unit} kind="training" />
            <NumField label="Target net debt" value={a.target.netDebt} onChange={(v) => setGroup("target", { netDebt: v })} unit={unit} kind="training" />
          </div>
          <table className="mf-table compact">
            <caption className="mf-sr-only">Implied equity value ranges</caption>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col" className="num">
                  25th pct
                </th>
                <th scope="col" className="num">
                  Median
                </th>
                <th scope="col" className="num">
                  75th pct
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">EV/EBITDA → equity</th>
                <td className="num">{fmtNum(r.impliedEquityFromEbitda.q1, 0)}</td>
                <td className="num">{fmtNum(r.impliedEquityFromEbitda.median, 0)}</td>
                <td className="num">{fmtNum(r.impliedEquityFromEbitda.q3, 0)}</td>
              </tr>
              <tr>
                <th scope="row">P/E → equity</th>
                <td className="num">{fmtNum(r.impliedEquityFromPe.q1, 0)}</td>
                <td className="num">{fmtNum(r.impliedEquityFromPe.median, 0)}</td>
                <td className="num">{fmtNum(r.impliedEquityFromPe.q3, 0)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mf-xsmall mf-muted">Trading multiples value a minority, liquid stake. Precedent transactions include control premiums and reflect their own dates — do not average them together.</p>
        </LabSection>

        <LabSection title="Enterprise value bridge" id="comps-bridge">
          <div className="mf-lab-row">
            <NumField label="Equity value" value={a.bridge.equityValue} onChange={(v) => setGroup("bridge", { equityValue: v })} />
            <NumField label="Debt" value={a.bridge.debt} onChange={(v) => setGroup("bridge", { debt: v })} />
            <NumField label="Preferred equity" value={a.bridge.preferredEquity} onChange={(v) => setGroup("bridge", { preferredEquity: v })} />
          </div>
          <div className="mf-lab-row">
            <NumField label="Non-controlling interests" value={a.bridge.nonControllingInterests} onChange={(v) => setGroup("bridge", { nonControllingInterests: v })} />
            <NumField label="Excess cash" value={a.bridge.excessCash} onChange={(v) => setGroup("bridge", { excessCash: v })} />
            <NumField label="Non-operating investments" value={a.bridge.nonOperatingInvestments} onChange={(v) => setGroup("bridge", { nonOperatingInvestments: v })} />
          </div>
          <NumField label="Disclosed transaction EV (optional, to reconcile)" value={a.bridge.disclosedEv} onChange={(v) => setGroup("bridge", { disclosedEv: v })} kind="reported" />
          <Formula>EV = equity + debt + preferred + NCI − excess cash − non-operating investments (market values; leases excluded)</Formula>
          {r.bridge.ok ? (
            <ResultFigure label="Enterprise value" value={fmtNum(r.bridge.value.enterpriseValue, 1)} sub={r.recon?.ok ? `Disclosed ${fmtNum(r.recon.value.disclosedEnterpriseValue, 1)} · difference ${fmtPct(r.recon.value.differencePct, 1)} ${r.recon.value.withinTolerance ? "(within 2%)" : "(check definitions)"}` : undefined} />
          ) : (
            <IssueList errors={r.bridge.errors} />
          )}
        </LabSection>
      </div>

      <div className="mf-lab-grid">
        <LabSection title="Offer premium" id="comps-premium">
          <div className="mf-lab-row">
            <NumField label="Offer price per share" value={a.premium.offerPrice} onChange={(v) => setGroup("premium", { offerPrice: v })} />
            <NumField label="Unaffected reference price" value={a.premium.refPrice} onChange={(v) => setGroup("premium", { refPrice: v })} />
          </div>
          <div className="mf-lab-row">
            <label className="mf-field">
              <span>Reference date</span>
              <input className="mf-input" type="date" value={a.premium.refDate} onChange={(e) => setGroup("premium", { refDate: e.target.value })} />
            </label>
            <label className="mf-field">
              <span>Announcement date</span>
              <input className="mf-input" type="date" value={a.premium.announcementDate} onChange={(e) => setGroup("premium", { announcementDate: e.target.value })} />
            </label>
            <label className="mf-field">
              <span>Convention</span>
              <select className="mf-select" value={a.premium.convention} onChange={(e) => setGroup("premium", { convention: e.target.value as PremiumConvention })}>
                <option value="prior_close">Prior unaffected close</option>
                <option value="vwap_1m">1-month VWAP</option>
                <option value="vwap_3m">3-month VWAP</option>
                <option value="vwap_6m">6-month VWAP</option>
                <option value="sebi_regulatory_floor">SEBI regulatory floor price</option>
                <option value="other">Other (explain in notes)</option>
              </select>
            </label>
          </div>
          {r.premium ? r.premium.ok ? <ResultFigure label="Offer premium" value={fmtPct(r.premium.value.premium, 1)} sub={`vs ${a.premium.convention.replaceAll("_", " ")} on ${a.premium.refDate}`} /> : <IssueList errors={r.premium.errors} /> : null}
        </LabSection>

        <LabSection title="Minority stake: implied 100% value" id="comps-minority">
          <div className="mf-lab-row">
            <NumField label="Consideration for the stake" value={a.minority.consideration} onChange={(v) => setGroup("minority", { consideration: v })} />
            <NumField label="Stake acquired (%)" value={a.minority.stakePct} onChange={(v) => setGroup("minority", { stakePct: v })} unit="%" />
          </div>
          <label className="mf-field">
            <span>Structure</span>
            <select className="mf-select" value={a.minority.structure} onChange={(e) => setGroup("minority", { structure: e.target.value as "secondary" | "primary" })}>
              <option value="secondary">Purchase from existing holders (secondary)</option>
              <option value="primary">New shares issued (primary)</option>
            </select>
          </label>
          {r.minority.ok ? (
            <>
              <ResultFigure
                label={r.minority.value.basis === "post_money" ? "Implied post-money equity value" : "Implied 100% equity value"}
                value={fmtNum(r.minority.value.impliedEquityValue, 1)}
                kind="calculated"
                sub={
                  r.minority.value.basis === "post_money"
                    ? `Pre-money = ${fmtNum(r.minority.value.preMoney, 1)}. Post-money includes the new cash.`
                    : "Implied by proportional extrapolation — valid only if the stake has no special rights, control premium, earn-out or put/call terms."
                }
              />
              <IssueList warnings={r.minority.warnings} />
            </>
          ) : (
            <IssueList errors={r.minority.errors} />
          )}
        </LabSection>
      </div>
    </div>
  );
}

function DealContext({ dealId }: { dealId: string }) {
  const q = useQuery<DealDetail>(`/api/finance/deals/${encodeURIComponent(dealId)}`);
  useRegisterEvidence(q.data?.evidence);
  const sector = q.data?.sector;
  const precedents = useQuery<Page<DealSummary>>(sector ? `/api/finance/deals?sector=${sector}&pageSize=50&sort=announced&dir=desc` : null);
  if (q.loading && !q.data) return <p className="mf-muted">Loading deal context…</p>;
  if (!q.data) return null;
  const d = q.data;
  return (
    <LabSection title={`Deal context: ${d.title}`} id="comps-deal" actions={<Link to={`/finance/deals/${d.id}`}>Open deal</Link>}>
      <p className="mf-small mf-muted">
        Reported terms are locked: editing scenarios never changes them. Announced {dateLabel(d.announced)} · research cutoff {d.researchCutoff}.
      </p>
      <table className="mf-table compact">
        <caption className="mf-sr-only">Reported deal terms</caption>
        <thead>
          <tr>
            <th scope="col">Term</th>
            <th scope="col">Value</th>
            <th scope="col">Basis</th>
            <th scope="col">Status</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {d.terms.map((t) => (
            <tr key={t.id}>
              <th scope="row">{t.label}</th>
              <td className="mf-num">{t.amount !== null ? asReported(t.amount, t.currency, t.unit) : t.ratio !== null ? fmtNum(t.ratio, 3) : (t.text ?? "—")}</td>
              <td>{t.valueBasis ? VALUE_BASIS_SHORT[t.valueBasis] : "—"}</td>
              <td>
                <ProvTag kind={t.status === "reported" ? "reported" : "calculated"} />
              </td>
              <td>
                <Ev ids={t.ev} label={t.label} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {precedents.data ? (
        <PrecedentTable deal={d} items={precedents.data.items} />
      ) : null}
    </LabSection>
  );
}

type MultipleKey = "evRevenue" | "evEbitda" | "priceToBook";

/** Precedent table: multiples come from sourced deal terms with their denominator basis, never a placeholder. */
export function precedentRows(deal: Pick<DealSummary, "id" | "sector" | "peerGroup">, items: DealSummary[]) {
  const keys: MultipleKey[] = deal.sector === "fig" ? ["priceToBook"] : ["evEbitda", "evRevenue"];
  const rows = items
    .filter((p) => p.id !== deal.id)
    .map((p) => ({
      deal: p,
      samePeerGroup: Boolean(deal.peerGroup) && p.peerGroup === deal.peerGroup,
      cells: keys.map((k) => ({ key: k, detail: p.multipleDetails?.[k] ?? null })),
    }))
    .sort((a, b) => Number(b.samePeerGroup) - Number(a.samePeerGroup) || b.deal.announced.date.localeCompare(a.deal.announced.date));
  return { keys, rows };
}

const MULT_LABEL: Record<MultipleKey, string> = { evRevenue: "EV/Revenue", evEbitda: "EV/EBITDA", priceToBook: "P/B" };

function PrecedentTable({ deal, items }: { deal: DealDetail; items: DealSummary[] }) {
  const { keys, rows } = precedentRows(deal, items);
  const withMultiples = rows.filter((r) => r.cells.some((c) => c.detail)).length;
  return (
    <>
      <h3 className="mf-h3">Precedent transactions in {deal.sector.toUpperCase()}</h3>
      <div className="mf-table-wrap">
        <table className="mf-table compact">
          <caption className="mf-sr-only">Precedent transactions in the same sector, same peer group first</caption>
          <thead>
            <tr>
              <th scope="col">Deal</th>
              <th scope="col">Peer group</th>
              <th scope="col">Announced</th>
              <th scope="col">Headline value</th>
              {keys.map((k) => (
                <th scope="col" key={k}>
                  {MULT_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map(({ deal: p, samePeerGroup, cells }) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/finance/deals/${p.id}`}>{p.title}</Link>
                </td>
                <td className={samePeerGroup ? undefined : "mf-muted"}>{p.peerGroup ? PEER_GROUP_LABEL[p.peerGroup] : "—"}</td>
                <td>{dateLabel(p.announced)}</td>
                <td className="mf-num">{p.headline ? `${headlineText(p.headline).value} (${headlineText(p.headline).basis})` : "not disclosed"}</td>
                {cells.map(({ key, detail }) => (
                  <td key={key}>
                    {detail ? (
                      <>
                        <span className="mf-num">{detail.value.toFixed(1)}×</span>
                        <Ev ids={detail.ev} label={`${p.title} ${MULT_LABEL[key]}`} />
                        <div className="mf-xsmall mf-muted">
                          {detail.status === "reported" ? "Disclosed" : "Calculated from sourced inputs"}
                          {detail.basis ? ` · ${detail.basis.periodType} ${detail.basis.periodLabel} · ${detail.basis.accountingBasis === "not_stated" ? "basis not stated" : detail.basis.accountingBasis}` : ""}
                        </div>
                      </>
                    ) : (
                      <span className="mf-muted" title="No transaction multiple with a sourced denominator is recorded for this deal.">
                        not sourced
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mf-xsmall mf-muted">
        {withMultiples} of {rows.length} precedents have a sourced multiple. Headline values mix enterprise, equity and stake bases and are not comparable without adjustment. Multiples are pooled only within one peer group, denominator period and accounting basis (see Compare).
      </p>
    </>
  );
}
