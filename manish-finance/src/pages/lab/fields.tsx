import { type ReactNode, useEffect, useId, useState } from "react";
import type { CalcIssue } from "../../../shared/calc/result";
import { Icon } from "../../components/Icon";
import { type ProvenanceKind, ProvTag } from "../../components/ui";

/**
 * Numeric input that keeps "missing" distinct from zero: an empty field is null. Percent fields
 * display percentages but store decimals (12.5 ⇄ 0.125) so calculators receive one convention.
 */
export function NumField({
  label,
  value,
  onChange,
  unit,
  percent,
  kind = "assumed",
  step,
  help,
  readOnly,
  compact,
}: {
  label: string;
  value: number | null | undefined;
  onChange?: (v: number | null) => void;
  unit?: string;
  percent?: boolean;
  kind?: ProvenanceKind;
  step?: number;
  help?: string;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const toText = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(percent ? Math.round(v * 1e8) / 1e6 : v));
  const [text, setText] = useState(toText(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text);
    const current = parsed === null ? null : percent ? parsed / 100 : parsed;
    const same = current === value || (current !== null && value !== null && value !== undefined && Math.abs(current - value) < 1e-12);
    if (!same) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only resync when the stored value changes
  }, [value]);

  const commit = (raw: string) => {
    setText(raw);
    const t = raw.trim().replace(/,/g, "");
    if (t === "") {
      setInvalid(false);
      onChange?.(null);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange?.(percent ? n / 100 : n);
  };

  return (
    <div className={`mf-lab-field${compact ? " compact" : ""}`}>
      <label htmlFor={id}>
        <span>{label}</span>
        <ProvTag kind={kind} />
      </label>
      <div className="mf-lab-input">
        <input
          id={id}
          className="mf-input"
          inputMode="decimal"
          value={text}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={help ? `${id}-help` : undefined}
          step={step}
          onChange={(e) => commit(e.target.value)}
          placeholder="missing"
        />
        {percent ? <span className="mf-lab-unit">%</span> : unit ? <span className="mf-lab-unit">{unit}</span> : null}
      </div>
      {invalid ? <p className="mf-field-error">Enter a number (or leave empty for missing).</p> : null}
      {help ? (
        <p className="mf-xsmall mf-muted" id={`${id}-help`}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function IssueList({ errors, warnings }: { errors?: CalcIssue[]; warnings?: CalcIssue[] }) {
  if (!errors?.length && !warnings?.length) return null;
  return (
    <div className="mf-stack" style={{ gap: 8 }}>
      {errors?.map((e, i) => (
        <div key={`e${i}`} className="mf-callout negative" role="alert">
          <Icon name="alert" size={16} />
          <div>
            <strong>{e.code.replaceAll("_", " ").toLowerCase()}</strong>
            <p className="mf-small">{e.message}</p>
          </div>
        </div>
      ))}
      {warnings?.map((w, i) => (
        <div key={`w${i}`} className="mf-callout attention">
          <Icon name="info" size={16} />
          <div>
            <strong>{w.code.replaceAll("_", " ").toLowerCase()}</strong>
            <p className="mf-small">{w.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultFigure({ label, value, sub, kind = "calculated" }: { label: string; value: string; sub?: ReactNode; kind?: ProvenanceKind }) {
  return (
    <div className="mf-lab-result">
      <div className="mf-lab-result-label">
        {label} <ProvTag kind={kind} />
      </div>
      <div className="mf-lab-result-value mf-num">{value}</div>
      {sub ? <div className="mf-xsmall mf-muted">{sub}</div> : null}
    </div>
  );
}

export function Formula({ children }: { children: ReactNode }) {
  return <p className="mf-formula">{children}</p>;
}

export function LabSection({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="mf-panel mf-lab-section" aria-labelledby={id}>
      <div className="mf-panel-head">
        <h2 className="mf-panel-title" id={id} style={{ fontSize: 17 }}>
          {title}
        </h2>
        {actions}
      </div>
      <div className="mf-panel-body">{children}</div>
    </section>
  );
}

export const fmtNum = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`);

export const fmtX = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}×`);
