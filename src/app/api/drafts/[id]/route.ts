import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { getDraft } from '@/server/drafts';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) =>
  ok((await getDraft(await requireAuth(), params.id)) as never));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
