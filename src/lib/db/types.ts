/**
 * Kysely table types — the typed mirror of db/migrations/*.sql.
 *
 * The SQL migrations are authoritative. When a migration changes a column,
 * change it here in the same commit; `npm run test` includes
 * tests/schema-parity.test.ts, which compares this file against the live
 * database and fails on any drift.
 */
import type { ColumnType, Generated } from 'kysely';

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json = ColumnType<unknown, string | undefined, string>;

export type Role = 'OWNER' | 'ADMIN' | 'PROCUREMENT_MANAGER' | 'ANALYST' | 'REVIEWER' | 'MEMBER';
export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
export type Provenance = 'VERIFIED' | 'USER_PROVIDED' | 'AI_INFERRED' | 'MISSING';
export type SourceKind = 'OFFICIAL_API' | 'MANUAL' | 'DEMO';
export type VerificationStatus = 'VERIFIED_SOURCE' | 'UNVERIFIED' | 'DEMO_DATA';
export type TenderStatus = 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'CANCELLED' | 'AWARDED' | 'UNKNOWN';
export type AnalysisStatus =
  | 'QUEUED' | 'RUNNING' | 'NEEDS_HUMAN_REVIEW' | 'COMPLETE' | 'FAILED' | 'PROVIDER_UNCONFIGURED';
export type Verdict =
  | 'STRONG_OPPORTUNITY' | 'POTENTIAL_OPPORTUNITY' | 'REQUIRES_FURTHER_REVIEW' | 'NOT_RECOMMENDED';
export type RunStatus =
  | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED'
  | 'AWAITING_APPROVAL' | 'PROVIDER_UNCONFIGURED';
export type StepStatus =
  | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'RETRYING' | 'INVALID_OUTPUT';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ComplianceStatus = 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN';
export type ApprovalType =
  | 'COMPANY_PROFILE' | 'CRITICAL_REQUIREMENTS' | 'UNCERTAIN_ANALYSIS'
  | 'RECOMMENDATION' | 'RESPONSE_DRAFT' | 'EXPORT';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'CANCELLED';
export type JobType =
  | 'DISCOVER_TENDERS' | 'PROCESS_DOCUMENT' | 'RUN_ANALYSIS' | 'DRAFT_RESPONSE'
  | 'SEND_NOTIFICATIONS' | 'DEADLINE_SWEEP';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'DEAD';
export type NotificationKind =
  | 'NEW_OPPORTUNITY' | 'DEADLINE' | 'ANALYSIS_COMPLETE' | 'MISSING_DOCUMENT'
  | 'APPROVAL_REQUEST' | 'RISK_ALERT' | 'AGENT_FAILURE';
export type ReportKind =
  | 'OPPORTUNITY_ANALYSIS' | 'COMPANY_READINESS' | 'COMPLIANCE' | 'RISK'
  | 'TENDER_COMPARISON' | 'AGENT_EXECUTION' | 'DECISION_HISTORY' | 'ACTIVITY';

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  cr_number: string | null;
  locale: Generated<string>;
  plan: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  name: string;
  password_hash: string;
  email_verified: TsNull;
  locale: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
}

export interface MembershipsTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  role: Generated<Role>;
  created_at: Ts;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  org_id: string | null;
  expires_at: Ts;
  created_at: Ts;
  last_seen: Ts;
  ip: string | null;
  user_agent: string | null;
}

export interface VerificationTokensTable {
  id: Generated<string>;
  user_id: string;
  purpose: string;
  token_hash: string;
  expires_at: Ts;
  used_at: TsNull;
  created_at: Ts;
}

export interface InvitationsTable {
  id: Generated<string>;
  org_id: string;
  email: string;
  role: Generated<Role>;
  token_hash: string;
  status: Generated<InviteStatus>;
  expires_at: Ts;
  created_at: Ts;
}

export interface IntegrationsTable {
  id: Generated<string>;
  org_id: string;
  key: string;
  enabled: Generated<boolean>;
  config: Json;
  last_check: TsNull;
  last_error: string | null;
}

