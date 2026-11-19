import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { currentSession, requireAuth } from '@/server/http/context';
import { listNotifications, markRead, setPreference, unreadCount } from '@/server/notifications';

export const GET = handler(async () => {
  const ctx = await requireAuth();
  const session = await currentSession();
  return ok({
    items: await listNotifications(ctx, session?.userId ?? null),
    unread: session ? await unreadCount(ctx, session.userId) : 0,
  } as never);
});

const patch = z.object({
  markRead: z.array(z.string().uuid()).optional(),
  markAll: z.boolean().optional(),
  preference: z.object({
    kind: z.enum(['NEW_OPPORTUNITY', 'DEADLINE', 'ANALYSIS_COMPLETE', 'MISSING_DOCUMENT',
      'APPROVAL_REQUEST', 'RISK_ALERT', 'AGENT_FAILURE']),
    inApp: z.boolean(),
    email: z.boolean(),
  }).optional(),
});

export const PATCH = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const input = await body(req, patch);
  if (input.markAll) await markRead(ctx, ctx.userId);
  else if (input.markRead?.length) await markRead(ctx, ctx.userId, input.markRead);
  if (input.preference) {
    await setPreference(ctx, ctx.userId, input.preference.kind, input.preference.inApp, input.preference.email);
  }
  return ok({ updated: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
