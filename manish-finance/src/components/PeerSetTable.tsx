import { useMemo, useState } from "react";
import type { PeerCell, PeerSetView } from "../../shared/api";
import { currencyPrefix, UNIT_LABEL, type ScaleUnit } from "../../shared/money/units";
import { useQuery } from "../app/query";
import { Link } from "../app/router";
import { Ev, useRegisterEvidence } from "./Evidence";
import { ErrorState, ProvTag, Segmented, Skeleton } from "./ui";

/**
 * Numerical peer comparison built from sourced observations. Empty cells mean no sourced value;
 * growth and margins are calculated only from matching units and scope; the median needs three values.
 * A column's unit is stated once in its header; a value in a different unit keeps its reported form.
 */

function numberText(value: number, currency: string | null): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 2 }).format(value);
}

/** "INR crore" → "₹ crore"; "%" and "count" have no header unit. */
function unitHeader(unitLabel: string | null | undefined): string | null {
  if (!unitLabel || unitLabel === "%" || unitLabel === "count") return null;
  const [currency, scale] = unitLabel.split(" ") as [string, ScaleUnit];
  return `${currencyPrefix(currency).trim()} ${UNIT_LABEL[scale] ?? scale}`;
}

function valueText(value: number, unitLabel: string): string {
  if (unitLabel === "%") return `${value.toFixed(2)}%`;
  if (unitLabel === "count") return Math.round(value).toLocaleString("en-IN");
  const [currency] = unitLabel.split(" ") as [string];
  return `${currencyPrefix(currency)}${numberText(value, currency)}`;
}

function cellText(c: PeerCell, columnUnit: string | null): { text: string; converted: boolean; foreign: boolean } {
  const n = c.normalized;
  if (!n) return { text: c.display, converted: false, foreign: false };
  const foreign = columnUnit !== null && n.unitLabel !== columnUnit;
  if (foreign) return { text: c.display, converted: false, foreign };
  return { text: valueText(n.value, n.unitLabel), converted: c.unit === "currency" && c.scale !== n.unitLabel.split(" ")[1], foreign };
}

const DERIVED_LABEL: Record<string, string> = { revenue_growth: "Revenue growth", net_income_growth: "Profit growth", net_margin: "Net margin" };

export function PeerSetTable({ setId, highlightCompanyId, compact }: { setId: string; highlightCompanyId?: string; compact?: boolean }) {
  const q = useQuery<PeerSetView>(`/api/finance/peer-sets/${encodeURIComponent(setId)}`, { staleMs: 60_000 });
  useRegisterEvidence(q.data?.evidence);
  const data = q.data;
  const [period, setPeriod] = useState<string | null>(null);
  const activeEnd = period ?? data?.periods[data.periods.length - 1]?.end ?? "";
  const derivedMetrics = useMemo(() => [...new Set((data?.derived ?? []).map((d) => d.metric))], [data]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="the peer set" />;
  if (!data) return <Skeleton lines={6} />;
  const label = data.periods.find((p) => p.end === activeEnd)?.label ?? activeEnd;
  const stat = (metric: string) => data.stats.find((s) => s.metric === metric && s.periodEnd === activeEnd);
  const filled = data.cells.filter((c) => c.periodEnd === activeEnd).length;
  const expected = data.companies.length * data.metrics.length;
  return (
    <div className="mf-stack tight">
      <div className="mf-row spread">
        <Segmented<string> label={`${data.name}: period`} value={activeEnd} onChange={setPeriod} options={data.periods.map((p) => ({ value: p.end, label: p.label }))} />
        <span className="mf-hint">
          {filled} of {expected} values sourced for {label} · empty = no sourced value
        </span>
      </div>
      <div className="mf-table-wrap">
        <table className="mf-table compact">
          <caption className="mf-sr-only">
            {data.name}, {label}: sourced values by company
          </caption>
          <thead>
            <tr>
              <th scope="col">Company</th>
              {data.metrics.map((m) => (
                <th scope="col" className="num" key={m.id}>
                  {m.label}
                  {unitHeader(stat(m.id)?.unitLabel) ? <div className="mf-xsmall mf-muted">{unitHeader(stat(m.id)?.unitLabel)}</div> : null}
                </th>
              ))}
              {derivedMetrics.map((d) => (
                <th scope="col" className="num" key={d}>
                  {DERIVED_LABEL[d] ?? d}
                  <div>
                    <ProvTag kind="calculated" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.companies.map((co) => (
              <tr key={co.id} className={co.id === highlightCompanyId ? "mf-row-highlight" : undefined} aria-current={co.id === highlightCompanyId ? "true" : undefined}>
                <th scope="row">
                  <Link to={`/finance/companies/${co.id}`}>{co.displayName}</Link>
                </th>
                {data.metrics.map((m) => {
                  const c = data.cells.find((x) => x.companyId === co.id && x.metric === m.id && x.periodEnd === activeEnd);
                  if (!c) {
                    return (
                      <td key={m.id} className="num mf-muted" title="No sourced value for this period">
                        —
                      </td>
                    );
                  }
                  const t = cellText(c, stat(m.id)?.unitLabel ?? null);
                  return (
                    <td key={m.id} className="num nowrap">
                      <span className={t.foreign ? "mf-muted" : undefined}>{t.text}</span>
                      <Ev ids={c.ev} label={`${co.displayName} ${m.label} ${label}`} />
                      {t.converted ? <div className="mf-xsmall mf-muted">reported as {c.display}</div> : null}
                      {t.foreign ? <div className="mf-xsmall mf-muted">other unit; not pooled</div> : null}
                      {!compact && c.scope !== data.preferredScope ? <div className="mf-xsmall mf-muted">{c.scope.replace("_", " ")}</div> : null}
                    </td>
                  );
                })}
                {derivedMetrics.map((d) => {
                  const x = data.derived.find((y) => y.companyId === co.id && y.metric === d && y.periodEnd === activeEnd);
                  return (
                    <td key={d} className="num nowrap" title={x?.reason ?? undefined}>
                      {x && x.value !== null ? `${(x.value * 100).toFixed(1)}%` : <span className="mf-muted">{x ? "n.a." : "—"}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Median</th>
              {data.metrics.map((m) => {
                const s = stat(m.id);
                const med = s?.median ?? null;
                const text = med !== null && s?.unitLabel ? valueText(med, s.unitLabel) : "—";
                return (
                  <td key={m.id} className="num nowrap" title={s?.note ?? undefined}>
                    {text}
                    {s ? <div className="mf-xsmall mf-muted">n = {s.n}</div> : null}
                  </td>
                );
              })}
              {derivedMetrics.map((d) => (
                <td key={d} />
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mf-xsmall mf-muted">
        {data.note} Medians pool only values with the same unit and reporting scope and need at least three. Growth and margins are calculated from the two sourced values shown in the evidence; “n.a.” means their units or scopes differ. Open the evidence icon beside a value to see its source and verification status.
      </p>
    </div>
  );
}
