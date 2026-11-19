import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { approvalHistory, decideApproval } from '@/server/approvals';

const input = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
  comment: z.string().max(2000).optional(),
});

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) =>
  ok((await approvalHistory(await requireAuth(), params.id)) as never));

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const { status, comment } = await body(req, input);
  return ok((await decideApproval(ctx, params.id, status, comment)) as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
