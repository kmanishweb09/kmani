import { useId } from "react";

/**
 * Minimal, dependency-free SVG charts. Every chart has a title, units in the title, a text summary
 * for assistive technology and a collapsible data table. Colours are paired with labels/patterns so
 * nothing depends on red-vs-green alone.
 */

const fmt = (v: number, digits = 1) => v.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="mf-chart-table">
      <summary>Show data table</summary>
      <table className="mf-table compact">
        <caption className="mf-sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j > 0 ? "num" : undefined}>
                  {typeof c === "number" ? fmt(c, 2) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function BarChart({ title, unit, data, height = 200 }: { title: string; unit: string; data: Array<{ label: string; value: number | null; tone?: "primary" | "muted" }>; height?: number }) {
  const id = useId();
  const valid = data.filter((d) => d.value !== null) as Array<{ label: string; value: number; tone?: "primary" | "muted" }>;
  const max = Math.max(1e-9, ...valid.map((d) => Math.abs(d.value)));
  const hasNeg = valid.some((d) => d.value < 0);
  const w = 560;
  const pad = { l: 8, r: 8, t: 16, b: 34 };
  const innerH = height - pad.t - pad.b;
  const zeroY = hasNeg ? pad.t + innerH / 2 : pad.t + innerH;
  const scale = hasNeg ? innerH / 2 / max : innerH / max;
  const bw = (w - pad.l - pad.r) / Math.max(1, data.length);
  const summary = `${title}: ${data.map((d) => `${d.label} ${d.value === null ? "missing" : fmt(d.value)}`).join("; ")} (${unit}).`;
  return (
    <figure className="mf-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="mf-chart-title">
        {title} <span className="mf-muted">({unit})</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        <line x1={pad.l} x2={w - pad.r} y1={zeroY} y2={zeroY} className="mf-chart-axis" />
        {data.map((d, i) => {
          const x = pad.l + i * bw + bw * 0.18;
          const bwInner = bw * 0.64;
          if (d.value === null) {
            return (
              <g key={d.label}>
                <text x={x + bwInner / 2} y={zeroY - 6} textAnchor="middle" className="mf-chart-label">
                  n/a
                </text>
                <text x={x + bwInner / 2} y={height - 12} textAnchor="middle" className="mf-chart-label">
                  {d.label}
                </text>
              </g>
            );
          }
          const h = Math.abs(d.value) * scale;
          const y = d.value >= 0 ? zeroY - h : zeroY;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={bwInner} height={Math.max(1, h)} rx={3} className={`mf-chart-bar ${d.value < 0 ? "neg" : d.tone === "muted" ? "muted" : ""}`} />
              <text x={x + bwInner / 2} y={d.value >= 0 ? y - 4 : y + h + 12} textAnchor="middle" className="mf-chart-value">
                {fmt(d.value)}
              </text>
              <text x={x + bwInner / 2} y={height - 12} textAnchor="middle" className="mf-chart-label">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <DataTable caption={title} head={["Item", unit]} rows={data.map((d) => [d.label, d.value === null ? "missing" : d.value])} />
    </figure>
  );
}

export interface WaterfallStep {
  label: string;
  value: number;
  kind: "start" | "add" | "subtract" | "total";
}

export function Waterfall({ title, unit, steps, height = 230 }: { title: string; unit: string; steps: WaterfallStep[]; height?: number }) {
  const id = useId();
  let running = 0;
  const bars = steps.map((s) => {
    if (s.kind === "start" || s.kind === "total") {
      running = s.value;
      return { ...s, from: 0, to: s.value };
    }
    const from = running;
    running = s.kind === "add" ? running + Math.abs(s.value) : running - Math.abs(s.value);
    return { ...s, from, to: running };
  });
  const maxV = Math.max(1e-9, ...bars.flatMap((b) => [b.from, b.to]));
  const minV = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  const w = 560;
  const pad = { l: 8, r: 8, t: 18, b: 40 };
  const innerH = height - pad.t - pad.b;
  const y = (v: number) => pad.t + ((maxV - v) / (maxV - minV)) * innerH;
  const bw = (w - pad.l - pad.r) / Math.max(1, bars.length);
  const summary = `${title}: ${steps.map((s) => `${s.label} ${s.kind === "subtract" ? "−" : s.kind === "add" ? "+" : ""}${fmt(Math.abs(s.value))}`).join("; ")} (${unit}).`;
  return (
    <figure className="mf-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="mf-chart-title">
        {title} <span className="mf-muted">({unit})</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label={summary}>
        <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} className="mf-chart-axis" />
        {bars.map((b, i) => {
          const x = pad.l + i * bw + bw * 0.15;
          const bwInner = bw * 0.7;
          const top = y(Math.max(b.from, b.to));
          const h = Math.max(1, Math.abs(y(b.from) - y(b.to)));
          const cls = b.kind === "subtract" ? "neg" : b.kind === "add" ? "pos" : "";
          return (
            <g key={`${b.label}-${i}`}>
              <rect x={x} y={top} width={bwInner} height={h} rx={3} className={`mf-chart-bar ${cls}`} />
              <text x={x + bwInner / 2} y={top - 4} textAnchor="middle" className="mf-chart-value">
                {b.kind === "subtract" ? "−" : b.kind === "add" ? "+" : ""}
                {fmt(Math.abs(b.value))}
              </text>
              <text x={x + bwInner / 2} y={height - 22} textAnchor="middle" className="mf-chart-label">
                {b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}
              </text>
            </g>
          );
        })}
      </svg>
      <DataTable caption={title} head={["Step", "Type", unit]} rows={steps.map((s) => [s.label, s.kind, s.kind === "subtract" ? -Math.abs(s.value) : s.value])} />
    </figure>
  );
}

export function ScatterChart({
  title,
  xLabel,
  yLabel,
  points,
  height = 260,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  points: Array<{ label: string; x: number; y: number; tone?: "training" | "assumed" }>;
  height?: number;
}) {
  const id = useId();
  const w = 560;
  const pad = { l: 44, r: 96, t: 14, b: 38 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(1e-9, ...xs) * 1.1;
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(1e-9, ...ys) * 1.15;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * (height - pad.t - pad.b);
  const summary = `${title}: ${points.map((p) => `${p.label} (${xLabel} ${fmt(p.x, 3)}, ${yLabel} ${fmt(p.y, 2)})`).join("; ")}.`;
  return (
    <figure className="mf-chart scatter" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="mf-chart-title">
        {title}
      </figcaption>
      <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label={summary}>
        <line x1={pad.l} x2={w - pad.r} y1={sy(0)} y2={sy(0)} className="mf-chart-axis" />
        <line x1={sx(0)} x2={sx(0)} y1={pad.t} y2={height - pad.b} className="mf-chart-axis" />
        <text x={w / 2} y={height - 6} textAnchor="middle" className="mf-chart-label">
          {xLabel}
        </text>
        <text x={12} y={height / 2} textAnchor="middle" className="mf-chart-label" transform={`rotate(-90 12 ${height / 2})`}>
          {yLabel}
        </text>
        {points.map((p) => (
          <g key={p.label}>
            {p.tone === "assumed" ? (
              <rect x={sx(p.x) - 5} y={sy(p.y) - 5} width={10} height={10} className="mf-chart-point assumed" />
            ) : (
              <circle cx={sx(p.x)} cy={sy(p.y)} r={5.5} className="mf-chart-point" />
            )}
            <text x={sx(p.x) + 8} y={sy(p.y) - 7} className="mf-chart-value">
              {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
            </text>
          </g>
        ))}
      </svg>
      <DataTable caption={title} head={["Point", xLabel, yLabel]} rows={points.map((p) => [p.label, p.x, p.y])} />
    </figure>
  );
}
