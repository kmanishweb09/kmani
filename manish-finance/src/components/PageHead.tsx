import type { ReactNode } from "react";
import { Link, useTitle } from "../app/router";

export function PageHead({
  title,
  docTitle,
  sub,
  actions,
  crumbs,
  eyebrow,
}: {
  title: ReactNode;
  docTitle?: string;
  sub?: ReactNode;
  actions?: ReactNode;
  crumbs?: Array<{ to: string; label: string }>;
  eyebrow?: ReactNode;
}) {
  useTitle(docTitle ?? (typeof title === "string" ? title : null));
  return (
    <div className="mf-page-head">
      <div style={{ minWidth: 0 }}>
        {crumbs?.length ? (
          <nav className="mf-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.to}>
                <Link to={c.to}>{c.label}</Link>
                {i < crumbs.length - 1 ? " / " : null}
              </span>
            ))}
          </nav>
        ) : null}
        {eyebrow ? <div className="mf-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div> : null}
        <h1 id="mf-page-title" tabIndex={-1}>
          {title}
        </h1>
        {sub ? <div className="mf-page-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="mf-row">{actions}</div> : null}
    </div>
  );
}
