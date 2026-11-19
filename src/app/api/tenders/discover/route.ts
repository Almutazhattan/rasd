import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { discover, providerStates } from '@/server/providers';
import { enqueue } from '@/server/jobs';
import { kickJobs } from '@/server/job-runner';
import { assertCan } from '@/lib/rbac';

const input = z.object({
  keywords: z.array(z.string().max(100)).max(20).optional(),
  sectors: z.array(z.string().max(120)).max(20).optional(),
  regions: z.array(z.string().max(120)).max(20).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  /** Run now and wait, or hand it to the worker. */
  background: z.boolean().default(false),
});

export const GET = handler(async () => {
  await requireAuth();
  return ok({ providers: providerStates() });
});

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  assertCan(ctx.role, 'tender:import');
  const { background, ...query } = await body(req, input);
  if (background) {
    const jobId = await enqueue(ctx, 'DISCOVER_TENDERS', { query });
    await kickJobs();
    return ok({ jobId, queued: true });
  }
  return ok((await discover(ctx, query)) as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
