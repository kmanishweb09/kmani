import { XMLParser } from "fast-xml-parser";

/**
 * Bounded RSS 2.0 / Atom parser. DOCTYPE and ENTITY declarations are rejected before parsing (no
 * external-entity or entity-expansion attacks); entity processing is disabled in the parser; input
 * size and item count are capped. Output is plain text only — feed HTML is never rendered.
 */

export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const MAX_FEED_ITEMS = 200;

export class FeedParseError extends Error {
  constructor(
    readonly code: "TOO_LARGE" | "DTD_NOT_ALLOWED" | "NOT_A_FEED" | "MALFORMED",
    message: string,
  ) {
    super(message);
    this.name = "FeedParseError";
  }
}

export interface FeedItem {
  guid: string | null;
  title: string;
  link: string | null;
  publishedAt: string | null;
  summary: string | null;
}

export interface ParsedFeed {
  format: "rss" | "atom";
  title: string | null;
  items: FeedItem[];
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", rupee: "₹" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Strips markup and control characters; returns collapsed plain text truncated to `max`. */
export function plainText(raw: unknown, max = 300): string {
  if (raw === null || raw === undefined) return "";
  const s = typeof raw === "string" ? raw : typeof raw === "object" && raw && "#text" in raw ? String((raw as Record<string, unknown>)["#text"]) : String(raw);
  const noCdata = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const noScripts = noCdata.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  const noTags = noScripts.replace(/<[^>]*>/g, " ");
  const text = decodeEntities(noTags)
    // eslint-disable-next-line no-control-regex -- strip control characters from untrusted text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function toIso(raw: unknown): string | null {
  const s = plainText(raw, 100);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  if (d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100) return null;
  return d.toISOString();
}

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function safeLink(raw: unknown): string | null {
  const s = plainText(raw, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseFeed(xml: string): ParsedFeed {
  if (xml.length > MAX_FEED_BYTES) throw new FeedParseError("TOO_LARGE", "Feed exceeds the size limit.");
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) throw new FeedParseError("DTD_NOT_ALLOWED", "Feeds with DOCTYPE/ENTITY declarations are rejected.");
  let doc: Record<string, unknown>;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      processEntities: false,
      htmlEntities: false,
      allowBooleanAttributes: true,
      parseTagValue: false,
      trimValues: true,
    });
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new FeedParseError("MALFORMED", `Could not parse XML: ${(e as Error).message.slice(0, 120)}`);
  }
  const rss = doc.rss as { channel?: Record<string, unknown> } | undefined;
  const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  if (rss?.channel || rdf) {
    const channel = (rss?.channel ?? rdf?.channel ?? {}) as Record<string, unknown>;
    const rawItems = asArray((rss?.channel?.item ?? rdf?.item) as Record<string, unknown> | Array<Record<string, unknown>>).slice(0, MAX_FEED_ITEMS);
    return {
      format: "rss",
      title: plainText(channel.title, 200) || null,
      items: rawItems
        .map((it) => {
          const guidRaw = it.guid as unknown;
          const guid = plainText(typeof guidRaw === "object" && guidRaw ? (guidRaw as Record<string, unknown>)["#text"] : guidRaw, 500) || null;
          return {
            guid,
            title: plainText(it.title, 400),
            link: safeLink(it.link),
            publishedAt: toIso(it.pubDate ?? it["dc:date"]),
            summary: plainText(it.description, 300) || null,
          };
        })
        .filter((i) => i.title),
    };
  }
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    const entries = asArray(feed.entry as Record<string, unknown> | Array<Record<string, unknown>>).slice(0, MAX_FEED_ITEMS);
    return {
      format: "atom",
      title: plainText(feed.title, 200) || null,
      items: entries
        .map((e) => {
          const links = asArray(e.link as Record<string, unknown> | Array<Record<string, unknown>>);
          const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
          return {
            guid: plainText(e.id, 500) || null,
            title: plainText(e.title, 400),
            link: safeLink(alt?.["@_href"]),
            publishedAt: toIso(e.published ?? e.updated),
            summary: plainText(e.summary ?? e.content, 300) || null,
          };
        })
        .filter((i) => i.title),
    };
  }
  throw new FeedParseError("NOT_A_FEED", "The document is not an RSS or Atom feed.");
}
