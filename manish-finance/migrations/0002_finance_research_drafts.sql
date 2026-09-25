-- Finance Desk: owner research-maintenance drafts (additive; safe to re-apply).
-- A draft is a proposed create/edit (company, deal, revised term, dated observation, deal event or claim
-- verification) that the owner can preview and edit before publishing. Publishing appends a row to
-- finance_published_changes (the existing append-only overlay); nothing in the archive is overwritten.
CREATE TABLE IF NOT EXISTS finance_research_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  note TEXT,
  base_seq INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  origin TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_change_id TEXT,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS finance_research_drafts_owner_idx ON finance_research_drafts (owner_id, status, updated_at);
-- One open draft per proposal: re-importing the same item does not create a second draft.
CREATE UNIQUE INDEX IF NOT EXISTS finance_research_drafts_open_uidx ON finance_research_drafts (owner_id, dedupe_key) WHERE status = 'draft';
