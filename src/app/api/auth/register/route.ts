import { z } from 'zod';
import { body, clientKey, created, handler, rateLimit } from '@/server/http/handler';
import { register, registerInput } from '@/server/accounts';
import { startSessionCookie } from '@/server/http/context';
import { mailState } from '@/lib/env';

export const POST = handler(async (req: Request) => {
  rateLimit(clientKey(req, 'register'), 5, 10 * 60_000);
  const input = await body(req, registerInput);
  const result = await register(input);
  await startSessionCookie(result.userId, result.orgId);
  return created({
    orgId: result.orgId,
    slug: result.slug,
    emailDelivery: mailState(),
    // With no SMTP configured the token is returned so a developer can verify
    // locally. In production, configure SMTP and this is omitted.
    verifyToken: mailState() === 'CONNECTED' ? undefined : result.verifyToken,
  });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
void z;
