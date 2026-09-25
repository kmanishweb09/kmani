import { type KeyboardEvent, type ReactNode, useRef } from "react";
import type { DealStatusValue } from "../../shared/labels";
import { DEAL_STATUS_LABEL } from "../../shared/labels";
import { ApiError } from "../app/api";
import { signInHref } from "../app/session";
import { Icon, type IconName } from "./Icon";

export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="mf-stack tight" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="mf-skel" style={{ height: height ?? 14, width: `${100 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="mf-table-wrap" aria-busy="true" aria-label="Loading table">
      <table className="mf-table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <span className="mf-skel" style={{ width: `${50 + ((r * 7 + c * 13) % 45)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, children, action, icon = "info", center }: { title: string; children?: ReactNode; action?: ReactNode; icon?: IconName; center?: boolean }) {
  return (
    <div className={`mf-empty${center ? " center" : ""}`}>
      <Icon name={icon} size={22} />
      <h3>{title}</h3>
      {children ? <div>{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, what = "this data" }: { error: unknown; onRetry?: () => void; what?: string }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 401) {
    return (
      <EmptyState title="Sign in required" icon="lock" action={<a className="mf-btn primary" href={signInHref()}>Sign in</a>}>
        {e.message}
      </EmptyState>
    );
  }
  if (e?.status === 403 || e?.code === "OWNER_NOT_CONFIGURED") {
    return (
      <EmptyState title={e.code === "OWNER_NOT_CONFIGURED" ? "Private features are not set up" : "Owner only"} icon="lock">
        {e.message}
      </EmptyState>
    );
  }
  if (e?.status === 404) {
    return <EmptyState title="Not found" icon="search">{e.message}</EmptyState>;
  }
  return (
    <EmptyState
      title={`Could not load ${what}`}
      icon="alert"
      action={
        onRetry ? (
          <button type="button" className="mf-btn" onClick={onRetry}>
            <Icon name="refresh" size={16} /> Try again
          </button>
        ) : undefined
      }
    >
      {e?.message ?? "Unexpected error."}
      {e?.requestId ? <span className="mf-xsmall"> (request {e.requestId})</span> : null}
    </EmptyState>
  );
}

const STATUS_CLASS: Record<DealStatusValue, string> = {
  rumoured: "muted",
  proposed: "attention",
  announced: "accent",
  pending_approvals: "attention",
  approved: "accent",
  completed: "positive",
  withdrawn: "negative",
  terminated: "negative",
};

const STATUS_ICON: Record<DealStatusValue, IconName> = {
  rumoured: "question",
  proposed: "clock",
  announced: "info",
  pending_approvals: "clock",
  approved: "check",
  completed: "check",
  withdrawn: "close",
  terminated: "close",
};

export function StatusPill({ status }: { status: DealStatusValue }) {
  return (
    <span className={`mf-pill ${STATUS_CLASS[status]}`}>
      <Icon name={STATUS_ICON[status]} size={13} />
      {DEAL_STATUS_LABEL[status]}
    </span>
  );
}

export type ProvenanceKind = "reported" | "calculated" | "assumed" | "training" | "analysis" | "fact" | "management";

const PROV_LABEL: Record<ProvenanceKind, string> = {
  reported: "Reported",
  calculated: "Calculated",
  assumed: "Assumed",
  training: "Training example",
  analysis: "Analysis",
  fact: "Fact",
  management: "Management claim",
};

export function ProvTag({ kind, title }: { kind: ProvenanceKind; title?: string }) {
  const cls = kind === "fact" ? "reported" : kind === "management" ? "assumed" : kind;
  return (
    <span className={`mf-tag ${cls}`} title={title}>
      {PROV_LABEL[kind]}
    </span>
  );
}

export interface TabDef {
  id: string;
  label: ReactNode;
}

/** Accessible tabs with roving focus (arrow keys, Home/End). */
/** Tab and panel ids are derived from the tablist label so a sibling <TabPanel> can reference them. */
function tabBase(label: string): string {
  return `mf-tabs-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function Tabs({ tabs, active, onChange, label }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; label: string }) {
  const id = tabBase(label);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const t = tabs[next];
      if (t) {
        onChange(t.id);
        refs.current[next]?.focus();
      }
    }
  };
  return (
    <div className="mf-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${id}-tab-${t.id}`}
          aria-selected={active === t.id}
          aria-controls={`${id}-panel`}
          tabIndex={active === t.id ? 0 : -1}
          className="mf-tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ children, tabsLabel, active }: { children: ReactNode; tabsLabel: string; active: string }) {
  const base = tabBase(tabsLabel);
  return (
    <div role="tabpanel" id={`${base}-panel`} className="mf-tabpanel" tabIndex={-1} aria-labelledby={`${base}-tab-${active}`}>
      {children}
    </div>
  );
}

export type SaveStateKind = "idle" | "dirty" | "saving" | "saved" | "failed" | "local" | "conflict";

export function SaveState({ state, detail }: { state: SaveStateKind; detail?: string }) {
  const text: Record<SaveStateKind, string> = {
    idle: "",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    failed: "Failed to save",
    local: "Saved on this device only",
    conflict: "Edited elsewhere — review conflict",
  };
  if (state === "idle") return null;
  return (
    <span className="mf-savestate" data-state={state} role="status" aria-live="polite">
      <Icon name={state === "saved" ? "check" : state === "failed" || state === "conflict" ? "alert" : state === "saving" ? "refresh" : "clock"} size={14} />
      {text[state]}
      {detail ? <span className="mf-muted"> · {detail}</span> : null}
    </span>
  );
}

export function Monogram({ name, large }: { name: string; large?: boolean }) {
  const letters = name
    .replace(/\b(limited|ltd|inc|corp|corporation|company|co|plc|ag|sa|holdings?|group|the)\b\.?/gi, "")
    .split(/[\s&/.-]+/)
    .filter(Boolean);
  const m = (letters.length >= 2 ? `${letters[0]?.[0] ?? ""}${letters[1]?.[0] ?? ""}` : (letters[0] ?? name).slice(0, 2)).toUpperCase();
  return (
    <span className={`mf-monogram${large ? " large" : ""}`} aria-hidden="true">
      {m}
    </span>
  );
}

export function SignInPrompt({ what }: { what: string }) {
  return (
    <EmptyState title="Owner sign-in needed" icon="lock" action={<a className="mf-btn" href={signInHref()}>Sign in</a>}>
      {what} is private to the site owner. Published research stays available without signing in.
    </EmptyState>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="mf-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
