import { useMemo } from "react";
import { capmCostOfEquity, computeWacc, dcfFromFcff, dcfToEquity, type DriverYear, type ForecastRow, forecastFcff, sensitivityGrid, validateRates } from "../../../shared/calc/dcf";
import type { CalcIssue } from "../../../shared/calc/result";
import { trainingModels } from "../../../data/training/models";
import { Segmented } from "../../components/ui";
import { BarChart, Waterfall } from "./charts";
import { Formula, fmtNum, fmtPct, IssueList, LabSection, NumField, ResultFigure } from "./fields";
import type { ScenarioApi } from "./useScenarios";

export interface DcfAssumptions {
  mode: "drivers" | "direct";
  currency: string;
  unit: string;
  baseRevenue: number | null;
  baseNwc: number | null;
  taxRate: number | null;
  years: DriverYear[];
  directFcff: Array<number | null>;
  waccMode: "build" | "direct";
  riskFree: number | null;
  beta: number | null;
  equityRiskPremium: number | null;
  equityValue: number | null;
  debtValue: number | null;
  preTaxCostOfDebt: number | null;
  taxShieldUsable: boolean;
  directWacc: number | null;
  terminalGrowth: number | null;
  bridgeCurrency: string;
  debt: number | null;
  preferredEquity: number | null;
  nonControllingInterests: number | null;
  excessCash: number | null;
  nonOperatingInvestments: number | null;
  dilutedShares: number | null;
}

type TrainingDcf = {
  forecast: { baseRevenue: number; baseNwc: number; taxRate: number; years: DriverYear[] };
  capm: { riskFree: number; beta: number; equityRiskPremium: number };
  wacc: { equityValue: number; debtValue: number; preTaxCostOfDebt: number; taxShieldUsable: boolean };
  terminalGrowth: number;
  bridge: { debt: number; preferredEquity: number; nonControllingInterests: number; excessCash: number; nonOperatingInvestments: number };
  dilutedShares: number;
};

export const DCF_TRAINING = trainingModels.find((m) => m.kind === "dcf");

export function dcfBase(): DcfAssumptions {
  const t = DCF_TRAINING?.inputs as unknown as TrainingDcf;
  return {
    mode: "drivers",
    currency: DCF_TRAINING?.currency ?? "INR",
    unit: DCF_TRAINING?.unit ?? "crore",
    baseRevenue: t.forecast.baseRevenue,
    baseNwc: t.forecast.baseNwc,
    taxRate: t.forecast.taxRate,
    years: t.forecast.years.map((y) => ({ ...y })),
    directFcff: [100, 100, 100, 100, 100],
    waccMode: "build",
    riskFree: t.capm.riskFree,
    beta: t.capm.beta,
    equityRiskPremium: t.capm.equityRiskPremium,
    equityValue: t.wacc.equityValue,
    debtValue: t.wacc.debtValue,
    preTaxCostOfDebt: t.wacc.preTaxCostOfDebt,
    taxShieldUsable: t.wacc.taxShieldUsable,
    directWacc: 0.1,
    terminalGrowth: t.terminalGrowth,
    bridgeCurrency: DCF_TRAINING?.currency ?? "INR",
    ...t.bridge,
    dilutedShares: t.dilutedShares,
  };
}

const YEAR_FIELDS: Array<{ key: keyof DriverYear; label: string }> = [
  { key: "revenueGrowth", label: "Revenue growth" },
  { key: "ebitMargin", label: "EBIT margin" },
  { key: "daPctRevenue", label: "D&A % revenue" },
  { key: "capexPctRevenue", label: "Capex % revenue" },
  { key: "nwcPctRevenue", label: "Operating NWC % revenue" },
];

