import { useEffect, useRef, useState } from "react";
import { CARD_TYPE_LABEL } from "../../../shared/labels";
import type { MemoryCard, MemoryRecord } from "../../../shared/schemas/private";
import { LADDER_DAYS } from "../../../shared/review/scheduler";
import { apiSend, errorMessage, newIdempotencyKey } from "../../app/api";
import { invalidate, useQuery } from "../../app/query";
import { Link } from "../../app/router";
import { useToast } from "../../app/toast";
import { Ev } from "../../components/Evidence";
import { Icon } from "../../components/Icon";
import { useConfirm } from "../../components/Overlay";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui";

type RecordItem = MemoryRecord & { title: string };

function subjectHref(type: string, id: string): string {
  return type === "deal" ? `/finance/deals/${id}` : `/finance/notebook?tab=learn&term=${id}`;
}

function SourceRefs({ refs, label }: { refs: MemoryCard["sourceRefs"]; label: string }) {
  const claims = refs.filter((r) => r.kind === "claim").map((r) => r.id);
  const others = refs.filter((r) => r.kind !== "claim");
  return (
    <span className="mf-row mf-xsmall mf-muted">
      {claims.length ? (
        <>
          Source <Ev ids={claims} label={label} />
        </>
      ) : null}
      {others.map((r) => (
        <Link key={`${r.kind}:${r.id}`} to={r.kind === "note" ? `/finance/notebook/${r.id}` : r.kind === "module" ? `/finance/notebook?tab=learn&module=${r.id}` : `/finance/notebook?tab=learn&term=${r.id}`}>
          {r.kind === "note" ? "your note" : r.kind}
        </Link>
      ))}
    </span>
  );
}

