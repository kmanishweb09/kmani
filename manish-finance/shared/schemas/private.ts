import * as z from "zod";
import { CARD_TYPES, SECTOR_SLUGS } from "../labels";
import { zSectorSlug } from "./research";

/** Schemas for owner-only records. Validated on every write; user IDs never come from request bodies. */

export const zPrivateId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "record id");
export const zEntityRef = z.object({
  type: z.enum(["deal", "company", "sector", "brief", "module", "glossary", "note"]),
  id: z.string().min(1).max(100),
});
export type EntityRef = z.infer<typeof zEntityRef>;

export const NOTE_TEMPLATES = ["blank", "deal_note", "sector_thesis", "company_note", "weekly_reflection", "deal_view", "research_question"] as const;
export const zNoteTemplate = z.enum(NOTE_TEMPLATES);

export const zNoteCreate = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(100_000).default(""),
  template: zNoteTemplate.default("blank"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  links: z.array(zEntityRef).max(50).default([]),
  evidenceIds: z.array(z.string().max(120)).max(100).default([]),
});
export type NoteCreate = z.infer<typeof zNoteCreate>;

export const zNotePatch = zNoteCreate.partial().extend({
  revision: z.number().int().min(1),
  archived: z.boolean().optional(),
});
export type NotePatch = z.infer<typeof zNotePatch>;

export interface Note {
  id: string;
  title: string;
  body: string;
  template: z.infer<typeof zNoteTemplate>;
  tags: string[];
  links: EntityRef[];
  evidenceIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export const zWatchCreate = z.object({
  kind: z.enum(["deal", "company", "sector"]),
  entityId: z.string().min(1).max(100),
});
export interface Watch {
  id: string;
  kind: "deal" | "company" | "sector";
  entityId: string;
  createdAt: string;
  lastViewedAt: string | null;
  watermark: string | null;
}

/** Public deal filters (safe to put in URLs and saved searches). */
export const zDealFilters = z.object({
  q: z.string().max(120).optional(),
  sector: z.array(zSectorSlug).max(8).optional(),
  subsector: z.array(z.string().max(80)).max(20).optional(),
  geo: z.enum(["india", "apac", "global"]).optional(),
  geoMode: z.enum(["target", "acquirer", "either"]).optional(),
  buyerType: z.array(z.string().max(40)).max(10).optional(),
  dealType: z.array(z.string().max(40)).max(10).optional(),
  status: z.array(z.string().max(40)).max(10).optional(),
  payment: z.array(z.string().max(40)).max(10).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  crossBorder: z.enum(["yes", "no"]).optional(),
  value: z.enum(["disclosed", "undisclosed"]).optional(),
  autopsy: z.enum(["yes"]).optional(),
});
export type DealFilters = z.infer<typeof zDealFilters>;

export const zSavedSearchCreate = z.object({
  name: z.string().trim().min(1).max(120),
  filters: zDealFilters,
});
export interface SavedSearch {
  id: string;
  name: string;
  filters: DealFilters;
  createdAt: string;
  lastViewedAt: string | null;
  watermark: string | null;
}

export const MODEL_TYPES = ["dcf", "accretion", "fig_residual_income", "comparables", "ev_bridge"] as const;
export const zModelCreate = z.object({
  modelType: z.enum(MODEL_TYPES),
  title: z.string().trim().min(1).max(160),
  calcVersion: z.string().max(40),
  sourceSnapshot: z.object({
    kind: z.enum(["training", "deal", "company", "user"]),
    refId: z.string().max(100).nullable(),
    archiveVersion: z.string().max(80),
    reported: z.record(z.string(), z.unknown()).default({}),
  }),
  assumptions: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  scenarios: z.array(z.object({ name: z.string().max(80), assumptions: z.record(z.string(), z.unknown()) })).max(8).default([]),
});
export const zModelPatch = zModelCreate.partial().extend({ revision: z.number().int().min(1) });
export interface SavedModel {
  id: string;
  modelType: (typeof MODEL_TYPES)[number];
  title: string;
  calcVersion: string;
  sourceSnapshot: z.infer<typeof zModelCreate>["sourceSnapshot"];
  assumptions: Record<string, unknown>;
  outputs: Record<string, unknown>;
  scenarios: Array<{ name: string; assumptions: Record<string, unknown> }>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export const zCardType = z.enum(CARD_TYPES);

export const zMemoryCardInput = z.object({
  cardType: zCardType,
  prompt: z.string().trim().min(3).max(500),
  answer: z.string().trim().min(1).max(4000),
  sourceRefs: z.array(z.object({ kind: z.enum(["claim", "note", "glossary", "module"]), id: z.string().max(120) })).min(1).max(20),
});

export const zMemoryUpsert = z.object({
  subject: z.object({ type: z.enum(["deal", "concept"]), id: z.string().min(1).max(100) }),
  cards: z.array(zMemoryCardInput).min(1).max(10),
});

export interface MemoryCard {
  id: string;
  recordId: string;
  cardType: (typeof CARD_TYPES)[number];
  prompt: string;
  answer: string;
  sourceRefs: Array<{ kind: "claim" | "note" | "glossary" | "module"; id: string }>;
  sourceVersion: string;
  stage: number;
  dueDate: string;
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  subjectType: "deal" | "concept";
  subjectId: string;
  sourceVersion: string;
  createdAt: string;
  updatedAt: string;
  cards: MemoryCard[];
  updateAvailable?: { currentVersion: string; reason: string } | null;
}

export const zReviewSubmit = z.object({
  cardId: zPrivateId,
  rating: z.enum(["again", "hard", "good", "easy"]),
});

export const zPreferences = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  geography: z.enum(["india", "apac", "global"]).default("india"),
  geoMode: z.enum(["target", "acquirer", "either"]).default("either"),
  followedSectors: z.array(zSectorSlug).max(8).default([]),
  highlightSector: zSectorSlug.default("fig"),
  sectorPickerDismissed: z.boolean().default(false),
  displayCurrency: z.enum(["original", "INR", "USD"]).default("original"),
  inrNumberSystem: z.enum(["indian", "international"]).default("indian"),
  timezone: z.string().max(64).default("Asia/Kolkata"),
  newsWindowDays: z.number().int().min(1).max(31).default(7),
  dealColumns: z.array(z.string().max(40)).max(20).default([]),
  sidebarCollapsed: z.boolean().default(false),
});
export type Preferences = z.infer<typeof zPreferences>;
export const zPreferencesPatch = zPreferences.partial().extend({ revision: z.number().int().min(0).optional() });

