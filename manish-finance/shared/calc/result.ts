/**
 * Shared result types for deterministic finance calculations.
 *
 * Every calculator returns either a value with warnings, or a list of issues.
 * Calculators never return NaN/Infinity and never coerce missing inputs to zero.
 */

export interface CalcIssue {
  code: string;
  message: string;
  field?: string;
}

export interface CalcOk<T> {
  ok: true;
  value: T;
  warnings: CalcIssue[];
}

export interface CalcErr {
  ok: false;
  errors: CalcIssue[];
}

export type CalcResult<T> = CalcOk<T> | CalcErr;

/** Version stamped into saved model snapshots so old outputs can be traced to the code that produced them. */
export const CALC_VERSION = "2026.09.1";

export function ok<T>(value: T, warnings: CalcIssue[] = []): CalcOk<T> {
  return { ok: true, value, warnings };
}

export function fail(errors: CalcIssue[] | CalcIssue): CalcErr {
  return { ok: false, errors: Array.isArray(errors) ? errors : [errors] };
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Collects issues for inputs that must be finite numbers. `null`/`undefined` are reported as missing, never as zero. */
export function requireNumbers(fields: Record<string, unknown>): CalcIssue[] {
  const issues: CalcIssue[] = [];
  for (const [field, v] of Object.entries(fields)) {
    if (v === null || v === undefined) {
      issues.push({ code: "MISSING_INPUT", field, message: `${field} is missing. Missing is not zero; enter a value or mark it confirmed zero.` });
    } else if (!isFiniteNumber(v)) {
      issues.push({ code: "INVALID_NUMBER", field, message: `${field} must be a finite number.` });
    }
  }
  return issues;
}

/** Relative + absolute tolerance comparison used for reconciliation checks (not for display rounding). */
export function nearlyEqual(a: number, b: number, relTol = 1e-9, absTol = 1e-9): boolean {
  return Math.abs(a - b) <= Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
}
