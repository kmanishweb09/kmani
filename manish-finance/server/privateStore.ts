import type { EntityRef, MemoryCard, MemoryRecord, Note, SavedModel, SavedSearch } from "../shared/schemas/private";
import { parseJsonColumn } from "./db";

/** Row → API object mappers for private tables. */

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  template: string;
  tags_json: string;
  links_json: string;
  evidence_json: string;
  link_key: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export function noteFromRow(r: NoteRow): Note {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    template: r.template as Note["template"],
    tags: parseJsonColumn<string[]>(r.tags_json, []),
    links: parseJsonColumn<EntityRef[]>(r.links_json, []),
    evidenceIds: parseJsonColumn<string[]>(r.evidence_json, []),
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

export interface WatchRow {
  id: string;
  user_id: string;
  kind: string;
  entity_id: string;
  created_at: string;
  last_viewed_at: string | null;
  watermark: string | null;
  saved: number;
  following: number;
}

export interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string;
  filters_json: string;
  created_at: string;
  last_viewed_at: string | null;
  watermark: string | null;
}

export function savedSearchFromRow(r: SavedSearchRow): SavedSearch {
  return { id: r.id, name: r.name, filters: parseJsonColumn(r.filters_json, {}), createdAt: r.created_at, lastViewedAt: r.last_viewed_at, watermark: r.watermark };
}

export interface ModelRow {
  id: string;
  user_id: string;
  model_type: string;
  title: string;
  calc_version: string;
  source_json: string;
  assumptions_json: string;
  outputs_json: string;
  scenarios_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export function modelFromRow(r: ModelRow): SavedModel {
  return {
    id: r.id,
    modelType: r.model_type as SavedModel["modelType"],
    title: r.title,
    calcVersion: r.calc_version,
    sourceSnapshot: parseJsonColumn(r.source_json, { kind: "user", refId: null, archiveVersion: "", reported: {} }),
    assumptions: parseJsonColumn(r.assumptions_json, {}),
    outputs: parseJsonColumn(r.outputs_json, {}),
    scenarios: parseJsonColumn(r.scenarios_json, []),
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface MemoryRecordRow {
  id: string;
  user_id: string;
  subject_type: string;
  subject_id: string;
  source_version: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryCardRow {
  id: string;
  user_id: string;
  record_id: string;
  card_type: string;
  prompt: string;
  answer: string;
  source_refs_json: string;
  source_version: string;
  stage: number;
  due_date: string;
  suspended: number;
  created_at: string;
  updated_at: string;
}

export function cardFromRow(r: MemoryCardRow): MemoryCard {
  return {
    id: r.id,
    recordId: r.record_id,
    cardType: r.card_type as MemoryCard["cardType"],
    prompt: r.prompt,
    answer: r.answer,
    sourceRefs: parseJsonColumn(r.source_refs_json, []),
    sourceVersion: r.source_version,
    stage: r.stage,
    dueDate: r.due_date,
    suspended: Boolean(r.suspended),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function recordFromRows(r: MemoryRecordRow, cards: MemoryCardRow[]): MemoryRecord {
  return {
    id: r.id,
    subjectType: r.subject_type as MemoryRecord["subjectType"],
    subjectId: r.subject_id,
    sourceVersion: r.source_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cards: cards.filter((c) => c.record_id === r.id).map(cardFromRow),
  };
}