export function computeDcf(a: DcfAssumptions) {
  const errors: CalcIssue[] = [];
  const warnings: CalcIssue[] = [];
  let rows: ForecastRow[] = [];
  let fcff: Array<number | null> = a.directFcff;
  if (a.mode === "drivers") {
    const f = forecastFcff({ baseRevenue: a.baseRevenue, baseNwc: a.baseNwc, taxRate: a.taxRate, years: a.years });
    if (!f.ok) errors.push(...f.errors);
    else {
      rows = f.value;
      fcff = f.value.map((r) => r.fcff);
      warnings.push(...f.warnings);
    }
  }
  let costOfEquity: number | null = null;
  let wacc: number | null = a.directWacc;
  let waccDetail: { equityWeight: number; debtWeight: number; afterTaxCostOfDebt: number } | null = null;
  if (a.waccMode === "build") {
    const ke = capmCostOfEquity(a.riskFree, a.beta, a.equityRiskPremium);
    if (!ke.ok) errors.push(...ke.errors);
    else {
      costOfEquity = ke.value;
      const w = computeWacc({ equityValue: a.equityValue, debtValue: a.debtValue, costOfEquity: ke.value, preTaxCostOfDebt: a.preTaxCostOfDebt, taxRate: a.taxRate, taxShieldUsable: a.taxShieldUsable, weightBasis: "target" });
      if (!w.ok) errors.push(...w.errors);
      else {
        wacc = w.value.wacc;
        waccDetail = w.value;
        warnings.push(...w.warnings);
      }
    }
  }
  const rateIssues = errors.length ? [] : validateRates(wacc, a.terminalGrowth);
  errors.push(...rateIssues);
  const dcf = errors.length ? null : dcfFromFcff(fcff, wacc, a.terminalGrowth);
  if (dcf && !dcf.ok) errors.push(...dcf.errors);
  if (dcf?.ok) warnings.push(...dcf.warnings);
  const equity =
    dcf?.ok
      ? dcfToEquity(dcf.value, { debt: a.debt, preferredEquity: a.preferredEquity, nonControllingInterests: a.nonControllingInterests, excessCash: a.excessCash, nonOperatingInvestments: a.nonOperatingInvestments }, a.dilutedShares, { cashFlowCurrency: a.currency, bridgeCurrency: a.bridgeCurrency })
      : null;
  if (equity && !equity.ok) errors.push(...equity.errors);
  if (equity?.ok) warnings.push(...equity.warnings);
  const numericFcff = fcff.every((v) => v !== null) ? (fcff as number[]) : null;
  const grid =
    numericFcff && wacc !== null && a.terminalGrowth !== null
      ? sensitivityGrid(
          numericFcff,
          [-0.01, -0.005, 0, 0.005, 0.01].map((d) => wacc + d),
          [-0.01, -0.005, 0, 0.005, 0.01].map((d) => (a.terminalGrowth as number) + d),
          (ev) => {
            if (!equity?.ok || a.dilutedShares === null) return null;
            const netClaims = dcf?.ok ? dcf.value.enterpriseValue - equity.value.bridge.equityValue : 0;
            return (ev - netClaims) / a.dilutedShares;
          },
        )
      : null;
  return { rows, fcff, costOfEquity, wacc, waccDetail, dcf: dcf?.ok ? dcf.value : null, equity: equity?.ok ? equity.value : null, grid, errors, warnings };
}

