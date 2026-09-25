import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClaimView } from "../../shared/api";
import { formatDateValue } from "../../shared/dates";
import { VERIFICATION_HELP, VERIFICATION_LABEL } from "../../shared/labels";
import { apiGet, errorMessage } from "../app/api";
import { Icon } from "./Icon";
import { Drawer } from "./Overlay";

/**
 * Evidence on demand: any sourced value can open the provenance drawer without leaving the page.
 * Claims arrive with detail responses (registered here) or are fetched by ID.
 */

interface EvidenceRequest {
  ids: string[];
  label: string;
}

interface EvidenceValue {
  register: (claims: Record<string, ClaimView> | undefined) => void;
  open: (ids: string[], label: string) => void;
}

const EvidenceContext = createContext<EvidenceValue | null>(null);
const registry = new Map<string, ClaimView>();

const DOC_TYPE: Record<string, string> = {
  press_release: "Press release",
  exchange_filing: "Exchange filing",
  regulatory_filing: "Regulatory filing",
  regulatory_order: "Regulatory order/decision",
  court_order: "Court/tribunal order",
  annual_report: "Annual report",
  investor_presentation: "Investor presentation",
  company_page: "Company web page",
  news_report: "News report",
  reference: "Reference",
  dataset: "Dataset",
};

export function VerificationBadge({ status }: { status: ClaimView["status"] }) {
  const cls = status === "source_checked" || status === "human_reviewed" ? "positive" : status === "search_corroborated" ? "accent" : status === "conflict" ? "negative" : "attention";
  const icon = status === "source_checked" || status === "human_reviewed" ? "check" : status === "conflict" ? "alert" : status === "pending" ? "clock" : "search";
  return (
    <span className={`mf-pill ${cls}`} title={VERIFICATION_HELP[status]}>
      <Icon name={icon} size={13} />
      {VERIFICATION_LABEL[status]}
    </span>
  );
}

