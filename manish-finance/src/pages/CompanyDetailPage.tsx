import { useMemo, useState } from "react";
import type { CompanyDetail, ObservationView } from "../../shared/api";
import { observationDisplay } from "../../shared/archive/compile";
import { countryName } from "../../shared/geo";
import { SECTOR_NAMES } from "../../shared/labels";
import type { Note } from "../../shared/schemas/private";
import { apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { invalidate, useQuery } from "../app/query";
import { Link, navigate } from "../app/router";
import { signInHref, useSession } from "../app/session";
import { useToast } from "../app/toast";
import { Ev, useRegisterEvidence } from "../components/Evidence";
import { Icon } from "../components/Icon";
import { Dialog } from "../components/Overlay";
import { AiAssist } from "../components/AiAssist";
import { RecordHistory } from "../components/RecordHistory";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, Monogram, ProvTag, Skeleton, StatusPill } from "../components/ui";
import { dateLabel, headlineText } from "../lib/format";

function HistoryTable({ observations }: { observations: ObservationView[] }) {
  // Group flow/stock metrics by label; show only periods with sourced values (no interpolation).
  const groups = useMemo(() => {
    const m = new Map<string, ObservationView[]>();
    for (const o of observations) {
      const key = `${o.label}|${o.unit}|${o.currency ?? ""}|${o.scope}|${o.basis}`;
      m.set(key, [...(m.get(key) ?? []), o]);
    }
    return [...m.values()].filter((g) => g.length >= 2).map((g) => g.sort((a, b) => a.period.end.localeCompare(b.period.end)).slice(-3));
  }, [observations]);
  if (!groups.length) return null;
  return (
    <section className="mf-section">
      <h3>Three-year view (verified periods only)</h3>
      <p className="mf-hint">Only periods with a sourced observation are shown. Missing years are not interpolated.</p>
      <div className="mf-table-wrap">
        <table className="mf-table compact">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Periods (oldest → latest)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g[0]?.id}>
                <td className="strong">
                  {g[0]?.label}
                  <div className="mf-xsmall mf-muted">
                    {g[0]?.scope} · {g[0]?.basis.replace("_", " ")}
                  </div>
                </td>
                <td>
                  <span className="mf-row">
                    {g.map((o) => (
                      <span key={o.id} className="mf-pill" style={{ height: "auto", padding: "4px 8px" }}>
                        <span className="mf-mono">{o.period.label}</span>: {observationDisplay(o)}
                        <Ev ids={o.ev} label={`${o.label} ${o.period.label}`} />
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const CORRECTABLE = [
  { id: "displayName", label: "Display name" },
  { id: "website", label: "Official website" },
  { id: "irUrl", label: "Investor-relations URL" },
  { id: "aliases", label: "Aliases (comma separated)" },
  { id: "subsector", label: "Subsector" },
] as const;

function CorrectionDialog({ company, open, onClose }: { company: CompanyDetail; open: boolean; onClose: () => void }) {
  const { notify } = useToast();
  const [field, setField] = useState<(typeof CORRECTABLE)[number]["id"]>("website");
  const [next, setNext] = useState("");
  const [note, setNote] = useState("");
  const [src, setSrc] = useState({ url: "", publisher: "", title: "", publishedDate: "", excerpt: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const value = field === "aliases" ? next.split(",").map((s) => s.trim()).filter(Boolean) : next.trim();
      await apiSend("POST", "/api/finance/admin/corrections", { companyId: company.id, field, next: value, note, evidence: { ...src, publishedDate: src.publishedDate || null } }, { idempotencyKey: newIdempotencyKey() });
      invalidate(`/api/finance/companies/${company.id}`);
      notify("Correction published with its evidence; the previous value is kept in history.", "success");
      onClose();
    } catch (e) {
      const details = (e as { details?: Array<{ path: string; message: string }> }).details;
      if (Array.isArray(details)) setErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
      notify(`Correction not saved: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Correct ${company.displayName}`}
      footer={
        <>
          <button type="button" className="mf-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="mf-btn primary" disabled={busy || !next.trim() || !src.url.trim()} onClick={() => void submit()}>
            {busy ? "Publishing…" : "Publish correction"}
          </button>
        </>
      }
    >
      <div className="mf-stack tight">
        <p className="mf-hint">Corrections need evidence. The sourced historical value is kept and shown as superseded, not overwritten silently.</p>
        <div className="mf-field">
          <label htmlFor="corr-field">Field</label>
          <select id="corr-field" className="mf-select" value={field} onChange={(e) => setField(e.target.value as typeof field)}>
            {CORRECTABLE.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mf-field">
          <label htmlFor="corr-next">New value</label>
          <input id="corr-next" className="mf-input" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={Boolean(errors.next)} />
          {errors.next ? <span className="mf-error-text">{errors.next}</span> : null}
        </div>
        <div className="mf-field">
          <label htmlFor="corr-url">Source URL (https)</label>
          <input id="corr-url" className="mf-input" type="url" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} aria-invalid={Boolean(errors["evidence.url"])} />
          {errors["evidence.url"] ? <span className="mf-error-text">{errors["evidence.url"]}</span> : <span className="mf-hint">Stored as a link; the server does not fetch arbitrary URLs.</span>}
        </div>
        <div className="mf-grid-2">
          <div className="mf-field">
            <label htmlFor="corr-pub">Publisher</label>
            <input id="corr-pub" className="mf-input" value={src.publisher} onChange={(e) => setSrc({ ...src, publisher: e.target.value })} />
          </div>
          <div className="mf-field">
            <label htmlFor="corr-date">Publication date</label>
            <input id="corr-date" className="mf-input" type="date" value={src.publishedDate} onChange={(e) => setSrc({ ...src, publishedDate: e.target.value })} />
          </div>
        </div>
        <div className="mf-field">
          <label htmlFor="corr-title">Document title</label>
          <input id="corr-title" className="mf-input" value={src.title} onChange={(e) => setSrc({ ...src, title: e.target.value })} />
        </div>
        <div className="mf-field">
          <label htmlFor="corr-excerpt">Short supporting excerpt (optional, ≤ 300 characters)</label>
          <textarea id="corr-excerpt" className="mf-textarea" maxLength={300} style={{ minHeight: 70 }} value={src.excerpt} onChange={(e) => setSrc({ ...src, excerpt: e.target.value })} />
        </div>
        <div className="mf-field">
          <label htmlFor="corr-note">Why this correction?</label>
          <input id="corr-note" className="mf-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

function CompanyNotes({ company }: { company: CompanyDetail }) {
  const { isOwner } = useSession();
  const { notify } = useToast();
  const notes = useQuery<{ items: Note[] }>(isOwner ? `/api/finance/notes?entityType=company&entityId=${company.id}` : null, { scope: "private" });
  if (!isOwner) return <p className="mf-hint">Private research notes are available to the site owner. <a href={signInHref()}>Sign in</a></p>;
  const create = async () => {
    try {
      const body = `## How it makes money\n\n## Operating KPIs\n\n## Financial quality\n\n## Competitive position\n\n## Valuation approach\n\n## Recent corporate actions\n\n## Risks\n\n## Questions for management\n`;
      const r = await apiSend<{ note: Note }>("POST", "/api/finance/notes", { title: `Company note: ${company.displayName}`, body, template: "company_note", tags: [SECTOR_NAMES[company.sector]], links: [{ type: "company", id: company.id }] }, { idempotencyKey: newIdempotencyKey() });
      invalidate("/api/finance/notes");
      navigate(`/finance/notebook/${r.note.id}`);
    } catch (e) {
      notify(`Failed to create note: ${errorMessage(e)}`, "error");
    }
  };
  return (
    <div className="mf-stack tight">
      {notes.data?.items.length ? (
        <ul className="mf-list">
          {notes.data.items.map((n) => (
            <li key={n.id}>
              <Link to={`/finance/notebook/${n.id}`}>{n.title}</Link>
              <div className="mf-hint">Updated {n.updatedAt.slice(0, 10)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mf-hint">No notes linked to this company yet.</p>
      )}
      <button type="button" className="mf-btn small" onClick={() => void create()}>
        <Icon name="plus" size={14} /> New company research note
      </button>
    </div>
  );
}

export function CompanyDetailPage({ id }: { id: string }) {
  const q = useQuery<CompanyDetail>(`/api/finance/companies/${id}`);
  const { isOwner } = useSession();
  const { notify } = useToast();
  const watches = useQuery<{ items: Array<{ kind: string; entityId: string; following: boolean; saved: boolean }> }>(isOwner ? "/api/finance/watchlist" : null, { scope: "private" });
  const [corrOpen, setCorrOpen] = useState(false);
  const c = q.data;
  useRegisterEvidence(c?.evidence);
  if (q.error) {
    return (
      <div className="mf-stack">
        <PageHead title="Company" crumbs={[{ to: "/finance/companies", label: "Companies" }]} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} what="this company" />
      </div>
    );
  }
  if (!c) return <Skeleton lines={10} height={18} />;
  const following = watches.data?.items.find((w) => w.kind === "company" && w.entityId === c.id)?.following ?? false;
  const toggleFollow = async () => {
    if (!isOwner) return location.assign(signInHref());
    try {
      await apiSend("PUT", "/api/finance/watchlist", { kind: "company", entityId: c.id, following: !following, saved: false });
      invalidate("/api/finance/watchlist");
      notify(following ? "Stopped following." : `Following ${c.displayName}.`, "success");
    } catch (e) {
      notify(`Failed to update: ${errorMessage(e)}`, "error");
    }
  };
  const acquisitions = c.deals.filter((d) => d.acquirer.companyId === c.id);
  const asTarget = c.deals.filter((d) => d.target.companyId === c.id);
  const other = c.deals.filter((d) => d.acquirer.companyId !== c.id && d.target.companyId !== c.id);
  return (
    <div className="mf-stack">
      <PageHead
        title={
          <span className="mf-row" style={{ flexWrap: "nowrap", gap: 14 }}>
            <Monogram name={c.displayName} large />
            <span>{c.displayName}</span>
          </span>
        }
        docTitle={c.displayName}
        crumbs={[
          { to: "/finance/companies", label: "Companies" },
          { to: `/finance/sectors/${c.sector}`, label: SECTOR_NAMES[c.sector] },
        ]}
        sub={
          <span>
            {c.legalName}
            <Ev ids={c.identityEv} label="company identity" /> · {countryName(c.country)} · {c.subsector}
            {c.tickerDetails.length ? ` · ${c.tickerDetails.map((t) => `${t.exchange}:${t.symbol}${t.active ? "" : " (inactive)"}`).join(", ")}` : " · Unlisted"}
          </span>
        }
        actions={
          <>
            <button type="button" className="mf-btn small" aria-pressed={following} onClick={() => void toggleFollow()}>
              <Icon name="bell" size={15} /> {following ? "Following" : "Follow"}
            </button>
            <Link className="mf-btn small" to={`/finance/companies?compare=${c.id}`}>
              <Icon name="compare" size={15} /> Compare
            </Link>
            {isOwner ? (
              <button type="button" className="mf-btn small" onClick={() => setCorrOpen(true)}>
                <Icon name="edit" size={15} /> Correct record
              </button>
            ) : null}
          </>
        }
      />
      {c.lifecycleDetail.status !== "active" ? (
        <div className="mf-callout attention">
          <strong>Historical entity ({c.lifecycleDetail.status.replace("_", " ")}{c.lifecycleDetail.validTo ? ` on ${dateLabel(c.lifecycleDetail.validTo)}` : ""}).</strong> {c.lifecycleDetail.note}{" "}
          {c.lifecycleDetail.successorId ? (
            <>
              Successor: <Link to={`/finance/companies/${c.lifecycleDetail.successorId}`}>{c.lifecycleDetail.successorId}</Link>.
            </>
          ) : null}
        </div>
      ) : null}
      <div className="mf-detail-layout">
        <div className="mf-stack">
          <section className="mf-panel">
            <div className="mf-panel-head">
              <h2>Business model</h2>
              <ProvTag kind="analysis" title="Authored explanation based on the cited company disclosures" />
            </div>
            <div className="mf-panel-body mf-stack tight">
              <p>{c.businessModel.summary}</p>
              <dl className="mf-dl">
                <dt>Customers</dt>
                <dd>{c.businessModel.customers}</dd>
                <dt>Products / services</dt>
                <dd>{c.businessModel.products}</dd>
                <dt>Revenue model</dt>
                <dd>{c.businessModel.revenueModel}</dd>
                <dt>Cost drivers</dt>
                <dd>{c.businessModel.costDrivers}</dd>
                <dt>Positioning</dt>
                <dd>{c.businessModel.positioning}</dd>
                <dt>Principal risks</dt>
                <dd>
                  <ul className="mf-bullets" style={{ paddingLeft: 18 }}>
                    {c.businessModel.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </dd>
              </dl>
              {c.businessModel.basisNote ? <p className="mf-hint">{c.businessModel.basisNote}</p> : null}
            </div>
          </section>

          <section className="mf-panel">
            <div className="mf-panel-head">
              <h2>Dated financial and KPI observations</h2>
            </div>
            <div className="mf-panel-body mf-stack">
              {c.observations.length ? (
                <div className="mf-table-wrap">
                  <table className="mf-table compact">
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        <th scope="col">Period</th>
                        <th scope="col" className="num">
                          Value
                        </th>
                        <th scope="col">Scope · basis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.observations.map((o) => (
                        <tr key={o.id} style={o.supersededBy ? { opacity: 0.6 } : undefined}>
                          <td className="wrap">
                            {o.label}
                            {o.supersededBy ? (
                              <span className="mf-pill attention" style={{ marginLeft: 6 }} title={o.supersededBy.note}>
                                Superseded {o.supersededBy.publishedAt.slice(0, 10)}
                              </span>
                            ) : null}
                            {o.definition ? <div className="mf-xsmall mf-muted">{o.definition}</div> : null}
                          </td>
                          <td className="nowrap mf-small">
                            {o.period.label}
                            <div className="mf-xsmall mf-muted">{o.period.type === "point" ? `as at ${o.period.end}` : `${o.period.months} months to ${o.period.end}`}</div>
                          </td>
                          <td className="num">
                            {observationDisplay(o)}
                            <Ev ids={o.ev} label={`${o.label} ${o.period.label}`} />
                          </td>
                          <td className="mf-small">
                            {o.scope} · {o.basis.replace("_", " ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No verified financial observations recorded">Fields stay empty rather than filled from memory. Figures are added only as dated observations with a cited source, through owner research maintenance (Sources → Research maintenance); corrections cover identity fields only.</EmptyState>
              )}
              <HistoryTable observations={c.observations.filter((o) => !o.supersededBy)} />
              {isOwner ? (
                <p className="mf-hint" style={{ marginTop: 8 }}>
                  <Link to={`/finance/research?tab=edit&kind=observation&entity=${c.id}`}>Add a dated observation with its source</Link>
                </p>
              ) : null}
            </div>
          </section>

          <section className="mf-panel">
            <div className="mf-panel-head">
              <h2>Acquisitions and divestments in this database</h2>
            </div>
            <div className="mf-panel-body">
              {!c.deals.length ? (
                <p className="mf-hint">No covered transactions involve this company.</p>
              ) : (
                <ul className="mf-list">
                  {[...acquisitions.map((d) => ({ d, role: "Acquirer/investor" })), ...asTarget.map((d) => ({ d, role: "Target" })), ...other.map((d) => ({ d, role: "Other party" }))].map(({ d, role }) => (
                    <li key={d.id}>
                      <div className="mf-row spread">
                        <Link to={`/finance/deals/${d.id}`}>{d.title}</Link>
                        <StatusPill status={d.status} />
                      </div>
                      <div className="mf-meta">
                        <span>{role}</span>
                        <span>Announced {dateLabel(d.announced)}</span>
                        <span>
                          {headlineText(d.headline).value} {d.headline ? <span className="mf-basis">{headlineText(d.headline).basis}</span> : null}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <aside className="mf-stack tight">
          <section className="mf-panel">
            <div className="mf-panel-head">
              <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                Links
              </h2>
            </div>
            <div className="mf-panel-body mf-stack tight mf-small">
              {c.website ? (
                <a href={c.website} target="_blank" rel="noopener noreferrer">
                  Official website <Icon name="external" size={12} />
                </a>
              ) : (
                <span className="mf-muted">Website not recorded</span>
              )}
              {c.irUrl ? (
                <a href={c.irUrl} target="_blank" rel="noopener noreferrer">
                  Investor relations <Icon name="external" size={12} />
                </a>
              ) : (
                <span className="mf-muted">Investor-relations page not recorded</span>
              )}
              {c.aliases.length ? <span>Aliases: {c.aliases.join(", ")}</span> : null}
              {c.formerNames.length ? <span>Former names: {c.formerNames.map((f) => `${f.name}${f.until ? ` (until ${f.until})` : ""}`).join(", ")}</span> : null}
              <span className="mf-muted">Record updated {dateLabel(c.recordUpdated)}</span>
            </div>
          </section>
          <section className="mf-panel">
            <div className="mf-panel-head">
              <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                Peers and why
              </h2>
            </div>
            <div className="mf-panel-body">
              {c.peers.length ? (
                <ul className="mf-list">
                  {c.peers.map((p) => (
                    <li key={p.companyId}>
                      <Link to={`/finance/companies/${p.companyId}`}>{p.displayName ?? p.companyId}</Link>
                      <div className="mf-hint">{p.reason}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mf-hint">No peers linked.</p>
              )}
            </div>
          </section>
          {c.ownership.length ? (
            <section className="mf-panel">
              <div className="mf-panel-head">
                <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                  Major shareholders
                </h2>
              </div>
              <div className="mf-panel-body">
                <ul className="mf-list mf-small">
                  {c.ownership.map((o) => (
                    <li key={o.holder}>
                      {o.holder}: {o.pct ?? "?"}% (as of {dateLabel(o.asOf)})
                      <Ev ids={o.ev} label={`${o.holder} shareholding`} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
          <RecordHistory entries={c.history ?? []} />
          {c.corrections.length ? (
            <section className="mf-panel">
              <div className="mf-panel-head">
                <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                  Correction history
                </h2>
              </div>
              <div className="mf-panel-body">
                <ul className="mf-list mf-small">
                  {c.corrections.map((x) => (
                    <li key={x.id}>
                      {x.field}: “{String(x.previous ?? "—")}” → “{String(x.next)}” on {x.publishedAt.slice(0, 10)}
                      <Ev ids={x.ev} label={`correction to ${x.field}`} />
                      {x.note ? <div className="mf-hint">{x.note}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
          <section className="mf-panel">
            <div className="mf-panel-head">
              <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                My notes
              </h2>
            </div>
            <div className="mf-panel-body">
              <CompanyNotes company={c} />
            </div>
          </section>
          <AiAssist subject={{ type: "company", id: c.id }} subjectTitle={c.displayName} ops={["summarize", "questions", "draft_note"]} />
        </aside>
      </div>
      {isOwner ? <CorrectionDialog company={c} open={corrOpen} onClose={() => setCorrOpen(false)} /> : null}
    </div>
  );
}
