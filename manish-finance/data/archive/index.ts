import type { ArchiveSource } from "../../shared/archive/compile";
import type { Brief, Company, Deal, GlossaryTerm, LearningModule, Question, Sector, SourceDocument, TrainingModel } from "../../shared/schemas/research";
import * as figIndia from "./companies/fig-india";
import * as globalCompanies from "./companies/global";
import * as indiaCompanies from "./companies/india";
import { trainingModels } from "../training/models";
import * as briefModule from "./briefs";
import * as apac from "./deals/apac";
import * as global from "./deals/global";
import * as hdfc from "./deals/hdfc-hdfc-bank";
import * as indiaAutopsies from "./deals/india-autopsies";
import * as indiaDeals from "./deals/india-deals";
import * as indiaFig from "./deals/india-fig";
import { glossary } from "./learning/glossary";
import { modules } from "./learning/modules";
import { questions } from "./learning/questions";
import * as sectorDocs from "./sectors/docs";
import { fig } from "./sectors/fig";
import { PRIMERS } from "./sectors/primers";
import { businessServices, energyInfra, industrials, realEstate } from "./sectors/ind-energy-bs-re";
import { consumer, healthcare, tmt } from "./sectors/tmt-healthcare-consumer";

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
const COMPANY_MODULES: CompanyModule[] = [figIndia, indiaCompanies, globalCompanies];

export function loadArchiveSource(): ArchiveSource {
  const documents: SourceDocument[] = [...DEAL_MODULES.flatMap((m) => m.documents), ...COMPANY_MODULES.flatMap((m) => m.documents), ...sectorDocs.documents, ...briefModule.documents];
  const deals = DEAL_MODULES.flatMap((m) => [...(m.deal ? [m.deal] : []), ...(m.deals ?? [])]) as Deal[];
  const companies = COMPANY_MODULES.flatMap((m) => m.companies) as Company[];
  return {
    cutoff: ARCHIVE_CUTOFF,
    documents,
    deals,
    companies,
    sectors: [fig, tmt, healthcare, consumer, industrials, energyInfra, businessServices, realEstate].map((s) => ({ ...s, primer: PRIMERS[s.slug] ?? null })) as Sector[],
    glossary: glossary as GlossaryTerm[],
    modules: modules as LearningModule[],
    questions: questions as Question[],
    briefs: briefModule.briefs as Brief[],
    training: trainingModels as TrainingModel[],
  };
}
