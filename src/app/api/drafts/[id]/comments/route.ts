import { z } from 'zod';
import { body, created, handler } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { addComment } from '@/server/drafts';

const input = z.object({ body: z.string().min(1).max(4000), sectionId: z.string().uuid().optional() });

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const { body: text, sectionId } = await body(req, input);
  await addComment(ctx, params.id, text, sectionId);
  return created({ added: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
