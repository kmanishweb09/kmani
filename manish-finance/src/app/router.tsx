import { type AnchorHTMLAttributes, type MouseEvent, type ReactNode, useEffect, useSyncExternalStore } from "react";

/**
 * Small History API router for the /finance namespace: deep links, back/forward, refresh and
 * meaningful document titles. Unknown paths render the finance not-found view.
 */

export type RouteName =
  | "desk"
  | "deals"
  | "compare"
  | "deal"
  | "sectors"
  | "sector"
  | "companies"
  | "company"
  | "lab"
  | "briefs"
  | "brief"
  | "notebook"
  | "note"
  | "sources"
  | "settings"
  | "research"
  | "not_found";

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  path: string;
  query: URLSearchParams;
  hash: string;
}

const TABLE: Array<{ name: RouteName; re: RegExp; keys?: string[] }> = [
  { name: "desk", re: /^\/finance$/ },
  { name: "deals", re: /^\/finance\/deals$/ },
  { name: "compare", re: /^\/finance\/deals\/compare$/ },
  { name: "deal", re: /^\/finance\/deals\/([a-z0-9][a-z0-9-]*)$/, keys: ["id"] },
  { name: "sectors", re: /^\/finance\/sectors$/ },
  { name: "sector", re: /^\/finance\/sectors\/([a-z0-9][a-z0-9-]*)$/, keys: ["slug"] },
  { name: "companies", re: /^\/finance\/companies$/ },
  { name: "company", re: /^\/finance\/companies\/([a-z0-9][a-z0-9-]*)$/, keys: ["id"] },
  { name: "lab", re: /^\/finance\/lab$/ },
  { name: "briefs", re: /^\/finance\/briefs$/ },
  { name: "brief", re: /^\/finance\/briefs\/([A-Za-z0-9][A-Za-z0-9_-]*)$/, keys: ["id"] },
  { name: "notebook", re: /^\/finance\/notebook$/ },
  { name: "note", re: /^\/finance\/notebook\/([A-Za-z0-9][A-Za-z0-9_-]*)$/, keys: ["id"] },
  { name: "sources", re: /^\/finance\/sources$/ },
  { name: "settings", re: /^\/finance\/settings$/ },
  { name: "research", re: /^\/finance\/research$/ },
];

export function matchRoute(pathname: string, search = "", hash = ""): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const r of TABLE) {
    const m = r.re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys?.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1] as string);
      });
      return { name: r.name, params, path, query: new URLSearchParams(search), hash };
    }
  }
  return { name: "not_found", params: {}, path, query: new URLSearchParams(search), hash };
}

const listeners = new Set<() => void>();
let snapshot = typeof window !== "undefined" ? `${location.pathname}${location.search}${location.hash}` : "/finance";

function emit(): void {
  snapshot = `${location.pathname}${location.search}${location.hash}`;
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", emit);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRoute(): Route {
  const snap = useSyncExternalStore(subscribe, () => snapshot);
  const u = new URL(snap, location.origin);
  return matchRoute(u.pathname, u.search, u.hash);
}

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean } = {}): void {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) {
    location.assign(url.toString());
    return;
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next === current) return;
  const samePath = url.pathname === location.pathname;
  if (opts.replace) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
  emit();
  if (!opts.keepScroll && !samePath) window.scrollTo(0, 0);
}

/** Updates query parameters on the current route (replace by default so filters don't flood history). */
export function setQuery(update: Record<string, string | null | undefined>, opts: { replace?: boolean } = { replace: true }): void {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(update)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  navigate(`${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`, { replace: opts.replace ?? true, keepScroll: true });
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  replace?: boolean;
  children: ReactNode;
}

export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    const url = new URL(to, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/finance")) return;
    e.preventDefault();
    navigate(to, replace ? { replace } : {});
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

/** Sets the document title for the current page. */
export function useTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · Finance Desk` : "Finance Desk";
  }, [title]);
}
