import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { toggleBookmark } from '@/server/tenders';

export const POST = handler(async (_req: Request, { params }: { params: { id: string } }) =>
  ok({ bookmarked: await toggleBookmark(await requireAuth(), params.id) }));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
