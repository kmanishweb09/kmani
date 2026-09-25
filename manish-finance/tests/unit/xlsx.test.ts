import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { afterAll, describe, expect, it } from "vitest";
import { unzipStored } from "../../shared/xlsx/zip";
import { type LabModel, labWorkbook } from "../../src/lib/labWorkbook";
import { accretionBase } from "../../src/pages/lab/AccretionTab";
import { compsBase } from "../../src/pages/lab/ComparablesTab";
import { dcfBase } from "../../src/pages/lab/DcfTab";
import { figBase } from "../../src/pages/lab/FigTab";

// Formula-based Lab workbooks. Structure is always checked; when LibreOffice Calc is installed, each
// workbook is also recalculated from its formulas alone (cached values stripped) and every formula cell
// is compared with the value the app's own calculation produced.

const EXPORTED = new Date("2026-09-25T12:00:00Z");

function scenariosFor(model: LabModel): Array<{ name: string; assumptions: unknown }> {
  if (model === "dcf") {
    const b = dcfBase();
    return [
      { name: "Base case", assumptions: b },
      { name: "Direct FCFF and WACC", assumptions: { ...b, mode: "direct", waccMode: "direct", directWacc: 0.11, directFcff: [120, 130, 140, 150, 160], dilutedShares: 40 } },
      { name: "WACC below growth", assumptions: { ...b, waccMode: "direct", directWacc: 0.04 } },
    ];
  }
  if (model === "accretion") {
    const b = accretionBase();
    return [
      { name: "Base case", assumptions: b },
      { name: "All stock, not deductible", assumptions: { ...b, fundingCash: 0, fundingDebt: 0, fundingStock: 1800, adjustmentsDeductible: false } },
      { name: "Loss-making buyer", assumptions: { ...b, buyerNetIncome: -50, stockIssuePrice: 85, adjustmentTaxRate: 0.3 } },
    ];
  }
  if (model === "fig") {
    const b = figBase();
    return [
      { name: "Base case", assumptions: b },
      { name: "Direct NI, growth above Ke", assumptions: { ...b, riMode: "direct", directYears: [{ netIncome: 15, distributions: 5, capitalChanges: 0 }, { netIncome: 18, distributions: 6, capitalChanges: 10 }, { netIncome: 20, distributions: 8, capitalChanges: 0 }], justifiedGrowth: 0.2 } },
    ];
  }
  const b = compsBase();
  return [
    { name: "Base case", assumptions: b },
    {
      name: "Exclusions and edge cases",
      assumptions: {
        ...b,
        peers: b.peers.map((p, i) => (i === 0 ? { ...p, include: false, excludeReason: "Different business model" } : i === 1 ? { ...p, ebitda: -5 } : i === 2 ? { ...p, netDebt: null } : p)),
        bridge: { ...b.bridge, disclosedEv: 1300 },
        premium: { ...b.premium, refDate: "2026-07-02" },
        minority: { consideration: 500, stakePct: 20, structure: "primary" },
      },
    },
  ];
}

const MODELS: LabModel[] = ["dcf", "accretion", "fig", "comparables"];

describe("Lab XLSX export: file structure", () => {
  for (const model of MODELS) {
    it(`${model}: valid package, well-formed XML, one sheet per scenario plus Summary and About`, () => {
      const scen = scenariosFor(model);
      const wb = labWorkbook(model, scen, { exported: EXPORTED });
      const parts = unzipStored(wb.bytes);
      const names = parts.map((p) => p.name);
      expect(names).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "docProps/core.xml"]));
      for (const p of parts) expect(XMLValidator.validate(new TextDecoder().decode(p.data)), p.name).toBe(true);
      expect(wb.sheetNames).toEqual(["Summary", ...scen.map((s) => s.name), "About"]);
      const sheetXml = parts.filter((p) => p.name.startsWith("xl/worksheets/")).map((p) => new TextDecoder().decode(p.data)).join("");
      const formulas = [...sheetXml.matchAll(/<f>([^<]*)<\/f>/g)].map((m) => m[1] as string);
      expect(formulas.length).toBeGreaterThan(20);
      expect(formulas.some((f) => f.startsWith("="))).toBe(false);
      // Post-2007 functions carry their file-format prefix (Excel shows QUARTILE.INC).
      if (model === "comparables") expect(formulas.some((f) => f.includes("_xlfn.QUARTILE.INC("))).toBe(true);
      expect(new TextDecoder().decode(parts.find((p) => p.name === "xl/workbook.xml")?.data)).toContain('fullCalcOnLoad="1"');
      expect(wb.fileName).toBe(`finance-lab-${model}-2026-09-25.xlsx`);
    });
  }
});