export interface CompanyProfilesTable {
  id: Generated<string>;
  org_id: string;
  legal_name: string;
  cr_number: string | null;
  industries: Generated<string[]>;
  activities: Generated<string[]>;
  size_band: string | null;
  services: Generated<string[]>;
  regions: Generated<string[]>;
  employee_count: number | null;
  annual_revenue_band: string | null;
  bonding_capacity: string | null;
  summary: string | null;
  confirmed_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}

export interface CompanyDocumentsTable {
  id: Generated<string>;
  org_id: string;
  uploaded_by_id: string | null;
  kind: string;
  title: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  page_count: number | null;
  extracted_at: TsNull;
  text_chars: number | null;
  expires_at: TsNull;
  created_at: Ts;
}

export interface CapabilitiesTable {
  id: Generated<string>;
  org_id: string;
  profile_id: string;
  label: string;
  level: Generated<number>;
  provenance: Generated<Provenance>;
  document_id: string | null;
}

export interface CertificationsTable {
  id: Generated<string>;
  org_id: string;
  profile_id: string;
  name: string;
  issuer: string | null;
  number: string | null;
  issued_at: TsNull;
  expires_at: TsNull;
  document_id: string | null;
  provenance: Generated<Provenance>;
}

export interface PastProjectsTable {
  id: Generated<string>;
  org_id: string;
  profile_id: string;
  title: string;
  client: string | null;
  sector: string | null;
  value_band: string | null;
  started_at: TsNull;
  ended_at: TsNull;
  description: string | null;
  document_id: string | null;
  provenance: Generated<Provenance>;
}

export interface TendersTable {
  id: Generated<string>;
  org_id: string;
  source_kind: SourceKind;
  source_name: string;
  source_ref: string;
  source_url: string | null;
  verification: Generated<VerificationStatus>;
  is_demo: Generated<boolean>;
  retrieved_at: Ts;
  title: string;
  entity: string;
  reference_no: string | null;
  sector: string | null;
  region: string | null;
  type: string | null;
  status: Generated<TenderStatus>;
  published_at: TsNull;
  closes_at: TsNull;
  estimated_value_band: string | null;
  bond_required: boolean | null;
  summary: string | null;
  scope_of_work: string | null;
  submission_notes: string | null;
  raw: Json;
  created_at: Ts;
  updated_at: Ts;
}

export interface TenderDocumentsTable {
  id: Generated<string>;
  org_id: string;
  tender_id: string;
  title: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  page_count: number | null;
  extracted_at: TsNull;
  readable: Generated<boolean>;
  note: string | null;
  created_at: Ts;
}

export interface DocumentChunksTable {
  id: Generated<string>;
  org_id: string;
  company_document_id: string | null;
  tender_document_id: string | null;
  page: number | null;
  ordinal: number;
  text: string;
  char_count: number;
}

export interface TenderQaTable {
  id: Generated<string>;
  org_id: string;
  tender_id: string;
  question: string;
  answer: string | null;
  asked_at: TsNull;
  source_ref: string | null;
}

export interface TenderRequirementsTable {
  id: Generated<string>;
  org_id: string;
  tender_id: string;
  category: string;
  mandatory: Generated<boolean>;
  text: string;
  doc_ref: string | null;
  page_ref: number | null;
  provenance: Generated<Provenance>;
  confidence: number | null;
  created_at: Ts;
}

export interface TenderChangesTable {
  id: Generated<string>;
  org_id: string;
  tender_id: string;
  field: string;
  before: string | null;
  after: string | null;
  noticed_at: Ts;
}

export interface ScoringWeightsTable {
  id: Generated<string>;
  org_id: string;
  technical_fit: Generated<number>;
  experience: Generated<number>;
  compliance_readiness: Generated<number>;
  resources: Generated<number>;
  financial_readiness: Generated<number>;
  geographic: Generated<number>;
  updated_at: Ts;
}

