import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, ok, query } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { buildReport, listReports, saveReport, toCsv } from '@/server/reports';

const input = z.object({
  kind: z.enum(['OPPORTUNITY_ANALYSIS', 'COMPANY_READINESS', 'COMPLIANCE', 'RISK',
    'TENDER_COMPARISON', 'AGENT_EXECUTION', 'DECISION_HISTORY', 'ACTIVITY']).optional(),
  analysisId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
  save: z.enum(['true', 'false']).default('false'),
});

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { kind, analysisId, format, save } = query(req, input);

  if (!kind) return ok((await listReports(ctx)) as never);

  const report = await buildReport(ctx, kind, { analysisId });
  if (save === 'true') await saveReport(ctx, report, analysisId);

  if (format === 'csv') {
    return new NextResponse(toCsv(report.rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${kind.toLowerCase()}.csv`)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  return ok(report as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
