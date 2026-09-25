import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { DealSummary, Page } from "../../shared/api";
import { dealQueryToParams, type DealQuery, parseDealQuery, type SortField } from "../../shared/dealQuery";
import { countryName, GEO_HELP } from "../../shared/geo";
import {
  BUYER_TYPE_LABEL,
  BUYER_TYPES,
  DEAL_STATUS_LABEL,
  DEAL_STATUSES,
  DEAL_TYPE_LABEL,
  DEAL_TYPES,
  PAYMENT_LABEL,
  SECTOR_NAMES,
  SECTOR_SLUGS,
  VERIFICATION_LABEL,
} from "../../shared/labels";
import type { SavedSearch } from "../../shared/schemas/private";
import { apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { usePrefs } from "../app/prefs";
import { invalidate, useQuery } from "../app/query";
import { Link, navigate, useRoute } from "../app/router";
import { useSession } from "../app/session";
import { readLocal, writeLocal } from "../app/storage";
import { useToast } from "../app/toast";
import { Ev } from "../components/Evidence";
import { Icon } from "../components/Icon";
import { MultiSelect } from "../components/MultiSelect";
import { Dialog } from "../components/Overlay";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, Segmented, StatusPill, TableSkeleton } from "../components/ui";
import { dateLabel, headlineText } from "../lib/format";

type ColumnId = "announced" | "acquirer" | "target" | "sector" | "geography" | "value" | "stake" | "status" | "verification" | "payment" | "buyerType" | "dealType" | "multiples" | "updated";

interface Column {
  id: ColumnId;
  label: string;
  sort?: SortField;
  num?: boolean;
  optional?: boolean;
  render: (d: DealSummary, ctx: { system: "indian" | "international" }) => ReactNode;
}

function verificationSummaryText(d: DealSummary): { text: string; tone: string } {
  const v = d.verification;
  const total = Object.values(v).reduce((s, x) => s + x, 0);
  if (v.conflict) return { text: `${VERIFICATION_LABEL.conflict} (${v.conflict})`, tone: "negative" };
  if (total && v.source_checked + v.human_reviewed === total) return { text: VERIFICATION_LABEL.source_checked, tone: "positive" };
  if (v.search_corroborated) return { text: `${VERIFICATION_LABEL.search_corroborated}`, tone: "accent" };
  return { text: VERIFICATION_LABEL.pending, tone: "attention" };
}