export interface AnalysesTable {
  id: Generated<string>;
  org_id: string;
  tender_id: string;
  status: Generated<AnalysisStatus>;
  score: number | null;
  confidence: number | null;
  verdict: Verdict | null;
  blocking_gaps: Generated<number>;
  methodology: Json;
  summary: string | null;
  assumptions: Generated<string[]>;
  missing_info: Generated<string[]>;
  next_actions: Generated<string[]>;
  failure_reason: string | null;
  started_at: TsNull;
  finished_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}

export interface ScoreDimensionsTable {
  id: Generated<string>;
  org_id: string;
  analysis_id: string;
  key: string;
  label: string;
  weight: number;
  raw: number;
  rationale: string | null;
}

export interface EvidenceTable {
  id: Generated<string>;
  org_id: string;
  analysis_id: string;
  dimension_id: string | null;
  provenance: Provenance;
  statement: string;
  source_type: string;
  source_id: string | null;
  doc_ref: string | null;
  page_ref: number | null;
  confidence: number | null;
  created_at: Ts;
}

export interface ComplianceItemsTable {
  id: Generated<string>;
  org_id: string;
  analysis_id: string;
  requirement_id: string | null;
  label: string;
  category: string;
  mandatory: Generated<boolean>;
  status: Generated<ComplianceStatus>;
  blocking: Generated<boolean>;
  note: string | null;
  document_id: string | null;
  provenance: Generated<Provenance>;
}

export interface RisksTable {
  id: Generated<string>;
  org_id: string;
  analysis_id: string;
  category: string;
  severity: Severity;
  likelihood: Generated<number>;
  impact: Generated<number>;
  title: string;
  detail: string | null;
  mitigation: string | null;
}

export interface AgentRunsTable {
  id: Generated<string>;
  org_id: string;
  analysis_id: string | null;
  agent_key: string;
  parent_run_id: string | null;
  status: Generated<RunStatus>;
  plan: Json;
  input: Json;
  output: Json | null;
  error: string | null;
  attempts: Generated<number>;
  model: string | null;
  input_tokens: number | null;
  out_tokens: number | null;
  started_at: TsNull;
  finished_at: TsNull;
  created_at: Ts;
}

export interface AgentStepsTable {
  id: Generated<string>;
  org_id: string;
  run_id: string;
  ordinal: number;
  label: string;
  status: Generated<StepStatus>;
  attempt: Generated<number>;
  tool_key: string | null;
  tool_input: Json | null;
  tool_output: Json | null;
  message: string | null;
  duration_ms: number | null;
  created_at: Ts;
}

export interface ResponseDraftsTable {
  id: Generated<string>;
  org_id: string;
  analysis_id: string;
  title: string;
  version: Generated<number>;
  approved_at: TsNull;
  exported_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}

export interface ApprovalRequestsTable {
  id: Generated<string>;
  org_id: string;
  type: ApprovalType;
  status: Generated<ApprovalStatus>;
  subject_type: string;
  subject_id: string;
  analysis_id: string | null;
  draft_id: string | null;
  requested_by_id: string | null;
  title: string;
  detail: string | null;
  created_at: Ts;
  decided_at: TsNull;
}

export interface ApprovalDecisionsTable {
  id: Generated<string>;
  org_id: string;
  request_id: string;
  reviewer_id: string;
  status: ApprovalStatus;
  comment: string | null;
  created_at: Ts;
}

export interface ResponseSectionsTable {
  id: Generated<string>;
  org_id: string;
  draft_id: string;
  ordinal: number;
  heading: string;
  body: Generated<string>;
  open_points: Generated<string[]>;
  source_refs: Json;
}

export interface RequirementMappingsTable {
  id: Generated<string>;
  org_id: string;
  draft_id: string;
  requirement_id: string;
  response: string | null;
  evidence_note: string | null;
  provenance: Generated<Provenance>;
  attachment_ref: string | null;
}

export interface DraftVersionsTable {
  id: Generated<string>;
  org_id: string;
  draft_id: string;
  version: number;
  snapshot: Json;
  author_id: string | null;
  note: string | null;
  created_at: Ts;
}

