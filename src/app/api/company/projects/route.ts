import { z } from 'zod';
import { body, handler, ok, query } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { addPastProject, projectInput, removeChild } from '@/server/company';

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  await addPastProject(ctx, await body(req, projectInput));
  return ok({ added: true });
});

export const DELETE = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { id } = query(req, z.object({ id: z.string().uuid() }));
  await removeChild(ctx, 'past_projects', id);
  return ok({ removed: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
