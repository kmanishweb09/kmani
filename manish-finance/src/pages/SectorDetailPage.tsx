import type { ClaimView, CompanySummary, DealSummary } from "../../shared/api";
import type { CompiledSector } from "../../shared/archive/compile";
import { countryName } from "../../shared/geo";
import type { Question } from "../../shared/schemas/research";
import type { Note } from "../../shared/schemas/private";
import { apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { usePrefs } from "../app/prefs";
import { invalidate, useQuery } from "../app/query";
import { Link, navigate, setQuery, useRoute } from "../app/router";
import { signInHref, useSession } from "../app/session";
import { useToast } from "../app/toast";
import { Ev, useRegisterEvidence } from "../components/Evidence";
import { Icon } from "../components/Icon";
import { AiAssist } from "../components/AiAssist";
import { Markdown } from "../components/Markdown";
import { PageHead } from "../components/PageHead";
import { QuestionCard } from "../components/Question";
import { EmptyState, ErrorState, Monogram, ProvTag, Skeleton, StatusPill, TabPanel, Tabs } from "../components/ui";
import { dateLabel, headlineText } from "../lib/format";

interface SectorResponse {
  sector: CompiledSector;
  deals: DealSummary[];
  companies: CompanySummary[];
  questions: Question[];
  evidence: Record<string, ClaimView>;
}

const STAGE_LABEL: Record<string, string> = {
  proposal: "Proposal",
  consultation: "Consultation",
  rule: "Final rule",
  approval: "Approval",
  effective: "Effective requirement",
  market_event: "Market event",
};

const UNIT_LABEL: Record<string, string> = { percent: "%", ratio: "ratio", multiple: "×", currency: "currency", count: "count", days: "days", bps: "bps", other: "—" };

export function SectorDetailPage({ slug }: { slug: string }) {
  const q = useQuery<SectorResponse>(`/api/finance/sectors/${slug}`);
  const route = useRoute();
  const { prefs, update } = usePrefs();
  const { isOwner } = useSession();
  const { notify } = useToast();
  useRegisterEvidence(q.data?.evidence);
  const s = q.data?.sector;
  const tabs = [
    { id: "overview", label: "How it makes money" },
    { id: "chain", label: "Value chain" },
    { id: "players", label: "Players" },
    { id: "metrics", label: "Metrics" },
    { id: "valuation", label: "Valuation" },
    { id: "mna", label: "M&A and diligence" },
    ...(s?.figWorkflow ? [{ id: "fig", label: "FIG workflow" }] : []),
    { id: "deals", label: "Deals" },
    { id: "changes", label: "What changed" },
    { id: "practice", label: "Practice" },
    { id: "view", label: "Build a sector view" },
  ];
  const tab = tabs.some((t) => t.id === route.query.get("tab")) ? (route.query.get("tab") as string) : "overview";

  if (q.error) {
    return (
      <div className="mf-stack">
        <PageHead title="Sector" crumbs={[{ to: "/finance/sectors", label: "Sectors" }]} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} what="this sector" />
      </div>
    );
  }
  if (!s || !q.data) return <Skeleton lines={12} height={18} />;
  const following = prefs.followedSectors.includes(s.slug);
  const buildView = async () => {
    if (!isOwner) return location.assign(signInHref());
    const body = `_Sector: ${s.name}. Research cutoff: ${s.recordUpdated}._\n\n## Thesis\n\n## Business models\n${s.subsectors.map((x) => `- ${x.name}: `).join("\n")}\n\n## Value drivers\n\n## Key players\n\n## Valuation logic\n\n## Consolidation thesis\n\n## Catalysts\n\n## Disconfirming evidence\n\n## Watchlist\n\n## Risks\n\n## Open questions\n\n## Sources and dates\n`;
    try {
      const r = await apiSend<{ note: Note }>("POST", "/api/finance/notes", { title: `Sector view: ${s.name}`, body, template: "sector_thesis", tags: [s.name], links: [{ type: "sector", id: s.slug }] }, { idempotencyKey: newIdempotencyKey() });
      invalidate("/api/finance/notes");
      navigate(`/finance/notebook/${r.note.id}`);
    } catch (e) {
      notify(`Failed to create note: ${errorMessage(e)}`, "error");
    }
  };
  const groups = new Map<string, Array<{ c: CompanySummary; note: string | null }>>();
  for (const p of s.players) {
    const c = q.data.companies.find((x) => x.id === p.companyId);
    if (!c) continue;
    groups.set(p.group, [...(groups.get(p.group) ?? []), { c, note: p.note ?? null }]);
  }
  return (
    <div className="mf-stack">
      <PageHead
        title={s.name}
        crumbs={[{ to: "/finance/sectors", label: "Sectors" }]}
        sub={s.tagline}
        actions={
          <>
            <button type="button" className="mf-btn small" aria-pressed={following} onClick={() => update({ followedSectors: following ? prefs.followedSectors.filter((x) => x !== s.slug) : [...prefs.followedSectors, s.slug], sectorPickerDismissed: true })}>
              <Icon name="bell" size={15} /> {following ? "Following" : "Follow sector"}
            </button>
            <button type="button" className="mf-btn small primary" onClick={() => void buildView()}>
              <Icon name="edit" size={15} /> Build a sector view
            </button>
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={(t) => setQuery({ tab: t === "overview" ? null : t })} label="Sector playbook sections" />
      <TabPanel>
        {tab === "overview" ? (
          <div className="mf-detail-layout">
            <div className="mf-stack">
              <section className="mf-section">
                <h2>How the sector makes money</h2>
                <Markdown source={s.howItMakesMoney} />
              </section>
              <section className="mf-section">
                <h2>Where value accrues</h2>
                <Markdown source={s.valueAccrual} />
              </section>
              {s.primer ? (
                <section className="mf-section">
                  <h2>
                    Analyst primer <ProvTag kind="analysis" />
                  </h2>
                  <Markdown source={s.primer} />
                </section>
              ) : null}
            </div>
            <aside className="mf-panel">
              <div className="mf-panel-head">
                <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                  Subsectors
                </h2>
              </div>
              <div className="mf-panel-body">
                <ul className="mf-list">
                  {s.subsectors.map((x) => (
                    <li key={x.id}>
                      <strong>{x.name}</strong>
                      <p className="mf-small" style={{ marginTop: 4 }}>
                        {x.businessModel}
                      </p>
                      <p className="mf-xsmall mf-muted" style={{ marginTop: 4 }}>
                        Valuation: {x.valuation}
                      </p>
                    </li>
                  ))}
                </ul>
                <AiAssist subject={{ type: "sector", id: s.slug }} subjectTitle={s.name} ops={["summarize", "questions", "draft_note"]} compact />
              </div>
            </aside>
          </div>
        ) : null}

        {tab === "chain" ? (
          <div className="mf-stack">
            <p className="mf-hint">Stages from left to right with where the economics sit. Grouped table rather than a decorative network graph.</p>
            <div className="mf-table-wrap">
              <table className="mf-table">
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">What happens</th>
                    <th scope="col">Economics</th>
                    <th scope="col">Covered examples</th>
                  </tr>
                </thead>
                <tbody>
                  {s.valueChain.map((v, i) => (
                    <tr key={v.stage}>
                      <td className="strong nowrap">
                        <span className="mf-mono mf-muted">{i + 1}.</span> {v.stage}
                      </td>
                      <td className="wrap">{v.description}</td>
                      <td className="wrap">{v.economics}</td>
                      <td className="wrap">
                        {v.examples.length
                          ? v.examples.map((id, j) => (
                              <span key={id}>
                                {j ? ", " : ""}
                                <Link to={`/finance/companies/${id}`}>{q.data?.companies.find((c) => c.id === id)?.displayName ?? id}</Link>
                              </span>
                            ))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "players" ? (
          groups.size ? (
            <div className="mf-grid-2">
              {[...groups.entries()].map(([g, list]) => (
                <section key={g} className="mf-panel">
                  <div className="mf-panel-head">
                    <h3>{g}</h3>
                  </div>
                  <div className="mf-panel-body">
                    <ul className="mf-list">
                      {list.map(({ c, note }) => (
                        <li key={c.id} className="mf-row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                          <Monogram name={c.displayName} />
                          <div>
                            <Link to={`/finance/companies/${c.id}`}>{c.displayName}</Link>
                            <div className="mf-hint">
                              {countryName(c.country)} · {c.subsector}
                              {note ? ` · ${note}` : ""}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState title="No covered players linked yet" />
          )
        ) : null}

        {tab === "metrics" ? (
          <div className="mf-stack">
            <p className="mf-hint">Formulas, denominators, interpretation and limitations. Issuer definitions can differ — the company page keeps the issuer’s own definition with each observation.</p>
            {s.metrics.map((m) => (
              <section key={m.id} id={`metric-${m.id}`} className="mf-panel">
                <div className="mf-panel-head">
                  <h3>{m.name}</h3>
                  <span className="mf-pill muted">{UNIT_LABEL[m.unit]}</span>
                </div>
                <div className="mf-panel-body mf-stack tight">
                  <code className="mf-formula">{m.formula}</code>
                  <dl className="mf-dl">
                    <dt>Denominator</dt>
                    <dd>{m.denominator}</dd>
                    <dt>Interpretation</dt>
                    <dd>{m.interpretation}</dd>
                    <dt>Limitations</dt>
                    <dd>{m.limitations}</dd>
                  </dl>
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {tab === "valuation" ? (
          <div className="mf-table-wrap">
            <table className="mf-table">
              <thead>
                <tr>
                  <th scope="col">Approach</th>
                  <th scope="col">When it is useful</th>
                  <th scope="col">When it misleads</th>
                </tr>
              </thead>
              <tbody>
                {s.valuation.map((v) => (
                  <tr key={v.method}>
                    <td className="strong">{v.method}</td>
                    <td className="wrap">{v.whenUseful}</td>
                    <td className="wrap">{v.whenMisleading}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === "mna" ? (
          <div className="mf-grid-2">
            {(
              [
                ["Why deals happen", s.mnaMotives],
                ["Integration issues", s.integrationIssues],
                ["Diligence questions", s.diligenceQuestions],
                ["Recurring structures", s.recurringStructures],
              ] as const
            ).map(([title, list]) => (
              <section key={title} className="mf-panel">
                <div className="mf-panel-head">
                  <h3>{title}</h3>
                </div>
                <div className="mf-panel-body">
                  <ul className="mf-bullets" style={{ paddingLeft: 18 }}>
                    {list.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {tab === "fig" && s.figWorkflow ? (
          <div className="mf-stack">
            <section className="mf-panel">
              <div className="mf-panel-head">
                <h3>Questions to answer for any financial institution</h3>
              </div>
              <div className="mf-panel-body">
                <ol className="mf-bullets">{s.figWorkflow.questions.map((x) => <li key={x}>{x}</li>)}</ol>
              </div>
            </section>
            <div className="mf-table-wrap">
              <table className="mf-table">
                <caption>Not every financial company is a bank: apply the model that fits the business.</caption>
                <thead>
                  <tr>
                    <th scope="col">Subsector</th>
                    <th scope="col">Primary approach</th>
                    <th scope="col">Avoid</th>
                  </tr>
                </thead>
                <tbody>
                  {s.figWorkflow.modelBySubsector.map((m) => (
                    <tr key={m.subsector}>
                      <td className="strong">{m.subsector}</td>
                      <td className="wrap">{m.primaryApproach}</td>
                      <td className="wrap">{m.avoid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="mf-section">
              <h3>Accounting measures versus regulatory measures</h3>
              <Markdown source={s.figWorkflow.regulatoryVsAccounting} />
            </section>
            <section className="mf-panel">
              <div className="mf-panel-head">
                <h3>Regulators and source pointers</h3>
              </div>
              <div className="mf-panel-body">
                <ul className="mf-list">
                  {s.regulators.map((r) => (
                    <li key={r.body}>
                      <a href={r.url} target="_blank" rel="noopener noreferrer">
                        {r.body} <Icon name="external" size={12} />
                      </a>
                      <Ev ids={r.ev} label={r.body} />
                      <div className="mf-hint">{r.role}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <p>
              Try the <Link to="/finance/lab?tab=fig">FIG lab</Link>: P/B versus ROE and a residual-income training model.
            </p>
          </div>
        ) : null}

        {tab === "deals" ? (
          q.data.deals.length ? (
            <ul className="mf-list">
              {q.data.deals.map((d) => (
                <li key={d.id}>
                  <div className="mf-row spread">
                    <Link to={`/finance/deals/${d.id}`}>{d.title}</Link>
                    <StatusPill status={d.status} />
                  </div>
                  <div className="mf-meta">
                    <span>{dateLabel(d.announced)}</span>
                    <span>{d.subsector}</span>
                    <span>
                      {headlineText(d.headline).value} {d.headline ? <span className="mf-basis">{headlineText(d.headline).basis}</span> : null}
                    </span>
                    <span>{countryName(d.target.country)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No covered deals in this sector yet" />
          )
        ) : null}

        {tab === "changes" ? (
          s.whatChanged.length ? (
            <ul className="mf-list">
              {[...s.whatChanged]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((w) => (
                  <li key={`${w.date}-${w.title}`}>
                    <div className="mf-row">
                      <span className="mf-mono mf-small">{dateLabel(w.date)}</span>
                      <span className={`mf-pill ${w.stage === "effective" || w.stage === "rule" ? "accent" : w.stage === "proposal" || w.stage === "consultation" ? "attention" : "muted"}`}>{STAGE_LABEL[w.stage]}</span>
                    </div>
                    <div className="mf-item-title" style={{ marginTop: 4 }}>
                      {w.title}
                      <Ev ids={w.ev} label={w.title} />
                    </div>
                    <p className="mf-small" style={{ marginTop: 4 }}>
                      {w.detail}
                    </p>
                  </li>
                ))}
            </ul>
          ) : (
            <EmptyState title="No dated changes recorded" />
          )
        ) : null}

        {tab === "practice" ? (
          <div className="mf-stack">
            <p className="mf-hint">Five questions with explanations. Answers are recorded for the owner only when submitted.</p>
            {q.data.questions.map((x, i) => (
              <QuestionCard key={x.id} q={x} index={i} />
            ))}
          </div>
        ) : null}

        {tab === "view" ? (
          <div className="mf-stack" style={{ maxWidth: 760 }}>
            <p>Build your own view with the sector-thesis template: thesis, drivers, valuation, consolidation, risks and open questions. The note is private and linked to this sector.</p>
            <ul className="mf-bullets" style={{ paddingLeft: 18 }}>
              <li>Thesis — what you believe and why, in two sentences.</li>
              <li>Drivers — the two or three variables that move value.</li>
              <li>Valuation — which approach fits which subsector, and why.</li>
              <li>Consolidation — who buys whom and what limits it.</li>
              <li>Risks and disconfirming evidence — what would change your mind.</li>
              <li>Open questions — what you still need to check.</li>
            </ul>
            <div>
              <button type="button" className="mf-btn primary" onClick={() => void buildView()}>
                <Icon name="edit" size={15} /> Start a sector view note
              </button>
            </div>
            <p className="mf-hint">
              <ProvTag kind="analysis" /> Playbook content is authored explanation; dated facts carry evidence links.
            </p>
          </div>
        ) : null}
      </TabPanel>
    </div>
  );
}
