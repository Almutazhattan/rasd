import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { confirmProfile } from '@/server/company';

export const POST = handler(async () => {
  await confirmProfile(await requireAuth());
  return ok({ confirmed: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
