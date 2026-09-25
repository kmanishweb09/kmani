import { useEffect, useState } from "react";
import type { CompanyDetail, CompanySummary, Page } from "../../shared/api";
import { countryName } from "../../shared/geo";
import { SECTOR_NAMES, SECTOR_SLUGS } from "../../shared/labels";
import { fetchQuery, useQuery } from "../app/query";
import { Link, setQuery, useRoute } from "../app/router";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, Monogram, TableSkeleton } from "../components/ui";

function CompanyCompare({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const [details, setDetails] = useState<Record<string, CompanyDetail>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    for (const id of ids) {
      if (!details[id]) {
        fetchQuery<CompanyDetail>(`/api/finance/companies/${id}`)
          .then((d) => setDetails((cur) => ({ ...cur, [id]: d })))
          .catch(() => setError("Could not load one of the companies."));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
  const rows: Array<{ label: string; get: (c: CompanyDetail) => string }> = [
    { label: "Sector / subsector", get: (c) => `${SECTOR_NAMES[c.sector]} · ${c.subsector}` },
    { label: "Country", get: (c) => countryName(c.country) },
    { label: "Status", get: (c) => c.lifecycle },
    { label: "How it makes money", get: (c) => c.businessModel.revenueModel },
    { label: "Customers", get: (c) => c.businessModel.customers },
    { label: "Cost drivers", get: (c) => c.businessModel.costDrivers },
    { label: "Positioning", get: (c) => c.businessModel.positioning },
    { label: "Deals in database", get: (c) => String(c.deals.length) },
    { label: "Dated observations", get: (c) => (c.observations.length ? c.observations.slice(0, 3).map((o) => `${o.label} (${o.period.label})`).join("; ") : "None recorded") },
  ];
  return (
    <section className="mf-panel" aria-label="Company comparison">
      <div className="mf-panel-head">
        <h2 className="mf-panel-title">Compare companies</h2>
        <button type="button" className="mf-btn small ghost" onClick={onClear}>
          Clear selection
        </button>
      </div>
      <div className="mf-panel-body flush">
        {error ? <p className="mf-error-text" style={{ padding: 16 }}>{error}</p> : null}
        <div className="mf-table-wrap">
          <table className="mf-table compact">
            <thead>
              <tr>
                <th scope="col">Field</th>
                {ids.map((id) => (
                  <th key={id} scope="col" style={{ minWidth: 220 }}>
                    <Link to={`/finance/companies/${id}`}>{details[id]?.displayName ?? id}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" style={{ position: "static", color: "var(--mf-text)" }}>
                    {r.label}
                  </th>
                  {ids.map((id) => (
                    <td key={id} className="wrap mf-small">
                      {details[id] ? r.get(details[id] as CompanyDetail) : <span className="mf-skel" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mf-panel-foot">Business-model rows are authored analysis based on the cited disclosures; financial figures are compared only on the company pages with their periods and units.</div>
    </section>
  );
}

export function CompaniesPage() {
  const route = useRoute();
  const q = route.query.get("q") ?? "";
  const sector = route.query.get("sector") ?? "";
  const country = route.query.get("country") ?? "";
  const lifecycle = route.query.get("lifecycle") ?? "";
  const compare = (route.query.get("compare") ?? "").split(",").filter(Boolean).slice(0, 4);
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sector) params.set("sector", sector);
  if (country) params.set("country", country);
  if (lifecycle) params.set("lifecycle", lifecycle);
  params.set("pageSize", "100");
  const list = useQuery<Page<CompanySummary>>(`/api/finance/companies?${params.toString()}`);
  const [text, setText] = useState(q);
  const toggle = (id: string) => {
    const next = compare.includes(id) ? compare.filter((x) => x !== id) : compare.length >= 4 ? compare : [...compare, id];
    setQuery({ compare: next.join(",") || null });
  };
  return (
    <div className="mf-stack">
      <PageHead title="Companies" sub="Dossiers linked to deals, briefs and sector views. Parents, listed subsidiaries, business units and former entities are kept as distinct records." />
      <section className="mf-panel" aria-label="Filters">
        <div className="mf-panel-body mf-row" style={{ gap: 12 }}>
          <form
            className="mf-search"
            style={{ flex: "1 1 280px" }}
            onSubmit={(e) => {
              e.preventDefault();
              setQuery({ q: text.trim() || null });
            }}
          >
            <Icon name="search" size={16} />
            <input className="mf-input" type="search" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setQuery({ q: text.trim() || null })} placeholder="Name, alias, former name or ticker" aria-label="Search companies" />
          </form>
          <label className="mf-sr-only" htmlFor="co-sector">
            Sector
          </label>
          <select id="co-sector" className="mf-select" style={{ width: "auto" }} value={sector} onChange={(e) => setQuery({ sector: e.target.value || null })}>
            <option value="">All sectors</option>
            {SECTOR_SLUGS.map((s) => (
              <option key={s} value={s}>
                {SECTOR_NAMES[s]}
              </option>
            ))}
          </select>
          <label className="mf-sr-only" htmlFor="co-country">
            Country
          </label>
          <select id="co-country" className="mf-select" style={{ width: "auto" }} value={country} onChange={(e) => setQuery({ country: e.target.value || null })}>
            <option value="">All countries</option>
            <option value="IN">India-based</option>
            <option value="non-IN">Outside India</option>
          </select>
          <label className="mf-sr-only" htmlFor="co-life">
            Status
          </label>
          <select id="co-life" className="mf-select" style={{ width: "auto" }} value={lifecycle} onChange={(e) => setQuery({ lifecycle: e.target.value || null })}>
            <option value="">Active and historical</option>
            <option value="active">Active entities</option>
            <option value="historical">Historical (acquired, merged, delisted)</option>
          </select>
        </div>
      </section>
      {compare.length >= 2 ? <CompanyCompare ids={compare} onClear={() => setQuery({ compare: null })} /> : compare.length === 1 ? <p className="mf-hint">Select at least one more company to compare (up to four).</p> : null}
      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2 className="mf-panel-title">{list.data ? `${list.data.total} companies` : "Companies"}</h2>
        </div>
        <div className="mf-panel-body flush">
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} what="companies" />
          ) : !list.data ? (
            <TableSkeleton rows={10} cols={6} />
          ) : !list.data.items.length ? (
            <EmptyState title="No companies match">Try a former name or ticker, or clear filters.</EmptyState>
          ) : (
            <div className="mf-table-wrap">
              <table className="mf-table">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 44 }}>
                      <span className="mf-sr-only">Compare</span>
                    </th>
                    <th scope="col">Company</th>
                    <th scope="col">Sector / subsector</th>
                    <th scope="col">Country</th>
                    <th scope="col">Listing</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Deals
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((c) => (
                    <tr key={c.id} aria-selected={compare.includes(c.id)}>
                      <td>
                        <input type="checkbox" style={{ width: 16, height: 16, accentColor: "var(--mf-accent)" }} checked={compare.includes(c.id)} disabled={!compare.includes(c.id) && compare.length >= 4} onChange={() => toggle(c.id)} aria-label={`Compare ${c.displayName}`} />
                      </td>
                      <td>
                        <span className="mf-row" style={{ flexWrap: "nowrap" }}>
                          <Monogram name={c.displayName} />
                          <span>
                            <Link className="row-link" to={`/finance/companies/${c.id}`}>
                              {c.displayName}
                            </Link>
                            <span className="mf-xsmall mf-muted" style={{ display: "block" }}>
                              {c.legalName}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {SECTOR_NAMES[c.sector]}
                        <span className="mf-xsmall mf-muted" style={{ display: "block" }}>
                          {c.subsector}
                        </span>
                      </td>
                      <td>{countryName(c.country)}</td>
                      <td className="mf-mono mf-small">{c.tickers.map((t) => `${t.exchange}:${t.symbol}`).join(" · ") || "Unlisted"}</td>
                      <td>{c.lifecycle === "active" ? <span className="mf-pill positive">Active</span> : <span className="mf-pill muted">{c.lifecycle.replace("_", " ")}</span>}</td>
                      <td className="num">{c.dealCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
