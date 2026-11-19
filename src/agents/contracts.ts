/**
 * Agent output contracts.
 *
 * Each agent must return one of these shapes. The runner validates every
 * result against its zod schema before it is persisted; an unparsable or
 * non-conforming result is recorded as INVALID_OUTPUT and retried with the
 * validation error fed back, never stored as if it were valid.
 *
 * Two rules are encoded in the shapes themselves rather than left to a prompt:
 *   • every claim carries a provenance, so an inference cannot be stored as a
 *     verified fact;
 *   • missing information is a first-class field, so "not found" has somewhere
 *     to go other than a confident guess.
 */
import { z } from 'zod';

export const provenanceSchema = z.enum(['VERIFIED', 'USER_PROVIDED', 'AI_INFERRED', 'MISSING']);

export const evidenceSchema = z.object({
  provenance: provenanceSchema.describe('VERIFIED only when a cited document supports it'),
  statement: z.string().min(3).max(600),
  sourceType: z.enum(['company_document', 'tender_document', 'profile', 'agent']),
  docRef: z.string().max(300).nullable().describe('document title the claim came from, or null'),
  pageRef: z.number().int().min(1).max(5000).nullable().describe('page number, or null'),
  confidence: z.number().min(0).max(1).nullable(),
});
export type EvidenceOut = z.infer<typeof evidenceSchema>;

// ── Agent 3: Document Intelligence ────────────────────────────────────────
export const requirementSchema = z.object({
  category: z.enum(['technical', 'administrative', 'financial', 'legal']),
  mandatory: z.boolean().describe('true only when the document states it as a condition of eligibility'),
  text: z.string().min(5).max(1200),
  docRef: z.string().max(300).nullable(),
  pageRef: z.number().int().min(1).max(5000).nullable(),
  confidence: z.number().min(0).max(1),
});

export const documentIntelligenceOutput = z.object({
  requirements: z.array(requirementSchema).max(400),
  keyDates: z.array(
    z.object({
      label: z.string().max(200),
      isoDate: z.string().max(40).nullable(),
      pageRef: z.number().int().min(1).max(5000).nullable(),
    }),
  ).max(40),
  attachmentsRequired: z.array(z.string().max(300)).max(120),
  unreadableDocuments: z.array(z.string().max(300)).max(60)
    .describe('documents that could not be read — reported, never guessed at'),
  missingInformation: z.array(z.string().max(400)).max(60),
  notes: z.string().max(3000).nullable(),
});
export type DocumentIntelligenceOut = z.infer<typeof documentIntelligenceOutput>;

// ── Agent 4: Compatibility ────────────────────────────────────────────────
export const dimensionKeys = [
  'technicalFit', 'experience', 'complianceReadiness', 'resources', 'financialReadiness', 'geographic',
] as const;

export const dimensionAssessmentSchema = z.object({
  key: z.enum(dimensionKeys),
  raw: z.number().int().min(0).max(100).describe('0 when there is no evidence either way — do not default to 50'),
  rationale: z.string().min(10).max(1200),
  evidence: z.array(evidenceSchema).max(12),
});

export const compatibilityOutput = z.object({
  dimensions: z.array(dimensionAssessmentSchema).length(6),
  strengths: z.array(z.string().max(400)).max(20),
  gaps: z.array(z.string().max(400)).max(30),
  missingInformation: z.array(z.string().max(400)).max(40),
  confidence: z.number().min(0).max(1),
});
export type CompatibilityOut = z.infer<typeof compatibilityOutput>;

// ── Agent 5: Compliance ───────────────────────────────────────────────────
export const complianceItemSchema = z.object({
  requirementText: z.string().min(5).max(1200),
  label: z.string().min(3).max(300),
  category: z.enum(['technical', 'administrative', 'financial', 'legal']),
  mandatory: z.boolean(),
  status: z.enum(['MET', 'PARTIAL', 'NOT_MET', 'UNKNOWN']),
  blocking: z.boolean().describe('true when failing this would disqualify the bid'),
  note: z.string().max(900).nullable(),
  matchedDocument: z.string().max(300).nullable().describe('company document that satisfies it, or null'),
  provenance: provenanceSchema,
});

export const complianceOutput = z.object({
  items: z.array(complianceItemSchema).max(300),
  missingDocuments: z.array(z.string().max(300)).max(80),
  expiringDocuments: z.array(
    z.object({ name: z.string().max(300), expiresOn: z.string().max(40).nullable() }),
  ).max(40),
  confidence: z.number().min(0).max(1),
});
export type ComplianceOut = z.infer<typeof complianceOutput>;

