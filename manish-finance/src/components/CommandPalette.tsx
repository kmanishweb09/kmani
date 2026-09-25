import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchHit } from "../../shared/api";
import { apiGet } from "../app/api";
import { usePrefs } from "../app/prefs";
import { navigate } from "../app/router";
import { useSession } from "../app/session";
import { Icon, type IconName } from "./Icon";
import { PaletteShell } from "./Overlay";

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  run: () => void;
}

const TYPE_ICON: Record<SearchHit["type"], IconName> = {
  deal: "deals",
  company: "companies",
  sector: "sectors",
  glossary: "notebook",
  module: "notebook",
  metric: "lab",
  note: "edit",
  brief: "briefs",
};

const TYPE_GROUP: Record<SearchHit["type"], string> = {
  deal: "Deals",
  company: "Companies",
  sector: "Sectors",
  glossary: "Concepts",
  module: "Learning",
  metric: "Metrics",
  note: "My notes",
  brief: "Briefs",
};

/** Ctrl/Cmd+K palette: deals, companies, sectors, concepts, notes (owner) and actions. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [noteHits, setNoteHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const { isOwner } = useSession();
  const { prefs, update } = usePrefs();
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      setNoteHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setNoteHits([]);
      return undefined;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      setLoading(true);
      apiGet<{ items: SearchHit[] }>(`/api/finance/search?q=${encodeURIComponent(term)}&limit=12`, ctl.signal)
        .then((r) => setHits(r.items))
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
      if (isOwner) {
        apiGet<{ items: Array<{ id: string; title: string; updatedAt: string }> }>(`/api/finance/notes?q=${encodeURIComponent(term)}&limit=5`, ctl.signal)
          .then((r) => setNoteHits(r.items.map((n) => ({ type: "note", id: n.id, title: n.title, subtitle: `Note · updated ${n.updatedAt.slice(0, 10)}`, href: `/finance/notebook/${n.id}`, score: 0 }))))
          .catch(() => setNoteHits([]));
      }
    }, 160);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [q, open, isOwner]);

  const go = (href: string) => {
    onClose();
    navigate(href);
  };

  const actions: Item[] = useMemo(() => {
    const a: Item[] = [
      { id: "a-deals", group: "Actions", title: "Open Deal Terminal", icon: "deals", run: () => go("/finance/deals") },
      { id: "a-fig", group: "Actions", title: "FIG sector playbook", icon: "sectors", run: () => go("/finance/sectors/fig") },
      { id: "a-dcf", group: "Actions", title: "Open DCF lab (training case)", icon: "lab", run: () => go("/finance/lab?tab=dcf") },
      { id: "a-accretion", group: "Actions", title: "Open accretion/dilution lab", icon: "lab", run: () => go("/finance/lab?tab=accretion") },
      { id: "a-brief", group: "Actions", title: "Read the latest brief", icon: "briefs", run: () => go("/finance/briefs") },
      { id: "a-learn", group: "Actions", title: "Learning library", icon: "notebook", run: () => go("/finance/notebook?tab=learn") },
      { id: "a-sources", group: "Actions", title: "Source health and coverage", icon: "sources", run: () => go("/finance/sources") },
      { id: "a-theme", group: "Actions", title: prefs.theme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: prefs.theme === "dark" ? "sun" : "moon", run: () => { update({ theme: prefs.theme === "dark" ? "light" : "dark" }); onClose(); } },
    ];
    if (isOwner) {
      a.splice(1, 0, { id: "a-note", group: "Actions", title: "New research note", icon: "plus", run: () => go("/finance/notebook?tab=notes&new=blank") });
      a.splice(2, 0, { id: "a-review", group: "Actions", title: "Start 5-minute review", icon: "clock", run: () => go("/finance/notebook?tab=review") });
    }
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, prefs.theme]);

  const items: Item[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const found: Item[] = [...noteHits, ...hits].map((h) => ({
      id: `${h.type}-${h.id}`,
      group: TYPE_GROUP[h.type],
      title: h.title,
      subtitle: h.subtitle,
      icon: TYPE_ICON[h.type],
      run: () => go(h.href),
    }));
    const acts = term ? actions.filter((a) => a.title.toLowerCase().includes(term)) : actions;
    return [...found, ...acts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, noteHits, actions, q]);

  useEffect(() => setActive(0), [items.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  };

  let lastGroup = "";
  return (
    <PaletteShell open={open} onClose={onClose} label="Command palette">
      <input
        data-autofocus
        className="mf-input mf-cmd-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={items[active] ? `${id}-${items[active]?.id}` : undefined}
        aria-autocomplete="list"
        aria-label="Search or run a command"
        placeholder="Search deals, companies, sectors, concepts, notes…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
      />
      <ul id={`${id}-list`} ref={listRef} className="mf-cmd-list" role="listbox" aria-label="Results">
        {items.length === 0 ? (
          <li className="mf-empty" role="option" aria-selected="false" aria-disabled="true">
            {loading ? "Searching…" : q.trim().length < 2 ? "Type at least two characters." : "No matches in the covered research. Try a legal name, ticker or alias."}
          </li>
        ) : null}
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <li key={it.id} role="presentation">
              {header ? (
                <div className="mf-cmd-group" aria-hidden="true">
                  {header}
                </div>
              ) : null}
              <div
                id={`${id}-${it.id}`}
                data-index={i}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className="mf-cmd-item"
                onMouseEnter={() => setActive(i)}
                onClick={() => it.run()}
              >
                <Icon name={it.icon} />
                <div style={{ minWidth: 0 }}>
                  <div className="mf-cmd-item-title">{it.title}</div>
                  {it.subtitle ? <div className="mf-cmd-item-sub">{it.subtitle}</div> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mf-panel-foot">
        <span>
          <span className="mf-kbd">↑</span> <span className="mf-kbd">↓</span> move · <span className="mf-kbd">Enter</span> open · <span className="mf-kbd">Esc</span> close
        </span>
      </div>
    </PaletteShell>
  );
}
