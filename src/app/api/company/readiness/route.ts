import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { readiness } from '@/server/company';

export const GET = handler(async () => ok(await readiness(await requireAuth()) as never));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
