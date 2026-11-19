import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { newVersion } from '@/server/drafts';

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const { note } = await body(req, z.object({ note: z.string().max(500).optional() }));
  return ok({ version: await newVersion(ctx, params.id, note) });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
