import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { invalidate, useQuery } from "../app/query";
import { Link, setQuery, useRoute } from "../app/router";
import { signInHref, useSession } from "../app/session";
import { useToast } from "../app/toast";
import { Icon } from "../components/Icon";
import { Dialog } from "../components/Overlay";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, Skeleton, TabPanel, Tabs } from "../components/ui";
import { formatTimestamp } from "../lib/format";

/**
 * Owner research maintenance: create or edit companies and deals, revised terms, dated observations,
 * deal events and claim verifications as drafts; preview (errors, warnings, duplicates, before/after);
 * edit before publishing; import files of proposals; and review or roll back the published history.
 */

const KINDS = [
  { id: "claim_verification", label: "Claim verification", entity: "Claim ID (from the evidence drawer)", help: "Upgrade or downgrade a claim's verification. “Source checked” needs the retrieval time, an exact locator, a short excerpt and the value found." },
  { id: "observation", label: "Dated company observation", entity: "Company ID", help: "A reported figure or KPI for a period that has ended, with its scope, basis and source. A different value for the same period must supersede the old one explicitly." },
  { id: "term_revision", label: "Revised deal term / multiple", entity: "Deal ID", help: "Revised terms keep the original visible as superseded. Transaction multiples need the denominator period, accounting basis and perimeter." },
  { id: "deal_event", label: "Deal event", entity: "Deal ID", help: "An event older than the deal's current status is added to the timeline but never moves the status backwards." },
  { id: "deal_edit", label: "Deal edit", entity: "Deal ID", help: "Replace fields such as counterparties (otherParties), advisers, payment, stake, perimeter or peer group. Cited sub-fields carry their own citations; other fields need the draft-level cites." },
  { id: "company_edit", label: "Company edit", entity: "Company ID", help: "Replace identity or business-model fields with a citation for the edit." },
  { id: "deal_create", label: "New deal", entity: "", help: "A full deal record. Duplicates (same parties within 180 days, same ID) are blocked." },
  { id: "company_create", label: "New company", entity: "", help: "A full company dossier. Duplicates (same listing, same name in the same country, same ID) are blocked." },
] as const;
type Kind = (typeof KINDS)[number]["id"];
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

const TABS = [
  { id: "drafts", label: "Drafts" },
  { id: "edit", label: "Editor" },
  { id: "import", label: "Import" },
  { id: "history", label: "Published history" },
];

const DOC_TYPES = ["press_release", "exchange_filing", "regulatory_filing", "regulatory_order", "court_order", "annual_report", "investor_presentation", "company_page", "news_report", "reference", "dataset"];

interface Issue {
  path: string;
  code: string;
  message: string;
}
interface EvaluationView {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  duplicates: Array<{ against: string; id: string; label: string; exact: boolean; reason: string }>;
  entity: { type: string; id: string; label: string; exists: boolean };
  fields: string[];
  diff: Array<{ field: string; before: unknown; after: unknown }>;
  change: { changeType: string; documents: Array<{ id: string; title: string; url: string }>; claims: Array<{ id: string; label: string; status: string }> } | null;
}
interface DraftDoc {
  ref: string;
  url: string;
  publisher: string;
  title: string;
  documentType: string;
  isPrimary: boolean;
  publishedDate: { date: string; precision: string } | null;
  retrievedAt: string | null;
}
interface DraftView {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  evidence?: { documents?: DraftDoc[] };
  note: string | null;
  revision: number;
  status: string;
  origin: string;
  updatedAt: string;
  publishedChangeId: string | null;
  evaluation?: EvaluationView;
  conflict?: boolean;
  summary?: { ok: boolean; errors: number; warnings: number; duplicates: number; entityLabel: string } | null;
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v, (k, x) => (k === "ev" ? undefined : x));
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

