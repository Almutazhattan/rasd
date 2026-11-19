import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { switchWorkspace } from '@/server/http/context';
import { forbidden } from '@/lib/errors';

export const POST = handler(async (req: Request) => {
  const { orgId } = await body(req, z.object({ orgId: z.string().uuid() }));
  if (!(await switchWorkspace(orgId))) throw forbidden('You are not a member of that workspace.');
  return ok({ orgId });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
