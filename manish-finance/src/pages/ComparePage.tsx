import type { ClaimView, DealSummary } from "../../shared/api";
import { formatMultiple } from "../../shared/calc/multiples";
import { PEER_GROUP_LABEL, type PeerGroupValue } from "../../shared/labels";
import type { DealComparison } from "../../shared/compare";
import { useQuery } from "../app/query";
import { Link, useRoute } from "../app/router";
import { Ev, useRegisterEvidence } from "../components/Evidence";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, Skeleton } from "../components/ui";

export function ComparePage() {
  const route = useRoute();
  const ids = (route.query.get("ids") ?? "").split(",").filter(Boolean).slice(0, 4);
  const q = useQuery<{ deals: DealSummary[]; comparison: DealComparison; evidence: Record<string, ClaimView> }>(ids.length >= 2 ? `/api/finance/deals/compare?ids=${ids.join(",")}` : null);
  useRegisterEvidence(q.data?.evidence);
  const head = <PageHead title="Compare deals" crumbs={[{ to: "/finance/deals", label: "Deals" }]} sub="Structures, value bases, ownership and eligible valuation measures side by side. Incompatible figures are shown but excluded from statistics with reasons." />;
  if (ids.length < 2) {
    return (
      <div className="mf-stack">
        {head}
        <EmptyState title="Select two to four deals" action={<Link className="mf-btn" to="/finance/deals">Choose deals</Link>}>
          Tick deals in the Deal Terminal, then choose Compare.
        </EmptyState>
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="mf-stack">
        {head}
        <ErrorState error={q.error} onRetry={() => void q.refetch()} what="the comparison" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="mf-stack">
        {head}
        <Skeleton lines={8} />
      </div>
    );
  }
  const { deals, comparison } = q.data;
  return (
    <div className="mf-stack">
      {head}
      <section className="mf-panel">
        <div className="mf-panel-body flush">
          <div className="mf-table-wrap">
            <table className="mf-table">
              <caption className="mf-sr-only">Deal comparison</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  {deals.map((d) => (
                    <th key={d.id} scope="col" style={{ minWidth: 220, whiteSpace: "normal" }}>
                      <Link to={`/finance/deals/${d.id}`}>{d.title}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" style={{ position: "static", color: "var(--mf-text)" }}>
                      {r.label}
                      {!r.comparable ? <div className="mf-pill attention" style={{ marginTop: 4 }}>Not directly comparable</div> : null}
                    </th>
                    {r.cells.map((c) => (
                      <td key={c.dealId} className="wrap">
                        {c.display}
                        {c.ev.length ? <Ev ids={c.ev} label={r.label} /> : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {comparison.rows.filter((r) => r.note).map((r) => (
          <div key={r.key} className="mf-panel-foot">
            <span>
              <strong>{r.label}:</strong> {r.note}
            </span>
          </div>
        ))}
      </section>

      <section className="mf-section">
        <h2>Eligible valuation measures</h2>
        <div className="mf-grid-3">
          {comparison.metrics.map((m) => (
            <div key={m.metric} className="mf-panel">
              <div className="mf-panel-head">
                <h3>{m.label}</h3>
              </div>
              <div className="mf-panel-body mf-stack tight">
                <ul className="mf-list">
                  {m.observations.map((o) => (
                    <li key={o.dealId}>
                      <div className="mf-row spread">
                        <span className="mf-small">{deals.find((d) => d.id === o.dealId)?.title}</span>
                        <span className={o.eligible ? "mf-mono" : "mf-mono mf-muted"}>
                          {formatMultiple(o.value)}
                          {o.value.kind === "value" && !o.eligible ? " (not pooled)" : ""}
                        </span>
                      </div>
                      {o.basisLabel ? <div className="mf-xsmall mf-muted">{o.basisLabel}</div> : null}
                    </li>
                  ))}
                </ul>
                <p className="mf-small">
                  {m.stats.median !== null ? (
                    <>
                      Median <span className="mf-mono">{m.stats.median.toFixed(1)}×</span> · n = {m.stats.n}
                      {m.reference?.peerGroup ? ` · ${PEER_GROUP_LABEL[m.reference.peerGroup as PeerGroupValue]}, ${m.reference.periodType}, ${m.reference.accountingBasis}` : ""}
                    </>
                  ) : (
                    <>{m.statsNote}</>
                  )}
                </p>
                {m.stats.excluded.length ? (
                  <details className="mf-details">
                    <summary>{m.stats.excluded.length} excluded</summary>
                    <ul className="mf-bullets mf-small" style={{ marginTop: 6 }}>
                      {m.stats.excluded.map((x) => (
                        <li key={x.id}>
                          {deals.find((d) => d.id === x.id)?.title}: {x.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {comparison.notes.map((n) => (
          <p key={n} className="mf-hint">
            {n}
          </p>
        ))}
      </section>
    </div>
  );
}
