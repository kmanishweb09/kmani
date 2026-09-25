/**
 * Build-time archive compiler: validates authored content with the shared zod schemas, compiles
 * citations into claim records and computes content statistics. Bundled and run by scripts/build.mjs
 * and scripts/verify-content.mjs.
 */
import { loadArchiveSource } from "../../data/archive/index";
import { type ArchiveSource, compileArchive, findUnresolvedReferences } from "../../shared/archive/compile";
import { zBrief, zCompany, zDeal, zGlossaryTerm, zModule, zPeerSet, zQuestion, zSector, zSourceDocument, zTrainingModel } from "../../shared/schemas/research";
import type { ZodType } from "zod";

export interface ValidationIssue {
  collection: string;
  id: string;
  path: string;
  message: string;
}

function validateAll<T>(collection: string, items: unknown[], schema: ZodType<T>, idOf: (x: Record<string, unknown>) => string, issues: ValidationIssue[]): T[] {
  const out: T[] = [];
  for (const raw of items) {
    const r = schema.safeParse(raw);
    const id = idOf((raw ?? {}) as Record<string, unknown>);
    if (!r.success) {
      for (const i of r.error.issues) issues.push({ collection, id, path: i.path.map(String).join("."), message: i.message });
    } else {
      out.push(r.data);
    }
  }
  return out;
}

export function buildArchive() {
  const src = loadArchiveSource();
  const issues: ValidationIssue[] = [];
  const idOf = (x: Record<string, unknown>) => String(x.id ?? x.slug ?? "?");
  const parsed: ArchiveSource = {
    cutoff: src.cutoff,
    documents: validateAll("documents", src.documents, zSourceDocument, idOf, issues),
    deals: validateAll("deals", src.deals, zDeal, idOf, issues),
    companies: validateAll("companies", src.companies, zCompany, idOf, issues),
    sectors: validateAll("sectors", src.sectors, zSector, idOf, issues),
    glossary: validateAll("glossary", src.glossary, zGlossaryTerm, idOf, issues),
    modules: validateAll("modules", src.modules, zModule, idOf, issues),
    questions: validateAll("questions", src.questions, zQuestion, idOf, issues),
    briefs: validateAll("briefs", src.briefs, zBrief, idOf, issues),
    training: validateAll("training", src.training, zTrainingModel, idOf, issues),
    peerSets: validateAll("peerSets", src.peerSets, zPeerSet, idOf, issues),
  };
  let compiled = null;
  let compileError: string | null = null;
  try {
    compiled = compileArchive(parsed);
  } catch (e) {
    compileError = e instanceof Error ? e.message : String(e);
  }
  // Unresolved cross-references are dropped at compile time (never rendered as broken links); report them.
  const unresolved = findUnresolvedReferences(parsed);
  return { source: parsed, compiled, issues, compileError, unresolved };
}
