import { useMemo } from "react";
import type { ClaimView } from "../../../shared/api";
import { justifiedPriceToBook, residualIncomeFromDrivers, residualIncomeValuation } from "../../../shared/calc/residualIncome";
import { trainingModels } from "../../../data/training/models";
import { useQuery } from "../../app/query";
import { Link } from "../../app/router";
import { Ev, useRegisterEvidence } from "../../components/Evidence";
import { ErrorState, ProvTag, Segmented, TableSkeleton } from "../../components/ui";
import { ScatterChart } from "./charts";
import { PeerSetTable } from "../../components/PeerSetTable";
import { Formula, fmtNum, fmtPct, fmtX, IssueList, LabSection, NumField, ResultFigure } from "./fields";
import type { ScenarioApi } from "./useScenarios";

export interface FigAssumptions {
  riMode: "drivers" | "direct";
  openingBookEquity: number | null;
  costOfEquity: number | null;
  years: Array<{ roe: number | null; payoutRatio: number | null; capitalChanges: number | null }>;
  directYears: Array<{ netIncome: number | null; distributions: number | null; capitalChanges: number | null }>;
  justifiedRoe: number | null;
  justifiedCoe: number | null;
  justifiedGrowth: number | null;
  /** User-entered market data for real banks; never mixed with reported figures. */
  peerAssumptions: Record<string, { pb: number | null; roe: number | null }>;
}

export const FIG_TRAINING = trainingModels.find((m) => m.kind === "fig_residual_income");

type FigTrainingInputs = {
  residualIncome: { openingBookEquity: number; costOfEquity: number; years: FigAssumptions["years"] };
  justified: { roe: number; costOfEquity: number; growth: number };
  balanceSheet: Record<string, number>;
  peers: Array<{ name: string; pb: number; roe: number; cet1: number }>;
};

export function figBase(): FigAssumptions {
  const t = FIG_TRAINING?.inputs as unknown as FigTrainingInputs;
  return {
    riMode: "drivers",
    openingBookEquity: t.residualIncome.openingBookEquity,
    costOfEquity: t.residualIncome.costOfEquity,
    years: t.residualIncome.years.map((y) => ({ ...y })),
    directYears: [{ netIncome: 15, distributions: 0, capitalChanges: 0 }],
    justifiedRoe: t.justified.roe,
    justifiedCoe: t.justified.costOfEquity,
    justifiedGrowth: t.justified.growth,
    peerAssumptions: {},
  };
}

interface BankPeer {
  companyId: string;
  name: string;
  country: string;
  subsector: string;
  metrics: Record<string, { value: number | null; unit: string; currency: string | null; scale: string | null; periodEnd: string; periodLabel: string; basis: string; ev: string[] }>;
}

export function computeFig(a: FigAssumptions) {
  const ri =
    a.riMode === "drivers"
      ? residualIncomeFromDrivers({ openingBookEquity: a.openingBookEquity, costOfEquity: a.costOfEquity, years: a.years })
      : residualIncomeValuation({ openingBookEquity: a.openingBookEquity, costOfEquity: a.costOfEquity, years: a.directYears });
  const justified = justifiedPriceToBook(a.justifiedRoe, a.justifiedCoe, a.justifiedGrowth);
  return { ri, justified };
}

