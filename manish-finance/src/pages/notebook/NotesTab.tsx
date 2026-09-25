import { useEffect, useRef, useState } from "react";
import type { Note } from "../../../shared/schemas/private";
import { NOTE_TEMPLATE_LABEL } from "../../../shared/labels";
import { apiSend, errorMessage, newIdempotencyKey } from "../../app/api";
import { invalidate, useQuery } from "../../app/query";
import { Link, navigate, setQuery, useRoute } from "../../app/router";
import { useToast } from "../../app/toast";
import { Icon } from "../../components/Icon";
import { EmptyState, ErrorState, Segmented, Skeleton } from "../../components/ui";
import { localDate } from "../../../shared/dates";
import { isTemplate, type NoteTemplateId, TEMPLATE_BODIES, TEMPLATE_OPTIONS, templateTitle } from "../../lib/noteTemplates";

type NoteListItem = Omit<Note, "body"> & { excerpt: string };

export async function createNote(template: NoteTemplateId, opts: { title?: string; body?: string; links?: Note["links"]; tags?: string[] } = {}): Promise<Note> {
  const today = localDate(new Date(), "Asia/Kolkata");
  const res = await apiSend<{ note: Note }>(
    "POST",
    "/api/finance/notes",
    { title: opts.title ?? templateTitle(template, today), body: opts.body ?? TEMPLATE_BODIES[template], template, tags: opts.tags ?? [], links: opts.links ?? [] },
    { idempotencyKey: newIdempotencyKey() },
  );
  invalidate("/api/finance/notes");
  invalidate("/api/finance/desk");
  return res.note;
}

export function NotesTab() {
  const route = useRoute();
  const { notify } = useToast();
  const q = route.query.get("q") ?? "";
  const tag = route.query.get("tag");
  const template = route.query.get("template");
  const archived = route.query.get("archived") === "1";
  const [search, setSearch] = useState(q);
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tag) params.set("tag", tag);
  if (template) params.set("template", template);
  if (archived) params.set("archived", "1");
  const list = useQuery<{ items: NoteListItem[]; total: number }>(`/api/finance/notes?${params.toString()}`, { scope: "private", staleMs: 10_000 });
  const creating = useRef(false);

  // `?new=<template>` creates a note from a template (used by Desk, command palette and sector pages).
  const newParam = route.query.get("new");
  useEffect(() => {
    if (!isTemplate(newParam) || creating.current) return;
    creating.current = true;
    createNote(newParam)
      .then((n) => navigate(`/finance/notebook/${n.id}`, { replace: true }))
      .catch((e: unknown) => {
        notify(`Could not create the note: ${errorMessage(e)}`, "error");
        setQuery({ new: null });
      })
      .finally(() => {
        creating.current = false;
      });
  }, [newParam, notify]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (search !== q) setQuery({ q: search || null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q]);

  const tags = [...new Set((list.data?.items ?? []).flatMap((n) => n.tags))].sort();

  return (
    <div className="mf-stack">
      <div className="mf-toolbar">
        <label className="mf-search-field">
          <Icon name="search" size={16} />
          <span className="mf-sr-only">Search notes</span>
          <input className="mf-input" type="search" placeholder="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className="mf-select" aria-label="Filter by template" value={template ?? ""} onChange={(e) => setQuery({ template: e.target.value || null })}>
          <option value="">All templates</option>
          {Object.entries(NOTE_TEMPLATE_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select className="mf-select" aria-label="Filter by tag" value={tag ?? ""} onChange={(e) => setQuery({ tag: e.target.value || null })}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <Segmented label="Archive state" value={archived ? "archived" : "active"} onChange={(v) => setQuery({ archived: v === "archived" ? "1" : null })} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        <div className="mf-spacer" />
        <label className="mf-sr-only" htmlFor="new-note-template">
          New note template
        </label>
        <select
          id="new-note-template"
          className="mf-select"
          value=""
          onChange={(e) => {
            if (isTemplate(e.target.value)) setQuery({ new: e.target.value });
          }}
        >
          <option value="">New note…</option>
          {TEMPLATE_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <a className="mf-btn small" href="/api/finance/export/notes.md">
          <Icon name="download" size={15} /> Export all (Markdown)
        </a>
      </div>
      {newParam ? <p className="mf-muted">Creating note…</p> : null}
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} what="your notes" />
      ) : !list.data ? (
        <Skeleton lines={6} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={q || tag || template || archived ? "No notes match" : "No notes yet"} icon="notebook" action={<button type="button" className="mf-btn primary small" onClick={() => setQuery({ new: "deal_note" })}>Start a deal note</button>}>
          Notes are private to your account. Start from a template — deal note, sector thesis, company note or weekly reflection — or draft one from a deal page.
        </EmptyState>
      ) : (
        <ul className="mf-note-list">
          {list.data.items.map((n) => (
            <li key={n.id}>
              <Link to={`/finance/notebook/${n.id}`} className="mf-note-card">
                <div className="mf-row spread">
                  <strong>{n.title}</strong>
                  <span className="mf-xsmall mf-muted">Updated {n.updatedAt.slice(0, 10)}</span>
                </div>
                <div className="mf-xsmall mf-muted">
                  {NOTE_TEMPLATE_LABEL[n.template] ?? n.template}
                  {n.links.length ? ` · ${n.links.length} linked` : ""}
                  {n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(" ")}` : ""}
                </div>
                {n.excerpt ? <p className="mf-small mf-muted">{n.excerpt}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
