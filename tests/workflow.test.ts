/**
 * The end-to-end workflow, driven by a scripted provider.
 *
 * company registers → profile → documents → discovery → analysis
 *   → requirements, compatibility, compliance, risk
 *   → deterministic score → quality assurance → recommendation
 *   → approval checkpoints → draft → review → approved export
 *
 * The failure paths are tested alongside the happy one, because they are where
 * the product's promises actually live: a blocking compliance item must cap the
 * verdict, an unapproved draft must refuse to export, and an analysis with no
 * provider must end with nothing rather than something invented.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { register } from '@/server/accounts';
import { addCapability, addCertification, addPastProject, confirmProfile, saveProfile } from '@/server/company';
import { uploadCompanyDocument, uploadTenderDocument } from '@/server/documents';
import { discover } from '@/server/providers';
import { AnalysisYield, executeAnalysis, getAnalysis, startAnalysis } from '@/server/analysis';
import { createDraft, exportDraft, getDraft, requestExportApproval } from '@/server/drafts';
import { decideApproval, listApprovals } from '@/server/approvals';
import { buildReport } from '@/server/reports';
import { claimJob, completeJob } from '@/server/jobs';
import { scoped, systemContext, type AuthContext } from '@/lib/tenancy';
import { __setProvider, type LlmProvider, type LlmRequest, type LlmResult } from '@/agents/provider';
import type { Row } from '@/components/ui';

let ctx: AuthContext;
let reviewer: AuthContext;
let tenderId: string;

/**
 * A provider that answers each agent's submit tool with a canned, schema-valid
 * result. It is keyed by the submit tool offered in the request, so the script
 * follows the orchestrator's plan rather than assuming an order.
 */
class WorkflowProvider implements LlmProvider {
  readonly name = 'workflow';
  readonly state = 'CONNECTED' as const;
  readonly model = 'workflow-model';
  readonly calls: string[] = [];

  constructor(private overrides: Record<string, unknown> = {}) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const submit = (req.tools ?? []).find((t) => t.name.startsWith('submit_'))!;
    const key = submit.name.replace('submit_', '');
    this.calls.push(key);
    const input = this.overrides[key] ?? DEFAULTS[key];
    if (!input) throw new Error(`no scripted answer for ${key}`);
    return {
      text: '',
      toolUses: [{ id: `use-${this.calls.length}`, name: submit.name, input }],
      stopReason: 'tool_use',
      model: this.model,
      usage: { input: 100, output: 200 },
    };
  }
}

const dim = (key: string, raw: number, rationale: string) => ({
  key, raw, rationale,
  evidence: [{
    provenance: raw > 60 ? 'VERIFIED' : 'MISSING',
    statement: rationale,
    sourceType: 'profile',
    docRef: raw > 60 ? 'ملف المنشأة' : null,
    pageRef: null,
    confidence: 0.8,
  }],
});

