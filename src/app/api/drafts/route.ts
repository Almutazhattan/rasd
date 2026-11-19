import { z } from 'zod';
import { body, created, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { createDraft, listDrafts } from '@/server/drafts';
import { enqueue } from '@/server/jobs';

const input = z.object({ analysisId: z.string().uuid(), background: z.boolean().default(true) });

export const GET = handler(async () => ok((await listDrafts(await requireAuth())) as never));

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { analysisId, background } = await body(req, input);
  if (background) {
    return created({ jobId: await enqueue(ctx, 'DRAFT_RESPONSE', { analysisId }), queued: true });
  }
  return created((await createDraft(ctx, analysisId)) as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
