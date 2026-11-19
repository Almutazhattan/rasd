import { z } from 'zod';
import { body, clientKey, handler, ok, rateLimit } from '@/server/http/handler';
import { completePasswordReset } from '@/server/accounts';
import { AppError } from '@/lib/errors';

const input = z.object({ token: z.string().min(10).max(200), password: z.string().min(10).max(200) });

export const POST = handler(async (req: Request) => {
  rateLimit(clientKey(req, 'reset'), 10, 15 * 60_000);
  const { token, password } = await body(req, input);
  const done = await completePasswordReset(token, password);
  if (!done) throw new AppError('VALIDATION', 'This reset link is invalid or has expired.');
  return ok({ reset: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
