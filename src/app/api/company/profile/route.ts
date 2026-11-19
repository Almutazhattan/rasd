import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { getProfile, profileInput, saveProfile } from '@/server/company';

export const GET = handler(async () => ok(((await getProfile(await requireAuth())) ?? null) as never));

export const PUT = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const input = await body(req, profileInput);
  return ok({ profileId: await saveProfile(ctx, input) });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
