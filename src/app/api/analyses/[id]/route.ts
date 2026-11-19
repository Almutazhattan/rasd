import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { getAnalysis } from '@/server/analysis';
import { runTree } from '@/agents/runner';
import { kickJobs } from '@/server/job-runner';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const [analysis, agents] = await Promise.all([getAnalysis(ctx, params.id), runTree(ctx, params.id)]);
  // On serverless hosts, a poll of a still-queued analysis nudges the queue.
  if ((analysis.analysis as { status?: string } | undefined)?.status === 'QUEUED') await kickJobs();
  return ok({ ...analysis, agents } as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
