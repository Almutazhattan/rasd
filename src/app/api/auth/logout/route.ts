import { handler, ok } from '@/server/http/handler';
import { endSessionCookie } from '@/server/http/context';

export const POST = handler(async () => {
  await endSessionCookie();
  return ok({ signedOut: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
