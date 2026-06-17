-- =============================================================================
-- Aegis data model — original & synthetic. A "case" is a filed claim; an
-- "adjudication" is the agent's ruling; the "case_ledger" is the audit trail.
-- Reference data (couriers / merchants / evidence_types) is all fictional.
-- =============================================================================

CREATE TABLE IF NOT EXISTS couriers (
  courier_id                  INTEGER PRIMARY KEY,
  courier_code                TEXT NOT NULL UNIQUE,
  courier_name                TEXT NOT NULL,
  swatch                      TEXT NOT NULL,            -- hex color for the UI
  transit_loss_threshold_days INTEGER NOT NULL          -- days w/o a scan => presumed lost
);

CREATE TABLE IF NOT EXISTS merchants (
  merchant_id        INTEGER PRIMARY KEY,
  merchant_name      TEXT NOT NULL,
  service_tier       TEXT NOT NULL,            -- standard | preferred | enterprise
  dom_hold_days      INTEGER NOT NULL,         -- domestic waiting period
  intl_hold_days     INTEGER NOT NULL,         -- international waiting period
  file_window_days   INTEGER NOT NULL,         -- filing window after dispatch
  allows_early_file  INTEGER NOT NULL,         -- 0 | 1
  ops_note           TEXT,                     -- free-text handling note (synthetic)
  deductible_usd     REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evidence_types (
  evidence_type_id INTEGER PRIMARY KEY,
  evidence_code    TEXT NOT NULL UNIQUE,
  evidence_label   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  case_id            INTEGER PRIMARY KEY,
  case_ref           TEXT NOT NULL UNIQUE,
  merchant_id        INTEGER NOT NULL REFERENCES merchants(merchant_id),
  courier_id         INTEGER NOT NULL REFERENCES couriers(courier_id),
  peril              TEXT NOT NULL,            -- loss | damage | shortage
  lifecycle_state    TEXT NOT NULL,
  goods_description  TEXT NOT NULL,
  claimant_statement TEXT NOT NULL,
  declared_usd       REAL NOT NULL,
  coverage_limit_usd REAL NOT NULL,
  demand_usd         REAL NOT NULL,
  shipment_ref       TEXT NOT NULL,
  dispatched_on      TEXT NOT NULL,
  filed_on           TEXT NOT NULL,
  origin_postal      TEXT NOT NULL,
  dest_postal        TEXT NOT NULL,
  cross_border       INTEGER NOT NULL DEFAULT 0,
  claimant_contact   TEXT NOT NULL,
  truth_label        TEXT,                     -- adjudicator ground truth (nullable)
  truth_label_note   TEXT,
  opened_at          TEXT NOT NULL,
  touched_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_state ON cases(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_cases_merchant ON cases(merchant_id);

CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id            INTEGER PRIMARY KEY,
  case_id                INTEGER NOT NULL REFERENCES cases(case_id),
  evidence_kind          TEXT NOT NULL,
  file_name              TEXT NOT NULL,
  media_type             TEXT NOT NULL,
  ocr_text               TEXT,
  is_extracted           INTEGER NOT NULL DEFAULT 0,
  extracted_value_usd    REAL,
  extracted_shipment_ref TEXT,
  extracted_kind         TEXT,
  extraction_score       REAL,
  extraction_note        TEXT,
  captured_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence_items(case_id);

CREATE TABLE IF NOT EXISTS scan_history (
  scan_id     INTEGER PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(case_id),
  scanned_at  TEXT NOT NULL,
  scan_status TEXT NOT NULL,
  scan_locale TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_case ON scan_history(case_id);

CREATE TABLE IF NOT EXISTS policy_chunks (
  chunk_id   INTEGER PRIMARY KEY,
  chunk_kind TEXT NOT NULL,            -- coverage_rule | exclusion | procedure | precedent
  heading    TEXT NOT NULL,
  body       TEXT NOT NULL,
  citation   TEXT NOT NULL,
  vector     TEXT                      -- JSON array of floats (embedding)
);

CREATE TABLE IF NOT EXISTS adjudications (
  adjudication_id     INTEGER PRIMARY KEY,
  case_id             INTEGER NOT NULL REFERENCES cases(case_id),
  verdict             TEXT NOT NULL,           -- approve | deny | request_docs | escalate
  resulting_state     TEXT NOT NULL,
  certainty           REAL NOT NULL,
  award_usd           REAL,
  refusal_basis       TEXT,
  requested_evidence  TEXT NOT NULL DEFAULT '[]',
  referral_basis      TEXT,
  rationale           TEXT NOT NULL,
  signals             TEXT NOT NULL DEFAULT '[]',
  retrieved           TEXT NOT NULL DEFAULT '[]',
  gate_checks         TEXT NOT NULL DEFAULT '[]',
  guardrails          TEXT NOT NULL DEFAULT '[]',
  engine              TEXT NOT NULL,
  engine_is_live      INTEGER NOT NULL DEFAULT 0,
  prompt_tokens       INTEGER NOT NULL DEFAULT 0,
  completion_tokens   INTEGER NOT NULL DEFAULT 0,
  elapsed_ms          INTEGER NOT NULL DEFAULT 0,
  ruled_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adj_case ON adjudications(case_id);

-- Audit trail of state transitions the agent made.
CREATE TABLE IF NOT EXISTS case_ledger (
  ledger_id  INTEGER PRIMARY KEY,
  case_id    INTEGER NOT NULL REFERENCES cases(case_id),
  actor      TEXT NOT NULL,           -- 'agent'
  from_state TEXT,
  to_state   TEXT,
  memo       TEXT,
  logged_at  TEXT NOT NULL
);

-- Evaluation runs. This is the ONLY table the eval write-guard allows.
CREATE TABLE IF NOT EXISTS eval_runs (
  eval_id         TEXT PRIMARY KEY,
  scored          INTEGER NOT NULL,
  matched         INTEGER NOT NULL,
  hit_rate        REAL NOT NULL,
  mean_certainty  REAL NOT NULL,
  mean_elapsed_ms REAL NOT NULL,
  matrix          TEXT NOT NULL,
  detail          TEXT NOT NULL,
  completed_at    TEXT NOT NULL
);
