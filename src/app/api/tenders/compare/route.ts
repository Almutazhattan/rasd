import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { compareTenders } from '@/server/tenders';

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { ids } = await body(req, z.object({ ids: z.array(z.string().uuid()).min(1).max(6) }));
  return ok((await compareTenders(ctx, ids)) as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