export interface CommentsTable {
  id: Generated<string>;
  org_id: string;
  draft_id: string;
  author_id: string;
  section_id: string | null;
  body: string;
  created_at: Ts;
}

export interface NotificationsTable {
  id: Generated<string>;
  org_id: string;
  user_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read_at: TsNull;
  created_at: Ts;
}

export interface NotificationPreferencesTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  kind: NotificationKind;
  in_app: Generated<boolean>;
  email: Generated<boolean>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  org_id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  meta: Json;
  ip: string | null;
  created_at: Ts;
}

export interface JobsTable {
  id: Generated<string>;
  org_id: string;
  type: JobType;
  status: Generated<JobStatus>;
  payload: Json;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_after: Ts;
  locked_at: TsNull;
  locked_by: string | null;
  last_error: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface SavedSearchesTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  query: Json;
  alert_active: Generated<boolean>;
  last_run_at: TsNull;
  created_at: Ts;
}

export interface BookmarksTable {
  id: Generated<string>;
  org_id: string;
  tender_id: string;
  note: string | null;
  created_at: Ts;
}

export interface ReportsTable {
  id: Generated<string>;
  org_id: string;
  kind: ReportKind;
  analysis_id: string | null;
  title: string;
  payload: Json;
  format: Generated<string>;
  created_at: Ts;
}

export interface MigrationsTable {
  name: string;
  applied_at: Ts;
}

export interface Database {
  organizations: OrganizationsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  sessions: SessionsTable;
  verification_tokens: VerificationTokensTable;
  invitations: InvitationsTable;
  integrations: IntegrationsTable;
  company_profiles: CompanyProfilesTable;
  company_documents: CompanyDocumentsTable;
  capabilities: CapabilitiesTable;
  certifications: CertificationsTable;
  past_projects: PastProjectsTable;
  tenders: TendersTable;
  tender_documents: TenderDocumentsTable;
  document_chunks: DocumentChunksTable;
  tender_qa: TenderQaTable;
  tender_requirements: TenderRequirementsTable;
  tender_changes: TenderChangesTable;
  scoring_weights: ScoringWeightsTable;
  analyses: AnalysesTable;
  score_dimensions: ScoreDimensionsTable;
  evidence: EvidenceTable;
  compliance_items: ComplianceItemsTable;
  risks: RisksTable;
  agent_runs: AgentRunsTable;
  agent_steps: AgentStepsTable;
  response_drafts: ResponseDraftsTable;
  approval_requests: ApprovalRequestsTable;
  approval_decisions: ApprovalDecisionsTable;
  response_sections: ResponseSectionsTable;
  requirement_mappings: RequirementMappingsTable;
  draft_versions: DraftVersionsTable;
  comments: CommentsTable;
  notifications: NotificationsTable;
  notification_preferences: NotificationPreferencesTable;
  audit_logs: AuditLogsTable;
  jobs: JobsTable;
  saved_searches: SavedSearchesTable;
  bookmarks: BookmarksTable;
  reports: ReportsTable;
  _migrations: MigrationsTable;
}

/** Tables that carry org_id and must never be queried without a tenant scope. */
export const TENANT_TABLES = [
  'memberships', 'invitations', 'integrations', 'company_profiles', 'company_documents',
  'capabilities', 'certifications', 'past_projects', 'tenders', 'tender_documents',
  'document_chunks', 'tender_qa', 'tender_requirements', 'tender_changes', 'scoring_weights',
  'analyses', 'score_dimensions', 'evidence', 'compliance_items', 'risks', 'agent_runs',
  'agent_steps', 'response_drafts', 'approval_requests', 'approval_decisions',
  'response_sections', 'requirement_mappings', 'draft_versions', 'comments', 'notifications',
  'notification_preferences', 'audit_logs', 'jobs', 'saved_searches', 'bookmarks', 'reports',
] as const satisfies readonly (keyof Database)[];

export type TenantTable = (typeof TENANT_TABLES)[number];
