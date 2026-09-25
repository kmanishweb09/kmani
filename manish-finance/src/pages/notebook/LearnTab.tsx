import { useEffect, useMemo, useState } from "react";
import type { GlossaryTerm, LearningModule, Question } from "../../../shared/schemas/research";
import { SECTOR_NAMES } from "../../../shared/labels";
import { apiSend, errorMessage, newIdempotencyKey } from "../../app/api";
import { invalidate, useQuery } from "../../app/query";
import { Link, setQuery, useRoute } from "../../app/router";
import { signInHref, useSession } from "../../app/session";
import { useToast } from "../../app/toast";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { QuestionCard } from "../../components/Question";
import { EmptyState, ErrorState, Segmented, Skeleton } from "../../components/ui";

interface ModuleListItem {
  id: string;
  number: number;
  title: string;
  summary: string;
  minutes: number;
  questionCount: number;
}

interface ProgressPayload {
  items: Array<{ itemType: "module" | "question"; itemId: string; status: string; correct: boolean | null; updatedAt: string }>;
  modulesTotal: number;
  questionsTotal: number;
}

function useProgress() {
  const { isOwner } = useSession();
  return useQuery<ProgressPayload>(isOwner ? "/api/finance/progress" : null, { scope: "private", staleMs: 10_000 });
}

export function LearnTab() {
  const route = useRoute();
  const moduleId = route.query.get("module");
  const term = route.query.get("term");
  const view = term ? "glossary" : (route.query.get("view") ?? "modules");
  return (
    <div className="mf-stack">
      <Segmented
        label="Learning library section"
        value={view as "modules" | "glossary" | "practice"}
        onChange={(v) => setQuery({ view: v === "modules" ? null : v, module: null, term: null })}
        options={[
          { value: "modules", label: "Modules" },
          { value: "glossary", label: "Glossary" },
          { value: "practice", label: "Practice set" },
        ]}
      />
      {view === "glossary" ? <Glossary focus={term} /> : view === "practice" ? <Practice /> : moduleId ? <ModuleView id={moduleId} /> : <ModuleList />}
    </div>
  );
}