export function FigTab({ sc }: { sc: ScenarioApi<FigAssumptions> }) {
  const a = sc.current.assumptions;
  const unit = `${FIG_TRAINING?.currency ?? "INR"} ${FIG_TRAINING?.unit ?? "crore"}`;
  const t = FIG_TRAINING?.inputs as unknown as FigTrainingInputs;
  const set = <K extends keyof FigAssumptions>(k: K, v: FigAssumptions[K]) => sc.update((x) => ({ ...x, [k]: v }));
  const r = useMemo(() => computeFig(a), [a]);
  const peers = useQuery<{ items: BankPeer[]; note: string; evidence: Record<string, ClaimView> }>("/api/finance/lab/bank-peers");
  useRegisterEvidence(peers.data?.evidence);

  const scatter = [
    ...t.peers.map((p) => ({ label: p.name.replace(" (fictional)", "*"), x: p.roe * 100, y: p.pb, tone: "training" as const })),
    ...Object.entries(a.peerAssumptions)
      .filter(([, v]) => v.pb !== null && v.roe !== null)
      .map(([id, v]) => ({ label: peers.data?.items.find((p) => p.companyId === id)?.name ?? id, x: (v.roe as number) * 100, y: v.pb as number, tone: "assumed" as const })),
  ];

  return (
    <div className="mf-stack">
      <div className="mf-callout analysis">
        <strong>Why banks are valued on equity.</strong>
        <p className="mf-small">
          Deposits are a bank's raw material, not financing debt, so enterprise value and EV/EBITDA are not meaningful. Value the equity: P/B against sustainable ROE, and residual income (book value plus the present value of returns above the cost of equity). Insurers, asset managers and exchanges need their own models — see the <Link to="/finance/sectors/fig?tab=figWorkflow">FIG workflow</Link>.
        </p>
      </div>

      <div className="mf-lab-grid">
        <LabSection
          title="Residual-income model"
          id="fig-ri"
          actions={<Segmented label="Input mode" value={a.riMode} onChange={(v) => set("riMode", v)} options={[{ value: "drivers", label: "ROE & payout" }, { value: "direct", label: "Direct NI" }]} />}
        >
          <p className="mf-xsmall mf-muted">
            <ProvTag kind="training" /> {FIG_TRAINING?.title}
          </p>
          <div className="mf-lab-row">
            <NumField label="Opening common book equity" value={a.openingBookEquity} onChange={(v) => set("openingBookEquity", v)} unit={unit} kind="training" />
            <NumField label="Cost of equity" value={a.costOfEquity} onChange={(v) => set("costOfEquity", v)} percent />
          </div>
          {a.riMode === "drivers" ? (
            <div className="mf-table-wrap">
              <table className="mf-table compact mf-lab-table">
                <caption className="mf-sr-only">ROE, payout and capital changes by year</caption>
                <thead>
                  <tr>
                    <th scope="col">Year</th>
                    <th scope="col" className="num">
                      ROE on opening book (%)
                    </th>
                    <th scope="col" className="num">
                      Payout (%)
                    </th>
                    <th scope="col" className="num">
                      Capital changes ({unit})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {a.years.map((y, i) => (
                    <tr key={i}>
                      <th scope="row">Y{i + 1}</th>
                      <td>
                        <NumField compact label={`ROE year ${i + 1}`} value={y.roe} percent onChange={(v) => set("years", a.years.map((x, j) => (j === i ? { ...x, roe: v } : x)))} />
                      </td>
                      <td>
                        <NumField compact label={`Payout year ${i + 1}`} value={y.payoutRatio} percent onChange={(v) => set("years", a.years.map((x, j) => (j === i ? { ...x, payoutRatio: v } : x)))} />
                      </td>
                      <td>
                        <NumField compact label={`Capital changes year ${i + 1}`} value={y.capitalChanges} onChange={(v) => set("years", a.years.map((x, j) => (j === i ? { ...x, capitalChanges: v } : x)))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mf-stack">
              {a.directYears.map((y, i) => (
                <div className="mf-lab-row" key={i}>
                  <NumField compact label={`Net income Y${i + 1}`} value={y.netIncome} onChange={(v) => set("directYears", a.directYears.map((x, j) => (j === i ? { ...x, netIncome: v } : x)))} />
                  <NumField compact label={`Distributions Y${i + 1}`} value={y.distributions} onChange={(v) => set("directYears", a.directYears.map((x, j) => (j === i ? { ...x, distributions: v } : x)))} />
                  <NumField compact label={`Capital changes Y${i + 1}`} value={y.capitalChanges} onChange={(v) => set("directYears", a.directYears.map((x, j) => (j === i ? { ...x, capitalChanges: v } : x)))} />
                </div>
              ))}
              <div className="mf-row">
                <button type="button" className="mf-btn small" disabled={a.directYears.length >= 5} onClick={() => set("directYears", [...a.directYears, { netIncome: null, distributions: null, capitalChanges: 0 }])}>
                  Add year
                </button>
                <button type="button" className="mf-btn small ghost" disabled={a.directYears.length <= 1} onClick={() => set("directYears", a.directYears.slice(0, -1))}>
                  Remove last year
                </button>
              </div>
            </div>
          )}
          <Formula>RI[t] = NI[t] − Ke × opening book[t] · Equity value = opening book + Σ PV(RI) · Closing book = opening + NI − distributions + capital changes</Formula>
          <p className="mf-xsmall mf-muted">Clean-surplus simplification: every change in book equity flows through NI, distributions or a listed capital change. Terminal assumption: no residual income after the final year (finite horizon).</p>
        </LabSection>

        <div className="mf-stack">
          {r.ri.ok ? (
            <>
              <div className="mf-lab-results">
                <ResultFigure label="Equity value" value={`${fmtNum(r.ri.value.equityValue, 1)} ${unit}`} />
                <ResultFigure label="Implied P/B" value={fmtX(r.ri.value.impliedPriceToBook, 2)} sub="Equity value ÷ opening book" />
                <ResultFigure label="Σ PV of residual income" value={fmtNum(r.ri.value.sumPvResidualIncome, 1)} />
              </div>
              <div className="mf-table-wrap">
                <table className="mf-table compact dense">
                  <caption className="mf-sr-only">Residual income by year ({unit})</caption>
                  <thead>
                    <tr>
                      <th scope="col">Year</th>
                      <th scope="col" className="num">
                        Opening book
                      </th>
                      <th scope="col" className="num">
                        NI
                      </th>
                      <th scope="col" className="num">
                        ROE
                      </th>
                      <th scope="col" className="num">
                        Equity charge
                      </th>
                      <th scope="col" className="num">
                        RI
                      </th>
                      <th scope="col" className="num">
                        PV of RI
                      </th>
                      <th scope="col" className="num">
                        Book growth
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.ri.value.rows.map((row) => (
                      <tr key={row.year}>
                        <th scope="row">Y{row.year}</th>
                        <td className="num">{fmtNum(row.openingBook, 1)}</td>
                        <td className="num">{fmtNum(row.netIncome, 1)}</td>
                        <td className="num">{fmtPct(row.roe, 1)}</td>
                        <td className="num">{fmtNum(row.equityCharge, 1)}</td>
                        <td className="num">{fmtNum(row.residualIncome, 1)}</td>
                        <td className="num">{fmtNum(row.pvResidualIncome, 1)}</td>
                        <td className="num">{fmtPct(row.openingBook ? row.closingBook / row.openingBook - 1 : null, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mf-small">
                <strong>Growth consumes capital.</strong> Retained earnings (NI − distributions) are what let the loan book grow at a stable capital ratio: sustainable book growth ≈ ROE × (1 − payout). A bank that pays out more must earn more, raise equity or grow more slowly. A high accounting ROE can also reflect thin capital or risky lending — check CET1 and credit costs alongside it.
              </p>
            </>
          ) : (
            <IssueList errors={r.ri.errors} />
          )}
          <LabSection title="Justified P/B" id="fig-justified">
            <div className="mf-lab-row">
              <NumField label="Sustainable ROE" value={a.justifiedRoe} onChange={(v) => set("justifiedRoe", v)} percent />
              <NumField label="Cost of equity" value={a.justifiedCoe} onChange={(v) => set("justifiedCoe", v)} percent />
              <NumField label="Long-run growth" value={a.justifiedGrowth} onChange={(v) => set("justifiedGrowth", v)} percent />
            </div>
            <Formula>Justified P/B = (ROE − g) ÷ (Ke − g)</Formula>
            {r.justified.ok ? <ResultFigure label="Justified P/B" value={fmtX(r.justified.value, 2)} sub="A bank earning above its cost of equity deserves P/B above 1." /> : <IssueList errors={r.justified.errors} />}
          </LabSection>
        </div>
      </div>

      <LabSection title="Indian bank peer set: FY24–FY26 history (sourced)" id="fig-peerset">
        <p className="mf-hint">Seven real banks compared at each fiscal year end. Use it to anchor the fictional training bank above: its ROE, asset quality and capital should be read against these ranges.</p>
        <PeerSetTable setId="india-banks" />
      </LabSection>

      <LabSection title="Indian bank peers: reported asset quality and capital" id="fig-peers">
        {peers.loading && !peers.data ? (
          <TableSkeleton rows={6} cols={8} />
        ) : peers.error ? (
          <ErrorState error={peers.error} onRetry={peers.refetch} what="bank peers" />
        ) : peers.data ? (
          <>
            <div className="mf-table-wrap">
              <table className="mf-table compact">
                <caption className="mf-sr-only">Bank peer table with reported regulatory measures and optional assumed market data</caption>
                <thead>
                  <tr>
                    <th scope="col">Bank</th>
                    <th scope="col" className="num">
                      GNPA
                    </th>
                    <th scope="col" className="num">
                      NNPA
                    </th>
                    <th scope="col" className="num">
                      CRAR
                    </th>
                    <th scope="col" className="num">
                      CET1
                    </th>
                    <th scope="col" className="num">
                      CASA
                    </th>
                    <th scope="col">As of</th>
                    <th scope="col" className="num">
                      P/B <ProvTag kind="assumed" />
                    </th>
                    <th scope="col" className="num">
                      ROE <ProvTag kind="assumed" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {peers.data.items.map((p) => {
                    const m = (k: string) => p.metrics[k];
                    const cell = (k: string) => {
                      const o = m(k);
                      if (!o || o.value === null) return <span className="mf-muted">—</span>;
                      return (
                        <span className="mf-num">
                          {o.value.toFixed(2)}% <Ev ids={o.ev} label={`${p.name} ${k}`} />
                        </span>
                      );
                    };
                    const asOf = Object.values(p.metrics)
                      .map((o) => o.periodEnd)
                      .sort()
                      .pop();
                    const pa = a.peerAssumptions[p.companyId] ?? { pb: null, roe: null };
                    const setPa = (patch: Partial<{ pb: number | null; roe: number | null }>) => set("peerAssumptions", { ...a.peerAssumptions, [p.companyId]: { ...pa, ...patch } });
                    return (
                      <tr key={p.companyId}>
                        <th scope="row">
                          <Link to={`/finance/companies/${p.companyId}`}>{p.name}</Link>
                        </th>
                        <td className="num">{cell("gnpa_ratio")}</td>
                        <td className="num">{cell("nnpa_ratio")}</td>
                        <td className="num">{cell("crar")}</td>
                        <td className="num">{cell("cet1_ratio")}</td>
                        <td className="num">{cell("casa_ratio")}</td>
                        <td className="mf-nowrap">{asOf ?? "—"}</td>
                        <td className="num">
                          <NumField compact label={`${p.name} P/B (assumed)`} value={pa.pb} onChange={(v) => setPa({ pb: v })} />
                        </td>
                        <td className="num">
                          <NumField compact label={`${p.name} ROE (assumed)`} value={pa.roe} percent onChange={(v) => setPa({ roe: v })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mf-xsmall mf-muted">{peers.data.note} GNPA/NNPA/CRAR/CET1 are regulatory measures on each bank's own reporting basis; periods may differ, so check "As of" before comparing.</p>
          </>
        ) : null}
      </LabSection>

      <ScatterChart title="P/B versus ROE (training peers marked *, your assumed inputs as squares)" xLabel="ROE (%)" yLabel="P/B (×)" points={scatter} />
      <p className="mf-xsmall mf-muted">
        Training peers are fictional. A high P/B or ROE alone never proves a good investment: ask how the ROE is produced (leverage, risk, one-offs) and whether it is sustainable.
      </p>

      <LabSection title="Other FIG business models" id="fig-other">
        <ul className="mf-list mf-small">
          <li>
            <strong>Life insurers:</strong> <Link to="/finance/notebook?tab=learn&term=g-embedded-value">embedded value</Link>, <Link to="/finance/notebook?tab=learn&term=g-vnb">VNB</Link> and VNB margin; value with P/EV — this bank model does not apply.
          </li>
          <li>
            <strong>General insurers:</strong> <Link to="/finance/notebook?tab=learn&term=g-combined-ratio">combined ratio</Link> and investment yield on float; P/E and P/B through the cycle.
          </li>
          <li>
            <strong>Asset managers:</strong> <Link to="/finance/notebook?tab=learn&term=g-aum">AUM</Link>, net flows and fee yield; P/E and EV/EBITDA are acceptable because there is no deposit funding.
          </li>
          <li>
            <strong>Exchanges and payments:</strong> volumes × take rate; P/E and EV/EBITDA with regulatory-change risk.
          </li>
        </ul>
      </LabSection>
    </div>
  );
}
