import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { listInvitations, listMembers } from '@/server/accounts';
import { ROLE_LABELS } from '@/lib/rbac';

export const GET = handler(async () => {
  const ctx = await requireAuth();
  return ok({
    members: await listMembers(ctx),
    invitations: await listInvitations(ctx),
    roles: ROLE_LABELS,
    you: { userId: ctx.userId, role: ctx.role },
  } as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
