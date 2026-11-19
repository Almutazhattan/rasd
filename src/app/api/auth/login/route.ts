import { z } from 'zod';
import { body, clientKey, handler, ok, rateLimit } from '@/server/http/handler';
import { signIn } from '@/server/accounts';
import { startSessionCookie } from '@/server/http/context';
import { audit } from '@/lib/audit';

const input = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const POST = handler(async (req: Request) => {
  // Tight limit: this is the endpoint worth brute-forcing.
  rateLimit(clientKey(req, 'login'), 10, 10 * 60_000);
  const { email, password } = await body(req, input);
  const user = await signIn(email, password);
  await startSessionCookie(user.userId, user.orgId);
  if (user.orgId) {
    await audit(
      { userId: user.userId, orgId: user.orgId, role: user.role ?? 'MEMBER', email: user.email, name: user.name },
      'auth.login', { type: 'user', id: user.userId },
    );
  }
  return ok({
    userId: user.userId, name: user.name, orgId: user.orgId, role: user.role,
    emailVerified: Boolean(user.emailVerified),
  });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