export const DEAL_COLUMNS: Column[] = [
  { id: "announced", label: "Announced", sort: "announced", render: (d) => <span className="mf-mono nowrap">{dateLabel(d.announced)}</span> },
  {
    id: "acquirer",
    label: "Acquirer / investor",
    sort: "acquirer",
    render: (d) => (
      <span className="wrap" style={{ display: "block" }}>
        {d.acquirer.companyId ? <Link to={`/finance/companies/${d.acquirer.companyId}`}>{d.acquirer.name}</Link> : d.acquirer.name}
      </span>
    ),
  },
  {
    id: "target",
    label: "Target",
    sort: "target",
    render: (d) => (
      <span className="wrap" style={{ display: "block" }}>
        <Link className="row-link" to={`/finance/deals/${d.id}`}>
          {d.target.name}
        </Link>
        <span className="mf-xsmall mf-muted" style={{ display: "block" }}>
          {DEAL_TYPE_LABEL[d.dealType]}
          {d.hasAutopsy ? " · Autopsy" : ""}
        </span>
      </span>
    ),
  },
  {
    id: "sector",
    label: "Sector / subsector",
    sort: "sector",
    render: (d) => (
      <span className="nowrap">
        {SECTOR_NAMES[d.sector]}
        <span className="mf-xsmall mf-muted" style={{ display: "block" }}>
          {d.subsector}
        </span>
      </span>
    ),
  },
  { id: "geography", label: "Target geography", render: (d) => <span className="nowrap">{countryName(d.target.country)}{d.crossBorder ? <span className="mf-xsmall mf-muted" style={{ display: "block" }}>Cross-border</span> : null}</span> },
  {
    id: "value",
    label: "Disclosed value (basis)",
    sort: "value",
    num: true,
    render: (d, ctx) => {
      const h = headlineText(d.headline, ctx.system);
      return (
        <span className="nowrap">
          {d.headline ? (
            <>
              {h.value}
              <span className="mf-basis">{h.basis}</span>
              <Ev ids={d.headline.ev} label={`${d.title} value`} />
            </>
          ) : (
            <span className="mf-muted">Undisclosed</span>
          )}
        </span>
      );
    },
  },
  { id: "stake", label: "Stake", num: true, render: (d) => <span className="nowrap">{d.stake.acquiredPct !== null ? `${d.stake.acquiredPct}%` : "—"}</span> },
  {
    id: "status",
    label: "Status",
    sort: "status",
    render: (d) => (
      <span className="nowrap">
        <StatusPill status={d.status} />
        <Ev ids={d.statusEv} label={`${d.title} status`} />
        <span className="mf-xsmall mf-muted" style={{ display: "block" }}>
          as of {dateLabel(d.statusAsOf)}
        </span>
      </span>
    ),
  },
  {
    id: "verification",
    label: "Verification",
    render: (d) => {
      const v = verificationSummaryText(d);
      const t = d.verification;
      return (
        <span className={`mf-pill ${v.tone}`} title={`Claims: ${t.source_checked} source checked, ${t.search_corroborated} search-corroborated, ${t.pending} pending, ${t.conflict} conflicting, ${t.human_reviewed} human reviewed`}>
          {v.text}
        </span>
      );
    },
  },
  { id: "payment", label: "Consideration", optional: true, render: (d) => d.paymentMix.map((p) => PAYMENT_LABEL[p]).join(", ") },
  { id: "buyerType", label: "Buyer type", optional: true, render: (d) => BUYER_TYPE_LABEL[d.buyerType] },
  { id: "dealType", label: "Deal type", optional: true, render: (d) => DEAL_TYPE_LABEL[d.dealType] },
  {
    id: "multiples",
    label: "Disclosed multiples",
    optional: true,
    num: true,
    render: (d) => {
      const parts = [d.multiples.evEbitda !== null ? `EV/EBITDA ${d.multiples.evEbitda.toFixed(1)}×` : null, d.multiples.evRevenue !== null ? `EV/Rev ${d.multiples.evRevenue.toFixed(1)}×` : null, d.multiples.priceToBook !== null ? `P/B ${d.multiples.priceToBook.toFixed(2)}×` : null].filter(Boolean);
      return parts.length ? <span className="nowrap">{parts.join(" · ")}</span> : <span className="mf-muted">Not available</span>;
    },
  },
  { id: "updated", label: "Record updated", sort: "updated", optional: true, render: (d) => <span className="mf-mono nowrap">{d.lastChangedAt.slice(0, 10)}</span> },
];

const DEFAULT_COLUMNS: ColumnId[] = ["announced", "acquirer", "target", "sector", "geography", "value", "stake", "status", "verification"];

function useColumns(): [ColumnId[], (c: ColumnId[]) => void] {
  const [cols, setCols] = useState<ColumnId[]>(() => {
    const stored = readLocal<ColumnId[] | null>("dealColumns", null);
    return stored?.length ? stored.filter((c) => DEAL_COLUMNS.some((x) => x.id === c)) : DEFAULT_COLUMNS;
  });
  const set = (c: ColumnId[]) => {
    setCols(c);
    writeLocal("dealColumns", c);
  };
  return [cols, set];
}

const PRESETS: Array<{ label: string; params: Record<string, string> }> = [
  { label: "Last 12 months", params: { from: "" } },
  { label: "India FIG", params: { geo: "india", sector: "fig" } },
  { label: "Failed / withdrawn", params: { status: "withdrawn,terminated", geo: "global" } },
  { label: "Deep autopsies", params: { autopsy: "yes", geo: "global" } },
];

