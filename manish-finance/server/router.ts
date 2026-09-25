import type { RequestContext } from "./types";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type Access = "public" | "owner" | "owner_or_maintenance";

export interface RouteDef {
  method: Method;
  pattern: string;
  access: Access;
  handler: (c: RequestContext) => Promise<Response>;
  /** Maximum request body size in bytes for writes. */
  bodyLimit?: number;
}

interface CompiledRoute extends RouteDef {
  regex: RegExp;
  keys: string[];
}

export type MatchResult =
  | { kind: "match"; route: CompiledRoute; params: Record<string, string> }
  | { kind: "method_not_allowed"; allowed: string[] }
  | { kind: "not_found" };

export class Router {
  private routes: CompiledRoute[] = [];

  add(def: RouteDef): this {
    const keys: string[] = [];
    const src = def.pattern
      .split("/")
      .map((seg) => {
        if (seg.startsWith(":")) {
          keys.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ ...def, regex: new RegExp(`^${src}$`), keys });
    return this;
  }

  match(method: string, path: string): MatchResult {
    const allowed = new Set<string>();
    const m = method === "HEAD" ? "GET" : method;
    for (const r of this.routes) {
      const res = r.regex.exec(path);
      if (!res) continue;
      if (r.method !== m) {
        allowed.add(r.method);
        continue;
      }
      const params: Record<string, string> = {};
      let bad = false;
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(res[i + 1] as string);
        } catch {
          bad = true;
        }
      });
      if (bad) return { kind: "not_found" };
      return { kind: "match", route: r, params };
    }
    if (allowed.size) {
      if (allowed.has("GET")) allowed.add("HEAD");
      return { kind: "method_not_allowed", allowed: [...allowed].sort() };
    }
    return { kind: "not_found" };
  }
}
