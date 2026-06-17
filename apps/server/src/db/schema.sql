-- =============================================================================
-- Aegis — synthetic schema. Everything here is fictional demo data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS carriers (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  color             TEXT NOT NULL,
  presumed_lost_days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  tier                TEXT NOT NULL,            -- standard | preferred | enterprise
  dom_waiting_days    INTEGER NOT NULL,
  intl_waiting_days   INTEGER NOT NULL,
  max_file_days       INTEGER NOT NULL,
  allow_early_file    INTEGER NOT NULL,         -- 0 | 1
  handling_note       TEXT,
  deductible          REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS doc_types (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id                     INTEGER PRIMARY KEY,
  public_ref             TEXT NOT NULL UNIQUE,
  client_id              INTEGER NOT NULL REFERENCES clients(id),
  carrier_id             INTEGER NOT NULL REFERENCES carriers(id),
  type                   TEXT NOT NULL,         -- loss | damage | shortage
  status                 TEXT NOT NULL,
  item_description       TEXT NOT NULL,
  narrative              TEXT NOT NULL,
  declared_value         REAL NOT NULL,
  insured_amount         REAL NOT NULL,
  amount_claimed         REAL NOT NULL,
  tracking_number        TEXT NOT NULL,
  ship_date              TEXT NOT NULL,
  filed_date             TEXT NOT NULL,
  origin_zip             TEXT NOT NULL,
  dest_zip               TEXT NOT NULL,
  is_international        INTEGER NOT NULL DEFAULT 0,
  claimant_email         TEXT NOT NULL,
  ground_truth_decision  TEXT,                  -- approve | deny | request_docs | escalate (nullable)
  ground_truth_note      TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_client ON claims(client_id);

CREATE TABLE IF NOT EXISTS claim_documents (
  id                   INTEGER PRIMARY KEY,
  claim_id             INTEGER NOT NULL REFERENCES claims(id),
  kind                 TEXT NOT NULL,
  filename             TEXT NOT NULL,
  mime                 TEXT NOT NULL,
  text_content         TEXT,
  analyzed             INTEGER NOT NULL DEFAULT 0,
  extracted_amount     REAL,
  extracted_tracking   TEXT,
  extracted_doc_type   TEXT,
  analysis_confidence  REAL,
  analysis_notes       TEXT,
  uploaded_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_claim ON claim_documents(claim_id);

CREATE TABLE IF NOT EXISTS tracking_events (
  id        INTEGER PRIMARY KEY,
  claim_id  INTEGER NOT NULL REFERENCES claims(id),
  ts        TEXT NOT NULL,
  status    TEXT NOT NULL,
  location  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_track_claim ON tracking_events(claim_id);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id        INTEGER PRIMARY KEY,
  category  TEXT NOT NULL,            -- coverage_rule | exclusion | procedure | precedent
  title     TEXT NOT NULL,
  text      TEXT NOT NULL,
  source    TEXT NOT NULL,
  embedding TEXT                      -- JSON array of floats
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id                  INTEGER PRIMARY KEY,
  claim_id            INTEGER NOT NULL REFERENCES claims(id),
  decision            TEXT NOT NULL,
  resulting_status    TEXT NOT NULL,
  confidence          REAL NOT NULL,
  paid_amount         REAL,
  denial_reason       TEXT,
  missing_doc_type_ids TEXT NOT NULL DEFAULT '[]',
  escalation_reason   TEXT,
  reasoning           TEXT NOT NULL,
  flags               TEXT NOT NULL DEFAULT '[]',
  citations           TEXT NOT NULL DEFAULT '[]',
  preflights          TEXT NOT NULL DEFAULT '[]',
  gates               TEXT NOT NULL DEFAULT '[]',
  model               TEXT NOT NULL,
  used_real_model     INTEGER NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  took_ms             INTEGER NOT NULL DEFAULT 0,
  decided_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dec_claim ON agent_decisions(claim_id);

-- Audit trail: every status change the agent makes (mirrors a real claim_changes log).
CREATE TABLE IF NOT EXISTS agent_changes (
  id          INTEGER PRIMARY KEY,
  claim_id    INTEGER NOT NULL REFERENCES claims(id),
  change_type TEXT NOT NULL,          -- 'AI_AGENT'
  old_status  TEXT,
  new_status  TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);

-- Evaluation runs. This is the ONLY table the backtest write-guard allows.
CREATE TABLE IF NOT EXISTS backtest_runs (
  run_id          TEXT PRIMARY KEY,
  total           INTEGER NOT NULL,
  agreed          INTEGER NOT NULL,
  accuracy        REAL NOT NULL,
  avg_confidence  REAL NOT NULL,
  avg_took_ms     REAL NOT NULL,
  matrix          TEXT NOT NULL,
  rows            TEXT NOT NULL,
  finished_at     TEXT NOT NULL
);
