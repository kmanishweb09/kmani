import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";

/** Filter popover with checkboxes. Escape and outside click close it; focus returns to the trigger. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  align,
}: {
  label: string;
  options: Array<{ value: string; label: string; count?: number }>;
  value: string[];
  onChange: (v: string[]) => void;
  align?: "right";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="mf-popover-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="mf-btn small mf-filter-btn"
        data-active={value.length > 0}
        aria-expanded={open}
        aria-controls={`${id}-pop`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {value.length ? <span className="mf-filter-count" aria-label={`${value.length} selected`}>{value.length}</span> : null}
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div id={`${id}-pop`} className={`mf-popover${align === "right" ? " right" : ""}`} role="group" aria-label={`${label} filter`}>
          {options.map((o) => (
            <label key={o.value} className="mf-option">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.count !== undefined ? <span className="mf-muted mf-xsmall mf-num">{o.count}</span> : null}
            </label>
          ))}
          {value.length ? (
            <div className="mf-row" style={{ padding: "6px 8px 2px" }}>
              <button type="button" className="mf-link-btn mf-small" onClick={() => onChange([])}>
                Clear {label.toLowerCase()}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
