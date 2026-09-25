import { useMemo } from "react";
import { type AccretionInput, accretionDilution, explainScenarioChange } from "../../../shared/calc/accretion";
import { trainingModels } from "../../../data/training/models";
import { BarChart, Waterfall } from "./charts";
import { Formula, fmtNum, fmtPct, IssueList, LabSection, NumField, ResultFigure } from "./fields";
import type { ScenarioApi } from "./useScenarios";

export type AccretionAssumptions = AccretionInput;

export const ACCRETION_TRAINING = trainingModels.find((m) => m.kind === "acquisition");

export function accretionBase(): AccretionAssumptions {
  const inputs = ACCRETION_TRAINING?.inputs as { accretion: AccretionInput } | undefined;
  return { adjustmentsDeductible: true, ...(inputs?.accretion as AccretionInput) };
}

const FIELD_LABELS: Partial<Record<keyof AccretionInput, string>> = {
  buyerNetIncome: "Buyer net income",
  buyerDilutedShares: "Buyer diluted shares",
  buyerSharePrice: "Buyer share price",
  targetNetIncome: "Target net income",
  equityConsideration: "Equity consideration",
  fundingCash: "Funded with cash",
  fundingDebt: "Funded with new debt",
  fundingStock: "Funded with new shares",
  stockIssuePrice: "Share issue price",
  interestRateOnNewDebt: "Interest rate on new debt",
  foregoneCashYield: "Foregone yield on cash",
  pretaxSynergies: "Pre-tax synergies",
  incrementalRecurringCosts: "Incremental recurring costs",
  incrementalDaPpa: "Incremental D&A / PPA",
  taxRate: "Tax rate",
  oneTimeCosts: "One-time costs",
  transactionFees: "Transaction fees",
  refinancedTargetDebt: "Target debt refinanced",
};

export function computeAccretion(a: AccretionAssumptions) {
  return accretionDilution(a);
}

