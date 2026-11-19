/**
 * Reporting.
 *
 * Every report is assembled from stored records — analyses, compliance items,
 * risks, agent runs, audit entries. Nothing is recomputed from a model and
 * nothing is filled in: a report of an empty workspace is an empty report that
 * says so.
 */
import { scoped, type Ctx } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { getDb } from '@/lib/db';
import type { ReportKind } from '@/lib/db/types';
import { VERDICT_LABELS } from '@/lib/scoring';
import { readiness } from './company';

export interface ReportPayload {
  kind: ReportKind;
  title: string;
  generatedAt: string;
  /** Tabular part, used for CSV export. */
  rows: Record<string, unknown>[];
  /** Narrative or scalar part. */
  meta: Record<string, unknown>;
  /** Stated plainly when the workspace has nothing to report yet. */
  emptyNote?: string;
}

export async function buildReport(
  ctx: Ctx, kind: ReportKind, opts: { analysisId?: string } = {},
): Promise<ReportPayload> {
  if (!('system' in ctx)) assertCan(ctx.role, 'report:read');
  const s = scoped(ctx);
  const generatedAt = new Date().toISOString();

  switch (kind) {
    case 'OPPORTUNITY_ANALYSIS': {
      if (!opts.analysisId) throw notFound('An analysis id is required for this report.');
      const analysis = (await s.getById('analyses', opts.analysisId, 'Analysis')) as Record<string, unknown>;
      const tender = (await s.getById('tenders', analysis.tender_id as string, 'Tender')) as Record<string, unknown>;
      const [dimensions, compliance, risks, evidence] = await Promise.all([
        s.from('score_dimensions').selectAll().where('analysis_id' as never, '=', opts.analysisId as never).execute(),
        s.from('compliance_items').selectAll().where('analysis_id' as never, '=', opts.analysisId as never).execute(),
        s.from('risks').selectAll().where('analysis_id' as never, '=', opts.analysisId as never).execute(),
        s.from('evidence').selectAll().where('analysis_id' as never, '=', opts.analysisId as never).limit(400).execute(),
      ]);
      return {
        kind, generatedAt,
        title: `تقرير تحليل فرصة — ${String(tender.title).slice(0, 80)}`,
        rows: dimensions as Record<string, unknown>[],
        meta: {
          tender: {
            title: tender.title, entity: tender.entity, closesAt: tender.closes_at,
            isDemo: tender.is_demo, verification: tender.verification,
          },
          score: analysis.score,
          verdict: analysis.verdict ? VERDICT_LABELS[analysis.verdict as keyof typeof VERDICT_LABELS] : null,
          blockingGaps: analysis.blocking_gaps,
          confidence: analysis.confidence,
          methodology: analysis.methodology,
          summary: analysis.summary,
          assumptions: analysis.assumptions,
          missingInformation: analysis.missing_info,
          nextActions: analysis.next_actions,
          compliance, risks, evidence,
        },
      };
    }

    case 'COMPANY_READINESS': {
      const r = await readiness(ctx);
      const docs = await s.from('company_documents')
        .select(['title', 'kind', 'expires_at', 'extracted_at', 'text_chars']).execute();
      return {
        kind, generatedAt, title: 'تقرير جاهزية المنشأة',
        rows: docs as Record<string, unknown>[],
        meta: { score: r.score, findings: r.findings, expiring: r.expiring },
        emptyNote: docs.length === 0 ? 'لا توجد وثائق مرفوعة بعد، فالجاهزية محسوبة على بيانات ناقصة.' : undefined,
      };
    }

    case 'COMPLIANCE': {
      const rows = await s.from('compliance_items')
        .innerJoin('analyses', 'analyses.id', 'compliance_items.analysis_id')
        .innerJoin('tenders', 'tenders.id', 'analyses.tender_id')
        .select(['tenders.title as tender', 'compliance_items.label as item',
          'compliance_items.category as category', 'compliance_items.mandatory as mandatory',
          'compliance_items.status as status', 'compliance_items.blocking as blocking',
          'compliance_items.note as note'])
        .orderBy('compliance_items.blocking', 'desc')
        .limit(1000)
        .execute();
      const blocking = (rows as { blocking: boolean }[]).filter((r) => r.blocking).length;
      return {
        kind, generatedAt, title: 'تقرير الالتزام',
        rows: rows as Record<string, unknown>[],
        meta: { total: rows.length, blocking },
        emptyNote: rows.length === 0 ? 'لم يُنفَّذ أي تحليل التزام بعد.' : undefined,
      };
    }

    case 'RISK': {
      const rows = await s.from('risks')
        .innerJoin('analyses', 'analyses.id', 'risks.analysis_id')
        .innerJoin('tenders', 'tenders.id', 'analyses.tender_id')
        .select(['tenders.title as tender', 'risks.category as category', 'risks.severity as severity',
          'risks.likelihood as likelihood', 'risks.impact as impact', 'risks.title as risk',
          'risks.mitigation as mitigation'])
        .orderBy('risks.severity', 'desc')
        .limit(1000)
        .execute();
      return {
        kind, generatedAt, title: 'تقرير المخاطر',
        rows: rows as Record<string, unknown>[],
        meta: {
          bySeverity: tally(rows as { severity: string }[], 'severity'),
          byCategory: tally(rows as unknown as { category: string }[], 'category'),
        },
        emptyNote: rows.length === 0 ? 'لا توجد مخاطر مسجّلة بعد.' : undefined,
      };
    }

    case 'TENDER_COMPARISON': {
      const rows = await s.from('analyses')
        .innerJoin('tenders', 'tenders.id', 'analyses.tender_id')
        .select(['tenders.title as tender', 'tenders.entity as entity', 'tenders.closes_at as closes_at',
          'analyses.score as score', 'analyses.verdict as verdict',
          'analyses.blocking_gaps as blocking_gaps', 'analyses.confidence as confidence',
          'tenders.is_demo as is_demo'])
        .where('analyses.score' as never, 'is not' as never, null as never)
        .orderBy('analyses.score', 'desc')
        .limit(200)
        .execute();
      return {
        kind, generatedAt, title: 'مقارنة الفرص',
        rows: rows as Record<string, unknown>[],
        meta: { count: rows.length },
        emptyNote: rows.length === 0 ? 'لا توجد تحليلات مكتملة للمقارنة.' : undefined,
      };
    }

    case 'AGENT_EXECUTION': {
      const rows = await s.from('agent_runs')
        .select(['id', 'agent_key', 'status', 'attempts', 'model', 'input_tokens', 'out_tokens',
          'started_at', 'finished_at', 'error'])
        .orderBy('created_at', 'desc')
        .limit(500)
        .execute();
      const list = rows as { status: string; input_tokens: number | null; out_tokens: number | null }[];
      return {
        kind, generatedAt, title: 'تقرير تنفيذ الوكلاء',
        rows: rows as Record<string, unknown>[],
        meta: {
          byStatus: tally(list, 'status'),
          tokens: {
            input: list.reduce((a, r) => a + (r.input_tokens ?? 0), 0),
            output: list.reduce((a, r) => a + (r.out_tokens ?? 0), 0),
          },
        },
        emptyNote: rows.length === 0 ? 'لم يُنفَّذ أي وكيل بعد.' : undefined,
      };
    }

    case 'DECISION_HISTORY': {
      const rows = await s.from('approval_requests')
        .leftJoin('approval_decisions', 'approval_decisions.request_id', 'approval_requests.id')
        .leftJoin('users', 'users.id', 'approval_decisions.reviewer_id')
        .select(['approval_requests.title as subject', 'approval_requests.type as type',
          'approval_requests.status as status', 'approval_requests.created_at as requested_at',
          'approval_decisions.status as decision', 'approval_decisions.comment as comment',
          'approval_decisions.created_at as decided_at', 'users.name as reviewer'])
        .orderBy('approval_requests.created_at', 'desc')
        .limit(500)
        .execute();
      return {
        kind, generatedAt, title: 'سجل القرارات',
        rows: rows as Record<string, unknown>[],
        meta: { count: rows.length },
        emptyNote: rows.length === 0 ? 'لا قرارات مسجّلة بعد.' : undefined,
      };
    }

    case 'ACTIVITY': {
      const rows = await getDb()
        .selectFrom('audit_logs')
        .leftJoin('users', 'users.id', 'audit_logs.actor_id')
        .select(['audit_logs.action as action', 'audit_logs.target_type as target_type',
          'audit_logs.target_id as target_id', 'audit_logs.created_at as at', 'users.name as actor'])
        .where('audit_logs.org_id', '=', ctx.orgId)
        .orderBy('audit_logs.created_at', 'desc')
        .limit(1000)
        .execute();
      return {
        kind, generatedAt, title: 'تقرير النشاط',
        rows: rows as Record<string, unknown>[],
        meta: { byAction: tally(rows as { action: string }[], 'action') },
      };
    }
  }
}

export async function saveReport(ctx: Ctx, payload: ReportPayload, analysisId?: string) {
  if (!('system' in ctx)) assertCan(ctx.role, 'report:create');
  const row = await scoped(ctx)
    .insert('reports', {
      kind: payload.kind, analysis_id: analysisId ?? null, title: payload.title,
      payload: JSON.stringify(payload), format: 'json',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await audit(ctx, 'report.create', { type: 'report', id: (row as { id: string }).id }, { kind: payload.kind });
  return (row as { id: string }).id;
}

export async function listReports(ctx: Ctx) {
  return scoped(ctx)
    .from('reports')
    .select(['id', 'kind', 'title', 'created_at'])
    .orderBy('created_at', 'desc')
    .limit(100)
    .execute();
}

/** CSV with a UTF-8 BOM so Excel opens Arabic correctly. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '﻿';
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\n')}`;
}

function tally<T extends Record<string, unknown>>(rows: T[], key: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? 'unknown');
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
