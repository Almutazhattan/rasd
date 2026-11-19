/**
 * Analysis orchestration — the workflow the whole product exists to run.
 *
 *   orchestrator → plan
 *     document_intelligence  (when readable documents exist)
 *     compatibility ─┬→ compliance ─→ risk
 *                    │
 *     scoring engine (deterministic, in code)
 *     quality_assurance
 *     recommendation (prose only; the verdict is the engine's)
 *   → approval checkpoints → COMPLETE | NEEDS_HUMAN_REVIEW
 *
 * Three invariants this module enforces rather than hopes for:
 *   • With no AI provider configured, the analysis ends PROVIDER_UNCONFIGURED
 *     with nothing invented and nothing scored.
 *   • The score and the verdict come from src/lib/scoring.ts. If the
 *     recommendation agent proposes a verdict the engine disallows, the
 *     engine's verdict is stored and the override is recorded.
 *   • A blocking compliance item or a QA review flag leaves the analysis in
 *     NEEDS_HUMAN_REVIEW with an open approval request. It never resolves
 *     itself.
 */
import { scoped, type Ctx, actorId } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { notify } from './notifications';
import { logger } from '@/lib/logger';
import { notFound, validation } from '@/lib/errors';
import {
  computeScore, deriveVerdict, DEFAULT_WEIGHTS, DIMENSION_LABELS, WEIGHT_COLUMNS,
  type DimensionInput, type DimensionKey, type Weights,
} from '@/lib/scoring';
import { AGENTS } from '@/agents/registry';
import { runAgent, savePlan } from '@/agents/runner';
import type {
  CompatibilityOut, ComplianceOut, DocumentIntelligenceOut, OrchestratorOut,
  QaOut, RecommendationOut, RiskOut,
} from '@/agents/contracts';
import type { AnalysisStatus, Verdict } from '@/lib/db/types';
import { requestApproval } from './approvals';
import { aiKeyName } from '@/lib/env';

export interface StartAnalysisResult {
  analysisId: string;
  status: AnalysisStatus;
}

/** Queue an analysis. The worker runs it; the UI polls the record. */
export async function startAnalysis(ctx: Ctx, tenderId: string): Promise<StartAnalysisResult> {
  if (!('system' in ctx)) assertCan(ctx.role, 'analysis:run');
  const s = scoped(ctx);
  await s.getById('tenders', tenderId, 'Tender');

  const row = await s
    .insert('analyses', { tender_id: tenderId, status: 'QUEUED' })
    .returning(['id', 'status'])
    .executeTakeFirstOrThrow();
  const analysis = row as { id: string; status: AnalysisStatus };

  await s.insert('jobs', {
    type: 'RUN_ANALYSIS',
    payload: JSON.stringify({ analysisId: analysis.id, tenderId, actorId: actorId(ctx) }),
  }).execute();

  await audit(ctx, 'analysis.start', { type: 'analysis', id: analysis.id }, { tenderId });
  return { analysisId: analysis.id, status: analysis.status };
}

export async function loadWeights(ctx: Ctx): Promise<Weights> {
  const row = await scoped(ctx).from('scoring_weights').selectAll().executeTakeFirst();
  if (!row) return { ...DEFAULT_WEIGHTS };
  const r = row as Record<string, number>;
  return {
    technicalFit: r[WEIGHT_COLUMNS.technicalFit] ?? DEFAULT_WEIGHTS.technicalFit,
    experience: r[WEIGHT_COLUMNS.experience] ?? DEFAULT_WEIGHTS.experience,
    complianceReadiness: r[WEIGHT_COLUMNS.complianceReadiness] ?? DEFAULT_WEIGHTS.complianceReadiness,
    resources: r[WEIGHT_COLUMNS.resources] ?? DEFAULT_WEIGHTS.resources,
    financialReadiness: r[WEIGHT_COLUMNS.financialReadiness] ?? DEFAULT_WEIGHTS.financialReadiness,
    geographic: r[WEIGHT_COLUMNS.geographic] ?? DEFAULT_WEIGHTS.geographic,
  };
}

