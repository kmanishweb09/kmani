import type { ArchiveSource } from "../../shared/archive/compile";

/**
 * Research archive entry point. Content modules are registered here; `npm run verify:content`
 * validates every record and `npm run build` compiles it into the Worker module.
 */

export const ARCHIVE_CUTOFF = "2026-09-25";

export function loadArchiveSource(): ArchiveSource {
  return {
    cutoff: ARCHIVE_CUTOFF,
    documents: [],
    deals: [],
    companies: [],
    sectors: [],
    glossary: [],
    modules: [],
    questions: [],
    briefs: [],
    training: [],
  };
}
