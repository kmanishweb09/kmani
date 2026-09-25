import type { RecordHistoryEntry } from "../../shared/api";
import { formatTimestamp } from "../lib/format";

const LABEL: Record<string, string> = {
  event_append: "Event added",
  term_revision: "Term revised",
  deal_create: "Record created",
  new_deal: "Record created",
  company_create: "Record created",
  deal_edit: "Record edited",
  company_edit: "Record edited",
  company_correction: "Correction",
  company_observation: "Observation added",
  claim_status: "Verification updated",
  revert: "Rollback",
};

/** Public change history of a record after the archive build: every change and rollback stays listed. */
export function RecordHistory({ entries, title = "Record history" }: { entries: RecordHistoryEntry[]; title?: string }) {
  if (!entries.length) return null;
  return (
    <section className="mf-panel">
      <div className="mf-panel-head">
        <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
          {title}
        </h2>
      </div>
      <div className="mf-panel-body">
        <ol className="mf-list mf-small" aria-label={title}>
          {[...entries].reverse().map((h) => (
            <li key={h.changeId}>
              <strong>{LABEL[h.changeType] ?? h.changeType.replace(/_/g, " ")}</strong>
              {h.fields.length && !h.fields.includes("*") && h.changeType !== "revert" ? <span className="mf-muted"> · {h.fields.join(", ")}</span> : null}
              <span className="mf-muted"> · {formatTimestamp(h.publishedAt)}</span>
              {h.revertedBy ? <span className="mf-pill attention" style={{ marginLeft: 6 }}>Rolled back</span> : null}
              {h.statusNotApplied ? <div className="mf-hint">Older than the current status, so it was added to the timeline without changing the status.</div> : null}
              {h.note ? <div className="mf-hint">{h.note}</div> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
