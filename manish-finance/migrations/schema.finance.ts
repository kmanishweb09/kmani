/**
 * Drizzle (sqlite-core) mirror of migrations/0001_finance_init.sql and 0002_finance_research_drafts.sql for hosts that manage D1 with
 * Drizzle (kmanish.live keeps its schema in db/schema.ts). Merge these exports into the host schema;
 * tests/unit/migration.test.ts checks this file against the SQL so the two cannot drift.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const financeMeta = sqliteTable(
  "finance_meta",
  {
    key: text("key").primaryKey().notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const financeSourceState = sqliteTable(
  "finance_source_state",
  {
    sourceId: text("source_id").primaryKey().notNull(),
    enabled: integer("enabled").notNull().default(1),
    configJson: text("config_json"),
    lastAttemptAt: text("last_attempt_at"),
    lastSuccessAt: text("last_success_at"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    lastHttpStatus: integer("last_http_status"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    nextAllowedAt: text("next_allowed_at"),
    lastItemCount: integer("last_item_count"),
    liveVerifiedAt: text("live_verified_at"),
    updatedAt: text("updated_at").notNull(),
  },
);

export const financeSourceDocuments = sqliteTable(
  "finance_source_documents",
  {
    id: text("id").primaryKey().notNull(),
    sourceId: text("source_id").notNull(),
    providerItemId: text("provider_item_id"),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    publishedAt: text("published_at"),
    publishedDate: text("published_date"),
    retrievedAt: text("retrieved_at").notNull(),
    contentHash: text("content_hash").notNull(),
    excerpt: text("excerpt"),
    locator: text("locator"),
    version: integer("version").notNull().default(1),
    dedupeKey: text("dedupe_key").notNull().unique(),
    publisher: text("publisher"),
    documentType: text("document_type"),
  },
  (t) => [
    index("finance_source_documents_source_idx").on(t.sourceId, t.retrievedAt),
    index("finance_source_documents_url_idx").on(t.canonicalUrl),
  ],
);

export const financeFeedItems = sqliteTable(
  "finance_feed_items",
  {
    id: text("id").primaryKey().notNull(),
    documentId: text("document_id").notNull(),
    sourceId: text("source_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    eventType: text("event_type").notNull(),
    eventDate: text("event_date"),
    publishedAt: text("published_at"),
    publishedDate: text("published_date"),
    discoveredAt: text("discovered_at").notNull(),
    sectorsJson: text("sectors_json").notNull().default("[]"),
    entitiesJson: text("entities_json").notNull().default("[]"),
    verification: text("verification").notNull().default("lead"),
    newlyDiscovered: integer("newly_discovered").notNull().default(0),
    clusterKey: text("cluster_key").notNull(),
    excerpt: text("excerpt"),
  },
  (t) => [
    uniqueIndex("finance_feed_items_document_idx").on(t.documentId),
    index("finance_feed_items_discovered_idx").on(t.discoveredAt),
    index("finance_feed_items_event_idx").on(t.eventDate),
    index("finance_feed_items_cluster_idx").on(t.clusterKey),
  ],
);

export const financeReviewQueue = sqliteTable(
  "finance_review_queue",
  {
    id: text("id").primaryKey().notNull(),
    kind: text("kind").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    field: text("field"),
    proposalJson: text("proposal_json").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("pending"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
  },
  (t) => [
    index("finance_review_queue_status_idx").on(t.status, t.createdAt),
  ],
);

export const financePublishedChanges = sqliteTable(
  "finance_published_changes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    changeType: text("change_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    note: text("note"),
    reviewItemId: text("review_item_id"),
    publishedAt: text("published_at").notNull(),
  },
  (t) => [
    index("finance_published_changes_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const financeBriefs = sqliteTable(
  "finance_briefs",
  {
    id: text("id").primaryKey().notNull(),
    scope: text("scope").notNull(),
    userKey: text("user_key").notNull().default(""),
    kind: text("kind").notNull(),
    briefDate: text("brief_date").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    cutoffAt: text("cutoff_at").notNull(),
    generatedAt: text("generated_at").notNull(),
    method: text("method").notNull(),
    provider: text("provider"),
    model: text("model"),
    contentJson: text("content_json").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    inputVersion: text("input_version").notNull(),
    version: integer("version").notNull().default(1),
    supersedesId: text("supersedes_id"),
    correctionNote: text("correction_note"),
    status: text("status").notNull().default("published"),
  },
  (t) => [
    uniqueIndex("finance_briefs_slot_idx").on(t.scope, t.userKey, t.kind, t.briefDate, t.version),
    index("finance_briefs_date_idx").on(t.scope, t.userKey, t.briefDate),
  ],
);

export const financeJobs = sqliteTable(
  "finance_jobs",
  {
    id: text("id").primaryKey().notNull(),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    requestedBy: text("requested_by").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    attempts: integer("attempts").notNull().default(1),
    resultJson: text("result_json"),
    error: text("error"),
  },
  (t) => [
    index("finance_jobs_type_idx").on(t.jobType, t.startedAt),
  ],
);

export const financeLeases = sqliteTable(
  "finance_leases",
  {
    name: text("name").primaryKey().notNull(),
    holder: text("holder").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
);

export const financeNotes = sqliteTable(
  "finance_notes",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    template: text("template").notNull(),
    tagsJson: text("tags_json").notNull().default("[]"),
    linksJson: text("links_json").notNull().default("[]"),
    evidenceJson: text("evidence_json").notNull().default("[]"),
    linkKey: text("link_key"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("finance_notes_user_idx").on(t.userId, t.updatedAt),
    uniqueIndex("finance_notes_view_idx").on(t.userId, t.template, t.linkKey).where(sql`link_key IS NOT NULL`),
  ],
);

export const financeNoteLinks = sqliteTable(
  "finance_note_links",
  {
    noteId: text("note_id").notNull(),
    userId: text("user_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.entityType, t.entityId] }),
    index("finance_note_links_entity_idx").on(t.userId, t.entityType, t.entityId),
  ],
);

export const financeWatches = sqliteTable(
  "finance_watches",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    saved: integer("saved").notNull().default(0),
    following: integer("following").notNull().default(0),
    createdAt: text("created_at").notNull(),
    lastViewedAt: text("last_viewed_at"),
    watermark: text("watermark"),
  },
  (t) => [
    uniqueIndex("finance_watches_entity_idx").on(t.userId, t.kind, t.entityId),
  ],
);

export const financeSavedSearches = sqliteTable(
  "finance_saved_searches",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    filtersJson: text("filters_json").notNull(),
    createdAt: text("created_at").notNull(),
    lastViewedAt: text("last_viewed_at"),
    watermark: text("watermark"),
  },
  (t) => [
    index("finance_saved_searches_user_idx").on(t.userId),
  ],
);

export const financeModels = sqliteTable(
  "finance_models",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    modelType: text("model_type").notNull(),
    title: text("title").notNull(),
    calcVersion: text("calc_version").notNull(),
    sourceJson: text("source_json").notNull(),
    assumptionsJson: text("assumptions_json").notNull(),
    outputsJson: text("outputs_json").notNull(),
    scenariosJson: text("scenarios_json").notNull().default("[]"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("finance_models_user_idx").on(t.userId, t.updatedAt),
  ],
);

export const financeMemoryRecords = sqliteTable(
  "finance_memory_records",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    sourceVersion: text("source_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("finance_memory_records_subject_idx").on(t.userId, t.subjectType, t.subjectId),
  ],
);

export const financeMemoryCards = sqliteTable(
  "finance_memory_cards",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    recordId: text("record_id").notNull(),
    cardType: text("card_type").notNull(),
    prompt: text("prompt").notNull(),
    answer: text("answer").notNull(),
    sourceRefsJson: text("source_refs_json").notNull(),
    sourceVersion: text("source_version").notNull(),
    stage: integer("stage").notNull().default(-1),
    dueDate: text("due_date").notNull(),
    suspended: integer("suspended").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("finance_memory_cards_type_idx").on(t.recordId, t.cardType),
    index("finance_memory_cards_due_idx").on(t.userId, t.dueDate),
  ],
);

export const financeReviewLog = sqliteTable(
  "finance_review_log",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    cardId: text("card_id").notNull(),
    reviewedAt: text("reviewed_at").notNull(),
    reviewDate: text("review_date").notNull(),
    rating: text("rating").notNull(),
    stageBefore: integer("stage_before").notNull(),
    stageAfter: integer("stage_after").notNull(),
    dueBefore: text("due_before").notNull(),
    dueAfter: text("due_after").notNull(),
    schedulerVersion: text("scheduler_version").notNull(),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("finance_review_log_card_idx").on(t.userId, t.cardId, t.reviewedAt),
    uniqueIndex("finance_review_log_idem_idx").on(t.userId, t.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
  ],
);

export const financePreferences = sqliteTable(
  "finance_preferences",
  {
    userId: text("user_id").primaryKey().notNull(),
    prefsJson: text("prefs_json").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
);

export const financeProgress = sqliteTable(
  "finance_progress",
  {
    userId: text("user_id").notNull(),
    itemType: text("item_type").notNull(),
    itemId: text("item_id").notNull(),
    status: text("status").notNull(),
    answerJson: text("answer_json"),
    correct: integer("correct"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemType, t.itemId] }),
  ],
);

export const financeInterviewAttempts = sqliteTable(
  "finance_interview_attempts",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    promptId: text("prompt_id").notNull(),
    subjectJson: text("subject_json"),
    response: text("response").notNull(),
    durationSec: integer("duration_sec").notNull(),
    selfRubricJson: text("self_rubric_json").notNull().default("{}"),
    reflection: text("reflection").notNull().default(""),
    aiFeedbackJson: text("ai_feedback_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("finance_interview_attempts_user_idx").on(t.userId, t.createdAt),
  ],
);

export const financeIdempotency = sqliteTable(
  "finance_idempotency",
  {
    userKey: text("user_key").notNull(),
    idemKey: text("idem_key").notNull(),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    status: integer("status").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userKey, t.idemKey] }),
  ],
);

export const financeImports = sqliteTable(
  "finance_imports",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    bundleJson: text("bundle_json").notNull(),
    previewJson: text("preview_json").notNull(),
    createdAt: text("created_at").notNull(),
    committedAt: text("committed_at"),
    summaryJson: text("summary_json"),
  },
  (t) => [
    index("finance_imports_user_idx").on(t.userId, t.createdAt),
  ],
);

export const financeAiUsage = sqliteTable(
  "finance_ai_usage",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    operation: text("operation").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estCostUsd: real("est_cost_usd"),
    priceTableDate: text("price_table_date"),
    subject: text("subject"),
    evidenceVersion: text("evidence_version"),
    resultJson: text("result_json"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("finance_ai_usage_day_idx").on(t.day),
  ],
);

export const financeRateLimits = sqliteTable(
  "finance_rate_limits",
  {
    bucket: text("bucket").primaryKey().notNull(),
    windowStart: text("window_start").notNull(),
    count: integer("count").notNull(),
  },
);

export const financeResearchDrafts = sqliteTable(
  "finance_research_drafts",
  {
    id: text("id").primaryKey().notNull(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    note: text("note"),
    baseSeq: integer("base_seq").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    status: text("status").notNull().default("draft"),
    origin: text("origin").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    publishedChangeId: text("published_change_id"),
    publishedAt: text("published_at"),
  },
  (t) => [
    index("finance_research_drafts_owner_idx").on(t.ownerId, t.status, t.updatedAt),
    uniqueIndex("finance_research_drafts_open_uidx").on(t.ownerId, t.dedupeKey).where(sql`status = 'draft'`),
  ],
);
