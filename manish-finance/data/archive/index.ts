import type { ArchiveSource } from "../../shared/archive/compile";
import type { Brief, Company, Deal, GlossaryTerm, LearningModule, Question, Sector, SourceDocument, TrainingModel } from "../../shared/schemas/research";
import * as figIndia from "./companies/fig-india";
import * as apac from "./deals/apac";
import * as global from "./deals/global";
import * as hdfc from "./deals/hdfc-hdfc-bank";
import * as indiaAutopsies from "./deals/india-autopsies";
import * as indiaDeals from "./deals/india-deals";
import * as indiaFig from "./deals/india-fig";

/**
 * Research archive entry point. Content modules are registered here; `npm run verify:content`
 * validates every record and `npm run build` compiles it into the Worker module.
 * Values are validated with zod at build time, so modules can use input (pre-default) shapes.
 */

export const ARCHIVE_CUTOFF = "2026-09-25";

interface DealModule {
  documents: SourceDocument[];
  deal?: unknown;
  deals?: unknown[];
}

interface CompanyModule {
  documents: SourceDocument[];
  companies: unknown[];
}

const DEAL_MODULES: DealModule[] = [hdfc, indiaFig, indiaAutopsies, indiaDeals, apac, global];
const COMPANY_MODULES: CompanyModule[] = [figIndia];

export function loadArchiveSource(): ArchiveSource {
  const documents: SourceDocument[] = [...DEAL_MODULES.flatMap((m) => m.documents), ...COMPANY_MODULES.flatMap((m) => m.documents)];
  const deals = DEAL_MODULES.flatMap((m) => [...(m.deal ? [m.deal] : []), ...(m.deals ?? [])]) as Deal[];
  const companies = COMPANY_MODULES.flatMap((m) => m.companies) as Company[];
  return {
    cutoff: ARCHIVE_CUTOFF,
    documents,
    deals,
    companies,
    sectors: [] as Sector[],
    glossary: [] as GlossaryTerm[],
    modules: [] as LearningModule[],
    questions: [] as Question[],
    briefs: [] as Brief[],
    training: [] as TrainingModel[],
  };
}