export const zProgressUpdate = z.object({
  itemType: z.enum(["module", "question"]),
  itemId: z.string().min(1).max(100),
  status: z.enum(["started", "completed", "answered"]),
  answer: z.union([z.string().max(4000), z.number()]).nullish(),
  correct: z.boolean().nullish(),
});

export const zInterviewAttempt = z.object({
  promptId: z.string().min(1).max(100),
  subject: zEntityRef.nullish(),
  response: z.string().max(20_000),
  durationSec: z.number().int().min(0).max(7200),
  selfRubric: z.record(z.string(), z.number().int().min(0).max(3)).default({}),
  reflection: z.string().max(4000).default(""),
});

export const EXPORT_FORMAT = "manish-finance-export";
export const EXPORT_VERSION = 1;

export const zExportBundle = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  archiveVersion: z.string().optional(),
  notes: z
    .array(
      zNoteCreate.extend({
        id: zPrivateId,
        revision: z.number().int().min(1),
        createdAt: z.string(),
        updatedAt: z.string(),
        archivedAt: z.string().nullable(),
      }),
    )
    .default([]),
  watches: z.array(zWatchCreate.extend({ id: zPrivateId, createdAt: z.string(), lastViewedAt: z.string().nullable(), watermark: z.string().nullable() })).default([]),
  savedSearches: z.array(zSavedSearchCreate.extend({ id: zPrivateId, createdAt: z.string(), lastViewedAt: z.string().nullable(), watermark: z.string().nullable() })).default([]),
  models: z.array(zModelCreate.extend({ id: zPrivateId, revision: z.number().int().min(1), createdAt: z.string(), updatedAt: z.string() })).default([]),
  memory: z
    .object({
      records: z.array(z.object({ id: zPrivateId, subjectType: z.enum(["deal", "concept"]), subjectId: z.string(), sourceVersion: z.string(), createdAt: z.string(), updatedAt: z.string() })).default([]),
      cards: z
        .array(
          zMemoryCardInput.extend({
            id: zPrivateId,
            recordId: zPrivateId,
            sourceVersion: z.string(),
            stage: z.number().int().min(-1).max(5),
            dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            suspended: z.boolean().default(false),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        )
        .default([]),
      reviewLog: z
        .array(
          z.object({
            id: zPrivateId,
            cardId: zPrivateId,
            reviewedAt: z.string(),
            reviewDate: z.string(),
            rating: z.enum(["again", "hard", "good", "easy"]),
            stageBefore: z.number().int(),
            stageAfter: z.number().int(),
            dueBefore: z.string(),
            dueAfter: z.string(),
            schedulerVersion: z.string(),
          }),
        )
        .default([]),
    })
    .default({ records: [], cards: [], reviewLog: [] }),
  preferences: zPreferences.partial().nullable().default(null),
  progress: z.array(zProgressUpdate.extend({ updatedAt: z.string() })).default([]),
  interviewAttempts: z.array(zInterviewAttempt.extend({ id: zPrivateId, createdAt: z.string() })).default([]),
});
export type ExportBundle = z.infer<typeof zExportBundle>;

export const zImportCommit = z.object({
  previewId: zPrivateId,
  /** Per-record decisions for conflicts; unspecified conflicts are skipped (never overwritten). */
  decisions: z.record(z.string().max(200), z.enum(["skip", "import_as_copy", "replace"])).default({}),
});

export const ALL_SECTORS = SECTOR_SLUGS;