export async function updateWeights(ctx: Ctx, weights: Weights) {
  if (!('system' in ctx)) assertCan(ctx.role, 'weights:update');
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total <= 0) throw validation('At least one dimension must carry a non-zero weight.');
  await scoped(ctx)
    .update('scoring_weights')
    .set({
      technical_fit: weights.technicalFit,
      experience: weights.experience,
      compliance_readiness: weights.complianceReadiness,
      resources: weights.resources,
      financial_readiness: weights.financialReadiness,
      geographic: weights.geographic,
      updated_at: new Date(),
    })
    .execute();
  await audit(ctx, 'weights.update', { type: 'scoring_weights' }, { weights });
}

/**
 * Execute a queued analysis end to end. Called by the worker, not by a request
 * handler: a full run takes minutes and must survive the user closing the tab.
 */
export async function executeAnalysis(ctx: Ctx, analysisId: string): Promise<AnalysisStatus> {
  const s = scoped(ctx);
  const analysis = await s.findById('analyses', analysisId);
  if (!analysis) throw notFound('Analysis not found in this workspace.');
  const tenderId = (analysis as { tender_id: string }).tender_id;

  await s.update('analyses').set({ status: 'RUNNING', started_at: new Date(), updated_at: new Date() })
    .where('id' as never, '=', analysisId as never).execute();

  const tender = (await s.getById('tenders', tenderId, 'Tender')) as Record<string, unknown>;
  const base = { analysisId, tenderId, tender: summarizeTender(tender) };

  // ── 1. plan ────────────────────────────────────────────────────────────
  const planRun = await runAgent<OrchestratorOut>({
    ctx, agent: AGENTS.orchestrator, input: { ...base, purpose: 'analysis' }, analysisId, tenderId,
  });

  if (planRun.status === 'PROVIDER_UNCONFIGURED') {
    return finishUnconfigured(ctx, analysisId);
  }
  if (planRun.status !== 'SUCCEEDED' || !planRun.output) {
    return fail(ctx, analysisId, `Planning failed: ${planRun.error ?? 'unknown error'}`);
  }
  const plan = planRun.output;
  await savePlan(ctx, planRun.runId, plan);

  const wanted = new Set(plan.plan.map((p) => p.agent));
  const docs = (await s
    .from('tender_documents')
    .select(['id', 'readable'])
    .where('tender_id' as never, '=', tenderId as never)
    .execute()) as { id: string; readable: boolean }[];
  const hasReadableDocs = docs.some((d) => d.readable);

  // ── 2. document intelligence ───────────────────────────────────────────
  if (wanted.has('document_intelligence') && hasReadableDocs) {
    const run = await runAgent<DocumentIntelligenceOut>({
      ctx, agent: AGENTS.document_intelligence, input: base,
      analysisId, tenderId, parentRunId: planRun.runId,
    });
    if (run.status === 'SUCCEEDED' && run.output) {
      await persistRequirements(ctx, tenderId, run.output);
    } else {
      logger.warn('document intelligence did not complete', { analysisId, error: run.error });
    }
  }

  // ── 3. compatibility ───────────────────────────────────────────────────
  const compatRun = await runAgent<CompatibilityOut>({
    ctx, agent: AGENTS.compatibility, input: base, analysisId, tenderId, parentRunId: planRun.runId,
  });
  if (compatRun.status !== 'SUCCEEDED' || !compatRun.output) {
    return fail(ctx, analysisId, `Compatibility assessment failed: ${compatRun.error ?? 'unknown error'}`);
  }

  // ── 4. compliance ──────────────────────────────────────────────────────
  const complianceRun = await runAgent<ComplianceOut>({
    ctx, agent: AGENTS.compliance, input: base, analysisId, tenderId, parentRunId: planRun.runId,
  });
  if (complianceRun.status !== 'SUCCEEDED' || !complianceRun.output) {
    return fail(ctx, analysisId, `Compliance check failed: ${complianceRun.error ?? 'unknown error'}`);
  }

  const weights = await loadWeights(ctx);
  const dimensionInputs: DimensionInput[] = compatRun.output.dimensions.map((d) => ({
    key: d.key as DimensionKey, raw: d.raw, rationale: d.rationale,
  }));

  await persistDimensionsAndEvidence(ctx, analysisId, compatRun.output, weights);
  const { blockingGaps, unknownMandatory } = await persistCompliance(
    ctx, analysisId, tenderId, complianceRun.output,
  );

  // ── 5. risk ────────────────────────────────────────────────────────────
  let riskConfidence = 0.6;
  const riskRun = await runAgent<RiskOut>({
    ctx, agent: AGENTS.risk, input: { ...base, blockingGaps }, analysisId, tenderId, parentRunId: planRun.runId,
  });
  if (riskRun.status === 'SUCCEEDED' && riskRun.output) {
    riskConfidence = riskRun.output.confidence;
    await persistRisks(ctx, analysisId, riskRun.output);
  }

  // ── 6. score (deterministic) ───────────────────────────────────────────
  const scored = computeScore(dimensionInputs, weights);

  // ── 7. quality assurance ───────────────────────────────────────────────
  let qa: QaOut | null = null;
  const qaRun = await runAgent<QaOut>({
    ctx, agent: AGENTS.quality_assurance,
    input: { ...base, score: scored.score, blockingGaps }, analysisId, tenderId, parentRunId: planRun.runId,
  });
  if (qaRun.status === 'SUCCEEDED' && qaRun.output) qa = qaRun.output;

  const confidence = Number(
    (
      (compatRun.output.confidence + complianceRun.output.confidence + riskConfidence) / 3
    ).toFixed(3),
  );

  const engineVerdict = deriveVerdict({
    score: scored.score,
    blockingGaps,
    confidence,
    unknownMandatory,
    qaRequiresReview: qa?.requiresHumanReview ?? true, // no QA result ⇒ require review
  });

  // ── 8. recommendation prose ────────────────────────────────────────────
  let recommendation: RecommendationOut | null = null;
  const recRun = await runAgent<RecommendationOut>({
    ctx, agent: AGENTS.recommendation,
    input: {
      ...base,
      computedScore: scored.score,
      blockingGaps,
      unknownMandatory,
      engineVerdict: engineVerdict.verdict,
      engineReasons: engineVerdict.reasons.map((r) => r.en),
      qa: qa ?? { note: 'quality assurance did not complete' },
    },
    analysisId, tenderId, parentRunId: planRun.runId,
  });
  if (recRun.status === 'SUCCEEDED' && recRun.output) recommendation = recRun.output;

  const verdictOverridden = recommendation ? recommendation.verdict !== engineVerdict.verdict : false;
  if (verdictOverridden) {
    logger.info('engine overrode the proposed verdict', {
      analysisId, proposed: recommendation?.verdict, stored: engineVerdict.verdict,
    });
  }

  const needsReview =
    blockingGaps > 0 ||
    unknownMandatory > 0 ||
    (qa?.requiresHumanReview ?? true) ||
    engineVerdict.verdict === 'REQUIRES_FURTHER_REVIEW';

  const status: AnalysisStatus = needsReview ? 'NEEDS_HUMAN_REVIEW' : 'COMPLETE';

  const missingInfo = dedupe([
    ...compatRun.output.missingInformation,
    ...complianceRun.output.missingDocuments.map((d) => `Missing document: ${d}`),
    ...(riskRun.status === 'SUCCEEDED' ? (riskRun.output?.informationUncertainty ?? []) : []),
    ...(recommendation?.missingInformation ?? []),
  ]).slice(0, 60);

  await s
    .update('analyses')
    .set({
      status,
      score: scored.score,
      confidence,
      verdict: engineVerdict.verdict as Verdict,
      blocking_gaps: blockingGaps,
      methodology: JSON.stringify({
        ...scored.methodology,
        verdictRules: engineVerdict.reasons,
        verdictCapped: engineVerdict.capped,
        proposedVerdict: recommendation?.verdict ?? null,
        verdictOverridden,
        qa: qa ? { verdict: qa.verdict, requiresHumanReview: qa.requiresHumanReview } : null,
      }),
      summary: recommendation?.summary ?? engineVerdict.reasons.map((r) => r.en).join(' '),
      assumptions: recommendation?.assumptions ?? [],
      missing_info: missingInfo,
      next_actions: recommendation?.nextActions ?? [],
      finished_at: new Date(),
      updated_at: new Date(),
    })
    .where('id' as never, '=', analysisId as never)
    .execute();

  // ── 9. human checkpoints ───────────────────────────────────────────────
  const checkpoints = new Set(plan.humanCheckpoints);
  if (blockingGaps > 0 || unknownMandatory > 0) checkpoints.add('CRITICAL_REQUIREMENTS');
  if (qa?.requiresHumanReview) checkpoints.add('UNCERTAIN_ANALYSIS');
  checkpoints.add('RECOMMENDATION');

  for (const type of checkpoints) {
    if (type === 'RESPONSE_DRAFT' || type === 'EXPORT') continue; // raised by the drafting flow
    await requestApproval(ctx, {
      type,
      subjectType: 'analysis',
      subjectId: analysisId,
      analysisId,
      title: checkpointTitle(type, tender.title as string),
      detail: engineVerdict.reasons.map((r) => r.ar).join(' · '),
    });
  }

  await notify(ctx, {
    kind: 'ANALYSIS_COMPLETE',
    title: `تحليل «${String(tender.title).slice(0, 80)}» جاهز`,
    body: `الدرجة ${scored.score}/100 · ${blockingGaps > 0 ? `${blockingGaps} متطلب إلزامي ناقص` : 'لا متطلبات إلزامية ناقصة'}`,
    link: `/app/analysis/${analysisId}`,
  });
  if (blockingGaps > 0) {
    await notify(ctx, {
      kind: 'MISSING_DOCUMENT',
      title: `${blockingGaps} متطلب إلزامي قد يؤدي إلى الاستبعاد`,
      body: complianceRun.output.missingDocuments.slice(0, 5).join(' · ') || undefined,
      link: `/app/analysis/${analysisId}`,
    });
  }

  await audit(ctx, 'analysis.complete', { type: 'analysis', id: analysisId }, {
    score: scored.score, verdict: engineVerdict.verdict, blockingGaps, status,
  });

  return status;
}

