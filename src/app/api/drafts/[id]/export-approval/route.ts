import { created, handler } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { requestExportApproval } from '@/server/drafts';

export const POST = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  return created({ approvalId: await requestExportApproval(ctx, params.id) });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
