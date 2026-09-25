/**
 * Live source check (bundled by scripts/check-sources-live.mjs). Uses the same fetch guard and parsers
 * as the Worker connectors against the registered endpoints, from the machine it runs on. It records
 * what actually happened; a blocked network is reported as blocked, never as success.
 */
import { guardedFetch } from "../../server/sources/fetchGuard";
import { SOURCES } from "../../server/sources/registry";
import { parseFeed } from "../../server/sources/rss";
import { parseSubmissions } from "../../server/sources/sec";

export interface LiveResult {
  sourceId: string;
  url: string;
  checkedAt: string;
  outcome: "ok" | "http_error" | "network_error" | "parse_error" | "not_configured";
  httpStatus: number | null;
  items: number | null;
  sample: string | null;
  note: string | null;
}

export async function runLiveCheck(env: { secUserAgent: string | null }): Promise<LiveResult[]> {
  const out: LiveResult[] = [];
  for (const def of SOURCES) {
    if (!def.connector || !def.endpoint) continue;
    const url = def.connector === "sec_submissions" ? def.endpoint.replace("{cik}", def.secCiks?.[0]?.cik ?? "") : def.endpoint;
    const base = { sourceId: def.id, url, checkedAt: new Date().toISOString() };
    if (def.connector === "sec_submissions" && !env.secUserAgent) {
      out.push({ ...base, outcome: "not_configured", httpStatus: null, items: null, sample: null, note: "Set FINANCE_SEC_USER_AGENT (a real contact) to run the SEC check." });
      continue;
    }
    const ua = def.connector === "sec_submissions" ? (env.secUserAgent as string) : "FinanceDesk/0.1 (+https://kmanish.live/finance) live-check";
    try {
      const res = await guardedFetch(url, { allowedHosts: def.allowedHosts, fetcher: fetch, headers: { "user-agent": ua }, timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 });
      if (res.status < 200 || res.status >= 300) {
        out.push({ ...base, outcome: "http_error", httpStatus: res.status, items: null, sample: null, note: res.text.slice(0, 160) || null });
        continue;
      }
      try {
        if (def.connector === "rss") {
          const f = parseFeed(res.text);
          out.push({ ...base, outcome: "ok", httpStatus: res.status, items: f.items.length, sample: f.items[0] ? `${f.items[0].publishedAt ?? "undated"} — ${f.items[0].title}` : null, note: null });
        } else {
          const s = parseSubmissions(res.text, { sinceDate: "2000-01-01", max: 5 });
          out.push({ ...base, outcome: "ok", httpStatus: res.status, items: s.filings.length, sample: s.filings[0] ? `${s.filings[0].filingDate} — ${s.name} ${s.filings[0].form}` : null, note: null });
        }
      } catch (e) {
        out.push({ ...base, outcome: "parse_error", httpStatus: res.status, items: null, sample: null, note: e instanceof Error ? e.message.slice(0, 200) : "parse error" });
      }
    } catch (e) {
      out.push({ ...base, outcome: "network_error", httpStatus: null, items: null, sample: null, note: e instanceof Error ? e.message.slice(0, 200) : "network error" });
    }
  }
  return out;
}