const DEFAULTS: Record<string, unknown> = {
  orchestrator: {
    plan: [
      { agent: 'document_intelligence', reason: 'الوثائق موجودة ومقروءة', dependsOn: [] },
      { agent: 'compatibility', reason: 'مطابقة القدرات', dependsOn: ['document_intelligence'] },
      { agent: 'compliance', reason: 'فحص الإلزامي', dependsOn: ['document_intelligence'] },
      { agent: 'risk', reason: 'تقدير المخاطر', dependsOn: ['compliance'] },
      { agent: 'quality_assurance', reason: 'تحقق أخير', dependsOn: ['risk'] },
    ],
    humanCheckpoints: ['CRITICAL_REQUIREMENTS', 'RECOMMENDATION'],
    note: null,
  },
  document_intelligence: {
    requirements: [
      {
        category: 'administrative', mandatory: true,
        text: 'شهادة أيزو 27001 سارية',
        docRef: 'كراسة الشروط', pageRef: 12, confidence: 0.9,
      },
      {
        category: 'technical', mandatory: false,
        text: 'خبرة في مشروعين مماثلين',
        docRef: 'كراسة الشروط', pageRef: 14, confidence: 0.8,
      },
    ],
    keyDates: [{ label: 'آخر موعد لتقديم العروض', isoDate: '2030-01-01', pageRef: 3 }],
    attachmentsRequired: ['السجل التجاري', 'شهادة الزكاة'],
    unreadableDocuments: [],
    missingInformation: ['لم تُعلن قيمة الضمان الابتدائي'],
    notes: null,
  },
  compatibility: {
    dimensions: [
      dim('technicalFit', 88, 'القدرات المسجّلة تغطي نطاق العمل'),
      dim('experience', 74, 'مشروع مرجعي موثّق بقيمة مماثلة'),
      dim('complianceReadiness', 40, 'شهادة إلزامية غير سارية'),
      dim('resources', 70, 'عدد العاملين كافٍ للمدة المعلنة'),
      dim('financialReadiness', 55, 'لا قوائم مالية مرفوعة'),
      dim('geographic', 95, 'المنطقة داخل نطاق التغطية المعلن'),
    ],
    strengths: ['تغطية جغرافية مطابقة'],
    gaps: ['شهادة أيزو 27001 منتهية'],
    missingInformation: ['قوائم مالية مدققة'],
    confidence: 0.78,
  },
  compliance: {
    items: [
      {
        requirementText: 'شهادة أيزو 27001 سارية', label: 'شهادة أيزو 27001',
        category: 'administrative', mandatory: true, status: 'NOT_MET', blocking: true,
        note: 'الشهادة على الملف منتهية', matchedDocument: null, provenance: 'VERIFIED',
      },
      {
        requirementText: 'خبرة في مشروعين مماثلين', label: 'الخبرة المماثلة',
        category: 'technical', mandatory: false, status: 'PARTIAL', blocking: false,
        note: 'مشروع واحد موثّق', matchedDocument: 'ملف المنشأة', provenance: 'USER_PROVIDED',
      },
    ],
    missingDocuments: ['شهادة أيزو 27001 سارية'],
    expiringDocuments: [{ name: 'شهادة أيزو 27001', expiresOn: '2024-01-01' }],
    confidence: 0.8,
  },
  risk: {
    risks: [{
      category: 'compliance', severity: 'CRITICAL', likelihood: 5, impact: 5,
      title: 'احتمال الاستبعاد لشهادة منتهية',
      detail: 'المتطلب إلزامي والشهادة غير سارية',
      mitigation: 'تجديد الشهادة قبل موعد التقديم',
    }],
    informationUncertainty: ['قيمة الضمان غير معلنة'],
    confidence: 0.75,
  },
  quality_assurance: {
    verdict: 'PASS_WITH_FLAGS',
    contradictions: [],
    unsupportedClaims: [],
    brokenReferences: [],
    lowConfidenceAreas: ['الجاهزية المالية بلا مستندات'],
    requiresHumanReview: true,
    reason: 'بند إلزامي غير مستوفى يحتاج قراراً بشرياً',
  },
  recommendation: {
    verdict: 'POTENTIAL_OPPORTUNITY',
    summary: 'الفرصة مناسبة فنياً، لكن شهادة إلزامية منتهية قد تؤدي إلى الاستبعاد قبل أي تقييم فني.',
    assumptions: ['الشهادة قابلة للتجديد قبل موعد التقديم'],
    missingInformation: ['قوائم مالية مدققة'],
    nextActions: ['تجديد شهادة أيزو 27001', 'رفع القوائم المالية'],
    confidence: 0.7,
  },
  drafting: {
    sections: [
      {
        heading: 'الملخص التنفيذي',
        body: 'تتقدّم المنشأة بعرضها لتنفيذ نطاق العمل المعلن، مستندةً إلى قدراتها المسجّلة.',
        openPoints: ['قيمة الضمان الابتدائي غير معلنة في الكراسة'],
        sourceRefs: ['ملف المنشأة'],
      },
      {
        heading: 'المنهجية الفنية',
        body: 'تُنفَّذ الأعمال على ثلاث مراحل وفق الجدول المعلن.',
        openPoints: [],
        sourceRefs: ['كراسة الشروط ص14'],
      },
    ],
    requirementResponses: [
      {
        requirementText: 'شهادة أيزو 27001 سارية', response: null,
        evidenceNote: 'لا توجد شهادة سارية على الملف', provenance: 'MISSING', attachmentRef: null,
      },
      {
        requirementText: 'خبرة في مشروعين مماثلين',
        response: 'مشروع مرجعي واحد موثّق، والثاني قيد التوثيق.',
        evidenceNote: 'ملف المنشأة', provenance: 'USER_PROVIDED', attachmentRef: null,
      },
    ],
    attachmentChecklist: ['السجل التجاري', 'شهادة الزكاة'],
    unansweredQuestions: ['ما قيمة الضمان الابتدائي؟'],
  },
};

