import type { ClaimView } from "../../shared/api";
import { SECTOR_NAMES, SECTOR_SLUGS, type SectorSlugValue } from "../../shared/labels";
import type { Note } from "../../shared/schemas/private";
import { apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { invalidate, useQuery } from "../app/query";
import { Link, navigate, setQuery, useRoute } from "../app/router";
import { signInHref, useSession } from "../app/session";
import { useToast } from "../app/toast";
import { Ev, useRegisterEvidence } from "../components/Evidence";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, ProvTag, Skeleton } from "../components/ui";
import { dateLabel, formatTimestamp } from "../lib/format";

export interface BriefItemView {
  rank: number;
  headline: string;
  whatChanged: string;
  eventDate: { date: string; precision: "day" | "month" | "quarter" | "year" };
  publishedDate: string | null;
  whyItMatters: string;
  whyBasis?: "item" | "generic";
  uncertainty: string;
  eventType: string;
  sectors: SectorSlugValue[];
  entities: Array<{ type: "deal" | "company" | "sector"; id: string }>;
  whyThisAppears: string;
  newlyDiscovered: boolean;
  ev: string[];
  url?: string | null;
}

export interface BriefView {
  id: string;
  kind: "daily" | "weekly";
  title: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  cutoffAt: string;
  generatedAt: string;
  method: string;
  scope: "public" | "private";
  origin: "archive_example" | "generated";
  version: number;
  correctionNote: string | null;
  items: BriefItemView[];
  deepDive: { entity: { type: "deal" | "company"; id: string }; why: string; title?: string | null } | null;
  sectorImplication: { sector: SectorSlugValue; causalChain: string[]; label: "Analysis" } | null;
  question: { text: string; template?: string | null } | null;
  weekly: { statusChanges: Array<{ dealId: string; change: string }>; openQuestions: string[]; reflectionPrompt: string } | null;
  evidence: Record<string, ClaimView>;
  provider?: string | null;
  model?: string | null;
}

export interface BriefSummary {
  id: string;
  kind: "daily" | "weekly";
  title: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  cutoffAt: string;
  generatedAt: string;
  method: string;
  origin: "archive_example" | "generated";
  itemCount: number;
  sectors: SectorSlugValue[];
  scope: "public" | "private";
}

const METHOD_LABEL: Record<string, string> = {
  compiled_archive_example: "Historical example (compiled from the research archive)",
  compiled: "Compiled brief (deterministic, no AI)",
  ai_synthesis: "AI synthesis from a retrieved evidence pack",
};