function ClaimCard({ claim }: { claim: ClaimView }) {
  const d = claim.document;
  const [copied, setCopied] = useState(false);
  const citation = `${d.publisher}, “${d.title}”${d.publishedDate ? `, ${formatDateValue(d.publishedDate)}` : ""}. ${d.url}`;
  return (
    <article className="mf-panel" style={{ marginBottom: 12 }}>
      <div className="mf-panel-body mf-stack tight">
        <div className="mf-row spread">
          <span className="mf-eyebrow">{claim.label}</span>
          <VerificationBadge status={claim.status} />
        </div>
        <p style={{ fontSize: 15.5, fontWeight: 600 }}>{claim.display}</p>
        <p className="mf-hint">{VERIFICATION_HELP[claim.status]}</p>
        <hr className="mf-divider" />
        <dl className="mf-dl" style={{ fontSize: 14 }}>
          <dt>Source</dt>
          <dd>
            <a href={d.url} target="_blank" rel="noopener noreferrer">
              {d.title} <Icon name="external" size={13} />
            </a>
          </dd>
          <dt>Publisher</dt>
          <dd>
            {d.publisher} · {DOC_TYPE[d.documentType] ?? d.documentType} · {d.isPrimary ? "primary source" : "secondary source"}
          </dd>
          <dt>Published</dt>
          <dd>{d.publishedDate ? formatDateValue(d.publishedDate) : "Date not recorded"}</dd>
          <dt>Retrieval</dt>
          <dd>
            {d.retrievalStatus === "retrieved" && d.retrievedAt
              ? `Retrieved ${d.retrievedAt.slice(0, 10)}`
              : d.retrievalStatus === "unavailable"
                ? "Unavailable (link may be broken or access-restricted)"
                : "Not retrieved by the build environment"}
            {d.retrievalNote ? <span className="mf-muted"> — {d.retrievalNote}</span> : null}
          </dd>
          {claim.locator ? (
            <>
              <dt>Location</dt>
              <dd>{claim.locator}</dd>
            </>
          ) : null}
          <dt>Checked</dt>
          <dd>
            {claim.checkedAt ?? "—"} · {claim.method.replace(/_/g, " ")}
          </dd>
        </dl>
        {claim.excerpt ? (
          <blockquote className="mf-callout" style={{ margin: 0 }}>
            “{claim.excerpt}”
          </blockquote>
        ) : null}
        {claim.note ? <p className="mf-hint">Note: {claim.note}</p> : null}
        <div className="mf-row">
          <button
            type="button"
            className="mf-btn small"
            onClick={() => {
              void navigator.clipboard?.writeText(citation).then(() => setCopied(true));
            }}
          >
            <Icon name="copy" size={14} /> {copied ? "Copied" : "Copy citation"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<EvidenceRequest | null>(null);
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reqSeq = useRef(0);

  const register = useCallback((m: Record<string, ClaimView> | undefined) => {
    if (!m) return;
    for (const [k, v] of Object.entries(m)) registry.set(k, v);
  }, []);

  const open = useCallback((ids: string[], label: string) => {
    setReq({ ids, label });
  }, []);

  useEffect(() => {
    if (!req) return;
    const seq = ++reqSeq.current;
    const known = req.ids.map((id) => registry.get(id)).filter(Boolean) as ClaimView[];
    const missing = req.ids.filter((id) => !registry.has(id));
    setClaims(known);
    setError(null);
    if (!missing.length) return;
    setLoading(true);
    Promise.all(missing.map((id) => apiGet<ClaimView>(`/api/finance/evidence/${encodeURIComponent(id)}`)))
      .then((got) => {
        if (seq !== reqSeq.current) return;
        for (const c of got) registry.set(c.id, c);
        setClaims(req.ids.map((id) => registry.get(id)).filter(Boolean) as ClaimView[]);
      })
      .catch((e) => seq === reqSeq.current && setError(errorMessage(e)))
      .finally(() => seq === reqSeq.current && setLoading(false));
  }, [req]);

  const value = useMemo(() => ({ register, open }), [register, open]);
  return (
    <EvidenceContext.Provider value={value}>
      {children}
      <Drawer open={Boolean(req)} onClose={() => setReq(null)} title={req ? `Evidence: ${req.label}` : "Evidence"}>
        {loading && !claims.length ? <span className="mf-skel" style={{ height: 120 }} /> : null}
        {error ? <p className="mf-error-text">{error}</p> : null}
        {!loading && !error && !claims.length ? <p className="mf-muted">No evidence record is attached to this value.</p> : null}
        {claims.map((c) => (
          <ClaimCard key={c.id} claim={c} />
        ))}
        <p className="mf-hint">
          Provenance policy: primary sources (filings, company and regulator documents) take precedence; only short permitted excerpts are stored. See{" "}
          <a href="/finance/sources">Sources</a>.
        </p>
      </Drawer>
    </EvidenceContext.Provider>
  );
}

export function useEvidence(): EvidenceValue {
  const v = useContext(EvidenceContext);
  if (!v) throw new Error("useEvidence outside EvidenceProvider");
  return v;
}

/** Inline provenance trigger shown next to a value. */
export function Ev({ ids, label }: { ids: string[] | undefined; label: string }) {
  const { open } = useEvidence();
  if (!ids?.length) {
    return (
      <span className="mf-ev unsourced" title="No source recorded for this value">
        <Icon name="evidence" size={13} />
        <span className="mf-sr-only">No source recorded for {label}</span>
      </span>
    );
  }
  return (
    <button type="button" className="mf-ev" onClick={() => open(ids, label)} aria-label={`Show evidence for ${label} (${ids.length} source${ids.length > 1 ? "s" : ""})`}>
      <Icon name="evidence" size={13} />
      {ids.length > 1 ? ids.length : null}
    </button>
  );
}

/** Registers claims from a detail payload so the drawer opens instantly. */
export function useRegisterEvidence(map: Record<string, ClaimView> | undefined): void {
  const { register } = useEvidence();
  useEffect(() => register(map), [map, register]);
}