// ── Agent 6: Risk Intelligence ────────────────────────────────────────────
export const riskSchema = z.object({
  category: z.enum(['deadline', 'delivery', 'resource', 'financial', 'compliance', 'contractual', 'information']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  title: z.string().min(5).max(300),
  detail: z.string().max(1500).nullable(),
  mitigation: z.string().max(1500).nullable(),
});

export const riskOutput = z.object({
  risks: z.array(riskSchema).max(60),
  informationUncertainty: z.array(z.string().max(400)).max(40),
  confidence: z.number().min(0).max(1),
});
export type RiskOut = z.infer<typeof riskOutput>;

// ── Agent 7: Response Drafting ────────────────────────────────────────────
export const draftSectionSchema = z.object({
  heading: z.string().min(3).max(300),
  body: z.string().max(12000),
  /** Anything the draft needs but company records do not support. */
  openPoints: z.array(z.string().max(400)).max(30),
  sourceRefs: z.array(z.string().max(300)).max(40),
});

export const draftingOutput = z.object({
  sections: z.array(draftSectionSchema).min(1).max(30),
  requirementResponses: z.array(
    z.object({
      requirementText: z.string().min(5).max(1200),
      response: z.string().max(4000).nullable(),
      evidenceNote: z.string().max(1200).nullable(),
      provenance: provenanceSchema,
      attachmentRef: z.string().max(300).nullable(),
    }),
  ).max(300),
  attachmentChecklist: z.array(z.string().max(300)).max(120),
  unansweredQuestions: z.array(z.string().max(500)).max(60),
});
export type DraftingOut = z.infer<typeof draftingOutput>;

// ── Agent 8: Quality Assurance ────────────────────────────────────────────
export const qaOutput = z.object({
  verdict: z.enum(['PASS', 'PASS_WITH_FLAGS', 'FAIL']),
  contradictions: z.array(z.string().max(600)).max(40),
  unsupportedClaims: z.array(z.string().max(600)).max(60),
  brokenReferences: z.array(z.string().max(400)).max(60),
  lowConfidenceAreas: z.array(z.string().max(400)).max(40),
  requiresHumanReview: z.boolean(),
  reason: z.string().max(2000).nullable(),
});
export type QaOut = z.infer<typeof qaOutput>;

// ── Agent 2: Discovery (relevance ranking of already-retrieved records) ───
export const discoveryOutput = z.object({
  ranked: z.array(
    z.object({
      sourceRef: z.string().max(200),
      relevance: z.number().min(0).max(1),
      reason: z.string().max(600),
    }),
  ).max(200),
  excluded: z.array(
    z.object({ sourceRef: z.string().max(200), reason: z.string().max(400) }),
  ).max(200),
});
export type DiscoveryOut = z.infer<typeof discoveryOutput>;

// ── Agent 1: Orchestrator ─────────────────────────────────────────────────
export const agentKeys = [
  'orchestrator', 'discovery', 'document_intelligence', 'compatibility',
  'compliance', 'risk', 'drafting', 'quality_assurance',
] as const;
export type AgentKey = (typeof agentKeys)[number];

export const planStepSchema = z.object({
  agent: z.enum(agentKeys),
  reason: z.string().max(500),
  dependsOn: z.array(z.enum(agentKeys)).max(7),
});

export const orchestratorOutput = z.object({
  plan: z.array(planStepSchema).min(1).max(12),
  humanCheckpoints: z.array(
    z.enum(['COMPANY_PROFILE', 'CRITICAL_REQUIREMENTS', 'UNCERTAIN_ANALYSIS', 'RECOMMENDATION', 'RESPONSE_DRAFT', 'EXPORT']),
  ).max(6),
  note: z.string().max(1500).nullable(),
});
export type OrchestratorOut = z.infer<typeof orchestratorOutput>;

/**
 * The final consolidated recommendation. The orchestrator proposes it; the
 * score itself is computed in code (src/lib/scoring.ts), not by the model, and
 * the deterministic engine overrides any verdict that contradicts a blocking
 * compliance failure.
 */
export const recommendationOutput = z.object({
  verdict: z.enum(['STRONG_OPPORTUNITY', 'POTENTIAL_OPPORTUNITY', 'REQUIRES_FURTHER_REVIEW', 'NOT_RECOMMENDED']),
  summary: z.string().min(20).max(4000),
  assumptions: z.array(z.string().max(400)).max(30),
  missingInformation: z.array(z.string().max(400)).max(40),
  nextActions: z.array(z.string().max(400)).max(30),
  confidence: z.number().min(0).max(1),
});
export type RecommendationOut = z.infer<typeof recommendationOutput>;