beforeAll(async () => {
  await resetDatabase();
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = '/tmp/rasd-workflow-storage';

  const owner = await register({
    name: 'Workflow Owner', email: 'owner@flow.test', password: 'a-long-password-1', orgName: 'Flow Contracting',
  });
  ctx = { userId: owner.userId, orgId: owner.orgId, role: 'OWNER', email: 'owner@flow.test', name: 'Workflow Owner' };

  const second = await register({
    name: 'Flow Reviewer', email: 'reviewer@flow.test', password: 'a-long-password-1', orgName: 'Other',
  });
  await scoped(ctx).insert('memberships', { user_id: second.userId, role: 'REVIEWER' }).execute();
  reviewer = {
    userId: second.userId, orgId: ctx.orgId, role: 'REVIEWER',
    email: 'reviewer@flow.test', name: 'Flow Reviewer',
  };
});

afterAll(teardown);
beforeEach(() => __setProvider(null));

describe('1–3. the company sets itself up', () => {
  it('registers, completes and confirms a profile, and uploads documents', async () => {
    await saveProfile(ctx, {
      legalName: 'شركة التدفق للمقاولات',
      industries: ['الإنشاءات والمقاولات'],
      activities: ['ترميم المباني'],
      services: ['ترميم واجهات'],
      regions: ['منطقة جازان'],
      employeeCount: 120,
      sizeBand: 'medium',
    });
    await addCapability(ctx, { label: 'ترميم المباني', level: 5 });
    await addCertification(ctx, {
      name: 'ISO 27001', issuer: 'جهة مانحة',
      expiresAt: new Date(Date.now() - 10 * 86_400_000), // expired on purpose
    });
    await addPastProject(ctx, {
      title: 'ترميم مجمّع', client: 'جهة حكومية', valueBand: '٥–١٠ مليون ريال',
    });
    await confirmProfile(ctx);

    const doc = await uploadCompanyDocument(ctx, {
      title: 'السجل التجاري', kind: 'cr', mimeType: 'text/plain',
      bytes: Buffer.from('سجل تجاري رقم 1010000001 ساري حتى 2030', 'utf8'),
    });
    expect(doc.readable).toBe(true);

    const profile = await scoped(ctx).from('company_profiles').selectAll().executeTakeFirst();
    expect((profile as Row).confirmed_at).not.toBeNull();
  });
});

describe('4. discovery brings in opportunities', () => {
  it('imports the labelled demonstration records and nothing unlabelled', async () => {
    const outcome = await discover(ctx, {});
    expect(outcome.imported).toBeGreaterThan(0);

    const tenders = (await scoped(ctx).from('tenders')
      .select(['id', 'title', 'is_demo', 'verification', 'source_kind']).execute()) as Row[];
    expect(tenders.every((t) => t.is_demo === true)).toBe(true);
    expect(tenders.every((t) => t.verification === 'DEMO_DATA')).toBe(true);

    tenderId = String(tenders[0]!.id);
    await uploadTenderDocument(ctx, tenderId, {
      title: 'كراسة الشروط', mimeType: 'text/plain',
      bytes: Buffer.from('المتطلبات: شهادة أيزو 27001 سارية. خبرة في مشروعين مماثلين.', 'utf8'),
    });
  });

  it('re-running discovery updates rather than duplicating', async () => {
    const before = await scoped(ctx).from('tenders').select('id').execute();
    const again = await discover(ctx, {});
    const after = await scoped(ctx).from('tenders').select('id').execute();
    expect(after.length).toBe(before.length);
    expect(again.imported).toBe(0);
  });
});