export function MemoryTab() {
  const q = useQuery<{ items: RecordItem[] }>("/api/finance/memory", { scope: "private", staleMs: 10_000 });
  const { notify } = useToast();
  const { confirm, element } = useConfirm();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const suspend = async (card: MemoryCard) => {
    try {
      await apiSend("PATCH", `/api/finance/memory/cards/${card.id}`, { suspended: !card.suspended });
      invalidate("/api/finance/memory");
      invalidate("/api/finance/review");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };
  const remove = async (r: RecordItem) => {
    if (!(await confirm({ title: "Delete this memory record?", message: `All ${r.cards.length} cards for “${r.title}” and their schedule will be removed. Review history is kept.`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await apiSend("DELETE", `/api/finance/memory/${r.id}?confirm=true`);
      invalidate("/api/finance/memory");
      invalidate("/api/finance/review");
      invalidate("/api/finance/desk");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="Deal Memory" />;
  if (!q.data) return <Skeleton lines={6} />;
  if (!q.data.items.length) {
    return (
      <EmptyState title="Deal Memory is empty" icon="layers" action={<Link className="mf-btn primary small" to="/finance/deals">Browse deals</Link>}>
        Open a deal and choose “Add to Deal Memory” to create recall cards: who bought what, consideration and structure, rationale, a valuation insight, a risk and a 60-second explanation. Each deal keeps one memory record.
      </EmptyState>
    );
  }
  return (
    <div className="mf-stack">
      {element}
      <p className="mf-hint">One record per deal or concept. Cards cite their source or your own note. When a linked deal changes, your original answers are kept and an update notice appears.</p>
      {q.data.items.map((r) => (
        <section key={r.id} className="mf-panel">
          <div className="mf-panel-head">
            <h2 className="mf-panel-title" style={{ fontSize: 17 }}>
              <Link to={subjectHref(r.subjectType, r.subjectId)}>{r.title || r.subjectId}</Link>
            </h2>
            <div className="mf-row">
              <span className="mf-xsmall mf-muted">
                {r.cards.length} cards · updated {r.updatedAt.slice(0, 10)}
              </span>
              <button type="button" className="mf-btn small ghost" onClick={() => void remove(r)}>
                <Icon name="trash" size={14} /> Delete
              </button>
            </div>
          </div>
          <div className="mf-panel-body mf-stack">
            {r.updateAvailable ? (
              <div className="mf-callout attention">
                <strong>Research record changed.</strong>
                <p className="mf-small">
                  {r.updateAvailable.reason} <Link to={subjectHref(r.subjectType, r.subjectId)}>Open the {r.subjectType}</Link> and use “Add to Deal Memory” to write updated cards.
                </p>
              </div>
            ) : null}
            <ul className="mf-list">
              {r.cards.map((c) => (
                <li key={c.id} className={c.suspended ? "mf-row-muted" : undefined}>
                  <div className="mf-row spread">
                    <strong className="mf-small">{CARD_TYPE_LABEL[c.cardType] ?? c.cardType}</strong>
                    <span className="mf-xsmall mf-muted">
                      {c.suspended ? "Suspended" : c.stage < 0 ? `New · due ${c.dueDate}` : `Stage ${c.stage + 1} of ${LADDER_DAYS.length} · due ${c.dueDate}`}
                    </span>
                  </div>
                  <p className="mf-small">{c.prompt}</p>
                  {revealed[c.id] ? <p className="mf-small mf-answer">{c.answer}</p> : null}
                  <div className="mf-row">
                    <button type="button" className="mf-btn small ghost" onClick={() => setRevealed((x) => ({ ...x, [c.id]: !x[c.id] }))} aria-expanded={Boolean(revealed[c.id])}>
                      {revealed[c.id] ? "Hide answer" : "Show answer"}
                    </button>
                    <button type="button" className="mf-btn small ghost" onClick={() => void suspend(c)}>
                      {c.suspended ? "Resume" : "Suspend"}
                    </button>
                    <SourceRefs refs={c.sourceRefs} label={c.prompt} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

interface ReviewPayload {
  today: string;
  timezone: string;
  schedulerVersion: string;
  due: Array<MemoryCard & { subjectType: string; subjectId: string; subjectTitle: string }>;
  dueCount: number;
  total: number;
  upcoming: Array<{ date: string; count: number }>;
  note: string;
}

const RATINGS: Array<{ id: "again" | "hard" | "good" | "easy"; label: string; help: string; key: string }> = [
  { id: "again", label: "Again", help: "Forgot — review tomorrow (resets the ladder)", key: "1" },
  { id: "hard", label: "Hard", help: "Recalled with difficulty — same stage, shorter interval", key: "2" },
  { id: "good", label: "Good", help: "Recalled — advance one stage", key: "3" },
  { id: "easy", label: "Easy", help: "Instant recall — advance two stages", key: "4" },
];

export function ReviewTab() {
  const q = useQuery<ReviewPayload>("/api/finance/review", { scope: "private", staleMs: 0 });
  const { notify, announce } = useToast();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [attempt, setAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Array<{ rating: string; dueAfter: string }>>([]);
  const keyRef = useRef<string>(newIdempotencyKey());
  const revealRef = useRef<HTMLButtonElement>(null);

  const due = q.data?.due ?? [];
  const card = due[index];

  useEffect(() => {
    setRevealed(false);
    setAttempt("");
    keyRef.current = newIdempotencyKey();
  }, [index]);

  const rate = async (rating: (typeof RATINGS)[number]["id"]) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const res = await apiSend<{ outcome: { dueAfter: string; stageAfter: number } }>("POST", "/api/finance/review", { cardId: card.id, rating }, { idempotencyKey: keyRef.current });
      setDone((d) => [...d, { rating, dueAfter: res.outcome.dueAfter }]);
      announce(`Rated ${rating}. Next review ${res.outcome.dueAfter}.`);
      setIndex((i) => i + 1);
      invalidate("/api/finance/desk");
      invalidate("/api/finance/memory");
    } catch (e) {
      notify(`Could not record the review: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!revealed || t?.closest("input, textarea, select, [contenteditable=true]")) return;
      const r = RATINGS.find((x) => x.key === e.key);
      if (r) {
        e.preventDefault();
        void rate(r.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="the review queue" />;
  if (!q.data) return <Skeleton lines={6} />;
  const data = q.data;

  return (
    <div className="mf-review-layout">
      <div className="mf-stack">
        <div className="mf-row spread">
          <p className="mf-small">
            <strong>{Math.max(0, data.dueCount - done.length)}</strong> due today ({data.today}, {data.timezone}) · {data.total} active cards
          </p>
          <span className="mf-xsmall mf-muted">{data.note}</span>
        </div>
        {!card ? (
          <EmptyState title={done.length ? "Review complete for today" : "Nothing due today"} icon="check" action={<Link className="mf-btn small" to="/finance/notebook?tab=memory">Open Deal Memory</Link>}>
            {done.length ? `You reviewed ${done.length} card${done.length === 1 ? "" : "s"}. Next reviews are scheduled on your local calendar.` : "Add deals to Deal Memory to build your review queue."}
          </EmptyState>
        ) : (
          <section className="mf-review-card" aria-labelledby="review-prompt">
            <div className="mf-row spread mf-xsmall mf-muted">
              <span>
                {CARD_TYPE_LABEL[card.cardType] ?? card.cardType} · <Link to={subjectHref(card.subjectType, card.subjectId)}>{card.subjectTitle}</Link>
              </span>
              <span>
                Card {index + 1} of {due.length}
              </span>
            </div>
            <h2 id="review-prompt" className="mf-review-prompt">
              {card.prompt}
            </h2>
            <label className="mf-field">
              <span>Your recall (optional — type before revealing)</span>
              <textarea className="mf-input mf-textarea" rows={4} value={attempt} onChange={(e) => setAttempt(e.target.value)} disabled={revealed} />
            </label>
            {!revealed ? (
              <button ref={revealRef} type="button" className="mf-btn primary" onClick={() => setRevealed(true)}>
                Reveal answer
              </button>
            ) : (
              <>
                <div className="mf-answer-box">
                  <p className="mf-xsmall mf-muted">Answer (your card, written from the cited source)</p>
                  <p>{card.answer}</p>
                  <SourceRefs refs={card.sourceRefs} label={card.prompt} />
                </div>
                <div className="mf-rating-grid" role="group" aria-label="Rate your recall">
                  {RATINGS.map((r) => (
                    <button key={r.id} type="button" className={`mf-btn rating-${r.id}`} disabled={busy} onClick={() => void rate(r.id)} title={r.help}>
                      <span>{r.label}</span>
                      <span className="mf-xsmall mf-muted">
                        {r.help} · key {r.key}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
      <aside className="mf-panel">
        <div className="mf-panel-head">
          <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
            How scheduling works
          </h2>
        </div>
        <div className="mf-panel-body mf-small mf-stack">
          <p>
            Interval ladder: {LADDER_DAYS.join(", ")} days ({data.schedulerVersion}). Good advances one stage, Easy two, Hard keeps the stage with a shorter repeat, Again resets to tomorrow. Dates follow your calendar in {data.timezone}.
          </p>
          {data.upcoming.length ? (
            <>
              <strong>Upcoming</strong>
              <ul className="mf-list">
                {data.upcoming.map((u) => (
                  <li key={u.date} className="mf-row spread">
                    <span>{u.date}</span>
                    <span className="mf-num">{u.count}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {done.length ? (
            <p className="mf-xsmall mf-muted">
              This session: {done.map((d) => d.rating).join(", ")}.
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