describe("Lab XLSX export: names and text are escaped", () => {
  it("sanitises sheet names, keeps them unique and escapes XML in text", () => {
    const b = dcfBase();
    const wb = labWorkbook("dcf", [
      { name: 'Bull & bear <x> "q"\u0001', assumptions: b },
      { name: "Bull & bear <x> \"q\"", assumptions: b },
      { name: "Case: 1/2 [draft]?", assumptions: b },
    ], { exported: EXPORTED });
    expect(wb.sheetNames.slice(1, 4)).toEqual(['Bull & bear <x> "q"', 'Bull & bear <x> "q" (2)', "Case 1 2 draft"]);
    for (const p of unzipStored(wb.bytes)) expect(XMLValidator.validate(new TextDecoder().decode(p.data)), p.name).toBe(true);
    const summary = new TextDecoder().decode(unzipStored(wb.bytes).find((p) => p.name === "xl/worksheets/sheet1.xml")?.data);
    expect(summary).toContain("Bull &amp; bear &lt;x&gt;");
    expect(summary).toContain("<f>'Bull &amp; bear &lt;x&gt; &quot;q&quot; (2)'!");
  });
});

// ---------------------------------------------------------------- recalculation in LibreOffice

const work = mkdtempSync(join(tmpdir(), "finance-xlsx-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function calcAvailable(): boolean {
  const probe = join(work, "probe.csv");
  writeFileSync(probe, "a,b\n1,2\n");
  const r = spawnSync("soffice", ["--headless", `-env:UserInstallation=file://${work}/profile`, "--convert-to", "xlsx", "--outdir", join(work, "probe"), probe], { timeout: 120_000, encoding: "utf8", env: { ...process.env, HOME: work } });
  return r.status === 0 && existsSync(join(work, "probe", "probe.xlsx"));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function refToIndex(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref) as RegExpExecArray;
  const c = (m[1] as string).split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { r: Number(m[2]) - 1, c };
}

const HAVE_CALC = calcAvailable();

describe.skipIf(!HAVE_CALC)("Lab XLSX export: formulas recalculated by LibreOffice match the app", () => {
  const books = MODELS.map((model) => ({ model, wb: labWorkbook(model, scenariosFor(model), { exported: EXPORTED, omitCachedValues: true, plainStyles: true }) }));
  const out = join(work, "csv");
  const files = books.map((b) => {
    const f = join(work, `${b.model}.xlsx`);
    writeFileSync(f, b.wb.bytes);
    return f;
  });
  const conv = spawnSync("soffice", ["--headless", `-env:UserInstallation=file://${work}/profile`, "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,1033,false,true,false,false,false,-1", "--outdir", out, ...files], { timeout: 240_000, encoding: "utf8", env: { ...process.env, HOME: work } });

  for (const { model, wb } of books) {
    it(`${model}: every formula check (${wb.checks.length}) matches the app's calculation`, () => {
      expect(conv.status, conv.stderr).toBe(0);
      const produced = readdirSync(out).filter((f) => f.startsWith(`${model}-`));
      expect(produced.length).toBe(wb.sheetNames.length);
      const grids = new Map(wb.sheetNames.map((s) => [s, parseCsv(readFileSync(join(out, `${model}-${s}.csv`), "utf8"))]));
      // No spreadsheet errors anywhere (#NAME?, #VALUE!, Err:5xx…).
      for (const [s, g] of grids) for (const r of g) for (const c of r) expect(c, `${s}`).not.toMatch(/^(#[A-Z/0!?]+|Err:\d+)/);
      const failures: string[] = [];
      for (const chk of wb.checks) {
        const { r, c } = refToIndex(chk.ref);
        const got = grids.get(chk.sheet)?.[r]?.[c] ?? "";
        if (typeof chk.expected === "number") {
          const n = Number(got);
          const tol = 1e-9 * Math.max(1, Math.abs(chk.expected));
          if (got === "" || !Number.isFinite(n) || Math.abs(n - chk.expected) > tol) failures.push(`${chk.sheet}!${chk.ref} ${chk.label}: expected ${chk.expected}, spreadsheet ${got}`);
        } else if (got !== chk.expected) failures.push(`${chk.sheet}!${chk.ref} ${chk.label}: expected “${chk.expected}”, spreadsheet “${got}”`);
      }
      expect(failures).toEqual([]);
      expect(wb.checks.length).toBeGreaterThan(20);
    });
  }
});

describe("Lab XLSX export: recalculation environment", () => {
  it("reports whether the LibreOffice recalculation check ran", () => {
    // Informational: the recalculation suite above is skipped (not failed) where LibreOffice Calc is absent.
    expect(typeof HAVE_CALC).toBe("boolean");
  });
});