function twelveMonthsAgo(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function SavedSearches({ current }: { current: DealQuery }) {
  const { isOwner } = useSession();
  const { notify } = useToast();
  const saved = useQuery<{ items: Array<SavedSearch & { changes: number }> }>(isOwner ? "/api/finance/saved-searches" : null, { scope: "private" });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isOwner) return null;
  const save = async () => {
    setBusy(true);
    try {
      const { page: _p, pageSize: _ps, sort: _s, dir: _d, ...filters } = current;
      await apiSend("POST", "/api/finance/saved-searches", { name: name.trim(), filters }, { idempotencyKey: newIdempotencyKey() });
      invalidate("/api/finance/saved-searches");
      notify("Search saved to your account.", "success");
      setOpen(false);
      setName("");
    } catch (e) {
      notify(`Failed to save search: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const openSaved = async (s: SavedSearch) => {
    const params = dealQueryToParams({ ...s.filters });
    params.set("saved", s.id);
    navigate(`/finance/deals?${params.toString()}`);
    try {
      await apiSend("POST", `/api/finance/saved-searches/${s.id}/viewed`, {});
      invalidate("/api/finance/saved-searches");
    } catch {
      /* viewing still works; the change marker simply stays */
    }
  };
  const items = saved.data?.items ?? [];
  return (
    <>
      <MultiSelectLike label={`Saved searches${items.length ? ` (${items.length})` : ""}`}>
        {items.length === 0 ? <p className="mf-hint" style={{ padding: 8 }}>No saved searches yet.</p> : null}
        {items.map((s) => (
          <button key={s.id} type="button" className="mf-option" style={{ width: "100%", border: 0, background: "none", textAlign: "left" }} onClick={() => void openSaved(s)}>
            <span style={{ flex: 1 }}>{s.name}</span>
            {s.changes > 0 ? <span className="mf-pill accent">{s.changes} changed</span> : <span className="mf-xsmall mf-muted">no changes</span>}
          </button>
        ))}
      </MultiSelectLike>
      <button type="button" className="mf-btn small" onClick={() => setOpen(true)}>
        <Icon name="bookmark" size={15} /> Save search
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Save this search"
        footer={
          <>
            <button type="button" className="mf-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="mf-btn primary" disabled={!name.trim() || busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <div className="mf-field">
          <label htmlFor="ss-name">Name</label>
          <input id="ss-name" data-autofocus className="mf-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. India FIG, last 12 months" />
          <p className="mf-hint">Saved privately to your account. The Desk marks deals that change after you last opened this search.</p>
        </div>
      </Dialog>
    </>
  );
}

function MultiSelectLike({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mf-popover-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button type="button" className="mf-btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} <Icon name="chevronDown" size={14} />
      </button>
      {open ? <div className="mf-popover right">{children}</div> : null}
    </div>
  );
}

export function DealsPage() {
  const route = useRoute();
  const { prefs } = usePrefs();
  const { status } = useSession();
  const { query, errors } = useMemo(() => parseDealQuery(route.query), [route.query]);
  const effective: DealQuery = useMemo(() => ({ ...query, geo: query.geo ?? prefs.geography, geoMode: query.geoMode ?? prefs.geoMode }), [query, prefs.geography, prefs.geoMode]);
  const apiParams = dealQueryToParams(effective, { includePaging: true });
  const list = useQuery<Page<DealSummary>>(`/api/finance/deals?${apiParams.toString()}`, { staleMs: 60_000 });
  const [cols, setCols] = useColumns();
  const [selected, setSelected] = useState<string[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [search, setSearch] = useState(query.q ?? "");
  const system = prefs.inrNumberSystem;

  useEffect(() => setSearch(query.q ?? ""), [query.q]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((query.q ?? "") !== search.trim()) update({ q: search.trim() || null });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(patch: Record<string, string | null>) {
    const p = new URLSearchParams(route.query);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    if (!("page" in patch)) p.delete("page");
    p.delete("saved");
    navigate(`/finance/deals${p.toString() ? `?${p.toString()}` : ""}`, { replace: true, keepScroll: true });
  }

  const setList = (k: string) => (v: string[]) => update({ [k]: v.length ? v.join(",") : null });
  const toggleSort = (f: SortField) => {
    const cur = effective.sort ?? "announced";
    const dir = cur === f ? (effective.dir === "asc" ? "desc" : "asc") : f === "announced" || f === "value" || f === "updated" ? "desc" : "asc";
    update({ sort: f, dir });
  };
  const activeFilterCount = ["q", "sector", "buyerType", "dealType", "status", "payment", "from", "to", "crossBorder", "value", "autopsy"].filter((k) => route.query.get(k)).length;
  const visible = DEAL_COLUMNS.filter((c) => cols.includes(c.id));
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const today = status?.serverTime.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const exportHref = `/api/finance/deals/export.csv?${dealQueryToParams(effective).toString()}`;
  const totalInDb = (data?.meta?.totalInDatabase as number | undefined) ?? null;

  const toggleSelect = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));

  return (
    <div className="mf-stack">
      <PageHead
        title="Deals"
        sub={
          <>
            Covered transactions within this curated database — not the whole market. Archive cutoff {status?.app.archiveCutoff ? dateLabel(status.app.archiveCutoff) : "…"}.
          </>
        }
        actions={
          <>
            <SavedSearches current={effective} />
            <a className="mf-btn small" href={exportHref} download>
              <Icon name="download" size={15} /> Export CSV
            </a>
          </>
        }
      />

      <section className="mf-panel" aria-label="Search and filters">
        <div className="mf-panel-body mf-stack tight">
          <div className="mf-row" style={{ gap: 12 }}>
            <div className="mf-search" style={{ flex: "1 1 320px" }}>
              <Icon name="search" size={16} />
              <input
                className="mf-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search legal name, alias, ticker, deal title or adviser"
                aria-label="Search deals"
              />
            </div>
            <div className="mf-row">
              <Segmented
                label="Geography"
                value={effective.geo ?? "india"}
                onChange={(v) => update({ geo: v })}
                options={[
                  { value: "india", label: "India" },
                  { value: "apac", label: "APAC" },
                  { value: "global", label: "Global" },
                ]}
              />
              <label className="mf-sr-only" htmlFor="geo-mode">
                Location rule
              </label>
              <select id="geo-mode" className="mf-select" style={{ width: "auto", minHeight: 34 }} value={effective.geoMode ?? "either"} onChange={(e) => update({ geoMode: e.target.value })} disabled={effective.geo === "global"}>
                <option value="either">Target or acquirer (either)</option>
                <option value="target">Target location</option>
                <option value="acquirer">Acquirer location</option>
              </select>
            </div>
          </div>
          <p className="mf-hint">{GEO_HELP}</p>
          <div className="mf-row">
            <MultiSelect label="Sector" options={SECTOR_SLUGS.map((s) => ({ value: s, label: SECTOR_NAMES[s] }))} value={query.sector ?? []} onChange={setList("sector")} />
            <MultiSelect label="Deal type" options={DEAL_TYPES.map((s) => ({ value: s, label: DEAL_TYPE_LABEL[s] }))} value={query.dealType ?? []} onChange={setList("dealType")} />
            <MultiSelect label="Status" options={DEAL_STATUSES.map((s) => ({ value: s, label: DEAL_STATUS_LABEL[s] }))} value={query.status ?? []} onChange={setList("status")} />
            <MultiSelect label="Buyer type" options={BUYER_TYPES.map((s) => ({ value: s, label: BUYER_TYPE_LABEL[s] }))} value={query.buyerType ?? []} onChange={setList("buyerType")} />
            <MultiSelect label="Payment" options={(["cash", "stock", "mixed", "debt_assumption", "undisclosed"] as const).map((s) => ({ value: s, label: PAYMENT_LABEL[s] }))} value={query.payment ?? []} onChange={setList("payment")} />
            <label className="mf-sr-only" htmlFor="f-value">
              Disclosed value
            </label>
            <select id="f-value" className="mf-select" style={{ width: "auto", minHeight: 30, fontSize: 13 }} value={query.value ?? ""} onChange={(e) => update({ value: e.target.value || null })}>
              <option value="">Any value disclosure</option>
              <option value="disclosed">Value disclosed</option>
              <option value="undisclosed">Value undisclosed</option>
            </select>
            <label className="mf-sr-only" htmlFor="f-xb">
              Cross-border
            </label>
            <select id="f-xb" className="mf-select" style={{ width: "auto", minHeight: 30, fontSize: 13 }} value={query.crossBorder ?? ""} onChange={(e) => update({ crossBorder: e.target.value || null })}>
              <option value="">Domestic and cross-border</option>
              <option value="yes">Cross-border only</option>
              <option value="no">Domestic only</option>
            </select>
            <label className="mf-small mf-muted" htmlFor="f-from">
              From
            </label>
            <input id="f-from" type="date" className="mf-input" style={{ width: "auto", minHeight: 30, fontSize: 13 }} value={query.from ?? ""} onChange={(e) => update({ from: e.target.value || null })} />
            <label className="mf-small mf-muted" htmlFor="f-to">
              to
            </label>
            <input id="f-to" type="date" className="mf-input" style={{ width: "auto", minHeight: 30, fontSize: 13 }} value={query.to ?? ""} onChange={(e) => update({ to: e.target.value || null })} />
            {activeFilterCount ? (
              <button type="button" className="mf-btn ghost small" onClick={() => navigate("/finance/deals", { replace: true, keepScroll: true })}>
                <Icon name="close" size={14} /> Clear filters ({activeFilterCount})
              </button>
            ) : null}
          </div>
          <div className="mf-row">
            <span className="mf-small mf-muted">Presets:</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="mf-chip"
                onClick={() => {
                  const params = { ...p.params };
                  if (p.label === "Last 12 months") params.from = twelveMonthsAgo(today);
                  const qs = new URLSearchParams(params);
                  if (!params.geo) qs.set("geo", effective.geo ?? "india");
                  navigate(`/finance/deals?${qs.toString()}`, { replace: true, keepScroll: true });
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {errors.length ? <p className="mf-error-text">{errors.join(" ")}</p> : null}
        </div>
      </section>

      <section className="mf-panel" aria-labelledby="deal-results-title">
        <div className="mf-panel-head">
          <h2 id="deal-results-title" className="mf-panel-title">
            {data ? `${data.total} deal${data.total === 1 ? "" : "s"}` : "Deals"}
            {data && totalInDb !== null && data.total !== totalInDb ? <span className="mf-muted mf-small" style={{ fontWeight: 400 }}> of {totalInDb} in the database</span> : null}
          </h2>
          <div className="mf-row">
            <div className="mf-popover-wrap">
              <button type="button" className="mf-btn small" aria-expanded={colMenu} onClick={() => setColMenu((o) => !o)}>
                <Icon name="columns" size={15} /> Columns
              </button>
              {colMenu ? (
                <div className="mf-popover right" role="group" aria-label="Visible columns">
                  {DEAL_COLUMNS.map((c) => (
                    <label key={c.id} className="mf-option">
                      <input type="checkbox" checked={cols.includes(c.id)} onChange={() => setCols(cols.includes(c.id) ? cols.filter((x) => x !== c.id) : [...cols, c.id])} />
                      {c.label}
                    </label>
                  ))}
                  <button type="button" className="mf-link-btn mf-small" style={{ padding: 8 }} onClick={() => setCols(DEFAULT_COLUMNS)}>
                    Reset columns
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mf-panel-body flush">
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} what="deals" />
          ) : !data ? (
            <TableSkeleton rows={10} cols={visible.length + 1} />
          ) : data.items.length === 0 ? (
            <EmptyState
              title="No deals match these filters"
              action={
                <div className="mf-row">
                  {effective.geo !== "global" ? (
                    <button type="button" className="mf-btn" onClick={() => update({ geo: "global" })}>
                      Show global view
                    </button>
                  ) : null}
                  <button type="button" className="mf-btn" onClick={() => navigate("/finance/deals", { replace: true })}>
                    Clear filters
                  </button>
                </div>
              }
            >
              The database is curated, so absence here does not mean no such deal exists. Try the global view, remove a filter, or search an alias.
            </EmptyState>
          ) : (
            <div className="mf-table-wrap">
              <table className="mf-table">
                <caption className="mf-sr-only">Covered transactions. Values show their basis: EV, equity, stake consideration or basis unclear.</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 44 }}>
                      <span className="mf-sr-only">Select for comparison</span>
                    </th>
                    {visible.map((c) => {
                      const active = (effective.sort ?? "announced") === c.sort;
                      const dir = active ? (effective.dir ?? "desc") : undefined;
                      return (
                        <th key={c.id} scope="col" className={c.num ? "num" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                          {c.sort ? (
                            <button type="button" className="mf-sort-btn" data-active={active} onClick={() => toggleSort(c.sort as SortField)}>
                              {c.label}
                              <Icon name={active ? (dir === "asc" ? "sortAsc" : "sortDesc") : "sort"} size={13} />
                            </button>
                          ) : (
                            c.label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.id} aria-selected={selected.includes(d.id)}>
                      <td>
                        <input
                          type="checkbox"
                          className="mf-check"
                          style={{ width: 16, height: 16, accentColor: "var(--mf-accent)" }}
                          checked={selected.includes(d.id)}
                          disabled={!selected.includes(d.id) && selected.length >= 4}
                          onChange={() => toggleSelect(d.id)}
                          aria-label={`Select ${d.title} for comparison`}
                        />
                      </td>
                      {visible.map((c) => (
                        <td key={c.id} className={c.num ? "num" : undefined}>
                          {c.render(d, { system })}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {data && data.total > data.pageSize ? (
          <div className="mf-panel-foot">
            <span>
              Page {data.page} of {pages}
            </span>
            <div className="mf-row">
              <button type="button" className="mf-btn small" disabled={data.page <= 1} onClick={() => update({ page: String(data.page - 1) })}>
                <Icon name="chevronLeft" size={14} /> Previous
              </button>
              <button type="button" className="mf-btn small" disabled={data.page >= pages} onClick={() => update({ page: String(data.page + 1) })}>
                Next <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {selected.length ? (
        <div className="mf-sticky-bar" role="region" aria-label="Comparison selection">
          <span>
            {selected.length} selected for comparison {selected.length < 2 ? "(select at least two)" : ""} · max 4
          </span>
          <div className="mf-row">
            <button type="button" className="mf-btn small ghost" onClick={() => setSelected([])}>
              Clear
            </button>
            <button type="button" className="mf-btn small primary" disabled={selected.length < 2} onClick={() => navigate(`/finance/deals/compare?ids=${selected.join(",")}`)}>
              <Icon name="compare" size={15} /> Compare
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
