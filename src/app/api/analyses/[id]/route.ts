import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { getAnalysis } from '@/server/analysis';
import { runTree } from '@/agents/runner';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const [analysis, agents] = await Promise.all([getAnalysis(ctx, params.id), runTree(ctx, params.id)]);
  return ok({ ...analysis, agents } as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
