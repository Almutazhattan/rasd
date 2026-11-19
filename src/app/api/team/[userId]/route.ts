import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { changeMemberRole, removeMember } from '@/server/accounts';

const input = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'PROCUREMENT_MANAGER', 'ANALYST', 'REVIEWER', 'MEMBER']),
});

export const PATCH = handler(async (req: Request, { params }: { params: { userId: string } }) => {
  const ctx = await requireAuth();
  const { role } = await body(req, input);
  await changeMemberRole(ctx, params.userId, role);
  return ok({ updated: true });
});

export const DELETE = handler(async (_req: Request, { params }: { params: { userId: string } }) => {
  await removeMember(await requireAuth(), params.userId);
  return ok({ removed: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
