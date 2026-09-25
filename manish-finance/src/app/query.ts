import { useCallback, useEffect, useReducer, useRef } from "react";
import { ApiError, apiGet } from "./api";

/**
 * Minimal query cache: deduplicates in-flight GETs, keeps results for reuse across routes and
 * separates public from private entries so private data can be dropped on sign-out/account change.
 */

type Scope = "public" | "private";

interface Entry {
  data?: unknown;
  error?: ApiError;
  fetchedAt: number;
  promise?: Promise<unknown> | undefined;
  scope: Scope;
  listeners: Set<() => void>;
}

const cache = new Map<string, Entry>();

function entry(key: string, scope: Scope): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { fetchedAt: 0, scope, listeners: new Set() };
    cache.set(key, e);
  }
  return e;
}

function notify(e: Entry): void {
  for (const l of e.listeners) l();
}

export function fetchQuery<T>(key: string, scope: Scope = "public", fetcher?: () => Promise<T>): Promise<T> {
  const e = entry(key, scope);
  if (e.promise) return e.promise as Promise<T>;
  const p = (fetcher ? fetcher() : apiGet<T>(key))
    .then((data) => {
      e.data = data;
      e.error = undefined;
      e.fetchedAt = Date.now();
      return data;
    })
    .catch((err: unknown) => {
      e.error = err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", String(err));
      e.fetchedAt = Date.now();
      throw e.error;
    })
    .finally(() => {
      e.promise = undefined;
      notify(e);
    });
  e.promise = p;
  notify(e);
  return p;
}

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  refreshing: boolean;
  refetch: () => Promise<void>;
}

export function useQuery<T>(key: string | null, opts: { scope?: Scope; staleMs?: number; fetcher?: () => Promise<T>; enabled?: boolean } = {}): QueryState<T> {
  const scope = opts.scope ?? "public";
  const staleMs = opts.staleMs ?? 60_000;
  const enabled = opts.enabled !== false && key !== null;
  const [, force] = useReducer((x: number) => x + 1, 0);
  const fetcherRef = useRef(opts.fetcher);
  fetcherRef.current = opts.fetcher;

  useEffect(() => {
    if (!enabled || !key) return undefined;
    const e = entry(key, scope);
    e.listeners.add(force);
    const fresh = e.fetchedAt && Date.now() - e.fetchedAt < staleMs && !e.error;
    if (!fresh && !e.promise) fetchQuery(key, scope, fetcherRef.current).catch(() => undefined);
    return () => {
      e.listeners.delete(force);
    };
  }, [key, scope, staleMs, enabled]);

  const refetch = useCallback(async () => {
    if (!key) return;
    await fetchQuery(key, scope, fetcherRef.current).catch(() => undefined);
  }, [key, scope]);

  const e = key ? cache.get(key) : undefined;
  return {
    data: enabled ? (e?.data as T | undefined) : undefined,
    error: enabled ? e?.error : undefined,
    loading: enabled && !e?.data && !e?.error,
    refreshing: Boolean(e?.promise && e.data),
    refetch,
  };
}

/** Marks matching entries stale and refetches those currently displayed. */
export function invalidate(prefix: string): void {
  for (const [k, e] of cache) {
    if (k.startsWith(prefix)) {
      e.fetchedAt = 0;
      if (e.listeners.size) fetchQuery(k, e.scope).catch(() => undefined);
    }
  }
}

export function setQueryData<T>(key: string, data: T, scope: Scope = "private"): void {
  const e = entry(key, scope);
  e.data = data;
  e.error = undefined;
  e.fetchedAt = Date.now();
  notify(e);
}

/** Drops every private entry (sign-out, account change). */
export function clearPrivateQueries(): void {
  for (const [k, e] of cache) {
    if (e.scope === "private") {
      cache.delete(k);
      e.data = undefined;
      notify(e);
    }
  }
}