export function DcfTab({ sc }: { sc: ScenarioApi<DcfAssumptions> }) {
  const a = sc.current.assumptions;
  const set = <K extends keyof DcfAssumptions>(k: K, v: DcfAssumptions[K]) => sc.update((x) => ({ ...x, [k]: v }));
  const setYear = (i: number, k: keyof DriverYear, v: number | null) => sc.update((x) => ({ ...x, years: x.years.map((y, j) => (j === i ? { ...y, [k]: v } : y)) }));
  const r = useMemo(() => computeDcf(a), [a]);
  const unit = `${a.currency} ${a.unit}`;

  return (
    <div className="mf-lab-grid">
      <div className="mf-stack">
        <LabSection title="Forecast inputs" id="dcf-inputs" actions={<Segmented label="Forecast mode" value={a.mode} onChange={(v) => set("mode", v)} options={[{ value: "drivers", label: "Drivers" }, { value: "direct", label: "Direct FCFF" }]} />}>
          {a.mode === "drivers" ? (
            <>
              <div className="mf-lab-row">
                <NumField label="Base-year revenue" value={a.baseRevenue} onChange={(v) => set("baseRevenue", v)} unit={unit} kind="training" />
                <NumField label="Base-year operating NWC" value={a.baseNwc} onChange={(v) => set("baseNwc", v)} unit={unit} kind="training" />
                <NumField label="Tax rate" value={a.taxRate} onChange={(v) => set("taxRate", v)} percent />
              </div>
              <div className="mf-table-wrap">
                <table className="mf-table compact mf-lab-table">
                  <caption className="mf-sr-only">Five-year driver assumptions</caption>
                  <thead>
                    <tr>
                      <th scope="col">Driver (%)</th>
                      {a.years.map((_, i) => (
                        <th scope="col" key={i} className="num">
                          Year {i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {YEAR_FIELDS.map((f) => (
                      <tr key={f.key}>
                        <th scope="row">{f.label}</th>
                        {a.years.map((y, i) => (
                          <td key={i} className="num">
                            <CellInput value={y[f.key]} onChange={(v) => setYear(i, f.key, v)} label={`${f.label}, year ${i + 1}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mf-xsmall mf-muted">Percentages. Operating NWC is modelled as a level (% of revenue); the change in NWC reduces FCFF. Tax is zero when EBIT is negative (no loss carry-forward modelled).</p>
            </>
          ) : (
            <div className="mf-lab-row">
              {a.directFcff.map((v, i) => (
                <NumField key={i} compact label={`FCFF year ${i + 1}`} value={v} onChange={(nv) => set("directFcff", a.directFcff.map((x, j) => (j === i ? nv : x)))} unit={unit} />
              ))}
            </div>
          )}
          <Formula>FCFF = EBIT × (1 − tax) + D&amp;A − capex − increase in operating working capital</Formula>
        </LabSection>

        <LabSection title="Discount rate" id="dcf-wacc" actions={<Segmented label="WACC mode" value={a.waccMode} onChange={(v) => set("waccMode", v)} options={[{ value: "build", label: "Build WACC" }, { value: "direct", label: "Enter WACC" }]} />}>
          {a.waccMode === "build" ? (
            <>
              <div className="mf-lab-row">
                <NumField label="Risk-free rate" value={a.riskFree} onChange={(v) => set("riskFree", v)} percent />
                <NumField label="Beta" value={a.beta} onChange={(v) => set("beta", v)} />
                <NumField label="Equity risk premium" value={a.equityRiskPremium} onChange={(v) => set("equityRiskPremium", v)} percent />
              </div>
              <div className="mf-lab-row">
                <NumField label="Equity value (target weight)" value={a.equityValue} onChange={(v) => set("equityValue", v)} unit={unit} />
                <NumField label="Debt value (target weight)" value={a.debtValue} onChange={(v) => set("debtValue", v)} unit={unit} />
                <NumField label="Pre-tax cost of debt" value={a.preTaxCostOfDebt} onChange={(v) => set("preTaxCostOfDebt", v)} percent />
              </div>
              <label className="mf-check">
                <input type="checkbox" checked={a.taxShieldUsable} onChange={(e) => set("taxShieldUsable", e.target.checked)} /> Tax shield on interest is usable
              </label>
              <Formula>
                WACC = E/(D+E) × Ke + D/(D+E) × Kd × (1 − tax) · Ke = Rf + β × ERP{r.costOfEquity !== null ? ` = ${fmtPct(r.costOfEquity, 2)}` : ""}
              </Formula>
              <p className="mf-xsmall mf-muted">Target market-value weights entered as assumptions. Nominal rates in the cash-flow currency ({a.currency}).</p>
            </>
          ) : (
            <NumField label="WACC" value={a.directWacc} onChange={(v) => set("directWacc", v)} percent />
          )}
          <NumField label="Terminal growth (g)" value={a.terminalGrowth} onChange={(v) => set("terminalGrowth", v)} percent help="Must be below WACC. A plausible-looking g is not automatically sustainable — compare with long-run nominal growth in the cash-flow currency." />
        </LabSection>

        <LabSection title="Enterprise value to equity bridge" id="dcf-bridge">
          <div className="mf-lab-row">
            <NumField label="Interest-bearing debt" value={a.debt} onChange={(v) => set("debt", v)} unit={unit} />
            <NumField label="Preferred equity" value={a.preferredEquity} onChange={(v) => set("preferredEquity", v)} unit={unit} />
            <NumField label="Non-controlling interests" value={a.nonControllingInterests} onChange={(v) => set("nonControllingInterests", v)} unit={unit} />
          </div>
          <div className="mf-lab-row">
            <NumField label="Excess cash" value={a.excessCash} onChange={(v) => set("excessCash", v)} unit={unit} />
            <NumField label="Non-operating investments" value={a.nonOperatingInvestments} onChange={(v) => set("nonOperatingInvestments", v)} unit={unit} />
            <NumField label="Diluted shares" value={a.dilutedShares} onChange={(v) => set("dilutedShares", v)} unit={a.unit} />
          </div>
          <label className="mf-field">
            <span>Bridge currency</span>
            <select className="mf-select" value={a.bridgeCurrency} onChange={(e) => set("bridgeCurrency", e.target.value)}>
              {["INR", "USD", "EUR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <p className="mf-xsmall mf-muted">Missing items block the bridge — absent debt is not zero debt. Enter 0 only when it is truly zero.</p>
        </LabSection>
      </div>

      <div className="mf-stack">
        <IssueList errors={r.errors} warnings={r.warnings} />
        {r.dcf ? (
          <div className="mf-lab-results">
            <ResultFigure label="Enterprise value" value={`${fmtNum(r.dcf.enterpriseValue)} ${unit}`} />
            <ResultFigure label="Equity value" value={r.equity ? `${fmtNum(r.equity.bridge.equityValue)} ${unit}` : "—"} />
            <ResultFigure label="Value per share" value={typeof r.equity?.perShare === "number" ? `${fmtNum(r.equity.perShare, 2)} ${a.currency}` : "—"} sub="Unit assumption: money in crore, shares in crore." />
            <ResultFigure label="Terminal value share of EV" value={fmtPct(r.dcf.terminalShare, 0)} sub={`WACC ${fmtPct(r.wacc, 2)} · g ${fmtPct(a.terminalGrowth, 1)}`} />
          </div>
        ) : (
          <p className="mf-muted">No valuation is shown until the inputs are valid.</p>
        )}
        {r.rows.length ? (
          <LabSection title="Forecast" id="dcf-forecast">
            <div className="mf-table-wrap">
              <table className="mf-table compact">
                <caption className="mf-sr-only">Forecast free cash flow ({unit})</caption>
                <thead>
                  <tr>
                    <th scope="col">{unit}</th>
                    {r.rows.map((row) => (
                      <th key={row.year} scope="col" className="num">
                        Y{row.year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Revenue", "revenue"],
                      ["EBIT", "ebit"],
                      ["Tax", "tax"],
                      ["NOPAT", "nopat"],
                      ["+ D&A", "da"],
                      ["− Capex", "capex"],
                      ["− Δ NWC", "deltaNwc"],
                      ["FCFF", "fcff"],
                    ] as const
                  ).map(([label, k]) => (
                    <tr key={k} className={k === "fcff" ? "mf-row-strong" : undefined}>
                      <th scope="row">{label}</th>
                      {r.rows.map((row) => (
                        <td key={row.year} className="num">
                          {fmtNum(row[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LabSection>
        ) : null}
        <BarChart title="Free cash flow to the firm by year" unit={unit} data={r.fcff.map((v, i) => ({ label: `Y${i + 1}`, value: v }))} />
        {r.dcf && r.equity ? (
          <Waterfall
            title="Enterprise value to equity value"
            unit={unit}
            steps={[
              { label: "PV of forecast", value: r.dcf.pvForecast, kind: "start" },
              { label: "PV of terminal", value: r.dcf.pvTerminal, kind: "add" },
              { label: "Enterprise value", value: r.dcf.enterpriseValue, kind: "total" },
              ...r.equity.bridge.steps
                .filter((s) => s.key !== "enterpriseValue" && s.key !== "equityValue" && s.amount !== 0)
                .map((s) => ({ label: s.label, value: Math.abs(s.contribution), kind: s.contribution < 0 ? ("subtract" as const) : ("add" as const) })),
              { label: "Equity value", value: r.equity.bridge.equityValue, kind: "total" },
            ]}
          />
        ) : null}
        {r.grid ? (
          <LabSection title="Sensitivity: value per share (WACC × terminal growth)" id="dcf-sens">
            <div className="mf-table-wrap">
              <table className="mf-table compact mf-sens">
                <caption className="mf-sr-only">Value per share for WACC (rows) and terminal growth (columns); invalid cells are marked</caption>
                <thead>
                  <tr>
                    <th scope="col">WACC \ g</th>
                    {r.grid[0]?.map((c) => (
                      <th key={c.g} scope="col" className="num">
                        {fmtPct(c.g, 1)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.grid.map((row, i) => (
                    <tr key={i}>
                      <th scope="row">{fmtPct(row[0]?.wacc, 1)}</th>
                      {row.map((c, j) => (
                        <td key={j} className={`num${i === 2 && j === 2 ? " mf-sens-base" : ""}${c.result.ok ? "" : " mf-sens-invalid"}`}>
                          {c.result.ok ? (c.result.perShare !== null ? fmtNum(c.result.perShare, 1) : fmtNum(c.result.enterpriseValue, 0)) : <span title="WACC must exceed g">invalid</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mf-xsmall mf-muted">Centre cell = current scenario. Invalid cells stay invalid (never zero). Values are per share when a share count and bridge are present, otherwise EV.</p>
          </LabSection>
        ) : null}
        <p className="mf-small mf-muted">End-of-year discounting; Gordon growth terminal value on year-5 FCFF. This is a training case with fictional data — Finance Desk does not generate forecasts for real companies.</p>
      </div>
    </div>
  );
}

function CellInput({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <input
      className="mf-input mf-cell-input"
      inputMode="decimal"
      aria-label={`${label} (%)`}
      defaultValue={value === null ? "" : String(Math.round(value * 1e6) / 1e4)}
      key={value === null ? "null" : value.toFixed(6)}
      onBlur={(e) => {
        const t = e.target.value.trim();
        if (t === "") return onChange(null);
        const n = Number(t);
        if (Number.isFinite(n)) onChange(n / 100);
        else e.target.value = value === null ? "" : String(Math.round(value * 1e6) / 1e4);
      }}
    />
  );
}
