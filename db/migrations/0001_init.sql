-- RASD | رَصْد — initial schema (authoritative).
--
-- Tenancy rule: every customer-owned row carries org_id. Application reads
-- and writes go through src/lib/tenancy.ts, which refuses any query without
-- an authorized organization scope. Foreign keys cascade from organizations
-- so deleting a tenant removes its data.
--
-- Conventions: snake_case identifiers, uuid primary keys, timestamptz.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────────────── enums ─────────────────────────────────

CREATE TYPE role AS ENUM ('OWNER','ADMIN','PROCUREMENT_MANAGER','ANALYST','REVIEWER','MEMBER');
CREATE TYPE invite_status AS ENUM ('PENDING','ACCEPTED','REVOKED','EXPIRED');

-- Where a fact came from. A score may never present an inference as verified.
CREATE TYPE provenance AS ENUM ('VERIFIED','USER_PROVIDED','AI_INFERRED','MISSING');

CREATE TYPE source_kind AS ENUM ('OFFICIAL_API','MANUAL','DEMO');
CREATE TYPE verification_status AS ENUM ('VERIFIED_SOURCE','UNVERIFIED','DEMO_DATA');
CREATE TYPE tender_status AS ENUM ('OPEN','CLOSING_SOON','CLOSED','CANCELLED','AWARDED','UNKNOWN');

CREATE TYPE analysis_status AS ENUM
  ('QUEUED','RUNNING','NEEDS_HUMAN_REVIEW','COMPLETE','FAILED','PROVIDER_UNCONFIGURED');
CREATE TYPE verdict AS ENUM
  ('STRONG_OPPORTUNITY','POTENTIAL_OPPORTUNITY','REQUIRES_FURTHER_REVIEW','NOT_RECOMMENDED');

CREATE TYPE run_status AS ENUM
  ('PENDING','RUNNING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','AWAITING_APPROVAL','PROVIDER_UNCONFIGURED');
CREATE TYPE step_status AS ENUM
  ('PENDING','RUNNING','SUCCEEDED','FAILED','SKIPPED','RETRYING','INVALID_OUTPUT');

CREATE TYPE severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE compliance_status AS ENUM ('MET','PARTIAL','NOT_MET','UNKNOWN');

CREATE TYPE approval_type AS ENUM
  ('COMPANY_PROFILE','CRITICAL_REQUIREMENTS','UNCERTAIN_ANALYSIS','RECOMMENDATION','RESPONSE_DRAFT','EXPORT');
CREATE TYPE approval_status AS ENUM ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED');

CREATE TYPE job_type AS ENUM
  ('DISCOVER_TENDERS','PROCESS_DOCUMENT','RUN_ANALYSIS','DRAFT_RESPONSE','SEND_NOTIFICATIONS','DEADLINE_SWEEP');
CREATE TYPE job_status AS ENUM ('QUEUED','RUNNING','DONE','FAILED','DEAD');

CREATE TYPE notification_kind AS ENUM
  ('NEW_OPPORTUNITY','DEADLINE','ANALYSIS_COMPLETE','MISSING_DOCUMENT','APPROVAL_REQUEST','RISK_ALERT','AGENT_FAILURE');
CREATE TYPE report_kind AS ENUM
  ('OPPORTUNITY_ANALYSIS','COMPANY_READINESS','COMPLIANCE','RISK','TENDER_COMPARISON','AGENT_EXECUTION','DECISION_HISTORY','ACTIVITY');

-- ───────────────────────── tenancy, identity, access ─────────────────────────

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  cr_number  text,
  locale     text NOT NULL DEFAULT 'ar',
  plan       text NOT NULL DEFAULT 'starter',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,              -- scrypt, salted (src/lib/password.ts)
  email_verified timestamptz,
  locale         text NOT NULL DEFAULT 'ar',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       role NOT NULL DEFAULT 'MEMBER',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,           -- only the hash is stored
  org_id     uuid REFERENCES organizations(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  ip         text,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE verification_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL,                  -- 'email_verify' | 'password_reset'
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_tokens_user_idx ON verification_tokens(user_id, purpose);

CREATE TABLE invitations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       role NOT NULL DEFAULT 'MEMBER',
  token_hash text NOT NULL UNIQUE,
  status     invite_status NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE TABLE integrations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        text NOT NULL,                  -- 'etimad' | 'anthropic' | 'smtp'
  enabled    boolean NOT NULL DEFAULT false,
  config     jsonb NOT NULL DEFAULT '{}',    -- never secrets; those live in env
  last_check timestamptz,
  last_error text,
  UNIQUE (org_id, key)
);

