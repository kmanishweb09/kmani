import { useCallback, useMemo, useState } from "react";
import type { Note } from "../../../shared/schemas/private";
import { NOTE_TEMPLATE_LABEL } from "../../../shared/labels";
import { apiGet, apiSend, errorMessage } from "../../app/api";
import { invalidate, useQuery } from "../../app/query";
import { Link, navigate } from "../../app/router";
import { useSession } from "../../app/session";
import { useToast } from "../../app/toast";
import { Ev } from "../../components/Evidence";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { useConfirm } from "../../components/Overlay";
import { PageHead } from "../../components/PageHead";
import { ErrorState, SaveState, Segmented, Skeleton } from "../../components/ui";
import { useAutosave } from "../../lib/autosave";

interface Editable {
  title: string;
  body: string;
  tags: string[];
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/finance/deals/${id}`,
  company: (id) => `/finance/companies/${id}`,
  sector: (id) => `/finance/sectors/${id}`,
  brief: (id) => `/finance/briefs/${id}`,
  module: (id) => `/finance/notebook?tab=learn&module=${id}`,
  glossary: (id) => `/finance/notebook?tab=learn&term=${id}`,
  note: (id) => `/finance/notebook/${id}`,
};

export function NoteEditor({ id }: { id: string }) {
  const [epoch, setEpoch] = useState(0);
  return <NoteEditorInner key={`${id}:${epoch}`} id={id} onReload={() => setEpoch((e) => e + 1)} />;
}

function NoteEditorInner({ id, onReload }: { id: string; onReload: () => void }) {
  const { status } = useSession();
  const { notify } = useToast();
  const { confirm, element: confirmElement } = useConfirm();
  const q = useQuery<{ note: Note }>(`/api/finance/notes/${encodeURIComponent(id)}`, { scope: "private", staleMs: 0 });
  const note = q.data?.note;
  const [mode, setMode] = useState<"write" | "split" | "preview">("split");
  const [tagText, setTagText] = useState<string | null>(null);

  const serverValue = useMemo<Editable | undefined>(() => (note ? { title: note.title, body: note.body, tags: note.tags } : undefined), [note]);
  const equals = useCallback((a: Editable, b: Editable) => a.title === b.title && a.body === b.body && a.tags.join("\u0000") === b.tags.join("\u0000"), []);
  const save = useCallback(
    async (v: Editable, revision: number | null) => {
      const r = await apiSend<{ note: Note }>("PATCH", `/api/finance/notes/${encodeURIComponent(id)}`, { title: v.title.trim() || "Untitled note", body: v.body, tags: v.tags, revision });
      invalidate("/api/finance/notes");
      return { revision: r.note.revision, value: { title: r.note.title, body: r.note.body, tags: r.note.tags } };
    },
    [id],
  );
  const auto = useAutosave<Editable>({
    draftKey: status?.viewer.key ? `draft.note.${status.viewer.key}.${id}` : null,
    serverValue,
    serverRevision: note?.revision ?? null,
    empty: { title: "", body: "", tags: [] },
    enabled: true,
    equals,
    save,
  });

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="this note" />;
  if (!note) return <Skeleton lines={10} />;

  const v = auto.value;
  const archiveToggle = async () => {
    try {
      const fresh = await apiGet<{ note: Note }>(`/api/finance/notes/${encodeURIComponent(id)}`);
      await apiSend("PATCH", `/api/finance/notes/${encodeURIComponent(id)}`, { archived: !fresh.note.archivedAt, revision: fresh.note.revision });
      invalidate("/api/finance/notes");
      notify(fresh.note.archivedAt ? "Note restored." : "Note archived.", "success");
      onReload();
    } catch (e) {
      notify(`Could not update the note: ${errorMessage(e)}`, "error");
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: "Delete this note?", message: `“${note.title}” will be permanently deleted from your account. Consider archiving instead.`, confirmLabel: "Delete note", danger: true });
    if (!ok) return;
    try {
      await apiSend("DELETE", `/api/finance/notes/${encodeURIComponent(id)}?confirm=true`);
      invalidate("/api/finance/notes");
      invalidate("/api/finance/desk");
      notify("Note deleted.", "success");
      navigate("/finance/notebook?tab=notes");
    } catch (e) {
      notify(`Delete failed: ${errorMessage(e)}`, "error");
    }
  };

  return (
    <div className="mf-page mf-note-editor">
      {confirmElement}
      <PageHead
        title={v.title || "Untitled note"}
        docTitle={`${v.title || "Note"} — Notebook`}
        crumbs={[{ to: "/finance/notebook?tab=notes", label: "Notebook" }]}
        eyebrow={NOTE_TEMPLATE_LABEL[note.template] ?? note.template}
        actions={
          <div className="mf-row mf-no-print">
            <SaveState state={auto.state} detail={auto.state === "local" ? "Saved on this device only — will retry" : undefined} />
            <a className="mf-btn small" href={`/api/finance/notes/${encodeURIComponent(id)}/export.md`}>
              <Icon name="download" size={15} /> Markdown
            </a>
            <button type="button" className="mf-btn small" onClick={() => window.print()}>
              <Icon name="print" size={15} /> Print
            </button>
            <button type="button" className="mf-btn small" disabled={auto.state === "dirty" || auto.state === "saving" || auto.state === "conflict"} title="Available once your edits are saved" onClick={() => void archiveToggle()}>
              <Icon name="archive" size={15} /> {note.archivedAt ? "Restore" : "Archive"}
            </button>
            <button type="button" className="mf-btn small danger" onClick={() => void remove()}>
              <Icon name="trash" size={15} /> Delete
            </button>
          </div>
        }
      />
      {auto.conflict ? (
        <div className="mf-callout attention mf-no-print" role="alert">
          <strong>This note changed in another tab or device.</strong>
          <p className="mf-small">Choose which version to keep. Your version is kept on this device until you decide.</p>
          <div className="mf-row">
            <button type="button" className="mf-btn small primary" onClick={() => auto.resolveConflict("mine")}>
              Keep my version
            </button>
            <button type="button" className="mf-btn small" onClick={() => auto.resolveConflict("theirs")}>
              Use the saved version
            </button>
          </div>
        </div>
      ) : null}
      {auto.state === "failed" ? (
        <div className="mf-callout negative mf-no-print" role="alert">
          <strong>Failed to save.</strong>
          <button type="button" className="mf-btn small" onClick={auto.retry}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="mf-note-meta mf-no-print">
        <label className="mf-field">
          <span>Title</span>
          <input className="mf-input" value={v.title} maxLength={200} onChange={(e) => auto.setValue((p) => ({ ...p, title: e.target.value }))} />
        </label>
        <label className="mf-field">
          <span>Tags (comma separated)</span>
          <input
            className="mf-input"
            value={tagText ?? v.tags.join(", ")}
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() => {
              if (tagText === null) return;
              const tags = [...new Set(tagText.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 40));
              auto.setValue((p) => ({ ...p, tags }));
              setTagText(null);
            }}
          />
        </label>
      </div>
      {note.links.length || note.evidenceIds.length ? (
        <div className="mf-row mf-wrap mf-small">
          {note.links.map((l) => (
            <Link key={`${l.type}:${l.id}`} className="mf-chip" to={(ENTITY_HREF[l.type] ?? ((x: string) => x))(l.id)}>
              {l.type}: {l.id}
            </Link>
          ))}
          {note.evidenceIds.length ? (
            <span className="mf-row">
              Evidence <Ev ids={note.evidenceIds} label={`sources cited in ${note.title}`} />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mf-row spread mf-no-print">
        <Segmented label="Editor view" value={mode} onChange={setMode} options={[{ value: "write", label: "Write" }, { value: "split", label: "Split" }, { value: "preview", label: "Preview" }]} />
        <span className="mf-xsmall mf-muted">Markdown: ## headings, **bold**, - lists, [links](https://…). Saved to your account as you type.</span>
      </div>
      <div className={`mf-note-body ${mode}`}>
        {mode !== "preview" ? (
          <label className="mf-note-write mf-no-print">
            <span className="mf-sr-only">Note body (Markdown)</span>
            <textarea className="mf-input mf-textarea" value={v.body} onChange={(e) => auto.setValue((p) => ({ ...p, body: e.target.value }))} spellCheck />
          </label>
        ) : null}
        {mode !== "write" ? (
          <article className="mf-prose mf-note-preview" aria-label="Preview">
            <h1 className="mf-print-only">{v.title}</h1>
            <Markdown source={v.body || "_Nothing written yet._"} />
          </article>
        ) : (
          <article className="mf-prose mf-print-only">
            <h1>{v.title}</h1>
            <Markdown source={v.body} />
          </article>
        )}
      </div>
      <p className="mf-xsmall mf-muted">
        Created {note.createdAt.slice(0, 16).replace("T", " ")} UTC · revision {note.revision}
        {note.archivedAt ? ` · archived ${note.archivedAt.slice(0, 10)}` : ""}
      </p>
    </div>
  );
}
