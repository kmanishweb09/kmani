import { useState } from "react";
import type { SourceStatusView } from "../../shared/api";
import { VERIFICATION_HELP, VERIFICATION_LABEL, type VerificationValue } from "../../shared/labels";
import { apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { invalidate, useQuery } from "../app/query";
import { useSession } from "../app/session";
import { useToast } from "../app/toast";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, Skeleton, TabPanel, Tabs } from "../components/ui";
import { formatTimestamp } from "../lib/format";

interface Coverage {
  archiveVersion: string;
  cutoff: string;
  deals: number;
  dealsByRegion: Record<string, number>;
  recentDeals: number;
  autopsies: number;
  companies: number;
  companiesIndia: number;
  sectors: number;
  glossary: number;
  questions: number;
  modules: number;
  claims: Record<VerificationValue, number>;
  documents: { total: number; primary: number; retrieved: number };
  training: number;
}

interface ReviewItem {
  id: string;
  kind: string;
  subjectType: string | null;
  subjectId: string | null;
  field: string | null;
  proposal: Record<string, unknown>;
  evidence: Record<string, unknown>;
  origin: string;
  status: string;
  createdAt: string;
}

interface JobRow {
  id: string;
  jobType: string;
  requestedBy: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

const HEALTH_TONE: Record<string, string> = {
  working: "positive",
  cached: "accent",
  stale: "attention",
  manual: "muted",
  not_configured: "muted",
  rate_limited: "attention",
  access_unavailable: "negative",
  failed: "negative",
  never_run: "muted",
};

function SourceTable({ items }: { items: SourceStatusView[] }) {
  return (
    <div className="mf-table-wrap">
      <table className="mf-table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Health</th>
            <th scope="col">Last attempt</th>
            <th scope="col">Last success</th>
            <th scope="col">Access</th>
            <th scope="col">Endpoint check</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td className="wrap">
                <strong>{s.name}</strong>
                <div className="mf-xsmall mf-muted">{s.publisher}</div>
                <details className="mf-details">
                  <summary>Coverage and terms</summary>
                  <p className="mf-small">{s.coverage}</p>
                  <p className="mf-small mf-muted">{s.rightsNotes}</p>
                  {s.endpoint ? <p className="mf-mono mf-xsmall" style={{ overflowWrap: "anywhere" }}>{s.endpoint}</p> : null}
                  <p className="mf-xsmall mf-muted">
                    Capabilities: {s.capabilities.join(", ")} · refresh {s.refreshIntervalMinutes ? `every ${s.refreshIntervalMinutes / 60} h` : "manual"} · stale after {s.staleAfterHours ? `${s.staleAfterHours} h` : "n/a"}
                  </p>
                </details>
              </td>
              <td>
                <span className={`mf-pill ${HEALTH_TONE[s.health] ?? "muted"}`}>{s.healthLabel}</span>
                {s.error ? <div className="mf-xsmall mf-muted" style={{ maxWidth: 260, whiteSpace: "normal" }}>{s.error}</div> : null}
              </td>
              <td className="mf-small nowrap">{s.lastAttemptAt ? formatTimestamp(s.lastAttemptAt) : "—"}</td>
              <td className="mf-small nowrap">
                {s.lastSuccessAt ? formatTimestamp(s.lastSuccessAt) : "—"}
                {s.lastItemCount !== null ? <div className="mf-xsmall mf-muted">{s.lastItemCount} items</div> : null}
              </td>
              <td className="mf-small">{s.accessMethod === "api" ? "API" : s.accessMethod === "rss" ? "RSS/Atom" : s.accessMethod === "manual" ? "Manual source" : "Link only"}</td>
              <td className="mf-small wrap">
                <span className={`mf-pill ${s.endpointVerification.status === "verified_live" ? "positive" : s.endpointVerification.status === "manual" ? "muted" : "attention"}`}>
                  {s.endpointVerification.status === "verified_live" ? "Verified live" : s.endpointVerification.status === "manual" ? "Manual" : "Unverified"}
                </span>
                <div className="mf-xsmall mf-muted">{s.endpointVerification.note}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoveragePanel() {
  const q = useQuery<Coverage>("/api/finance/coverage");
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="coverage" />;
  if (!q.data) return <Skeleton lines={6} />;
  const c = q.data;
  const totalClaims = Object.values(c.claims).reduce((s, x) => s + x, 0);
  return (
    <div className="mf-stack">
      <div className="mf-callout">
        This is a curated research archive as of <strong>{c.cutoff}</strong> ({c.archiveVersion}), not a licensed or comprehensive M&A database. Counts describe what is covered here, not the market.
      </div>
      <div className="mf-grid-3">
        <div className="mf-figure">
          <div className="mf-figure-value">{c.deals}</div>
          <div className="mf-figure-label">Transactions covered</div>
          <div className="mf-figure-def">
            India-related {c.dealsByRegion.india ?? 0} · APAC ex-India {c.dealsByRegion.apac ?? 0} · rest of world {c.dealsByRegion.global ?? 0} · {c.recentDeals} with an event in the 12 months to the cutoff · {c.autopsies} deep autopsies
          </div>
        </div>
        <div className="mf-figure">
          <div className="mf-figure-value">{c.companies}</div>
          <div className="mf-figure-label">Company dossiers</div>
          <div className="mf-figure-def">{c.companiesIndia} India-based · {c.sectors} sector playbooks</div>
        </div>
        <div className="mf-figure">
          <div className="mf-figure-value">{c.documents.total}</div>
          <div className="mf-figure-label">Source documents</div>
          <div className="mf-figure-def">
            {c.documents.primary} primary · {c.documents.retrieved} retrieved by the build or owner
          </div>
        </div>
      </div>
      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2 className="mf-panel-title">Claim verification ({totalClaims} claims)</h2>
        </div>
        <div className="mf-panel-body flush">
          <div className="mf-table-wrap">
            <table className="mf-table compact">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Claims
                  </th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(c.claims) as VerificationValue[]).map((k) => (
                  <tr key={k}>
                    <td className="strong nowrap">{VERIFICATION_LABEL[k]}</td>
                    <td className="num">{c.claims[k]}</td>
                    <td className="wrap mf-small">{VERIFICATION_HELP[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function OwnerAdmin() {
  const { notify } = useToast();
  const admin = useQuery<{ items: SourceStatusView[]; jobs: JobRow[]; reviewPending: number }>("/api/finance/admin/sources", { scope: "private", staleMs: 10_000 });
  const review = useQuery<{ items: ReviewItem[] }>("/api/finance/admin/review?status=pending", { scope: "private", staleMs: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState({ url: "", publisher: "", title: "", publishedDate: "", eventDate: "", excerpt: "", dealId: "", eventType: "regulatory_approval", statusAfter: "" });
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      notify(ok, "success");
      invalidate("/api/finance/admin");
      invalidate("/api/finance/sources");
      invalidate("/api/finance/status");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mf-stack">
      <div className="mf-row">
        <button type="button" className="mf-btn primary small" disabled={busy === "refresh"} onClick={() => void act("refresh", () => apiSend("POST", "/api/finance/admin/refresh", {}, { idempotencyKey: newIdempotencyKey() }), "Refresh requested (one bounded, deduplicated run).")}>
          <Icon name="refresh" size={15} /> Refresh sources now
        </button>
        <span className="mf-hint">Runs each enabled connector once with timeouts, backoff and a lease so concurrent requests do not stampede upstream sites.</span>
      </div>
      {admin.error ? <ErrorState error={admin.error} onRetry={() => void admin.refetch()} what="source administration" /> : null}
      {admin.data ? (
        <section className="mf-panel">
          <div className="mf-panel-head">
            <h2 className="mf-panel-title">Connectors (owner diagnostics)</h2>
          </div>
          <div className="mf-panel-body flush">
            <div className="mf-table-wrap">
              <table className="mf-table compact">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Enabled</th>
                    <th scope="col">Diagnostics (redacted)</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.data.items
                    .filter((s) => s.accessMethod === "api" || s.accessMethod === "rss")
                    .map((s) => (
                      <tr key={s.id}>
                        <td className="strong">{s.name}</td>
                        <td>
                          <label className="mf-check">
                            <input type="checkbox" checked={s.enabled} onChange={() => void act(`en-${s.id}`, () => apiSend("PATCH", `/api/finance/admin/sources/${s.id}`, { enabled: !s.enabled }), s.enabled ? "Source disabled." : "Source enabled.")} />
                            <span className="mf-sr-only">Enable {s.name}</span>
                          </label>
                        </td>
                        <td className="wrap mf-small">{s.error ?? s.healthLabel}</td>
                        <td>
                          <button type="button" className="mf-btn small" disabled={busy === `t-${s.id}`} onClick={() => void act(`t-${s.id}`, () => apiSend("POST", `/api/finance/admin/sources/${s.id}/test`, {}, { idempotencyKey: newIdempotencyKey() }), "Connection test finished; see status.")}>
                            Test connection
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2 className="mf-panel-title">Review queue {review.data ? `(${review.data.items.length} pending)` : ""}</h2>
        </div>
        <div className="mf-panel-body">
          {review.error ? <ErrorState error={review.error} what="the review queue" /> : null}
          {review.data && !review.data.items.length ? <p className="mf-hint">Nothing awaiting review. Uncertain, conflicting or machine-extracted material terms land here before publication.</p> : null}
          <ul className="mf-list">
            {review.data?.items.map((r) => (
              <li key={r.id}>
                <div className="mf-row spread">
                  <strong>
                    {r.kind.replace(/_/g, " ")} {r.subjectId ? `· ${r.subjectId}` : ""}
                  </strong>
                  <span className="mf-xsmall mf-muted">
                    {r.origin} · {formatTimestamp(r.createdAt)}
                  </span>
                </div>
                <pre className="mf-formula" style={{ marginTop: 6 }}>{JSON.stringify(r.proposal, null, 2)}</pre>
                <p className="mf-xsmall mf-muted">Evidence: {JSON.stringify(r.evidence).slice(0, 300)}</p>
                <div className="mf-row" style={{ marginTop: 6 }}>
                  <button type="button" className="mf-btn small primary" onClick={() => void act(`p-${r.id}`, () => apiSend("POST", `/api/finance/admin/review/${r.id}/decision`, { decision: "publish" }, { idempotencyKey: newIdempotencyKey() }), "Published with its evidence.")}>
                    Publish
                  </button>
                  <button type="button" className="mf-btn small" onClick={() => void act(`r-${r.id}`, () => apiSend("POST", `/api/finance/admin/review/${r.id}/decision`, { decision: "reject" }, { idempotencyKey: newIdempotencyKey() }), "Rejected; kept in history.")}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2 className="mf-panel-title">Add a manual source (link + excerpt)</h2>
        </div>
        <div className="mf-panel-body mf-stack tight">
          <p className="mf-hint">For sources without a permitted automated feed (e.g., CCI orders, exchange filings). The server stores the link and your short excerpt; it does not fetch the URL. A deal event is queued for review.</p>
          <div className="mf-grid-2">
            <div className="mf-field">
              <label htmlFor="m-url">Source URL</label>
              <input id="m-url" className="mf-input" type="url" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} />
            </div>
            <div className="mf-field">
              <label htmlFor="m-pub">Publisher</label>
              <input id="m-pub" className="mf-input" value={manual.publisher} onChange={(e) => setManual({ ...manual, publisher: e.target.value })} />
            </div>
            <div className="mf-field">
              <label htmlFor="m-title">Document title</label>
              <input id="m-title" className="mf-input" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            </div>
            <div className="mf-field">
              <label htmlFor="m-deal">Deal ID (optional)</label>
              <input id="m-deal" className="mf-input" value={manual.dealId} onChange={(e) => setManual({ ...manual, dealId: e.target.value })} placeholder="e.g. hdfc-hdfc-bank-merger" />
            </div>
            <div className="mf-field">
              <label htmlFor="m-pd">Publication date</label>
              <input id="m-pd" className="mf-input" type="date" value={manual.publishedDate} onChange={(e) => setManual({ ...manual, publishedDate: e.target.value })} />
            </div>
            <div className="mf-field">
              <label htmlFor="m-ed">Event date</label>
              <input id="m-ed" className="mf-input" type="date" value={manual.eventDate} onChange={(e) => setManual({ ...manual, eventDate: e.target.value })} />
            </div>
            <div className="mf-field">
              <label htmlFor="m-type">Event type</label>
              <select id="m-type" className="mf-select" value={manual.eventType} onChange={(e) => setManual({ ...manual, eventType: e.target.value })}>
                <option value="regulatory_approval">Regulatory approval</option>
                <option value="regulatory_decision">Regulatory decision</option>
                <option value="shareholder_approval">Shareholder approval</option>
                <option value="court_approval">Court/tribunal approval</option>
                <option value="open_offer">Open offer</option>
                <option value="completion">Completion</option>
                <option value="termination">Termination</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="revision">Revised terms</option>
                <option value="subsequent">Subsequent event</option>
              </select>
            </div>
            <div className="mf-field">
              <label htmlFor="m-status">Status after (optional)</label>
              <select id="m-status" className="mf-select" value={manual.statusAfter} onChange={(e) => setManual({ ...manual, statusAfter: e.target.value })}>
                <option value="">No status change</option>
                <option value="pending_approvals">Pending approvals</option>
                <option value="approved">Approved</option>
                <option value="completed">Completed</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
          </div>
          <div className="mf-field">
            <label htmlFor="m-ex">Short excerpt (≤ 300 characters)</label>
            <textarea id="m-ex" className="mf-textarea" maxLength={300} style={{ minHeight: 70 }} value={manual.excerpt} onChange={(e) => setManual({ ...manual, excerpt: e.target.value })} />
          </div>
          <div>
            <button
              type="button"
              className="mf-btn primary small"
              disabled={!manual.url || !manual.title || !manual.publisher || busy === "manual"}
              onClick={() =>
                void act(
                  "manual",
                  () =>
                    apiSend(
                      "POST",
                      "/api/finance/admin/manual-source",
                      { ...manual, publishedDate: manual.publishedDate || null, eventDate: manual.eventDate || null, dealId: manual.dealId || null, statusAfter: manual.statusAfter || null },
                      { idempotencyKey: newIdempotencyKey() },
                    ),
                  "Manual source recorded; review item created.",
                )
              }
            >
              Record source
            </button>
          </div>
        </div>
      </section>

      {admin.data?.jobs.length ? (
        <section className="mf-panel">
          <div className="mf-panel-head">
            <h2 className="mf-panel-title">Recent jobs</h2>
          </div>
          <div className="mf-panel-body flush">
            <div className="mf-table-wrap">
              <table className="mf-table compact">
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Requested by</th>
                    <th scope="col">Status</th>
                    <th scope="col">Started</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.data.jobs.map((j) => (
                    <tr key={j.id}>
                      <td>{j.jobType}</td>
                      <td>{j.requestedBy}</td>
                      <td>{j.status}</td>
                      <td className="nowrap mf-small">{formatTimestamp(j.startedAt)}</td>
                      <td className="wrap mf-xsmall">{j.error ?? JSON.stringify(j.result ?? {}).slice(0, 200)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function SourcesPage() {
  const q = useQuery<{ items: SourceStatusView[]; scheduler: { scheduler: string; lastScheduledRunAt: string | null; lastRunAt: string | null } }>("/api/finance/sources", { staleMs: 30_000 });
  const { isOwner, status } = useSession();
  const [tab, setTab] = useState("health");
  const tabs = [
    { id: "health", label: "Source health" },
    { id: "coverage", label: "Coverage and citations" },
    ...(isOwner ? [{ id: "admin", label: "Administration" }] : []),
  ];
  return (
    <div className="mf-stack">
      <PageHead title="Sources" sub="Coverage, freshness, citations and source health. A source is only marked working after a real refresh succeeds." />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Source views" />
      <TabPanel>
        {tab === "health" ? (
          q.error ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} what="source status" />
          ) : !q.data ? (
            <Skeleton lines={8} />
          ) : (
            <div className="mf-stack">
              <div className={`mf-callout ${q.data.scheduler.scheduler === "observed" ? "" : "attention"}`}>
                <strong>{q.data.scheduler.scheduler === "observed" ? "Background schedule observed" : q.data.scheduler.scheduler === "stale" ? "Background schedule stale" : "Background schedule not configured"}.</strong>{" "}
                {q.data.scheduler.lastScheduledRunAt ? `Last scheduled run ${formatTimestamp(q.data.scheduler.lastScheduledRunAt)}. ` : "No scheduler invocation has been observed; sources refresh only when the owner requests it. "}
                While the app is open it re-checks cached status about every five minutes; that polling does not fetch upstream sources.
              </div>
              {q.data.items.length ? <SourceTable items={q.data.items} /> : <EmptyState title="No sources registered" />}
              {status ? <p className="mf-hint">Status checked {formatTimestamp(status.serverTime)}.</p> : null}
            </div>
          )
        ) : null}
        {tab === "coverage" ? <CoveragePanel /> : null}
        {tab === "admin" && isOwner ? <OwnerAdmin /> : null}
      </TabPanel>
    </div>
  );
}