describe('5–10. the agents run and the platform scores', () => {
  it('queues an analysis as a job', async () => {
    const { analysisId, status } = await startAnalysis(ctx, tenderId);
    expect(status).toBe('QUEUED');

    const job = await claimJob('test-worker');
    expect(job?.type).toBe('RUN_ANALYSIS');
    expect((job?.payload as Row).analysisId).toBe(analysisId);
    await completeJob(job!.id);
  });

  it('runs every planned agent and caps the verdict on a blocking requirement', async () => {
    const provider = new WorkflowProvider();
    __setProvider(provider);

    const { analysisId } = await startAnalysis(ctx, tenderId);
    const status = await executeAnalysis(systemContext(ctx.orgId), analysisId);

    expect(status).toBe('NEEDS_HUMAN_REVIEW');
    expect(provider.calls).toContain('orchestrator');
    expect(provider.calls).toContain('document_intelligence');
    expect(provider.calls).toContain('compatibility');
    expect(provider.calls).toContain('compliance');
    expect(provider.calls).toContain('risk');
    expect(provider.calls).toContain('quality_assurance');
    expect(provider.calls).toContain('recommendation');

    const { analysis, dimensions, compliance, risks, evidence } = await getAnalysis(ctx, analysisId);
    const a = analysis as Row;

    // The score is the engine's weighted arithmetic, not the model's opinion.
    expect(a.score).toBe(70);
    expect(dimensions).toHaveLength(6);

    // A mandatory unmet requirement blocks, and the verdict is capped by it —
    // the agent proposed POTENTIAL_OPPORTUNITY.
    expect(a.blocking_gaps).toBe(1);
    expect(a.verdict).toBe('REQUIRES_FURTHER_REVIEW');
    const methodology = a.methodology as Row;
    expect(methodology.verdictOverridden).toBe(true);
    expect(methodology.proposedVerdict).toBe('POTENTIAL_OPPORTUNITY');
    expect(methodology.verdictCapped).toBe(true);

    expect((compliance as Row[]).filter((c) => c.blocking)).toHaveLength(1);
    expect(risks).toHaveLength(1);
    expect((evidence as Row[]).some((e) => e.provenance === 'MISSING')).toBe(true);

    // Requirements were persisted with their page references.
    const requirements = (await scoped(ctx).from('tender_requirements')
      .select(['text', 'page_ref', 'mandatory'])
      .where('tender_id' as never, '=', tenderId as never).execute()) as Row[];
    expect(requirements.some((r) => r.page_ref === 12 && r.mandatory)).toBe(true);
  }, 60_000);

  it('records every agent run and its steps for audit', async () => {
    const runs = (await scoped(ctx).from('agent_runs')
      .select(['id', 'agent_key', 'status', 'model', 'input_tokens', 'parent_run_id'])
      .execute()) as Row[];
    expect(runs.length).toBeGreaterThanOrEqual(7);
    expect(runs.every((r) => r.model === 'workflow-model' || r.status === 'PROVIDER_UNCONFIGURED')).toBe(true);
    // Specialists hang off the orchestrator's run.
    expect(runs.some((r) => r.parent_run_id !== null)).toBe(true);

    const steps = (await scoped(ctx).from('agent_steps').select(['run_id', 'label']).execute()) as Row[];
    expect(steps.length).toBeGreaterThan(0);
  });

  it('raises the human checkpoints the analysis needs', async () => {
    const pending = (await listApprovals(ctx, 'PENDING')) as Row[];
    const types = pending.map((p) => p.type);
    expect(types).toContain('CRITICAL_REQUIREMENTS');
    expect(types).toContain('RECOMMENDATION');
    expect(types).toContain('UNCERTAIN_ANALYSIS'); // QA asked for review
  });
});

