import { zipStored } from "./zip";

/**
 * Minimal XLSX (Office Open XML SpreadsheetML) writer for formula-based exports.
 *
 * - Cells hold numbers, strings, booleans or formulas. A formula may carry a cached value (what the app
 *   calculated), so viewers that do not recalculate still show numbers; `fullCalcOnLoad` makes Excel
 *   and LibreOffice recalculate on open.
 * - Formulas are written in the file format's invariant syntax: English function names, comma
 *   separators, A1 references, no leading "=".
 * - A small fixed style table: blue for inputs, black for calculations, bold totals.
 */

export type StyleName =
  | "default"
  | "title"
  | "header"
  | "label"
  | "input_num"
  | "input_pct"
  | "calc_num"
  | "calc_pct"
  | "calc_mult"
  | "total_num"
  | "note"
  | "year"
  | "input_text"
  | "calc_int"
  | "total_pct"
  | "input_date"
  | "bold"
  | "calc_text"
  | "subtitle"
  | "input_int"
  | "calc_factor";

export interface FormulaValue {
  f: string;
  /** Cached result calculated by the app (omitted when exporting for recalculation checks). */
  v?: number | string | boolean | null;
}

export type CellValue = null | undefined | number | string | boolean | FormulaValue;

export interface CellSpec {
  v: CellValue;
  s?: StyleName;
}

export type Row = Array<CellSpec | CellValue>;

export interface SheetSpec {
  name: string;
  rows: Row[];
  /** Column widths in characters, from column A. */
  cols?: number[];
  /** Freeze panes at this cell (e.g. "B2"). */
  freeze?: string;
}

export interface WorkbookMeta {
  title: string;
  created: Date;
  /** Drop cached formula results (forces recalculation; used by the recalculation check). */
  omitCachedValues?: boolean;
  /** Write every cell unstyled (raw values in text exports; used by the recalculation check). */
  plainStyles?: boolean;
}

const STYLE_ORDER: StyleName[] = ["default", "title", "header", "label", "input_num", "input_pct", "calc_num", "calc_pct", "calc_mult", "total_num", "note", "year", "input_text", "calc_int", "total_pct", "input_date", "bold", "calc_text", "subtitle", "input_int", "calc_factor"];

export function colName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A1 reference from zero-based column and one-based row. */
export function cellRef(col: number, row: number, abs: "" | "col" | "row" | "both" = ""): string {
  const c = colName(col);
  return `${abs === "col" || abs === "both" ? "$" : ""}${c}${abs === "row" || abs === "both" ? "$" : ""}${row}`;
}

export function sheetRef(sheet: string, ref: string): string {
  return `'${sheet.replace(/'/g, "''")}'!${ref}`;
}

/**
 * Sheet names: at most 31 characters, no control characters or []:*?/\, not starting or ending with an
 * apostrophe, not Excel's reserved "History", unique (case-insensitive).
 */
export function safeSheetName(name: string, taken: Set<string>): string {
  const visible = Array.from(name)
    .filter((ch) => (ch.codePointAt(0) as number) >= 0x20 && ch !== "\ufffe" && ch !== "\uffff")
    .join("");
  let base = visible.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31).trim() || "Sheet";
  if (base.toLowerCase() === "history") base = "History (scenario)";
  let out = base;
  let i = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` (${i++})`;
    out = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(out.toLowerCase());
  return out;
}

/** Drops characters that XML 1.0 does not allow (control characters other than tab, LF, CR; U+FFFE/FFFF). */
function stripInvalidXml(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
    out += ch;
  }
  return out;
}

function esc(s: string): string {
  return stripInvalidXml(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isFormula(v: unknown): v is FormulaValue {
  return typeof v === "object" && v !== null && "f" in v;
}

function cellXml(ref: string, cell: CellSpec, omitCached: boolean, plain: boolean): string {
  const s = plain ? 0 : STYLE_ORDER.indexOf(cell.s ?? "default");
  const sAttr = s > 0 ? ` s="${s}"` : "";
  const v = cell.v;
  if (v === null || v === undefined) return s > 0 ? `<c r="${ref}"${sAttr}/>` : "";
  if (isFormula(v)) {
    const f = `<f>${esc(v.f.replace(/^=/, ""))}</f>`;
    const cached = omitCached || v.v === undefined || v.v === null ? null : v.v;
    if (cached === null) return `<c r="${ref}"${sAttr}>${f}</c>`;
    if (typeof cached === "number") return Number.isFinite(cached) ? `<c r="${ref}"${sAttr}>${f}<v>${cached}</v></c>` : `<c r="${ref}"${sAttr}>${f}</c>`;
    if (typeof cached === "boolean") return `<c r="${ref}"${sAttr} t="b">${f}<v>${cached ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${sAttr} t="str">${f}<v>${esc(cached)}</v></c>`;
  }
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${sAttr}><v>${v}</v></c>` : `<c r="${ref}"${sAttr}/>`;
  if (typeof v === "boolean") return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sheet: SheetSpec, omitCached: boolean, plain: boolean): string {
  const rows = sheet.rows
    .map((row, ri) => {
      const cells = row
        .map((c, ci) => {
          const spec: CellSpec = c !== null && typeof c === "object" && !isFormula(c) && "v" in c ? (c as CellSpec) : { v: c as CellValue };
          return cellXml(cellRef(ci, ri + 1), spec, omitCached, plain);
        })
        .join("");
      return cells ? `<row r="${ri + 1}">${cells}</row>` : "";
    })
    .join("");
  const cols = sheet.cols?.length ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  let views = "<sheetViews><sheetView workbookViewId=\"0\"/></sheetViews>";
  if (sheet.freeze) {
    const m = /^([A-Z]+)(\d+)$/.exec(sheet.freeze);
    if (m) {
      const col = (m[1] as string).split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = Number(m[2]) - 1;
      views = `<sheetViews><sheetView workbookViewId="0"><pane${col ? ` xSplit="${col}"` : ""}${row ? ` ySplit="${row}"` : ""} topLeftCell="${sheet.freeze}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="6"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="0.0&quot;x&quot;"/><numFmt numFmtId="167" formatCode="&quot;Year &quot;0"/><numFmt numFmtId="168" formatCode="yyyy-mm-dd"/><numFmt numFmtId="169" formatCode="0.0000"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF1F4E9A"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8C99AE"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF000000"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="21">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="5" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="167" fontId="2" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="5" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="168" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function buildXlsx(sheets: SheetSpec[], meta: WorkbookMeta): Uint8Array {
  const enc = new TextEncoder();
  const taken = new Set<string>();
  for (const s of sheets) {
    if (s.name.length > 31 || /[[\]:*?/\\]/.test(s.name) || taken.has(s.name.toLowerCase())) throw new Error(`Invalid or duplicate sheet name: ${s.name}`);
    taken.add(s.name.toLowerCase());
  }
  const created = meta.created.toISOString().replace(/\.\d{3}Z$/, "Z");
  const files: Array<[string, string]> = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    ],
    [
      "docProps/core.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title)}</dc:title><dc:creator>Finance Desk</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`,
    ],
    ["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Finance Desk</Application></Properties>`],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES_XML],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, Boolean(meta.omitCachedValues), Boolean(meta.plainStyles))]),
  ];
  return zipStored(
    files.map(([name, text]) => ({ name, data: enc.encode(text) })),
    meta.created,
  );
}

/** Excel serial date (1900 system) for a YYYY-MM-DD string; null if invalid. */
export function excelDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? (t - Date.UTC(1899, 11, 30)) / 86_400_000 : null;
}
