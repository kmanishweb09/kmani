import { Fragment, type ReactNode } from "react";

/**
 * Safe Markdown subset rendered to React elements (no innerHTML): headings, paragraphs, lists,
 * blockquotes, fenced code, tables, emphasis, inline code and links. Links are limited to http(s),
 * mailto and local /finance paths; anything else renders as plain text.
 */

function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  if (h.startsWith("/finance") && !h.startsWith("//")) return h;
  if (h.startsWith("#")) return h;
  return null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm ? safeHref(lm[2] as string) : null;
      if (lm && href) {
        const external = /^https?:/i.test(href);
        out.push(
          <a key={k} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {lm[1]}
          </a>,
        );
      } else out.push(lm ? `${lm[1]} (${lm[2]})` : tok);
    } else if (m[5]) {
      out.push(
        <a key={k} href={tok} target="_blank" rel="noopener noreferrer">
          {tok}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Block {
  type: "h" | "p" | "ul" | "ol" | "quote" | "code" | "hr" | "table";
  level?: number;
  lines: string[];
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] as string)) body.push(lines[i++] as string);
      i++;
      blocks.push({ type: "code", lines: body });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "h", level: (h[1] as string).length, lines: [h[2] as string] });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr", lines: [] });
      i++;
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1] as string)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] as string)) rows.push(lines[i++] as string);
      blocks.push({ type: "table", lines: rows });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] as string)) body.push((lines[i++] as string).replace(/^>\s?/, ""));
      blocks.push({ type: "quote", lines: body });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] as string)) items.push((lines[i++] as string).replace(/^\s*[-*]\s+/, ""));
      blocks.push({ type: "ul", lines: items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] as string)) items.push((lines[i++] as string).replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push({ type: "ol", lines: items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] as string).trim() && !/^(#{1,4}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+|\|)/.test(lines[i] as string)) para.push(lines[i++] as string);
    if (!para.length) para.push(lines[i++] as string);
    blocks.push({ type: "p", lines: para });
  }
  return blocks;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source ?? "");
  return (
    <div className={`mf-prose${className ? ` ${className}` : ""}`}>
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        switch (b.type) {
          case "h": {
            const lvl = Math.min(4, Math.max(2, (b.level ?? 2) + 1));
            const content = inline(b.lines[0] ?? "", k);
            if (lvl === 2) return <h2 key={k}>{content}</h2>;
            if (lvl === 3) return <h3 key={k}>{content}</h3>;
            return <h4 key={k}>{content}</h4>;
          }
          case "ul":
            return (
              <ul key={k}>
                {b.lines.map((l, i) => (
                  <li key={i}>{inline(l, `${k}-${i}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k}>
                {b.lines.map((l, i) => (
                  <li key={i}>{inline(l, `${k}-${i}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return <blockquote key={k}>{inline(b.lines.join(" "), k)}</blockquote>;
          case "code":
            return (
              <pre key={k}>
                <code>{b.lines.join("\n")}</code>
              </pre>
            );
          case "hr":
            return <hr key={k} className="mf-divider" />;
          case "table": {
            const [head, , ...body] = b.lines;
            return (
              <div key={k} className="mf-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {cells(head ?? "").map((c, i) => (
                        <th key={i}>{inline(c, `${k}-h${i}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.map((r, ri) => (
                      <tr key={ri}>
                        {cells(r).map((c, ci) => (
                          <td key={ci}>{inline(c, `${k}-${ri}-${ci}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          default:
            return (
              <p key={k}>
                {b.lines.map((l, i) => (
                  <Fragment key={i}>
                    {i > 0 ? " " : null}
                    {inline(l, `${k}-${i}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
