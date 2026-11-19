import { created, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { addManualTender, searchTenders } from '@/server/tenders';

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { raw[k] = v; });
  return ok((await searchTenders(ctx, raw)) as never);
});

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  return created({ id: await addManualTender(ctx, await req.json()) });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
