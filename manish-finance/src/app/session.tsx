import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StatusResponse } from "../../shared/api";
import { type ApiError, apiGet } from "./api";
import { clearPrivateQueries } from "./query";
import { clearPrivateLocal } from "./storage";

/**
 * Session status: viewer role, capability flags and source freshness from /api/finance/status.
 * Polls about every five minutes while the tab is visible and stops in background tabs. Private
 * caches and device-local drafts are cleared when the signed-in account changes or signs out.
 */

interface SessionValue {
  status: StatusResponse | null;
  error: ApiError | null;
  loading: boolean;
  isOwner: boolean;
  signedIn: boolean;
  refresh: () => Promise<void>;
  lastCheckedAt: number | null;
}

const SessionContext = createContext<SessionValue | null>(null);
const POLL_MS = 5 * 60_000;

export function safeLocalPath(path: string): string {
  if (!path.startsWith("/finance") || path.startsWith("//") || path.includes("\\")) return "/finance";
  return path;
}

export function signInHref(path = `${location.pathname}${location.search}`): string {
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(safeLocalPath(path))}`;
}

export function signOutHref(path = `${location.pathname}${location.search}`): string {
  return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeLocalPath(path))}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const viewerKey = useRef<string | null | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const s = await apiGet<StatusResponse>("/api/finance/status");
        if (viewerKey.current !== undefined && viewerKey.current !== s.viewer.key) {
          clearPrivateQueries();
          clearPrivateLocal();
        }
        viewerKey.current = s.viewer.key;
        setStatus(s);
        setError(null);
      } catch (e) {
        setError(e as ApiError);
      } finally {
        setLastCheckedAt(Date.now());
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > POLL_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      error,
      loading: !status && !error,
      isOwner: status?.viewer.role === "owner",
      signedIn: Boolean(status?.viewer.signedIn),
      refresh,
      lastCheckedAt,
    }),
    [status, error, refresh, lastCheckedAt],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
