import { z } from 'zod';
import { body, created, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { listAnalyses, startAnalysis } from '@/server/analysis';
import { kickJobs } from '@/server/job-runner';

export const GET = handler(async () => ok((await listAnalyses(await requireAuth())) as never));

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { tenderId } = await body(req, z.object({ tenderId: z.string().uuid() }));
  const result = await startAnalysis(ctx, tenderId);
  await kickJobs();
  return created(result as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
