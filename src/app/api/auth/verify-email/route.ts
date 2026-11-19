import { z } from 'zod';
import { handler, ok, query } from '@/server/http/handler';
import { verifyEmail } from '@/server/accounts';

export const GET = handler(async (req: Request) => {
  const { token } = query(req, z.object({ token: z.string().min(10).max(200) }));
  return ok({ verified: await verifyEmail(token) });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