// ───────────────────────────── persistence ─────────────────────────────

function summarizeTender(t: Record<string, unknown>) {
  return {
    title: t.title, entity: t.entity, referenceNo: t.reference_no, sector: t.sector,
    region: t.region, status: t.status, closesAt: t.closes_at, publishedAt: t.published_at,
    estimatedValueBand: t.estimated_value_band, bondRequired: t.bond_required,
    scopeOfWork: typeof t.scope_of_work === 'string' ? t.scope_of_work.slice(0, 8000) : null,
    submissionNotes: t.submission_notes,
    sourceKind: t.source_kind, verification: t.verification, isDemo: t.is_demo,
    dataNote:
      t.is_demo === true
        ? 'This record is clearly-labelled demonstration data, not a live official tender.'
        : 'This record came from a configured source; verification status is given above.',
  };
}

async function persistRequirements(ctx: Ctx, tenderId: string, out: DocumentIntelligenceOut) {
  const s = scoped(ctx);
  await s.delete('tender_requirements')
    .where('tender_id' as never, '=', tenderId as never)
    .where('provenance' as never, '=', 'AI_INFERRED' as never)
    .execute();

  if (out.requirements.length) {
    await s.insertMany(
      'tender_requirements',
      out.requirements.map((r) => ({
        tender_id: tenderId, category: r.category, mandatory: r.mandatory, text: r.text,
        doc_ref: r.docRef, page_ref: r.pageRef, provenance: 'AI_INFERRED', confidence: r.confidence,
      })),
    ).execute();
  }

  for (const d of out.unreadableDocuments) {
    await s.update('tender_documents')
      .set({ readable: false, note: 'Reported unreadable by the document agent.' })
      .where('tender_id' as never, '=', tenderId as never)
      .where('title' as never, '=', d as never)
      .execute();
  }
  await audit(ctx, 'document.extract', { type: 'tender', id: tenderId }, {
    requirements: out.requirements.length, unreadable: out.unreadableDocuments.length,
  });
}

