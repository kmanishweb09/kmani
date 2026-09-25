import { useMemo, useState } from "react";
import type { ClaimView } from "../../shared/api";
import { INTERVIEW_RUBRIC } from "../../shared/interview";
import { ApiError, apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { invalidate, useQuery } from "../app/query";
import { Link, navigate } from "../app/router";
import { useSession } from "../app/session";
import { useToast } from "../app/toast";
import { formatTimestamp } from "../lib/format";
import { Ev, useRegisterEvidence } from "./Evidence";
import { Icon } from "./Icon";
import { Dialog } from "./Overlay";

/**
 * Optional AI assist (owner only). Nothing is sent until the owner reviews the exact evidence list
 * and confirms. Output that fails grounding checks is shown separately as "held back", never as a
 * finding. When AI is off the panel explains why and points to the deterministic alternative.
 */

export type AiOp = "summarize" | "explain" | "draft_note" | "questions" | "interview_feedback" | "extract";

interface AiStatus {
  enabled: boolean;
  reason: string;
  model: string | null;
  dailyBudgetUsd: number;
  spentTodayUsd: number;
  requestsToday: number;
  dailyRequestCap: number;
  priceDate: string | null;
  costLabel: string;
  operations: Array<{ id: AiOp; label: string; alternative: string }>;
}

interface Preview {
  enabled: boolean;
  reason: string;
  alternative: string;
  items: Array<{ id: string; label: string; chars: number; private: boolean }>;
  instruction: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedMaxCostUsd: number | null;
  priceDate: string | null;
}

interface Section {
  kind: "fact" | "analysis" | "question";
  text: string;
  citations: string[];
}

export interface AiResultView {
  operation: AiOp;
  title: string | null;
  sections: Section[];
  held: Array<Section & { reasons: string[] }>;
  uncertainty: string;
  criteria?: Array<{ criterion: string; score: number; comment: string; citations: string[] }>;
  overall?: string;
  proposals?: Array<{ eventType: string; date: string; title: string; citations: string[] }>;
  queuedReviewItems?: string[];
  meta: { model: string; servedModel: string; generatedAt: string; evidenceVersion: string };
  /** Absent on stored results (e.g. saved interview feedback); usage is kept in the AI history log. */
  usage?: { inputTokens: number | null; outputTokens: number | null; estCostUsd: number; estimate: boolean; priceDate: string | null };
  evidence?: Record<string, ClaimView>;
  packLabels?: Record<string, string>;
}

const KIND_LABEL: Record<Section["kind"], string> = { fact: "Fact", analysis: "Analysis", question: "Question" };

export function useAiStatus(): AiStatus | null {
  const { isOwner } = useSession();
  const q = useQuery<AiStatus>(isOwner ? "/api/finance/ai/status" : null, { scope: "private", staleMs: 30_000 });
  return q.data ?? null;
}

function Citations({ ids, labels }: { ids: string[]; labels: Record<string, string> }) {
  const ev = ids.filter((id) => id.startsWith("ev-"));
  const other = ids.filter((id) => !id.startsWith("ev-"));
  return (
    <>
      {ev.length ? <Ev ids={ev} label="AI-cited evidence" /> : null}
      {other.map((id) =>
        id.startsWith("note:") ? (
          <Link key={id} className="mf-tag" to={`/finance/notebook/${id.slice(5)}`}>
            your note
          </Link>
        ) : (
          <span key={id} className="mf-tag">
            {labels[id] ?? id}
          </span>
        ),
      )}
    </>
  );
}

export function AiResultBody({ r }: { r: AiResultView }) {
  useRegisterEvidence(r.evidence);
  const labels = r.packLabels ?? {};
  return (
    <div className="mf-stack tight mf-ai-result">
      {r.title ? <h3 className="mf-h3">{r.title}</h3> : null}
      {r.sections.length ? (
        <ul className="mf-ai-sections">
          {r.sections.map((s, i) => (
            <li key={i} className={`mf-ai-section ${s.kind}`}>
              <span className={`mf-tag ${s.kind === "fact" ? "reported" : s.kind === "analysis" ? "analysis" : "assumed"}`}>{KIND_LABEL[s.kind]}</span> {s.text} <Citations ids={s.citations} labels={labels} />
            </li>
          ))}
        </ul>
      ) : null}
      {r.criteria?.length ? (
        <table className="mf-table compact">
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col" className="num">
                Score
              </th>
              <th scope="col">Comment</th>
            </tr>
          </thead>
          <tbody>
            {r.criteria.map((c) => (
              <tr key={c.criterion}>
                <td className="strong nowrap">{INTERVIEW_RUBRIC.find((x) => x.id === c.criterion)?.label ?? c.criterion}</td>
                <td className="num">{c.score} / 3</td>
                <td className="wrap">
                  {c.comment} <Citations ids={c.citations} labels={labels} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {r.overall ? <p>{r.overall}</p> : null}
      {r.proposals?.length ? (
        <div className="mf-callout">
          {r.proposals.length} proposed event{r.proposals.length > 1 ? "s" : ""} added to the owner review queue (Sources → Administration). Nothing was published automatically.
        </div>
      ) : null}
      {r.uncertainty ? (
        <p className="mf-hint">
          <strong>Uncertainty:</strong> {r.uncertainty}
        </p>
      ) : null}
      {r.held.length ? (
        <details className="mf-ai-held">
          <summary>
            {r.held.length} part{r.held.length > 1 ? "s" : ""} held back (failed grounding checks)
          </summary>
          <ul className="mf-list">
            {r.held.map((h, i) => (
              <li key={i}>
                <span className="mf-muted">{h.text}</span>
                <div className="mf-xsmall mf-ai-held-reason">{h.reasons.join(" · ")}</div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mf-xsmall mf-muted">
        AI synthesis from the listed evidence · {r.meta.servedModel}
        {r.meta.servedModel !== r.meta.model ? ` (fallback from ${r.meta.model})` : ""} · {formatTimestamp(r.meta.generatedAt)} · evidence version {r.meta.evidenceVersion}
        {r.usage ? ` · ${r.usage.inputTokens ?? "?"} in / ${r.usage.outputTokens ?? "?"} out tokens · est. US$${r.usage.estCostUsd.toFixed(4)} (estimate; prices dated ${r.usage.priceDate ?? "—"})` : ""}
      </p>
    </div>
  );
}

function noteMarkdown(r: AiResultView, subjectTitle: string): string {
  const lines = [`# ${r.title ?? `AI draft: ${subjectTitle}`}`, ""];
  for (const k of ["fact", "analysis", "question"] as const) {
    const items = r.sections.filter((s) => s.kind === k);
    if (!items.length) continue;
    lines.push(`## ${k === "fact" ? "Facts" : k === "analysis" ? "Analysis" : "Open questions"}`, "");
    for (const s of items) lines.push(`- ${s.text}${s.citations.length ? ` [${s.citations.join(", ")}]` : ""}`);
    lines.push("");
  }
  if (r.uncertainty) lines.push("## Uncertainty", "", r.uncertainty, "");
  lines.push("---", `_AI draft generated ${r.meta.generatedAt} by ${r.meta.servedModel} from evidence version ${r.meta.evidenceVersion}. Review before relying on it._`);
  return lines.join("\n");
}

export function AiAssist({
  subject,
  subjectTitle,
  ops,
  attemptId,
  compact,
}: {
  subject?: { type: "deal" | "company" | "sector"; id: string };
  subjectTitle: string;
  ops: AiOp[];
  attemptId?: string;
  compact?: boolean;
}) {
  const { isOwner } = useSession();
  const status = useAiStatus();
  const { notify } = useToast();
  const [op, setOp] = useState<AiOp>(ops[0] as AiOp);
  const [termId, setTermId] = useState("");
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "run" | "save" | null>(null);
  const [result, setResult] = useState<AiResultView | null>(null);
  const [error, setError] = useState<{ message: string; alternative?: string } | null>(null);
  const glossary = useQuery<{ items: Array<{ id: string; term: string }> }>(op === "explain" ? "/api/finance/glossary" : null, { staleMs: 600_000 });
  const notes = useQuery<{ items: Array<{ id: string; title: string }> }>(isOwner && op === "draft_note" ? "/api/finance/notes?limit=50" : null, { scope: "private" });
  const body = useMemo(() => ({ ...(subject ? { subject } : {}), ...(attemptId ? { attemptId } : {}), ...(op === "explain" && termId ? { termId } : {}), ...(op === "draft_note" ? { noteIds } : { noteIds: [] }) }), [subject, attemptId, op, termId, noteIds]);
  if (!isOwner || !status) return null;
  const opInfo = status.operations.find((o) => o.id === op);

  const openPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await apiSend<Preview>("POST", `/api/finance/ai/${op}/preview`, body));
    } catch (e) {
      setError({ message: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const run = async () => {
    setBusy("run");
    setError(null);
    try {
      const r = await apiSend<AiResultView>("POST", `/api/finance/ai/${op}`, body, { idempotencyKey: newIdempotencyKey() });
      setResult(r);
      setPreview(null);
      invalidate("/api/finance/ai");
      if (op === "interview_feedback") invalidate("/api/finance/interview");
      if (op === "extract") invalidate("/api/finance/admin");
    } catch (e) {
      const alt = e instanceof ApiError ? ((e.details as { alternative?: string } | undefined)?.alternative ?? opInfo?.alternative) : undefined;
      setError({ message: errorMessage(e), ...(alt ? { alternative: alt } : {}) });
      setPreview(null);
      invalidate("/api/finance/ai");
    } finally {
      setBusy(null);
    }
  };
  const saveAsNote = async () => {
    if (!result) return;
    setBusy("save");
    try {
      const evidenceIds = [...new Set(result.sections.flatMap((s) => s.citations).filter((c) => c.startsWith("ev-")))].slice(0, 50);
      const r = await apiSend<{ note: { id: string } }>(
        "POST",
        "/api/finance/notes",
        { title: `AI draft — ${subjectTitle}`.slice(0, 200), body: noteMarkdown(result, subjectTitle), template: subject?.type === "company" ? "company_note" : subject?.type === "sector" ? "sector_thesis" : "deal_note", tags: ["ai-draft"], links: subject ? [{ type: subject.type, id: subject.id }] : [], evidenceIds },
        { idempotencyKey: newIdempotencyKey() },
      );
      invalidate("/api/finance/notes");
      notify("Saved as a note tagged ai-draft.", "success");
      navigate(`/finance/notebook/${r.note.id}`);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={compact ? "mf-ai compact" : "mf-panel mf-ai"} aria-label="AI assist">
      {!compact ? (
        <div className="mf-panel-head">
          <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
            <Icon name="sparkle" size={15} /> AI assist <span className="mf-tag">optional</span>
          </h2>
        </div>
      ) : null}
      <div className={compact ? "mf-stack tight" : "mf-panel-body mf-stack tight"}>
        {!status.enabled ? (
          <p className="mf-hint">
            {status.reason} {opInfo?.alternative}
          </p>
        ) : (
          <p className="mf-hint">
            Uses only the stored evidence you review first. Today: est. US${status.spentTodayUsd.toFixed(2)} of US${status.dailyBudgetUsd.toFixed(2)}, {status.requestsToday}/{status.dailyRequestCap} requests.
          </p>
        )}
        {ops.length > 1 ? (
          <div className="mf-field">
            <label htmlFor={`ai-op-${subject?.id ?? attemptId}`}>Task</label>
            <select id={`ai-op-${subject?.id ?? attemptId}`} className="mf-select" value={op} onChange={(e) => (setOp(e.target.value as AiOp), setResult(null), setError(null))}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {status.operations.find((x) => x.id === o)?.label ?? o}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {op === "explain" ? (
          <div className="mf-field">
            <label htmlFor="ai-term">Term</label>
            <select id="ai-term" className="mf-select" value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Choose a glossary term…</option>
              {glossary.data?.items.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.term}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {op === "draft_note" ? (
          <fieldset className="mf-fieldset">
            <legend>Include your notes (optional — sent only if ticked)</legend>
            {notes.data?.items.length ? (
              notes.data.items.slice(0, 12).map((n) => (
                <label key={n.id} className="mf-check">
                  <input type="checkbox" checked={noteIds.includes(n.id)} disabled={!noteIds.includes(n.id) && noteIds.length >= 5} onChange={(e) => setNoteIds(e.target.checked ? [...noteIds, n.id] : noteIds.filter((x) => x !== n.id))} /> {n.title}
                </label>
              ))
            ) : (
              <p className="mf-hint">No notes yet.</p>
            )}
          </fieldset>
        ) : null}
        <div className="mf-row">
          <button type="button" className="mf-btn small" disabled={busy !== null || (op === "explain" && !termId)} onClick={() => void openPreview()}>
            {busy === "preview" ? "Preparing…" : "Review what will be sent"}
          </button>
        </div>
        {error ? (
          <div className="mf-callout attention" role="alert">
            {error.message}
            {error.alternative && !error.message.includes(error.alternative) ? ` ${error.alternative}` : ""}
          </div>
        ) : null}
        {result ? (
          <>
            <AiResultBody r={result} />
            {op === "draft_note" || op === "summarize" ? (
              <div>
                <button type="button" className="mf-btn small" disabled={busy === "save"} onClick={() => void saveAsNote()}>
                  Save as note
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Content that will be sent"
        footer={
          preview?.enabled ? (
            <>
              <button type="button" className="mf-btn" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button type="button" className="mf-btn primary" disabled={busy === "run"} onClick={() => void run()}>
                {busy === "run" ? "Waiting for the model…" : "Send to AI"}
              </button>
            </>
          ) : (
            <button type="button" className="mf-btn" onClick={() => setPreview(null)}>
              Close
            </button>
          )
        }
      >
        {preview ? (
          <div className="mf-stack tight">
            {!preview.enabled ? <div className="mf-callout attention">{preview.reason}</div> : null}
            <p className="mf-hint">{preview.instruction}</p>
            <p className="mf-small">
              {preview.items.length} evidence items (~{preview.estimatedInputTokens.toLocaleString()} input tokens, up to {preview.maxOutputTokens.toLocaleString()} output tokens)
              {preview.estimatedMaxCostUsd !== null ? `; worst case est. US$${preview.estimatedMaxCostUsd.toFixed(4)} (estimate; prices dated ${preview.priceDate ?? "—"})` : ""}.
            </p>
            <ul className="mf-list mf-ai-preview">
              {preview.items.map((i) => (
                <li key={i.id} className="mf-small">
                  <span className="mf-mono mf-xsmall">{i.id}</span> {i.label} {i.private ? <span className="mf-tag assumed">private</span> : null}
                </li>
              ))}
            </ul>
            <p className="mf-hint">Instructions inside documents are treated as data. No tools or web access are given to the model.</p>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
