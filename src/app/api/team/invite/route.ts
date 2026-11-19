import { body, created, handler } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { inviteInput, inviteMember } from '@/server/accounts';
import { mailState } from '@/lib/env';

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const result = await inviteMember(ctx, await body(req, inviteInput));
  return created({
    emailDelivery: result.emailDelivery,
    // Without SMTP the operator passes the link along themselves; the API says
    // so rather than implying an email was sent.
    inviteToken: mailState() === 'CONNECTED' ? undefined : result.token,
  });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
