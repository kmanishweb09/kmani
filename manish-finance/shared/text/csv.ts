/**
 * CSV serialisation with spreadsheet formula-injection neutralisation: text cells beginning with
 * =, +, -, @, tab or carriage return are prefixed with a single quote so spreadsheet apps treat
 * them as text. Numeric cells are written as plain numbers.
 */

export type CsvCell = string | number | boolean | null | undefined;

const DANGEROUS = /^[=+\-@\t\r]/;

export function neutralizeCell(value: string): string {
  return DANGEROUS.test(value) ? `'${value}` : value;
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const safe = neutralizeCell(value);
  return /[",\n\r]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header.map((h) => csvCell(h)).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
