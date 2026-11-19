import { z } from 'zod';
import { body, handler, ok, query } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { addCapability, capabilityInput, removeChild } from '@/server/company';

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  await addCapability(ctx, await body(req, capabilityInput));
  return ok({ added: true });
});

export const DELETE = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { id } = query(req, z.object({ id: z.string().uuid() }));
  await removeChild(ctx, 'capabilities', id);
  return ok({ removed: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