-- ───────────────────────── company knowledge (memory) ─────────────────────────

CREATE TABLE company_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  legal_name          text NOT NULL,
  cr_number           text,
  industries          text[] NOT NULL DEFAULT '{}',
  activities          text[] NOT NULL DEFAULT '{}',
  size_band           text,
  services            text[] NOT NULL DEFAULT '{}',
  regions             text[] NOT NULL DEFAULT '{}',
  employee_count      integer,
  annual_revenue_band text,                  -- band, never an exact figure
  bonding_capacity    text,
  summary             text,
  confirmed_at        timestamptz,           -- human confirmation checkpoint
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind           text NOT NULL,              -- 'cr' | 'iso' | 'zakat' | 'gosi' | 'reference' | 'other'
  title          text NOT NULL,
  storage_key    text NOT NULL,              -- private object key, never a public URL
  mime_type      text NOT NULL,
  byte_size      integer NOT NULL,
  sha256         text NOT NULL,
  page_count     integer,
  extracted_at   timestamptz,
  text_chars     integer,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_documents_kind_idx ON company_documents(org_id, kind);
CREATE INDEX company_documents_expiry_idx ON company_documents(org_id, expires_at);

CREATE TABLE capabilities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  label       text NOT NULL,
  level       integer NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 5),
  provenance  provenance NOT NULL DEFAULT 'USER_PROVIDED',
  document_id uuid REFERENCES company_documents(id) ON DELETE SET NULL
);
CREATE INDEX capabilities_org_idx ON capabilities(org_id);

CREATE TABLE certifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  issuer      text,
  number      text,
  issued_at   timestamptz,
  expires_at  timestamptz,
  document_id uuid REFERENCES company_documents(id) ON DELETE SET NULL,
  provenance  provenance NOT NULL DEFAULT 'USER_PROVIDED'
);
CREATE INDEX certifications_org_idx ON certifications(org_id);
CREATE INDEX certifications_expiry_idx ON certifications(org_id, expires_at);

CREATE TABLE past_projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  client      text,
  sector      text,
  value_band  text,                           -- band, never an exact contract value
  started_at  timestamptz,
  ended_at    timestamptz,
  description text,
  document_id uuid REFERENCES company_documents(id) ON DELETE SET NULL,
  provenance  provenance NOT NULL DEFAULT 'USER_PROVIDED'
);
CREATE INDEX past_projects_org_idx ON past_projects(org_id);

-- ──────────────────────────────── tenders ────────────────────────────────

CREATE TABLE tenders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_kind          source_kind NOT NULL,
  source_name          text NOT NULL,         -- 'etimad' | 'manual' | 'demo'
  source_ref           text NOT NULL,         -- the source's own identifier
  source_url           text,
  verification         verification_status NOT NULL DEFAULT 'UNVERIFIED',
  is_demo              boolean NOT NULL DEFAULT false,
  retrieved_at         timestamptz NOT NULL,
  title                text NOT NULL,
  entity               text NOT NULL,
  reference_no         text,
  sector               text,
  region               text,
  type                 text,
  status               tender_status NOT NULL DEFAULT 'UNKNOWN',
  published_at         timestamptz,
  closes_at            timestamptz,
  estimated_value_band text,
  bond_required        boolean,
  summary              text,
  scope_of_work        text,
  submission_notes     text,
  raw                  jsonb NOT NULL DEFAULT '{}',  -- untouched source payload
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_name, source_ref)
);
CREATE INDEX tenders_closing_idx ON tenders(org_id, closes_at);
CREATE INDEX tenders_status_idx ON tenders(org_id, status);

CREATE TABLE tender_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id    uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  title        text NOT NULL,
  storage_key  text NOT NULL,
  mime_type    text NOT NULL,
  byte_size    integer NOT NULL,
  sha256       text NOT NULL,
  page_count   integer,
  extracted_at timestamptz,
  readable     boolean NOT NULL DEFAULT true, -- false => scanned/encrypted, reported not guessed
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tender_documents_idx ON tender_documents(org_id, tender_id);

CREATE TABLE document_chunks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_document_id uuid REFERENCES company_documents(id) ON DELETE CASCADE,
  tender_document_id  uuid REFERENCES tender_documents(id) ON DELETE CASCADE,
  page                integer,
  ordinal             integer NOT NULL,
  text                text NOT NULL,
  char_count          integer NOT NULL,
  CHECK (num_nonnulls(company_document_id, tender_document_id) = 1)
);
CREATE INDEX document_chunks_company_idx ON document_chunks(company_document_id, ordinal);
CREATE INDEX document_chunks_tender_idx ON document_chunks(tender_document_id, ordinal);
CREATE INDEX document_chunks_org_idx ON document_chunks(org_id);

