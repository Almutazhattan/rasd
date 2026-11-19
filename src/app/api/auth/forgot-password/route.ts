import { z } from 'zod';
import { body, clientKey, handler, ok, rateLimit } from '@/server/http/handler';
import { requestPasswordReset } from '@/server/accounts';
import { mailState } from '@/lib/env';
import { logger } from '@/lib/logger';

const input = z.object({ email: z.string().email() });

export const POST = handler(async (req: Request) => {
  rateLimit(clientKey(req, 'forgot'), 5, 15 * 60_000);
  const { email } = await body(req, input);
  const { token } = await requestPasswordReset(email);

  if (token && mailState() !== 'CONNECTED') {
    // No mail transport: the link is logged for the operator rather than
    // reported as sent.
    logger.warn('password reset link not emailed — SMTP not configured', { hasToken: true });
  }

  // The same response either way: this endpoint must not reveal whether an
  // address is registered.
  return ok({
    accepted: true,
    emailDelivery: mailState(),
    note:
      mailState() === 'CONNECTED'
        ? 'If that address has an account, a reset link is on its way.'
        : 'Email delivery is not configured in this deployment; ask an operator for the reset link from the server log.',
  });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
