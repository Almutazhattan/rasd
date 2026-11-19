/**
 * Scheduled sweep for serverless hosts (Vercel Cron, see vercel.json).
 *
 * Does what the long-running worker does on its timer: requeues jobs whose
 * invocation was cut off, prunes expired sessions, enqueues the daily deadline
 * sweep for every organization, then drains the queue within a time budget.
 *
 * Authenticated by CRON_SECRET, which Vercel Cron sends as a bearer token.
 * Without CRON_SECRET configured the route refuses every call.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/lib/db';
import { requeueStale } from '@/server/jobs';
import { drainJobs } from '@/server/job-runner';
import { pruneExpiredSessions } from '@/lib/session';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const started = Date.now();
  // Function invocations are capped at maxDuration, so anything RUNNING longer
  // than that was cut off and is safe to hand out again.
  const requeued = await requeueStale(10 * 60_000);
  await pruneExpiredSessions();

  const enqueueSweep = new URL(req.url).searchParams.get('sweep') !== '0';
  let swept = 0;
  if (enqueueSweep) {
    const res = await getDb()
      .insertInto('jobs')
      .columns(['org_id', 'type'])
      .expression((eb) => eb.selectFrom('organizations').select(['id', eb.val('DEADLINE_SWEEP').as('type')]))
      .executeTakeFirst();
    swept = Number(res.numInsertedOrUpdatedRows ?? 0);
  }

  const ran = await drainJobs({ budgetMs: 240_000, workerId: 'cron' });
  const result = { requeued, deadlineSweepsQueued: swept, jobsRun: ran, ms: Date.now() - started };
  logger.info('cron sweep finished', result);
  return NextResponse.json({ ok: true, data: result });
}
