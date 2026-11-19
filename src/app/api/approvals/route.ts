import { z } from 'zod';
import { handler, ok, query } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { listApprovals } from '@/server/approvals';

const input = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELLED', 'ALL']).default('PENDING'),
});

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { status } = query(req, input);
  return ok((await listApprovals(ctx, status)) as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