export function AccretionTab({ sc }: { sc: ScenarioApi<AccretionAssumptions> }) {
  const a = sc.current.assumptions;
  const unit = `${ACCRETION_TRAINING?.currency ?? "INR"} ${ACCRETION_TRAINING?.unit ?? "crore"}`;
  const set = <K extends keyof AccretionAssumptions>(k: K, v: AccretionAssumptions[K]) => sc.update((x) => ({ ...x, [k]: v }));
  const r = useMemo(() => computeAccretion(a), [a]);
  const changes = useMemo(() => (sc.state.active === 0 ? [] : explainScenarioChange(sc.baseCase.assumptions, a)), [sc.state.active, sc.baseCase.assumptions, a]);
  const baseResult = useMemo(() => (sc.state.active === 0 ? null : computeAccretion(sc.baseCase.assumptions)), [sc.state.active, sc.baseCase.assumptions]);
  const fundingTotal = (a.fundingCash ?? 0) + (a.fundingDebt ?? 0) + (a.fundingStock ?? 0);

  const sens = useMemo(() => {
    const synergies = [0, 0.5, 1, 1.5].map((m) => (a.pretaxSynergies ?? 0) * m);
    const rates = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => (a.interestRateOnNewDebt ?? 0) + d);
    return synergies.map((s) => rates.map((rt) => ({ s, rt, res: accretionDilution({ ...a, pretaxSynergies: s, interestRateOnNewDebt: rt }) })));
  }, [a]);

  const field = (k: keyof AccretionInput, opts: { percent?: boolean; unit?: string; kind?: "assumed" | "training" } = {}) => (
    <NumField key={k} label={FIELD_LABELS[k] ?? k} value={a[k] as number | null | undefined} onChange={(v) => set(k, v as never)} percent={opts.percent} unit={opts.unit} kind={opts.kind ?? "assumed"} />
  );

  return (
    <div className="mf-lab-grid">
      <div className="mf-stack">
        <LabSection title="Buyer and target" id="ad-parties">
          <div className="mf-lab-row">
            {field("buyerNetIncome", { unit, kind: "training" })}
            {field("buyerDilutedShares", { unit: "crore shares", kind: "training" })}
            {field("buyerSharePrice", { unit: "₹", kind: "training" })}
          </div>
          <div className="mf-lab-row">
            {field("targetNetIncome", { unit, kind: "training" })}
            {field("equityConsideration", { unit })}
            {field("taxRate", { percent: true })}
          </div>
          <p className="mf-xsmall mf-muted">Buyer and target net income are after-tax amounts; they are not taxed again. Assumes a 100% acquisition and a full-year contribution — partial stakes and stub periods are blocked, not approximated.</p>
        </LabSection>
        <LabSection title="Funding" id="ad-funding">
          <div className="mf-lab-row">
            {field("fundingCash", { unit })}
            {field("fundingDebt", { unit })}
            {field("fundingStock", { unit })}
          </div>
          <div className="mf-lab-row">
            {field("stockIssuePrice", { unit: "₹" })}
            {field("interestRateOnNewDebt", { percent: true })}
            {field("foregoneCashYield", { percent: true })}
          </div>
          <p className={`mf-small ${Math.abs(fundingTotal - (a.equityConsideration ?? 0)) > 1e-9 ? "mf-negative-text" : "mf-muted"}`}>
            Funding total {fmtNum(fundingTotal)} vs consideration {fmtNum(a.equityConsideration)} {unit} — the split must reconcile.
          </p>
        </LabSection>
        <LabSection title="Adjustments" id="ad-adj">
          <div className="mf-lab-row">
            {field("pretaxSynergies", { unit })}
            {field("incrementalRecurringCosts", { unit })}
            {field("incrementalDaPpa", { unit })}
          </div>
          <label className="mf-check">
            <input type="checkbox" checked={a.adjustmentsDeductible !== false} onChange={(e) => set("adjustmentsDeductible", e.target.checked)} /> Adjustments are tax-deductible at the common tax rate
          </label>
          <div className="mf-lab-row">
            {field("oneTimeCosts", { unit })}
            {field("transactionFees", { unit })}
            {field("refinancedTargetDebt", { unit })}
          </div>
          <p className="mf-xsmall mf-muted">One-time costs are shown separately from run-rate EPS. Fees and refinanced target debt are displayed separately; they are not part of the equity purchase price.</p>
        </LabSection>
        <Formula>
          Adjusted combined NI = buyer NI + target NI + (synergies − recurring costs − new interest − foregone interest − D&amp;A/PPA) × (1 − tax) · Pro forma EPS = NI ÷ (buyer shares + new shares)
        </Formula>
      </div>

      <div className="mf-stack">
        {!r.ok ? <IssueList errors={r.errors} /> : <IssueList warnings={r.warnings} />}
        {r.ok ? (
          <>
            <div className="mf-lab-results">
              <ResultFigure label="Standalone EPS" value={fmtNum(r.value.standaloneEps, 3)} />
              <ResultFigure label="Pro forma EPS (run-rate)" value={fmtNum(r.value.proFormaEps, 3)} />
              <ResultFigure
                label="Accretion / (dilution)"
                value={r.value.accretionPct === null ? "not meaningful" : `${r.value.accretionPct >= 0 ? "+" : ""}${fmtPct(r.value.accretionPct, 2)}`}
                sub={r.value.accretionPct === null ? "Standalone EPS is zero or negative, so a percentage is not meaningful." : `${r.value.accretionPct >= 0 ? "Accretive" : "Dilutive"} by ${fmtNum(Math.abs(r.value.accretionPerShare), 3)} per share`}
              />
              <ResultFigure label="EPS including one-time costs" value={fmtNum(r.value.proFormaEpsIncludingOneTime, 3)} sub={`One-time after tax: ${fmtNum(r.value.oneTimeCostsAfterTax)} ${unit}`} />
            </div>
            <BarChart
              title="Funding mix"
              unit={unit}
              data={[
                { label: "Cash", value: r.value.fundingMix.cash },
                { label: "New debt", value: r.value.fundingMix.debt },
                { label: "New shares", value: r.value.fundingMix.stock },
              ]}
            />
            <Waterfall
              title="What the deal adds to buyer net income (after tax)"
              unit={unit}
              steps={[
                ...r.value.epsBridge.map((b, i) => ({
                  label: b.label,
                  value: Math.abs(b.netIncomeImpact),
                  kind: i === 0 ? ("start" as const) : b.netIncomeImpact < 0 ? ("subtract" as const) : ("add" as const),
                })),
                { label: "Net addition", value: r.value.combinedNetIncome - (a.buyerNetIncome ?? 0), kind: "total" as const },
              ]}
            />
            <LabSection title="EPS bridge" id="ad-bridge">
              <table className="mf-table compact">
                <caption className="mf-sr-only">Net income and share bridge</caption>
                <tbody>
                  {r.value.epsBridge.map((b) => (
                    <tr key={b.label}>
                      <th scope="row">{b.label}</th>
                      <td className="num">{fmtNum(b.netIncomeImpact, 2)}</td>
                    </tr>
                  ))}
                  <tr className="mf-row-strong">
                    <th scope="row">Adjusted combined net income</th>
                    <td className="num">{fmtNum(r.value.combinedNetIncome, 2)}</td>
                  </tr>
                  <tr>
                    <th scope="row">New shares issued</th>
                    <td className="num">{fmtNum(r.value.newShares, 3)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Pro forma shares</th>
                    <td className="num">{fmtNum(r.value.proFormaShares, 3)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mf-xsmall mf-muted">
                Separate items: fees {fmtNum(r.value.separateItems.transactionFees)} · refinanced target debt {fmtNum(r.value.separateItems.refinancedTargetDebt)} {unit}. Adjustment tax rate applied: {fmtPct(r.value.appliedAdjustmentTaxRate, 1)}.
              </p>
            </LabSection>
          </>
        ) : null}
        <LabSection title="Sensitivity: accretion by synergies and interest rate" id="ad-sens">
          <div className="mf-table-wrap">
            <table className="mf-table compact mf-sens">
              <caption className="mf-sr-only">Accretion percentage for pre-tax synergies (rows) and interest rate on new debt (columns)</caption>
              <thead>
                <tr>
                  <th scope="col">Synergies \ rate</th>
                  {sens[0]?.map((c) => (
                    <th key={c.rt} scope="col" className="num">
                      {fmtPct(c.rt, 1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sens.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{fmtNum(row[0]?.s, 0)}</th>
                    {row.map((c, j) => (
                      <td key={j} className={`num${i === 2 && j === 2 ? " mf-sens-base" : ""}${c.res.ok ? "" : " mf-sens-invalid"}`}>
                        {c.res.ok ? (c.res.value.accretionPct === null ? "n/m" : fmtPct(c.res.value.accretionPct, 1)) : "invalid"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LabSection>
        {changes.length ? (
          <LabSection title="What changed versus the base case?" id="ad-changes">
            <ul className="mf-list">
              {changes.map((c) => (
                <li key={String(c.field)} className="mf-small">
                  {FIELD_LABELS[c.field] ?? String(c.field)}: {String(c.from ?? "missing")} → {String(c.to ?? "missing")}
                </li>
              ))}
            </ul>
            {baseResult?.ok && r.ok && baseResult.value.accretionPct !== null && r.value.accretionPct !== null ? (
              <p className="mf-small">
                Accretion moved from {fmtPct(baseResult.value.accretionPct, 2)} to {fmtPct(r.value.accretionPct, 2)}.
              </p>
            ) : null}
          </LabSection>
        ) : null}
        <div className="mf-callout analysis">
          <strong>EPS accretion is not value creation.</strong>
          <p className="mf-small">Cheap debt can make a value-destroying deal accretive, and a dilutive deal can create value if returns exceed the cost of capital. This simplified model is not a full merger model and does not capture purchase accounting in full.</p>
        </div>
      </div>
    </div>
  );
}
