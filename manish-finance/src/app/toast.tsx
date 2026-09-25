import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";

interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

interface ToastValue {
  notify: (message: string, kind?: Toast["kind"]) => void;
  announce: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

/** Toasts for outcomes (truthful save states etc.) plus a polite live region for screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [live, setLive] = useState("");
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (message: string, kind: Toast["kind"] = "info") => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setLive(message);
      window.setTimeout(() => dismiss(id), kind === "error" ? 9000 : 4500);
    },
    [dismiss],
  );
  const announce = useCallback((message: string) => setLive(message), []);
  const value = useMemo(() => ({ notify, announce }), [notify, announce]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="mf-sr-only" aria-live="polite" role="status">
        {live}
      </div>
      <div className="mf-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`mf-toast ${t.kind}`}>
            <Icon name={t.kind === "error" ? "alert" : t.kind === "success" ? "check" : "info"} />
            <span style={{ flex: 1 }}>{t.message}</span>
            <button type="button" className="mf-btn ghost icon small" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const v = useContext(ToastContext);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}
