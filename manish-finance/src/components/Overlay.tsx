import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/**
 * Accessible overlays: focus moves into the panel, Tab is trapped, Escape closes, and focus returns
 * to the element that opened it. On narrow screens the drawer becomes a full-screen sheet.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Stack of open overlays so Escape closes only the top one.
const stack: string[] = [];

function useOverlayBehaviour(open: boolean, onClose: () => void, panel: React.RefObject<HTMLElement | null>, id: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    stack.push(id);
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
        if (!items.length) {
          e.preventDefault();
          el.focus();
          return;
        }
        const firstEl = items[0] as HTMLElement;
        const lastEl = items[items.length - 1] as HTMLElement;
        if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === el)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) document.body.style.overflow = prevOverflow;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, id, panel]);
}

export function Drawer({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlayBehaviour(open, onClose, ref, id);
  if (!open) return null;
  return createPortal(
    <div className="finance-root" style={{ minHeight: 0 }}>
      <div className="mf-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={`mf-drawer${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <div className="mf-drawer-head">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="mf-btn ghost icon" onClick={onClose} aria-label="Close panel">
            <Icon name="close" />
          </button>
        </div>
        <div className="mf-drawer-body">{children}</div>
        {footer ? <div className="mf-panel-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  top,
  describedBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  top?: boolean;
  describedBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlayBehaviour(open, onClose, ref, id);
  if (!open) return null;
  return createPortal(
    <div className="finance-root" style={{ minHeight: 0 }}>
      <div className="mf-scrim mf-dialog-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={`mf-dialog${top ? " top" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={describedBy} tabIndex={-1}>
        <div className="mf-dialog-head">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="mf-btn ghost icon small" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="mf-dialog-body">{children}</div>
        {footer ? <div className="mf-dialog-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Headless dialog container used by the command palette (custom layout, same focus rules). */
export function PaletteShell({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlayBehaviour(open, onClose, ref, id);
  if (!open) return null;
  return createPortal(
    <div className="finance-root" style={{ minHeight: 0 }}>
      <div className="mf-scrim mf-dialog-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="mf-dialog top" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm() {
  return (message: string) => window.confirm(message);
}