CREATE TABLE tender_qa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id  uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  question   text NOT NULL,
  answer     text,
  asked_at   timestamptz,
  source_ref text
);
CREATE INDEX tender_qa_idx ON tender_qa(org_id, tender_id);

CREATE TABLE tender_requirements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id   uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  category    text NOT NULL,                 -- technical | administrative | financial | legal
  mandatory   boolean NOT NULL DEFAULT false,
  text        text NOT NULL,
  doc_ref     text,
  page_ref    integer,
  provenance  provenance NOT NULL DEFAULT 'AI_INFERRED',
  confidence  real,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tender_requirements_idx ON tender_requirements(org_id, tender_id, category);

CREATE TABLE tender_changes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id  uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  field      text NOT NULL,
  before     text,
  after      text,
  noticed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tender_changes_idx ON tender_changes(org_id, tender_id);

-- ──────────────────────────────── analysis ────────────────────────────────

CREATE TABLE scoring_weights (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  technical_fit        integer NOT NULL DEFAULT 25,
  experience           integer NOT NULL DEFAULT 20,
  compliance_readiness integer NOT NULL DEFAULT 20,
  resources            integer NOT NULL DEFAULT 15,
  financial_readiness  integer NOT NULL DEFAULT 10,
  geographic           integer NOT NULL DEFAULT 10,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analyses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id      uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  status         analysis_status NOT NULL DEFAULT 'QUEUED',
  score          integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  confidence     real,
  verdict        verdict,
  blocking_gaps  integer NOT NULL DEFAULT 0,  -- unmet mandatory requirements
  methodology    jsonb NOT NULL DEFAULT '{}', -- weights + formula actually used
  summary        text,
  assumptions    text[] NOT NULL DEFAULT '{}',
  missing_info   text[] NOT NULL DEFAULT '{}',
  next_actions   text[] NOT NULL DEFAULT '{}',
  failure_reason text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analyses_tender_idx ON analyses(org_id, tender_id);
CREATE INDEX analyses_status_idx ON analyses(org_id, status);

CREATE TABLE score_dimensions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  key         text NOT NULL,
  label       text NOT NULL,
  weight      integer NOT NULL,
  raw         integer NOT NULL CHECK (raw BETWEEN 0 AND 100),
  rationale   text,
  UNIQUE (analysis_id, key)
);
CREATE INDEX score_dimensions_org_idx ON score_dimensions(org_id);

-- Every number the platform shows can be traced to one of these.
CREATE TABLE evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_id  uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  dimension_id uuid REFERENCES score_dimensions(id) ON DELETE SET NULL,
  provenance   provenance NOT NULL,
  statement    text NOT NULL,
  source_type  text NOT NULL,                -- company_document | tender_document | profile | agent
  source_id    uuid,
  doc_ref      text,
  page_ref     integer,
  confidence   real,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_idx ON evidence(org_id, analysis_id);

CREATE TABLE compliance_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_id    uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES tender_requirements(id) ON DELETE SET NULL,
  label          text NOT NULL,
  category       text NOT NULL,
  mandatory      boolean NOT NULL DEFAULT false,
  status         compliance_status NOT NULL DEFAULT 'UNKNOWN',
  blocking       boolean NOT NULL DEFAULT false,  -- a potential disqualifier
  note           text,
  document_id    uuid REFERENCES company_documents(id) ON DELETE SET NULL,
  provenance     provenance NOT NULL DEFAULT 'AI_INFERRED'
);
CREATE INDEX compliance_items_idx ON compliance_items(org_id, analysis_id);
CREATE INDEX compliance_items_blocking_idx ON compliance_items(org_id, blocking);

CREATE TABLE risks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  category    text NOT NULL,
  severity    severity NOT NULL,
  likelihood  integer NOT NULL DEFAULT 3 CHECK (likelihood BETWEEN 1 AND 5),
  impact      integer NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  title       text NOT NULL,
  detail      text,
  mitigation  text
);
CREATE INDEX risks_idx ON risks(org_id, analysis_id);

-- ─────────────────────── agent execution records ───────────────────────

CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_id   uuid REFERENCES analyses(id) ON DELETE CASCADE,
  agent_key     text NOT NULL,
  parent_run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  status        run_status NOT NULL DEFAULT 'PENDING',
  plan          jsonb NOT NULL DEFAULT '[]',  -- the orchestrator's execution plan
  input         jsonb NOT NULL DEFAULT '{}',
  output        jsonb,
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  model         text,
  input_tokens  integer,
  out_tokens    integer,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_agent_idx ON agent_runs(org_id, agent_key);
CREATE INDEX agent_runs_status_idx ON agent_runs(org_id, status);
CREATE INDEX agent_runs_analysis_idx ON agent_runs(analysis_id);

CREATE TABLE agent_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id      uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  label       text NOT NULL,
  status      step_status NOT NULL DEFAULT 'PENDING',
  attempt     integer NOT NULL DEFAULT 1,
  tool_key    text,
  tool_input  jsonb,
  tool_output jsonb,
  message     text,
  duration_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_steps_idx ON agent_steps(org_id, run_id, ordinal);

-- ──────────────────── human-in-the-loop & drafting ────────────────────

CREATE TABLE response_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  title       text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  approved_at timestamptz,
  exported_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX response_drafts_idx ON response_drafts(org_id, analysis_id);

CREATE TABLE approval_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            approval_type NOT NULL,
  status          approval_status NOT NULL DEFAULT 'PENDING',
  subject_type    text NOT NULL,
  subject_id      uuid NOT NULL,
  analysis_id     uuid REFERENCES analyses(id) ON DELETE CASCADE,
  draft_id        uuid REFERENCES response_drafts(id) ON DELETE CASCADE,
  requested_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title           text NOT NULL,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE INDEX approval_requests_status_idx ON approval_requests(org_id, status);
CREATE INDEX approval_requests_type_idx ON approval_requests(org_id, type);

CREATE TABLE approval_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  status      approval_status NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_decisions_idx ON approval_decisions(org_id, request_id);

CREATE TABLE response_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  draft_id    uuid NOT NULL REFERENCES response_drafts(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  heading     text NOT NULL,
  body        text NOT NULL DEFAULT '',
  open_points text[] NOT NULL DEFAULT '{}',  -- statements with no company record behind them
  source_refs jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX response_sections_idx ON response_sections(org_id, draft_id, ordinal);

CREATE TABLE requirement_mappings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  draft_id       uuid NOT NULL REFERENCES response_drafts(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES tender_requirements(id) ON DELETE CASCADE,
  response       text,
  evidence_note  text,
  provenance     provenance NOT NULL DEFAULT 'MISSING',
  attachment_ref text,
  UNIQUE (draft_id, requirement_id)
);
CREATE INDEX requirement_mappings_idx ON requirement_mappings(org_id, draft_id);

CREATE TABLE draft_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  draft_id   uuid NOT NULL REFERENCES response_drafts(id) ON DELETE CASCADE,
  version    integer NOT NULL,
  snapshot   jsonb NOT NULL,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, version)
);
CREATE INDEX draft_versions_idx ON draft_versions(org_id, draft_id);

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  draft_id   uuid NOT NULL REFERENCES response_drafts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  section_id uuid REFERENCES response_sections(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_idx ON comments(org_id, draft_id);

-- ──────────────── notifications, audit, jobs, reporting ────────────────

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  kind       notification_kind NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_idx ON notifications(org_id, user_id, read_at);

CREATE TABLE notification_preferences (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    notification_kind NOT NULL,
  in_app  boolean NOT NULL DEFAULT true,
  email   boolean NOT NULL DEFAULT false,
  UNIQUE (org_id, user_id, kind)
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text,
  meta        jsonb NOT NULL DEFAULT '{}',
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_time_idx ON audit_logs(org_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs(org_id, action);

CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type         job_type NOT NULL,
  status       job_status NOT NULL DEFAULT 'QUEUED',
  payload      jsonb NOT NULL DEFAULT '{}',
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after    timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim_idx ON jobs(status, run_after);
CREATE INDEX jobs_org_idx ON jobs(org_id, type);

CREATE TABLE saved_searches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  query        jsonb NOT NULL DEFAULT '{}',
  alert_active boolean NOT NULL DEFAULT false,
  last_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_searches_idx ON saved_searches(org_id);

CREATE TABLE bookmarks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id  uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, tender_id)
);

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind        report_kind NOT NULL,
  analysis_id uuid REFERENCES analyses(id) ON DELETE SET NULL,
  title       text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  format      text NOT NULL DEFAULT 'json',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_idx ON reports(org_id, kind);