function ModuleList() {
  const q = useQuery<{ items: ModuleListItem[] }>("/api/finance/learn");
  const progress = useProgress();
  const { isOwner } = useSession();
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="the learning library" />;
  if (!q.data) return <Skeleton lines={8} />;
  const completed = new Set((progress.data?.items ?? []).filter((p) => p.itemType === "module" && p.status === "completed").map((p) => p.itemId));
  const answered = (progress.data?.items ?? []).filter((p) => p.itemType === "question");
  return (
    <div className="mf-stack">
      {isOwner && progress.data ? (
        <p className="mf-small">
          Progress: {completed.size} of {progress.data.modulesTotal} modules marked complete · {answered.length} of {progress.data.questionsTotal} questions answered ({answered.filter((a) => a.correct === true).length} correct on objective questions).
        </p>
      ) : (
        <p className="mf-hint">
          Modules are open to everyone; nothing is gated. <a href={signInHref()}>Sign in</a> as the owner to record progress.
        </p>
      )}
      <ol className="mf-module-grid">
        {q.data.items.map((m) => (
          <li key={m.id}>
            <Link className="mf-module-card" to={`/finance/notebook?tab=learn&module=${m.id}`}>
              <span className="mf-eyebrow">
                Module {m.number} · {m.minutes} min {completed.has(m.id) ? "· completed" : ""}
              </span>
              <strong>{m.title}</strong>
              <span className="mf-small mf-muted">{m.summary}</span>
              <span className="mf-xsmall mf-muted">{m.questionCount} practice questions</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

const RELATED_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/finance/deals/${id}`,
  sector: (id) => `/finance/sectors/${id}`,
  glossary: (id) => `/finance/notebook?tab=learn&term=${id}`,
  lab: (id) => `/finance/lab?tab=${id === "fig" ? "fig" : id === "accretion" ? "accretion" : id === "dcf" ? "dcf" : "comparables"}`,
};

function ModuleView({ id }: { id: string }) {
  const q = useQuery<{ module: LearningModule; questions: Question[] }>(`/api/finance/learn/${encodeURIComponent(id)}`);
  const { isOwner } = useSession();
  const { notify } = useToast();
  const progress = useProgress();
  const done = (progress.data?.items ?? []).some((p) => p.itemType === "module" && p.itemId === id && p.status === "completed");

  useEffect(() => {
    if (!isOwner || !q.data) return;
    void apiSend("POST", "/api/finance/progress", { itemType: "module", itemId: id, status: "started" }).catch(() => undefined);
  }, [isOwner, q.data, id]);

  const complete = async () => {
    try {
      await apiSend("POST", "/api/finance/progress", { itemType: "module", itemId: id, status: "completed" });
      invalidate("/api/finance/progress");
      invalidate("/api/finance/desk");
      notify("Module marked complete.", "success");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="this module" />;
  if (!q.data) return <Skeleton lines={10} />;
  const m = q.data.module;
  return (
    <article className="mf-module">
      <p className="mf-small">
        <Link to="/finance/notebook?tab=learn">← All modules</Link>
      </p>
      <p className="mf-eyebrow">
        Module {m.number} · about {m.minutes} minutes
      </p>
      <h2 className="mf-module-title">{m.title}</h2>
      <p className="mf-muted">{m.summary}</p>
      <section className="mf-section mf-prose">
        <h3>Explanation</h3>
        <Markdown source={m.explanation} />
      </section>
      <section className="mf-section mf-prose mf-worked">
        <h3>Worked example</h3>
        <Markdown source={m.workedExample} />
      </section>
      <section className="mf-section">
        <h3>Common mistakes</h3>
        <ul className="mf-list">
          {m.commonMistakes.map((x) => (
            <li key={x} className="mf-small">
              {x}
            </li>
          ))}
        </ul>
      </section>
      <section className="mf-section mf-stack">
        <h3>Practice</h3>
        {q.data.questions.map((qq, i) => (
          <QuestionCard key={qq.id} q={qq} index={i} />
        ))}
      </section>
      <section className="mf-section">
        <h3>Source pointers</h3>
        <ul className="mf-list">
          {m.sourcePointers.map((s) => (
            <li key={s.url} className="mf-small">
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>{" "}
              — {s.publisher}
              {s.note ? <span className="mf-muted"> ({s.note})</span> : null}
            </li>
          ))}
        </ul>
        {m.related.length ? (
          <p className="mf-small">
            Related:{" "}
            {m.related.map((r, i) => (
              <span key={`${r.type}:${r.id}`}>
                {i ? " · " : ""}
                <Link to={(RELATED_HREF[r.type] ?? ((x: string) => x))(r.id)}>
                  {r.type === "lab" ? `Lab: ${r.id}` : r.id.replace(/^g-/, "").replaceAll("-", " ")}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </section>
      <div className="mf-row">
        {isOwner ? (
          <button type="button" className="mf-btn primary" onClick={() => void complete()} disabled={done}>
            <Icon name="check" size={15} /> {done ? "Completed" : "Mark module complete"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function Glossary({ focus }: { focus: string | null }) {
  const q = useQuery<{ items: GlossaryTerm[] }>("/api/finance/glossary");
  const { isOwner } = useSession();
  const { notify } = useToast();
  const [filter, setFilter] = useState("");
  const [sector, setSector] = useState("");
  const items = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (q.data?.items ?? [])
      .filter((g) => (!f || g.term.toLowerCase().includes(f) || g.definition.toLowerCase().includes(f)) && (!sector || g.sectors.includes(sector as GlossaryTerm["sectors"][number])))
      .sort((a, b) => a.term.localeCompare(b.term));
  }, [q.data, filter, sector]);

  useEffect(() => {
    if (!focus || !q.data) return;
    const el = document.getElementById(`term-${focus}`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus();
    }
  }, [focus, q.data]);

  const addToMemory = async (g: GlossaryTerm) => {
    try {
      await apiSend(
        "POST",
        "/api/finance/memory",
        { subject: { type: "concept", id: g.id }, cards: [{ cardType: "concept", prompt: `Define “${g.term}” and give the common confusion.`, answer: `${g.definition} Common confusion: ${g.confusion}`, sourceRefs: [{ kind: "glossary", id: g.id }] }] },
        { idempotencyKey: newIdempotencyKey() },
      );
      invalidate("/api/finance/memory");
      invalidate("/api/finance/review");
      notify(`“${g.term}” added to your review queue.`, "success");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="the glossary" />;
  if (!q.data) return <Skeleton lines={8} />;
  return (
    <div className="mf-stack">
      <div className="mf-toolbar">
        <label className="mf-search-field">
          <Icon name="search" size={16} />
          <span className="mf-sr-only">Filter glossary</span>
          <input className="mf-input" type="search" placeholder="Filter terms" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <select className="mf-select" aria-label="Filter by sector" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">All sectors</option>
          {Object.entries(SECTOR_NAMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="mf-xsmall mf-muted">
          {items.length} of {q.data.items.length} terms
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No matching terms" />
      ) : (
        <dl className="mf-glossary">
          {items.map((g) => (
            <div key={g.id} id={`term-${g.id}`} tabIndex={-1} className={`mf-glossary-item${focus === g.id ? " focused" : ""}`}>
              <dt>{g.term}</dt>
              <dd>
                <p>{g.definition}</p>
                <p className="mf-small">
                  <span className="mf-muted">Where it matters:</span> {g.context}
                </p>
                <p className="mf-small">
                  <span className="mf-muted">Common confusion:</span> {g.confusion}
                </p>
                <div className="mf-row mf-xsmall">
                  {g.example ? (
                    <Link to={g.example.type === "deal" ? `/finance/deals/${g.example.id}` : g.example.type === "company" ? `/finance/companies/${g.example.id}` : g.example.type === "sector" ? `/finance/sectors/${g.example.id}` : `/finance/notebook?tab=learn&module=${g.example.id}`}>
                      Example: {g.example.note}
                    </Link>
                  ) : null}
                  {isOwner ? (
                    <button type="button" className="mf-btn small ghost" onClick={() => void addToMemory(g)}>
                      <Icon name="plus" size={13} /> Add to review
                    </button>
                  ) : null}
                </div>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Practice() {
  const [topic, setTopic] = useState<"all" | "module" | "sector" | "deal" | "drill">("drill");
  const q = useQuery<{ items: Question[]; total: number }>(`/api/finance/questions${topic === "all" ? "" : `?topicType=${topic}`}`);
  const [count, setCount] = useState(10);
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="practice questions" />;
  return (
    <div className="mf-stack">
      <Segmented
        label="Question topic"
        value={topic}
        onChange={(v) => {
          setTopic(v);
          setCount(10);
        }}
        options={[
          { value: "drill", label: "Technical drills" },
          { value: "deal", label: "Deal drills" },
          { value: "sector", label: "Sector sets" },
          { value: "module", label: "Module questions" },
          { value: "all", label: "All" },
        ]}
      />
      {!q.data ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <p className="mf-small mf-muted">
            {q.data.total} questions. Objective answers are checked deterministically; open questions show a self-review rubric.
          </p>
          {q.data.items.slice(0, count).map((qq, i) => (
            <QuestionCard key={qq.id} q={qq} index={i} />
          ))}
          {count < q.data.items.length ? (
            <button type="button" className="mf-btn" onClick={() => setCount((c) => c + 10)}>
              Show more
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