describe('11–15. review, draft, approve, export', () => {
  let analysisId: string;
  let draftId: string;

  beforeEach(async () => {
    const analyses = (await scoped(ctx).from('analyses').select('id')
      .where('status' as never, '=', 'NEEDS_HUMAN_REVIEW' as never).execute()) as Row[];
    analysisId = String(analyses[0]!.id);
  });

  it('a reviewer decides the pending checkpoints', async () => {
    const pending = ((await listApprovals(ctx, 'PENDING')) as Row[])
      .filter((p) => p.analysis_id === analysisId);
    expect(pending.length).toBeGreaterThan(0);

    for (const request of pending) {
      const result = await decideApproval(reviewer, String(request.id), 'APPROVED', 'مراجعة مقبولة');
      expect(result.status).toBe('APPROVED');
    }
    expect(((await listApprovals(ctx, 'PENDING')) as Row[])
      .filter((p) => p.analysis_id === analysisId)).toHaveLength(0);
  });

  it('the drafting agent produces a draft that states what it could not support', async () => {
    __setProvider(new WorkflowProvider());
    const result = await createDraft(ctx, analysisId);
    expect(result.status).toBe('SUCCEEDED');
    draftId = result.draftId;

    const { sections, mappings } = await getDraft(ctx, draftId);
    expect(sections).toHaveLength(2);

    // The requirement with no company evidence is MISSING with a null response —
    // not a confident sentence the company cannot back up.
    const missing = (mappings as Row[]).find((m) => m.provenance === 'MISSING');
    expect(missing).toBeTruthy();
    expect(missing!.response).toBeNull();

    const open = (sections as Row[]).flatMap((s) => s.open_points as string[]);
    expect(open.some((p) => p.includes('الضمان'))).toBe(true);
  }, 30_000);

  it('refuses to export an unapproved draft', async () => {
    await expect(exportDraft(ctx, draftId, 'md')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses to raise an export checkpoint before the draft itself is approved', async () => {
    await expect(requestExportApproval(ctx, draftId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('exports only after the draft and the export are both approved', async () => {
    const draftApproval = ((await listApprovals(ctx, 'PENDING')) as Row[])
      .find((p) => p.type === 'RESPONSE_DRAFT' && p.draft_id === draftId);
    expect(draftApproval).toBeTruthy();
    await decideApproval(reviewer, String(draftApproval!.id), 'APPROVED', 'المسودة مقبولة');

    // Draft approved, export not yet: still refused.
    await expect(exportDraft(ctx, draftId, 'md')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const exportId = await requestExportApproval(ctx, draftId);
    await decideApproval(reviewer, exportId, 'APPROVED', 'التصدير مقبول');

    const file = await exportDraft(ctx, draftId, 'md');
    expect(file.filename).toMatch(/\.md$/);
    expect(file.content).toContain('الملخص التنفيذي');
    expect(file.content).toContain('مصفوفة المتطلبات');
    // The export states plainly that submission is the user's act.
    expect(file.content).toContain('التقديم الفعلي مسؤولية');
    expect(file.content).toContain('— غير متوفر'); // the unsupported requirement

    const html = await exportDraft(ctx, draftId, 'html');
    expect(html.content).toContain('<!DOCTYPE html>');
    expect(html.content).toContain('dir="rtl"');
  });

  it('editing an approved draft reopens it for review', async () => {
    const { sections } = await getDraft(ctx, draftId);
    const { updateSection } = await import('@/server/drafts');
    await updateSection(ctx, String((sections as Row[])[0]!.id), 'نصّ محرَّر بعد الاعتماد');

    const draft = (await scoped(ctx).getById('response_drafts', draftId, 'Draft')) as Row;
    expect(draft.approved_at).toBeNull();
    await expect(exportDraft(ctx, draftId, 'md')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps the whole workflow in the company history', async () => {
    const report = await buildReport(ctx, 'OPPORTUNITY_ANALYSIS', { analysisId });
    expect(report.rows).toHaveLength(6);
    expect((report.meta as Row).blockingGaps).toBe(1);

    const activity = await buildReport(ctx, 'ACTIVITY');
    const actions = (activity.rows as Row[]).map((r) => r.action);
    for (const action of ['auth.register', 'profile.confirm', 'document.upload', 'tender.discover',
      'analysis.start', 'analysis.complete', 'approval.decide', 'draft.create', 'draft.export']) {
      expect(actions, action).toContain(action);
    }

    const agentReport = await buildReport(ctx, 'AGENT_EXECUTION');
    expect((agentReport.meta as Row).tokens.input).toBeGreaterThan(0);
  });
});

describe('failure paths', () => {
  it('an analysis with no provider configured ends with nothing, not something', async () => {
    __setProvider(null); // the test env has no API key
    const { analysisId } = await startAnalysis(ctx, tenderId);
    const status = await executeAnalysis(systemContext(ctx.orgId), analysisId);

    expect(status).toBe('PROVIDER_UNCONFIGURED');
    const { analysis, dimensions, compliance, risks } = await getAnalysis(ctx, analysisId);
    const a = analysis as Row;
    expect(a.score).toBeNull();
    expect(a.verdict).toBeNull();
    expect(a.failure_reason).toMatch(/nothing was analysed/i);
    expect(dimensions).toHaveLength(0);
    expect(compliance).toHaveLength(0);
    expect(risks).toHaveLength(0);
  });

  it('a failed specialist fails the analysis instead of scoring without it', async () => {
    class PartialProvider extends WorkflowProvider {
      async complete(req: LlmRequest): Promise<LlmResult> {
        const submit = (req.tools ?? []).find((t) => t.name.startsWith('submit_'))!;
        if (submit.name === 'submit_compatibility') throw new Error('compatibility unavailable');
        return super.complete(req);
      }
    }
    __setProvider(new PartialProvider());

    const { analysisId } = await startAnalysis(ctx, tenderId);
    const status = await executeAnalysis(systemContext(ctx.orgId), analysisId);

    expect(status).toBe('FAILED');
    const { analysis } = await getAnalysis(ctx, analysisId);
    expect((analysis as Row).score).toBeNull();
    expect((analysis as Row).failure_reason).toMatch(/Compatibility assessment failed/i);
  }, 60_000);

  it('a draft cannot be created from an analysis that never ran', async () => {
    const analyses = (await scoped(ctx).from('analyses').select('id')
      .where('status' as never, '=', 'PROVIDER_UNCONFIGURED' as never).execute()) as Row[];
    await expect(createDraft(ctx, String(analyses[0]!.id))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('serverless: an analysis split across invocations', () => {
  /** A provider that takes a moment, so a tight invocation deadline runs out. */
  class SlowProvider extends WorkflowProvider {
    async complete(req: LlmRequest): Promise<LlmResult> {
      await new Promise((r) => setTimeout(r, 120));
      return super.complete(req);
    }
  }

  it('yields when an invocation is nearly over, then resumes without repeating any agent', async () => {
    const provider = new SlowProvider();
    __setProvider(provider);
    const { analysisId } = await startAnalysis(ctx, tenderId);
    const sys = systemContext(ctx.orgId);

    // Just enough time for one stage to start, not the next.
    const tight = Date.now() + 150_000 + 60;
    await expect(executeAnalysis(sys, analysisId, { deadlineAt: tight }))
      .rejects.toBeInstanceOf(AnalysisYield);
    expect(provider.calls).toEqual(['orchestrator']);
    expect(((await getAnalysis(ctx, analysisId)).analysis as Row).status).toBe('RUNNING');

    // Next invocation, plenty of time: carries on from where it stopped.
    const status = await executeAnalysis(sys, analysisId, { deadlineAt: Date.now() + 10 * 60_000 });
    expect(status).toBe('NEEDS_HUMAN_REVIEW');
    expect(provider.calls.filter((c) => c === 'orchestrator')).toHaveLength(1);
    expect(new Set(provider.calls).size).toBe(provider.calls.length); // every agent ran exactly once

    const { analysis, dimensions } = await getAnalysis(ctx, analysisId);
    expect((analysis as Row).score).not.toBeNull();
    expect(dimensions).toHaveLength(6); // persisted once, not duplicated by the resume
  }, 60_000);

  it('a finished analysis is not re-run by a duplicate job', async () => {
    const provider = new WorkflowProvider();
    __setProvider(provider);
    const { analysisId } = await startAnalysis(ctx, tenderId);
    const sys = systemContext(ctx.orgId);
    await executeAnalysis(sys, analysisId);
    const before = provider.calls.length;
    await executeAnalysis(sys, analysisId);
    expect(provider.calls.length).toBe(before);
  }, 60_000);
});
