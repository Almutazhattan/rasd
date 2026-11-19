import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { deleteTender, getTender } from '@/server/tenders';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) =>
  ok((await getTender(await requireAuth(), params.id)) as never));

export const DELETE = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  await deleteTender(await requireAuth(), params.id);
  return ok({ deleted: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