async function persistDimensionsAndEvidence(
  ctx: Ctx, analysisId: string, out: CompatibilityOut, weights: Weights,
) {
  const s = scoped(ctx);
  await s.delete('score_dimensions').where('analysis_id' as never, '=', analysisId as never).execute();
  await s.delete('evidence').where('analysis_id' as never, '=', analysisId as never).execute();

  for (const d of out.dimensions) {
    const key = d.key as DimensionKey;
    const row = await s
      .insert('score_dimensions', {
        analysis_id: analysisId, key, label: DIMENSION_LABELS[key].ar,
        weight: weights[key], raw: clamp(d.raw), rationale: d.rationale,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const dimensionId = (row as { id: string }).id;

    if (d.evidence.length) {
      await s.insertMany(
        'evidence',
        d.evidence.map((e) => ({
          analysis_id: analysisId, dimension_id: dimensionId, provenance: e.provenance,
          statement: e.statement, source_type: e.sourceType, doc_ref: e.docRef,
          page_ref: e.pageRef, confidence: e.confidence,
        })),
      ).execute();
    }
  }

  const extras = [
    ...out.strengths.map((t) => ({ provenance: 'AI_INFERRED' as const, statement: `Strength: ${t}` })),
    ...out.gaps.map((t) => ({ provenance: 'AI_INFERRED' as const, statement: `Gap: ${t}` })),
    ...out.missingInformation.map((t) => ({ provenance: 'MISSING' as const, statement: t })),
  ];
  if (extras.length) {
    await s.insertMany(
      'evidence',
      extras.map((e) => ({
        analysis_id: analysisId, dimension_id: null, provenance: e.provenance,
        statement: e.statement.slice(0, 600), source_type: 'agent', doc_ref: null,
        page_ref: null, confidence: null,
      })),
    ).execute();
  }
}

async function persistCompliance(
  ctx: Ctx, analysisId: string, tenderId: string, out: ComplianceOut,
): Promise<{ blockingGaps: number; unknownMandatory: number }> {
  const s = scoped(ctx);
  await s.delete('compliance_items').where('analysis_id' as never, '=', analysisId as never).execute();

  const requirements = (await s
    .from('tender_requirements')
    .select(['id', 'text'])
    .where('tender_id' as never, '=', tenderId as never)
    .execute()) as { id: string; text: string }[];

  const match = (text: string): string | null => {
    const needle = normalize(text);
    let best: { id: string; score: number } | null = null;
    for (const r of requirements) {
      const hay = normalize(r.text);
      const score = hay === needle ? 1 : hay.includes(needle) || needle.includes(hay) ? 0.8 : 0;
      if (score > 0 && (!best || score > best.score)) best = { id: r.id, score };
    }
    return best?.id ?? null;
  };

  if (out.items.length) {
    await s.insertMany(
      'compliance_items',
      out.items.map((i) => ({
        analysis_id: analysisId,
        requirement_id: match(i.requirementText),
        label: i.label, category: i.category, mandatory: i.mandatory, status: i.status,
        // A mandatory item that is not met — or cannot be determined — blocks.
        blocking: i.blocking || (i.mandatory && i.status === 'NOT_MET'),
        note: i.note, provenance: i.provenance,
      })),
    ).execute();
  }

  const blockingGaps = out.items.filter(
    (i) => i.blocking || (i.mandatory && i.status === 'NOT_MET'),
  ).length;
  const unknownMandatory = out.items.filter((i) => i.mandatory && i.status === 'UNKNOWN').length;
  return { blockingGaps, unknownMandatory };
}

async function persistRisks(ctx: Ctx, analysisId: string, out: RiskOut) {
  const s = scoped(ctx);
  await s.delete('risks').where('analysis_id' as never, '=', analysisId as never).execute();
  if (!out.risks.length) return;
  await s.insertMany(
    'risks',
    out.risks.map((r) => ({
      analysis_id: analysisId, category: r.category, severity: r.severity,
      likelihood: r.likelihood, impact: r.impact, title: r.title,
      detail: r.detail, mitigation: r.mitigation,
    })),
  ).execute();
}

// ───────────────────────────── terminal states ─────────────────────────────

async function finishUnconfigured(ctx: Ctx, analysisId: string): Promise<AnalysisStatus> {
  await scoped(ctx)
    .update('analyses')
    .set({
      status: 'PROVIDER_UNCONFIGURED',
      failure_reason:
        'No AI provider is configured for this deployment, so no agent was executed and ' +
        `nothing was analysed. Set ${aiKeyName()} and run the analysis again.`,
      finished_at: new Date(), updated_at: new Date(),
    })
    .where('id' as never, '=', analysisId as never)
    .execute();
  logger.warn('analysis stopped: provider not configured', { analysisId });
  return 'PROVIDER_UNCONFIGURED';
}

async function fail(ctx: Ctx, analysisId: string, reason: string): Promise<AnalysisStatus> {
  await scoped(ctx)
    .update('analyses')
    .set({ status: 'FAILED', failure_reason: reason.slice(0, 2000), finished_at: new Date(), updated_at: new Date() })
    .where('id' as never, '=', analysisId as never)
    .execute();
  await notify(ctx, {
    kind: 'AGENT_FAILURE',
    title: 'تعذّر إكمال التحليل',
    body: reason.slice(0, 300),
    link: `/app/analysis/${analysisId}`,
  });
  await audit(ctx, 'analysis.fail', { type: 'analysis', id: analysisId }, { reason });
  return 'FAILED';
}

function checkpointTitle(type: string, tenderTitle: string): string {
  const t = tenderTitle.slice(0, 60);
  switch (type) {
    case 'CRITICAL_REQUIREMENTS': return `مراجعة المتطلبات الحرجة — ${t}`;
    case 'UNCERTAIN_ANALYSIS': return `تحليل يحتاج تأكيداً بشرياً — ${t}`;
    case 'COMPANY_PROFILE': return 'تأكيد بيانات المنشأة قبل الاعتماد عليها';
    case 'RECOMMENDATION': return `اعتماد التوصية — ${t}`;
    default: return `مراجعة — ${t}`;
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

// ───────────────────────────── read models ─────────────────────────────

export async function getAnalysis(ctx: Ctx, analysisId: string) {
  const s = scoped(ctx);
  const analysis = await s.findById('analyses', analysisId);
  if (!analysis) throw notFound('Analysis not found in this workspace.');
  const a = analysis as { tender_id: string };

  const [tender, dimensions, evidence, compliance, risks] = await Promise.all([
    s.findById('tenders', a.tender_id),
    s.from('score_dimensions').selectAll().where('analysis_id' as never, '=', analysisId as never).execute(),
    s.from('evidence').selectAll().where('analysis_id' as never, '=', analysisId as never).limit(400).execute(),
    s.from('compliance_items').selectAll().where('analysis_id' as never, '=', analysisId as never).execute(),
    s.from('risks').selectAll().where('analysis_id' as never, '=', analysisId as never).execute(),
  ]);

  return { analysis, tender, dimensions, evidence, compliance, risks };
}

export async function listAnalyses(ctx: Ctx, limit = 50) {
  return scoped(ctx)
    .from('analyses')
    .innerJoin('tenders', 'tenders.id', 'analyses.tender_id')
    .select([
      'analyses.id as id', 'analyses.status as status', 'analyses.score as score',
      'analyses.verdict as verdict', 'analyses.blocking_gaps as blocking_gaps',
      'analyses.created_at as created_at', 'analyses.finished_at as finished_at',
      'tenders.id as tender_id', 'tenders.title as tender_title', 'tenders.entity as entity',
      'tenders.closes_at as closes_at', 'tenders.is_demo as is_demo',
    ])
    .orderBy('analyses.created_at', 'desc')
    .limit(limit)
    .execute();
}
