import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { deleteCompanyDocument } from '@/server/documents';

export const DELETE = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  await deleteCompanyDocument(await requireAuth(), params.id);
  return ok({ deleted: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