function EvaluationPanel({ e, conflict, onRebase }: { e: EvaluationView; conflict?: boolean; onRebase?: () => void }) {
  return (
    <section className="mf-panel" aria-label="Draft preview">
      <div className="mf-panel-head">
        <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
          Preview: {e.entity.label}
        </h2>
        <span className={`mf-pill ${e.ok ? "positive" : "negative"}`}>{e.ok ? "Ready to publish" : `${e.errors.length} issue${e.errors.length === 1 ? "" : "s"} to fix`}</span>
      </div>
      <div className="mf-panel-body mf-stack tight">
        {conflict ? (
          <div className="mf-callout negative" role="alert">
            <strong>This record changed after the draft was prepared.</strong> Compare the current values below, then rebase the draft to publish over them.
            {onRebase ? (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="mf-btn small" onClick={onRebase}>
                  Rebase on current values
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {e.errors.length ? (
          <ul className="mf-bullets mf-small" aria-label="Errors">
            {e.errors.map((x, i) => (
              <li key={`e${i}`}>
                <strong className="mf-negative">{x.code.replace(/_/g, " ").toLowerCase()}</strong> <span className="mf-mono mf-xsmall">{x.path}</span> — {x.message}
              </li>
            ))}
          </ul>
        ) : null}
        {e.warnings.map((w, i) => (
          <div key={`w${i}`} className="mf-callout attention mf-small">
            {w.message}
          </div>
        ))}
        {e.duplicates.length ? (
          <div className="mf-small">
            <strong>Possible duplicates</strong>
            <ul className="mf-bullets">
              {e.duplicates.map((d) => (
                <li key={`${d.id}-${d.reason}`}>
                  {d.exact ? "Blocks publishing: " : "Check: "}
                  {d.label} ({d.reason})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {e.diff.length ? (
          <div className="mf-table-wrap">
            <table className="mf-table compact">
              <caption className="mf-sr-only">Before and after</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Current</th>
                  <th scope="col">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {e.diff.map((d) => (
                  <tr key={d.field}>
                    <th scope="row">{d.field === "*" ? "New record" : d.field}</th>
                    <td className="wrap mf-xsmall mf-mono">{short(d.before)}</td>
                    <td className="wrap mf-xsmall mf-mono">{short(d.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {e.change ? (
          <p className="mf-hint">
            Publishing adds {e.change.claims.length} citation record{e.change.claims.length === 1 ? "" : "s"}
            {e.change.documents.length ? ` and ${e.change.documents.length} source document${e.change.documents.length === 1 ? "" : "s"}` : ""} to the published history. Nothing in the archive is overwritten; the change can be rolled back.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function DocumentsEditor({ docs, onChange }: { docs: DraftDoc[]; onChange: (d: DraftDoc[]) => void }) {
  const set = (i: number, patch: Partial<DraftDoc>) => onChange(docs.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <fieldset className="mf-stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="mf-eyebrow">Source documents (citations refer to them by reference)</legend>
      {docs.map((d, i) => (
        <div key={i} className="mf-panel">
          <div className="mf-panel-body mf-stack tight">
            <div className="mf-lab-row">
              <label className="mf-field">
                <span>Reference</span>
                <input className="mf-input" value={d.ref} onChange={(e) => set(i, { ref: e.target.value })} />
              </label>
              <label className="mf-field" style={{ flex: 3 }}>
                <span>URL (https)</span>
                <input className="mf-input" value={d.url} onChange={(e) => set(i, { url: e.target.value })} />
              </label>
            </div>
            <div className="mf-lab-row">
              <label className="mf-field">
                <span>Publisher</span>
                <input className="mf-input" value={d.publisher} onChange={(e) => set(i, { publisher: e.target.value })} />
              </label>
              <label className="mf-field" style={{ flex: 2 }}>
                <span>Title</span>
                <input className="mf-input" value={d.title} onChange={(e) => set(i, { title: e.target.value })} />
              </label>
            </div>
            <div className="mf-lab-row">
              <label className="mf-field">
                <span>Document type</span>
                <select className="mf-select" value={d.documentType} onChange={(e) => set(i, { documentType: e.target.value })}>
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mf-field">
                <span>Published (date)</span>
                <input className="mf-input" type="date" value={d.publishedDate?.date ?? ""} onChange={(e) => set(i, { publishedDate: e.target.value ? { date: e.target.value, precision: "day" } : null })} />
              </label>
              <label className="mf-field">
                <span>Retrieved by you (UTC)</span>
                <input className="mf-input" type="datetime-local" value={d.retrievedAt ? d.retrievedAt.slice(0, 16) : ""} onChange={(e) => set(i, { retrievedAt: e.target.value ? `${e.target.value}:00Z` : null })} />
              </label>
              <label className="mf-check" style={{ alignSelf: "end" }}>
                <input type="checkbox" checked={d.isPrimary} onChange={(e) => set(i, { isPrimary: e.target.checked })} /> Primary source
              </label>
            </div>
            <div>
              <button type="button" className="mf-btn small ghost" onClick={() => onChange(docs.filter((_, j) => j !== i))}>
                <Icon name="trash" size={14} /> Remove document
              </button>
            </div>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="mf-btn small" onClick={() => onChange([...docs, { ref: `d${docs.length + 1}`, url: "", publisher: "", title: "", documentType: "press_release", isPrimary: true, publishedDate: null, retrievedAt: null }])}>
          <Icon name="plus" size={14} /> Add document
        </button>
      </div>
    </fieldset>
  );
}

function Editor({ draftId }: { draftId: string | null }) {
  const { notify } = useToast();
  const route = useRoute();
  const existing = useQuery<{ draft: DraftView }>(draftId ? `/api/finance/admin/drafts/${draftId}` : null, { scope: "private" });
  const [kind, setKind] = useState<Kind>((route.query.get("kind") as Kind) || "claim_verification");
  const [entity, setEntity] = useState(route.query.get("entity") ?? "");
  const [payloadText, setPayloadText] = useState("");
  const [docs, setDocs] = useState<DraftDoc[]>([]);
  const [note, setNote] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const draft = existing.data?.draft ?? null;

  useEffect(() => {
    if (!draft) return;
    setKind(draft.kind as Kind);
    setEntity(draft.entityId);
    setPayloadText(JSON.stringify(draft.payload ?? {}, null, 2));
    setDocs(draft.evidence?.documents ?? []);
    setNote(draft.note ?? "");
    setEvaluation(draft.evaluation ?? null);
  }, [draft?.id, draft?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(payloadText || "{}") as Record<string, unknown> };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [payloadText]);

  const loadTemplate = async () => {
    setBusy("template");
    try {
      const t = await apiGet<{ payload: Record<string, unknown>; evidence: { documents: DraftDoc[] } }>(`/api/finance/admin/drafts/template?kind=${kind}&entityId=${encodeURIComponent(entity.trim())}`);
      setPayloadText(JSON.stringify(t.payload, null, 2));
      setDocs(t.evidence.documents);
      setEvaluation(null);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (!draftId && route.query.get("kind") && route.query.get("entity") && !payloadText) void loadTemplate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => ({ kind, payload: parsed.ok ? parsed.value : {}, evidence: { documents: docs }, note: note.trim() || null });
  const preview = async () => {
    if (!parsed.ok) return;
    setBusy("preview");
    try {
      const r = await apiSend<{ evaluation: EvaluationView }>("POST", "/api/finance/admin/drafts/preview", body());
      setEvaluation(r.evaluation);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const save = async (rebase = false) => {
    if (!parsed.ok) return;
    setBusy("save");
    try {
      if (draft) {
        const r = await apiSend<{ draft: DraftView }>("PATCH", `/api/finance/admin/drafts/${draft.id}`, { revision: draft.revision, payload: parsed.value, evidence: { documents: docs }, note: note.trim() || null, ...(rebase ? { rebase: true } : {}) });
        setEvaluation(r.draft.evaluation ?? null);
        notify(rebase ? "Draft rebased on the current values." : "Draft saved.", "success");
        await existing.refetch();
      } else {
        const r = await apiSend<{ draft: DraftView }>("POST", "/api/finance/admin/drafts", body(), { idempotencyKey: newIdempotencyKey() });
        notify("Draft saved. Nothing is published until you publish it.", "success");
        setQuery({ tab: "edit", draft: r.draft.id, kind: null, entity: null });
      }
      invalidate("/api/finance/admin/drafts");
    } catch (e) {
      notify(e instanceof ApiError && e.code === "STALE_DRAFT" ? "This draft changed in another tab. Reload it before saving." : errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    if (!draft) return;
    setBusy("publish");
    try {
      await apiSend("POST", `/api/finance/admin/drafts/${draft.id}/publish`, { revision: draft.revision }, { idempotencyKey: newIdempotencyKey() });
      notify("Published. The change is in the published history and can be rolled back.", "success");
      invalidate("/api/finance");
      setConfirm(false);
      await existing.refetch();
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { evaluation?: EvaluationView } | undefined) : undefined;
      if (details?.evaluation) setEvaluation(details.evaluation);
      notify(errorMessage(e), "error");
      setConfirm(false);
    } finally {
      setBusy(null);
    }
  };
  const discard = async () => {
    if (!draft) return;
    try {
      await apiSend("POST", `/api/finance/admin/drafts/${draft.id}/discard`, { revision: draft.revision });
      notify("Draft discarded.", "success");
      invalidate("/api/finance/admin/drafts");
      setQuery({ tab: "drafts", draft: null });
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  if (draftId && existing.error) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} what="this draft" />;
  if (draftId && !draft) return <Skeleton lines={8} />;
  const k = KINDS.find((x) => x.id === kind);
  const editable = !draft || draft.status === "draft";
  return (
    <div className="mf-stack">
      {draft ? (
        <p className="mf-hint">
          {KIND_LABEL[draft.kind] ?? draft.kind} · revision {draft.revision} · {draft.status} · updated {formatTimestamp(draft.updatedAt)} · origin {draft.origin}
          {draft.publishedChangeId ? ` · published as ${draft.publishedChangeId}` : ""}
        </p>
      ) : null}
      <div className="mf-lab-row">
        <label className="mf-field">
          <span>What are you changing?</span>
          <select className="mf-select" value={kind} disabled={Boolean(draft)} onChange={(e) => (setKind(e.target.value as Kind), setEvaluation(null))}>
            {KINDS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {k?.entity ? (
          <label className="mf-field">
            <span>{k.entity}</span>
            <input className="mf-input" value={entity} disabled={Boolean(draft)} onChange={(e) => setEntity(e.target.value)} />
          </label>
        ) : null}
        {!draft ? (
          <button type="button" className="mf-btn small" style={{ alignSelf: "end" }} disabled={busy === "template" || Boolean(k?.entity && !entity.trim())} onClick={() => void loadTemplate()}>
            Load template
          </button>
        ) : null}
      </div>
      <p className="mf-hint">{k?.help}</p>
      <DocumentsEditor docs={docs} onChange={(d) => (setDocs(d), setEvaluation(null))} />
      <div className="mf-field">
        <label htmlFor="rm-payload">Proposal (JSON)</label>
        <textarea id="rm-payload" className="mf-textarea mf-mono" style={{ minHeight: 260, fontSize: 13 }} value={payloadText} readOnly={!editable} onChange={(e) => (setPayloadText(e.target.value), setEvaluation(null))} spellCheck={false} />
        {!parsed.ok ? <p className="mf-negative mf-small">Not valid JSON: {parsed.error}</p> : null}
        <p className="mf-hint">Citations use {"{ doc: <reference>, locator, excerpt, status, method }"}. Owner entries default to “human reviewed”; “source checked” needs a document you retrieved (retrieval time), a locator and an excerpt.</p>
      </div>
      <div className="mf-field">
        <label htmlFor="rm-note">Note for the published history</label>
        <input id="rm-note" className="mf-input" value={note} readOnly={!editable} onChange={(e) => setNote(e.target.value)} />
      </div>
      {editable ? (
        <div className="mf-row">
          <button type="button" className="mf-btn small" disabled={!parsed.ok || busy !== null} onClick={() => void preview()}>
            Preview
          </button>
          <button type="button" className="mf-btn small" disabled={!parsed.ok || busy !== null} onClick={() => void save()}>
            {draft ? "Save changes" : "Save draft"}
          </button>
          {draft ? (
            <>
              <button type="button" className="mf-btn small primary" disabled={busy !== null || !evaluation?.ok || draft.conflict} onClick={() => setConfirm(true)}>
                Publish…
              </button>
              <button type="button" className="mf-btn small ghost" onClick={() => void discard()}>
                Discard draft
              </button>
            </>
          ) : (
            <span className="mf-hint">Save the draft to publish it.</span>
          )}
        </div>
      ) : null}
      {evaluation ? <EvaluationPanel e={evaluation} conflict={draft?.conflict} {...(draft?.conflict ? { onRebase: () => void save(true) } : {})} /> : null}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Publish this change?"
        footer={
          <>
            <button type="button" className="mf-btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="mf-btn primary" disabled={busy === "publish"} onClick={() => void publish()}>
              {busy === "publish" ? "Publishing…" : "Publish"}
            </button>
          </>
        }
      >
        <p>
          {KIND_LABEL[kind]} for <strong>{evaluation?.entity.label}</strong> becomes part of the public research with its citations. It is re-validated now; if the record changed since this draft was prepared, publishing stops and asks you to rebase.
        </p>
      </Dialog>
    </div>
  );
}

function DraftsList() {
  const [status, setStatus] = useState("draft");
  const q = useQuery<{ items: DraftView[] }>(`/api/finance/admin/drafts?status=${status}`, { scope: "private", staleMs: 5_000 });
  return (
    <div className="mf-stack">
      <div className="mf-row">
        <label className="mf-field">
          <span>Show</span>
          <select className="mf-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Open drafts</option>
            <option value="published">Published</option>
            <option value="discarded">Discarded</option>
            <option value="all">All</option>
          </select>
        </label>
        <button type="button" className="mf-btn small primary" style={{ alignSelf: "end" }} onClick={() => setQuery({ tab: "edit", draft: null })}>
          <Icon name="plus" size={14} /> New draft
        </button>
      </div>
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} what="drafts" /> : null}
      {q.data && !q.data.items.length ? <EmptyState title="No drafts">Proposals you save or import appear here. Nothing is published until you publish it.</EmptyState> : null}
      {q.data?.items.length ? (
        <div className="mf-table-wrap">
          <table className="mf-table compact">
            <caption className="mf-sr-only">Research drafts</caption>
            <thead>
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Record</th>
                <th scope="col">State</th>
                <th scope="col">Updated</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <tr key={d.id}>
                  <td>{KIND_LABEL[d.kind] ?? d.kind}</td>
                  <td className="wrap">{d.summary?.entityLabel ?? `${d.entityType}:${d.entityId}`}</td>
                  <td className="mf-small">
                    {d.status !== "draft" ? d.status : d.conflict ? <span className="mf-pill negative">Record changed — rebase</span> : d.summary?.ok ? <span className="mf-pill positive">Ready</span> : <span className="mf-pill attention">{d.summary?.errors ?? 0} to fix</span>}
                    {d.summary?.warnings ? <span className="mf-muted"> · {d.summary.warnings} warning{d.summary.warnings === 1 ? "" : "s"}</span> : null}
                  </td>
                  <td className="mf-small">{formatTimestamp(d.updatedAt)}</td>
                  <td>
                    <button type="button" className="mf-btn small" aria-label={`Open draft: ${KIND_LABEL[d.kind] ?? d.kind} for ${d.summary?.entityLabel ?? d.entityId}`} onClick={() => setQuery({ tab: "edit", draft: d.id })}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const IMPORT_EXAMPLE = {
  format: "finance-research-import-v1",
  items: [
    {
      kind: "observation",
      payload: {
        companyId: "tata-motors",
        observation: { metric: "revenue", value: null, nullReason: "Replace with the reported figure", unit: "currency", currency: "INR", scale: "crore", period: { type: "FY", end: "2026-03-31", months: 12, label: "FY2026" }, scope: "consolidated", basis: "reported", cites: [{ doc: "ar", locator: "Consolidated statement of profit and loss", excerpt: null, status: "human_reviewed", checkedAt: null, method: "owner_entry" }] },
      },
      evidence: { documents: [{ ref: "ar", url: "https://www.example.com/annual-report.pdf", publisher: "Company", title: "Annual report FY2026", documentType: "annual_report", isPrimary: true, publishedDate: { date: "2026-06-30", precision: "day" }, retrievedAt: null }] },
    },
  ],
};

function ImportTab() {
  const { notify } = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ items: Array<{ index: number; kind: string; action: string; entity: { label: string }; evaluation: EvaluationView }>; summary: { total: number; create: number; createWithErrors: number; skipped: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => {
    try {
      return text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      return undefined;
    }
  }, [text]);
  const run = async (commit: boolean) => {
    if (!parsed) return;
    setBusy(true);
    try {
      if (commit) {
        const r = await apiSend<{ created: unknown[]; skipped: unknown[] }>("POST", "/api/finance/admin/import", parsed, { idempotencyKey: newIdempotencyKey() });
        notify(`${r.created.length} draft${r.created.length === 1 ? "" : "s"} created; ${r.skipped.length} skipped. Review and publish them from Drafts.`, "success");
        invalidate("/api/finance/admin/drafts");
        setPreview(null);
      } else setPreview(await apiSend("POST", "/api/finance/admin/import/preview", parsed));
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mf-stack">
      <p className="mf-hint">
        Import a JSON file of proposals (format <span className="mf-mono">finance-research-import-v1</span>, up to 100 items). Preview checks each item, duplicates within the file, open drafts and published records. Importing creates drafts only; publishing stays a separate, per-draft step.
      </p>
      <div className="mf-row">
        <label className="mf-btn small">
          <Icon name="upload" size={14} /> Choose file
          <input
            type="file"
            accept="application/json,.json"
            className="mf-sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then((t) => (setText(t), setPreview(null)));
            }}
          />
        </label>
        <button type="button" className="mf-btn small ghost" onClick={() => (setText(JSON.stringify(IMPORT_EXAMPLE, null, 2)), setPreview(null))}>
          Insert example
        </button>
      </div>
      <div className="mf-field">
        <label htmlFor="rm-import">Import file contents</label>
        <textarea id="rm-import" className="mf-textarea mf-mono" style={{ minHeight: 200, fontSize: 13 }} value={text} onChange={(e) => (setText(e.target.value), setPreview(null))} spellCheck={false} />
        {parsed === undefined ? <p className="mf-negative mf-small">Not valid JSON.</p> : null}
      </div>
      <div className="mf-row">
        <button type="button" className="mf-btn small" disabled={!parsed || busy} onClick={() => void run(false)}>
          Preview import
        </button>
        <button type="button" className="mf-btn small primary" disabled={!preview || busy || preview.summary.create + preview.summary.createWithErrors === 0} onClick={() => void run(true)}>
          Create drafts
        </button>
      </div>
      {preview ? (
        <section className="mf-panel" aria-label="Import preview">
          <div className="mf-panel-head">
            <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
              {preview.summary.total} items: {preview.summary.create} ready, {preview.summary.createWithErrors} with issues to fix after import, {preview.summary.skipped} skipped
            </h2>
          </div>
          <div className="mf-panel-body flush">
            <div className="mf-table-wrap">
              <table className="mf-table compact">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Change</th>
                    <th scope="col">Record</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((it) => (
                    <tr key={it.index}>
                      <td>{it.index + 1}</td>
                      <td>{KIND_LABEL[it.kind] ?? it.kind}</td>
                      <td className="wrap">{it.entity.label}</td>
                      <td className="wrap mf-small">
                        {it.action.replace(/_/g, " ")}
                        {it.evaluation.errors.length ? <div className="mf-muted">{it.evaluation.errors.slice(0, 3).map((e) => e.message).join(" · ")}</div> : null}
                        {it.evaluation.warnings.length ? <div className="mf-muted">{it.evaluation.warnings.map((w) => w.message).join(" · ")}</div> : null}
                      </td>
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

interface HistoryItem {
  entity: string;
  changeId: string;
  changeType: string;
  fields: string[];
  note: string | null;
  publishedAt: string;
  revertedBy: string | null;
  reverts: string | null;
  canRevert: boolean;
  statusNotApplied?: boolean;
  warning?: { code: string; applied: "no" | "partly"; message: string };
}

interface OverlayWarningItem {
  changeId: string;
  changeType: string;
  entity: string;
  code: string;
  applied: "no" | "partly";
  message: string;
}

function entityLink(key: string): string | null {
  const [type, id] = key.split(":");
  if (type === "deal") return `/finance/deals/${id}`;
  if (type === "company") return `/finance/companies/${id}`;
  return null;
}

function HistoryTab() {
  const { notify } = useToast();
  const q = useQuery<{ items: HistoryItem[]; warnings?: OverlayWarningItem[] }>("/api/finance/admin/history", { scope: "private", staleMs: 5_000 });
  const [target, setTarget] = useState<HistoryItem | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const revert = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await apiSend("POST", `/api/finance/admin/changes/${target.changeId}/revert`, { note }, { idempotencyKey: newIdempotencyKey() });
      notify("Rolled back. The original change and the rollback both stay in the history.", "success");
      invalidate("/api/finance");
      setTarget(null);
      setNote("");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="the published history" />;
  if (!q.data) return <Skeleton lines={6} />;
  if (!q.data.items.length) return <EmptyState title="No published changes yet">Changes published from drafts or the review queue appear here, newest first.</EmptyState>;
  const warnings = q.data.warnings ?? [];
  return (
    <div className="mf-stack">
      {warnings.length ? (
        <section className="mf-callout attention" aria-labelledby="rm-overlay-warnings">
          <strong id="rm-overlay-warnings">
            {warnings.length} published change{warnings.length === 1 ? "" : "s"} could not be fully applied to this archive version
          </strong>
          <p className="mf-small">A change is never applied to a different record. Review each one, then publish a corrected draft or roll it back.</p>
          <ul className="mf-list mf-small">
            {warnings.map((w) => {
              const link = entityLink(w.entity);
              return (
                <li key={w.changeId}>
                  <span className="mf-pill attention">{w.applied === "no" ? "Not applied" : "Partly applied"}</span> {w.changeType.replace(/_/g, " ")} on {link ? <Link to={link}>{w.entity}</Link> : w.entity}: {w.message}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <p className="mf-hint">Newest first. A rollback is itself a published change; roll back a record's changes newest first.</p>
      <div className="mf-table-wrap">
        <table className="mf-table compact">
          <caption className="mf-sr-only">Published change history</caption>
          <thead>
            <tr>
              <th scope="col">Published</th>
              <th scope="col">Record</th>
              <th scope="col">Change</th>
              <th scope="col">Note</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((h) => {
              const link = entityLink(h.entity);
              return (
                <tr key={h.changeId}>
                  <td className="mf-small">{formatTimestamp(h.publishedAt)}</td>
                  <td className="mf-small">{link ? <Link to={link}>{h.entity}</Link> : h.entity}</td>
                  <td className="mf-small">
                    {h.changeType.replace(/_/g, " ")}
                    {h.fields.length && !h.fields.includes("*") ? <span className="mf-muted"> · {h.fields.join(", ")}</span> : null}
                    {h.statusNotApplied ? <div className="mf-muted">Older than the current status: added to the timeline only.</div> : null}
                  </td>
                  <td className="wrap mf-small">{h.note ?? "—"}</td>
                  <td className="mf-small">
                    {h.reverts ? `Rollback of ${h.reverts}` : h.revertedBy ? <span className="mf-pill attention">Rolled back</span> : h.warning ? <span className="mf-pill attention">{h.warning.applied === "no" ? "Not applied" : "Partly applied"}</span> : "In effect"}
                    {h.canRevert ? (
                      <div>
                        <button type="button" className="mf-btn small" aria-label={`Roll back ${h.changeType.replace(/_/g, " ")} on ${h.entity}`} onClick={() => setTarget(h)}>
                          Roll back…
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Dialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Roll back this change?"
        footer={
          <>
            <button type="button" className="mf-btn" onClick={() => setTarget(null)}>
              Cancel
            </button>
            <button type="button" className="mf-btn primary" disabled={busy || note.trim().length < 5} onClick={() => void revert()}>
              Roll back
            </button>
          </>
        }
      >
        <div className="mf-stack tight">
          <p>
            {target?.changeType.replace(/_/g, " ")} on {target?.entity} stops applying. Both the change and this rollback stay in the public history.
          </p>
          <div className="mf-field">
            <label htmlFor="rm-revert-note">Why? (shown in the history)</label>
            <input id="rm-revert-note" className="mf-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export default function ResearchMaintenancePage() {
  const route = useRoute();
  const { isOwner, status } = useSession();
  const tab = TABS.some((t) => t.id === route.query.get("tab")) ? (route.query.get("tab") as string) : "drafts";
  const draftId = route.query.get("draft");
  if (status && !isOwner) {
    return (
      <div className="mf-stack">
        <PageHead title="Research maintenance" crumbs={[{ to: "/finance/sources", label: "Sources" }]} />
        <EmptyState title="Owner only" icon="lock" action={<a className="mf-btn" href={signInHref()}>Sign in as owner</a>}>
          Research maintenance changes the published research, so only the site owner can use it.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="mf-stack">
      <PageHead
        title="Research maintenance"
        crumbs={[{ to: "/finance/sources", label: "Sources" }]}
        sub="Drafts are private until published. Every change needs evidence, is checked for duplicates and conflicts, and can be rolled back."
      />
      <Tabs tabs={TABS} active={tab} onChange={(t) => setQuery({ tab: t === "drafts" ? null : t, ...(t !== "edit" ? { draft: null } : {}) })} label="Research maintenance sections" />
      <TabPanel tabsLabel="Research maintenance sections" active={tab}>
        {tab === "drafts" ? <DraftsList /> : null}
        {tab === "edit" ? <Editor key={draftId ?? "new"} draftId={draftId} /> : null}
        {tab === "import" ? <ImportTab /> : null}
        {tab === "history" ? <HistoryTab /> : null}
      </TabPanel>
    </div>
  );
}
