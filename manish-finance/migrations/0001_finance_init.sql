-- Finance Desk: initial additive schema (finance_* tables only).
-- Safe to apply to the existing kmanish.live D1 database: creates new tables and indexes only,
-- never alters, drops or reads non-finance tables. Every statement is idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS finance_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Runtime state for the source registry (definitions live in code; owner overrides live here).
CREATE TABLE IF NOT EXISTS finance_source_state (
  source_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_status TEXT,
  last_error TEXT,
  last_http_status INTEGER,
  etag TEXT,
  last_modified TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_allowed_at TEXT,
  last_item_count INTEGER,
  live_verified_at TEXT,
  updated_at TEXT NOT NULL
);

-- Source documents discovered by connectors (metadata and short permitted excerpts only).
CREATE TABLE IF NOT EXISTS finance_source_documents (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  provider_item_id TEXT,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  published_date TEXT,
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  excerpt TEXT,
  locator TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  dedupe_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS finance_source_documents_source_idx ON finance_source_documents (source_id, retrieved_at);
CREATE INDEX IF NOT EXISTS finance_source_documents_url_idx ON finance_source_documents (canonical_url);

-- Source-linked developments (leads until reviewed; never canonical deal terms by themselves).
CREATE TABLE IF NOT EXISTS finance_feed_items (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT,
  published_at TEXT,
  published_date TEXT,
  discovered_at TEXT NOT NULL,
  sectors_json TEXT NOT NULL DEFAULT '[]',
  entities_json TEXT NOT NULL DEFAULT '[]',
  verification TEXT NOT NULL DEFAULT 'lead',
  newly_discovered INTEGER NOT NULL DEFAULT 0,
  cluster_key TEXT NOT NULL,
  excerpt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_feed_items_document_idx ON finance_feed_items (document_id);
CREATE INDEX IF NOT EXISTS finance_feed_items_discovered_idx ON finance_feed_items (discovered_at);
CREATE INDEX IF NOT EXISTS finance_feed_items_event_idx ON finance_feed_items (event_date);
CREATE INDEX IF NOT EXISTS finance_feed_items_cluster_idx ON finance_feed_items (cluster_key);

-- Owner review queue for uncertain, conflicting or machine-extracted material terms.
CREATE TABLE IF NOT EXISTS finance_review_queue (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  field TEXT,
  proposal_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS finance_review_queue_status_idx ON finance_review_queue (status, created_at);

-- Published updates overlaid on the compiled research archive (append-only history).
CREATE TABLE IF NOT EXISTS finance_published_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  note TEXT,
  review_item_id TEXT,
  published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_published_changes_entity_idx ON finance_published_changes (entity_type, entity_id);

-- Generated briefs. Snapshots are immutable; corrections create a new version that supersedes.
CREATE TABLE IF NOT EXISTS finance_briefs (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  user_key TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  brief_date TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  cutoff_at TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  method TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  content_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  input_version TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT,
  correction_note TEXT,
  status TEXT NOT NULL DEFAULT 'published'
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_briefs_slot_idx ON finance_briefs (scope, user_key, kind, brief_date, version);
CREATE INDEX IF NOT EXISTS finance_briefs_date_idx ON finance_briefs (scope, user_key, brief_date);

-- Maintenance jobs (idempotent by key) and leases preventing concurrent refresh storms.
CREATE TABLE IF NOT EXISTS finance_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  job_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  result_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS finance_jobs_type_idx ON finance_jobs (job_type, started_at);

CREATE TABLE IF NOT EXISTS finance_leases (
  name TEXT PRIMARY KEY NOT NULL,
  holder TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- ===== Private, user-scoped records. Every query filters by user_id from the trusted host identity. =====

CREATE TABLE IF NOT EXISTS finance_notes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  template TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  links_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  link_key TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS finance_notes_user_idx ON finance_notes (user_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS finance_notes_view_idx ON finance_notes (user_id, template, link_key) WHERE link_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_note_links (
  note_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (note_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS finance_note_links_entity_idx ON finance_note_links (user_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS finance_watches (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  saved INTEGER NOT NULL DEFAULT 0,
  following INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_viewed_at TEXT,
  watermark TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_watches_entity_idx ON finance_watches (user_id, kind, entity_id);

CREATE TABLE IF NOT EXISTS finance_saved_searches (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_viewed_at TEXT,
  watermark TEXT
);
CREATE INDEX IF NOT EXISTS finance_saved_searches_user_idx ON finance_saved_searches (user_id);

CREATE TABLE IF NOT EXISTS finance_models (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  model_type TEXT NOT NULL,
  title TEXT NOT NULL,
  calc_version TEXT NOT NULL,
  source_json TEXT NOT NULL,
  assumptions_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  scenarios_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_models_user_idx ON finance_models (user_id, updated_at);

CREATE TABLE IF NOT EXISTS finance_memory_records (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_memory_records_subject_idx ON finance_memory_records (user_id, subject_type, subject_id);

CREATE TABLE IF NOT EXISTS finance_memory_cards (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  card_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  source_version TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT -1,
  due_date TEXT NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_memory_cards_type_idx ON finance_memory_cards (record_id, card_type);
CREATE INDEX IF NOT EXISTS finance_memory_cards_due_idx ON finance_memory_cards (user_id, due_date);

CREATE TABLE IF NOT EXISTS finance_review_log (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  review_date TEXT NOT NULL,
  rating TEXT NOT NULL,
  stage_before INTEGER NOT NULL,
  stage_after INTEGER NOT NULL,
  due_before TEXT NOT NULL,
  due_after TEXT NOT NULL,
  scheduler_version TEXT NOT NULL,
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS finance_review_log_card_idx ON finance_review_log (user_id, card_id, reviewed_at);
CREATE UNIQUE INDEX IF NOT EXISTS finance_review_log_idem_idx ON finance_review_log (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_preferences (
  user_id TEXT PRIMARY KEY NOT NULL,
  prefs_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_progress (
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  answer_json TEXT,
  correct INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS finance_interview_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  subject_json TEXT,
  response TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  self_rubric_json TEXT NOT NULL DEFAULT '{}',
  reflection TEXT NOT NULL DEFAULT '',
  ai_feedback_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_interview_attempts_user_idx ON finance_interview_attempts (user_id, created_at);

-- Idempotency records for retried POSTs (notes, imports, reviews, job requests).
CREATE TABLE IF NOT EXISTS finance_idempotency (
  user_key TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_key, idem_key)
);

CREATE TABLE IF NOT EXISTS finance_imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  summary_json TEXT
);
CREATE INDEX IF NOT EXISTS finance_imports_user_idx ON finance_imports (user_id, created_at);

CREATE TABLE IF NOT EXISTS finance_ai_usage (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  operation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  est_cost_usd REAL,
  price_table_date TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_ai_usage_day_idx ON finance_ai_usage (day);

CREATE TABLE IF NOT EXISTS finance_rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL
);

INSERT INTO finance_meta (key, value, updated_at) VALUES ('schema_version', '1', '1970-01-01T00:00:00Z')
  ON CONFLICT(key) DO NOTHING;