export function BriefItem({ item }: { item: BriefItemView }) {
  return (
    <li>
      <div className="mf-row" style={{ gap: 8 }}>
        <span className="mf-mono mf-muted">#{item.rank}</span>
        {item.newlyDiscovered ? <span className="mf-pill attention">Newly discovered, not newly announced</span> : null}
        {item.sectors.map((s) => (
          <span key={s} className="mf-pill muted">
            {SECTOR_NAMES[s]}
          </span>
        ))}
      </div>
      <div className="mf-item-title" style={{ marginTop: 6 }}>
        {item.headline}
        <Ev ids={item.ev} label={item.headline} />
      </div>
      <p className="mf-small" style={{ marginTop: 6 }}>
        <ProvTag kind="fact" /> {item.whatChanged}
      </p>
      <p className="mf-small" style={{ marginTop: 6 }}>
        <ProvTag kind="analysis" /> {item.whyBasis === "generic" ? <span className="mf-muted">General note on this type of development: </span> : null}
        {item.whyItMatters}
      </p>
      <div className="mf-meta">
        <span>Event {dateLabel(item.eventDate)}</span>
        {item.publishedDate ? <span>Published {dateLabel(item.publishedDate)}</span> : null}
        <span>Uncertainty: {item.uncertainty}</span>
      </div>
      <details className="mf-details" style={{ marginTop: 4 }}>
        <summary>Why this appears</summary>
        <p className="mf-hint">{item.whyThisAppears}</p>
      </details>
      {item.entities.length ? (
        <div className="mf-meta">
          {item.entities.map((e) => (
            <Link key={`${e.type}-${e.id}`} to={`/finance/${e.type === "deal" ? "deals" : e.type === "company" ? "companies" : "sectors"}/${e.id}`}>
              Open {e.type}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function BriefBody({ brief }: { brief: BriefView }) {
  const { isOwner } = useSession();
  const { notify } = useToast();
  useRegisterEvidence(brief.evidence);
  const saveQuestion = async () => {
    if (!isOwner || !brief.question) return location.assign(signInHref());
    try {
      const r = await apiSend<{ note: Note }>(
        "POST",
        "/api/finance/notes",
        { title: `Research question: ${brief.question.text.slice(0, 120)}`, body: `## Question\n${brief.question.text}\n\n## What I found\n\n## Sources\n`, template: "research_question", links: [{ type: "brief", id: brief.id }], evidenceIds: brief.items.flatMap((i) => i.ev).slice(0, 50) },
        { idempotencyKey: newIdempotencyKey() },
      );
      invalidate("/api/finance/notes");
      navigate(`/finance/notebook/${r.note.id}`);
    } catch (e) {
      notify(`Failed to save question: ${errorMessage(e)}`, "error");
    }
  };
  return (
    <div className="mf-stack">
      <div className="mf-callout">
        <strong>{brief.label}.</strong> {METHOD_LABEL[brief.method] ?? brief.method}. Period {dateLabel(brief.periodStart)} – {dateLabel(brief.periodEnd)} · evidence cutoff {formatTimestamp(brief.cutoffAt)} · generated {formatTimestamp(brief.generatedAt)}
        {brief.version > 1 ? ` · version ${brief.version}` : ""}
        {brief.correctionNote ? <div style={{ marginTop: 6 }}>Correction: {brief.correctionNote}</div> : null}
      </div>
      <section className="mf-section">
        <h2>{brief.kind === "weekly" ? "Developments this week" : "Developments"}</h2>
        <ol className="mf-list" style={{ listStyle: "none" }}>
          {brief.items.map((i) => (
            <BriefItem key={i.rank} item={i} />
          ))}
        </ol>
      </section>
      {brief.deepDive ? (
        <section className="mf-panel">
          <div className="mf-panel-head">
            <h2>Worth understanding more deeply</h2>
          </div>
          <div className="mf-panel-body">
            <Link to={`/finance/${brief.deepDive.entity.type === "deal" ? "deals" : "companies"}/${brief.deepDive.entity.id}`}>{brief.deepDive.title ?? brief.deepDive.entity.id}</Link>
            <p className="mf-small" style={{ marginTop: 6 }}>
              {brief.deepDive.why}
            </p>
          </div>
        </section>
      ) : null}
      {brief.sectorImplication ? (
        <section className="mf-callout analysis">
          <ProvTag kind="analysis" /> <strong>Sector implication ({SECTOR_NAMES[brief.sectorImplication.sector]}).</strong>
          <ol className="mf-bullets" style={{ marginTop: 6 }}>
            {brief.sectorImplication.causalChain.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </section>
      ) : null}
      {brief.weekly ? (
        <section className="mf-grid-2">
          <div className="mf-panel">
            <div className="mf-panel-head">
              <h3>Deal status changes</h3>
            </div>
            <div className="mf-panel-body">
              {brief.weekly.statusChanges.length ? (
                <ul className="mf-list">
                  {brief.weekly.statusChanges.map((s) => (
                    <li key={s.dealId}>
                      <Link to={`/finance/deals/${s.dealId}`}>{s.dealId}</Link>: {s.change}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mf-hint">No status changes in the covered universe this week.</p>
              )}
            </div>
          </div>
          <div className="mf-panel">
            <div className="mf-panel-head">
              <h3>Open questions</h3>
            </div>
            <div className="mf-panel-body">
              <ul className="mf-bullets" style={{ paddingLeft: 18 }}>
                {brief.weekly.openQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <p className="mf-hint" style={{ marginTop: 8 }}>
                What changed my view? {brief.weekly.reflectionPrompt}
              </p>
            </div>
          </div>
        </section>
      ) : null}
      {brief.question ? (
        <section className="mf-panel">
          <div className="mf-panel-head">
            <h2>Question to investigate</h2>
          </div>
          <div className="mf-panel-body mf-stack tight">
            <p>{brief.question.text}</p>
            <div>
              <button type="button" className="mf-btn small" onClick={() => void saveQuestion()}>
                <Icon name="edit" size={14} /> Save as a research question
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function BriefsPage() {
  const route = useRoute();
  const kind = route.query.get("kind") ?? "";
  const sector = route.query.get("sector") ?? "";
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (sector) params.set("sector", sector);
  const list = useQuery<{ items: BriefSummary[]; today: string; todaysBriefId: string | null; scheduleNote: string; lastError: { at: string; message: string } | null }>(`/api/finance/briefs?${params.toString()}`);
  const { isOwner } = useSession();
  const { notify } = useToast();
  const compile = async (scope: "private" | "public") => {
    try {
      const r = await apiSend<{ brief: { id: string } }>("POST", "/api/finance/briefs/compile", { kind: "daily", scope }, { idempotencyKey: newIdempotencyKey() });
      invalidate("/api/finance/briefs");
      navigate(`/finance/briefs/${r.brief.id}`);
    } catch (e) {
      notify(`Brief not compiled: ${errorMessage(e)}`, "error");
    }
  };
  return (
    <div className="mf-stack">
      <PageHead
        title="Briefs"
        sub="Daily and weekly research summaries with their evidence. Historical briefs are immutable snapshots; corrections create a new version."
        actions={
          isOwner ? (
            <>
              <button type="button" className="mf-btn small primary" onClick={() => void compile("private")} title="Ranked with your followed sectors and watchlist; visible only to you.">
                <Icon name="refresh" size={15} /> Compile my brief
              </button>
              <button type="button" className="mf-btn small" onClick={() => void compile("public")} title="General brief ranked with the desk focus (FIG); visible to visitors.">
                Publish general brief
              </button>
            </>
          ) : null
        }
      />
      <div className="mf-row">
        <label className="mf-sr-only" htmlFor="b-kind">
          Brief type
        </label>
        <select id="b-kind" className="mf-select" style={{ width: "auto" }} value={kind} onChange={(e) => setQuery({ kind: e.target.value || null })}>
          <option value="">Daily and weekly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <label className="mf-sr-only" htmlFor="b-sector">
          Sector
        </label>
        <select id="b-sector" className="mf-select" style={{ width: "auto" }} value={sector} onChange={(e) => setQuery({ sector: e.target.value || null })}>
          <option value="">All sectors</option>
          {SECTOR_SLUGS.map((s) => (
            <option key={s} value={s}>
              {SECTOR_NAMES[s]}
            </option>
          ))}
        </select>
      </div>
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} what="briefs" />
      ) : !list.data ? (
        <Skeleton lines={6} height={24} />
      ) : (
        <>
          {!list.data.todaysBriefId ? (
            <div className="mf-callout attention">
              No brief for today ({dateLabel(list.data.today)}) yet. {list.data.scheduleNote}
              {list.data.lastError ? <span className="mf-block mf-small">Last compile attempt ({formatTimestamp(list.data.lastError.at)}) did not produce a brief: {list.data.lastError.message}</span> : null}
            </div>
          ) : null}
          {list.data.items.length ? (
            <ul className="mf-list">
              {list.data.items.map((b) => (
                <li key={b.id}>
                  <div className="mf-row spread">
                    <Link to={`/finance/briefs/${b.id}`} className="mf-item-title">
                      {b.title}
                    </Link>
                    <span className={`mf-pill ${b.origin === "archive_example" ? "muted" : "accent"}`}>{b.origin === "archive_example" ? "Historical example" : b.scope === "private" ? "Personal" : "Generated"}</span>
                  </div>
                  <div className="mf-meta">
                    <span>{b.kind === "weekly" ? "Weekly" : "Daily"}</span>
                    <span>
                      Period {dateLabel(b.periodStart)} – {dateLabel(b.periodEnd)}
                    </span>
                    <span>Cutoff {formatTimestamp(b.cutoffAt)}</span>
                    <span>{b.itemCount} items</span>
                    <span>{METHOD_LABEL[b.method] ?? b.method}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No briefs match" />
          )}
        </>
      )}
    </div>
  );
}

export function BriefDetailPage({ id }: { id: string }) {
  const q = useQuery<BriefView>(`/api/finance/briefs/${encodeURIComponent(id)}`, { scope: id.startsWith("p_") ? "private" : "public" });
  if (q.error) {
    return (
      <div className="mf-stack">
        <PageHead title="Brief" crumbs={[{ to: "/finance/briefs", label: "Briefs" }]} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} what="this brief" />
      </div>
    );
  }
  if (!q.data) return <Skeleton lines={10} height={18} />;
  return (
    <div className="mf-stack">
      <PageHead
        title={q.data.title}
        crumbs={[{ to: "/finance/briefs", label: "Briefs" }]}
        actions={
          <>
            <a className="mf-btn small" href={`/api/finance/briefs/${encodeURIComponent(id)}/export.md`} download>
              <Icon name="download" size={15} /> Markdown
            </a>
            <button type="button" className="mf-btn small" onClick={() => window.print()}>
              <Icon name="print" size={15} /> Print
            </button>
          </>
        }
      />
      <BriefBody brief={q.data} />
    </div>
  );
}
