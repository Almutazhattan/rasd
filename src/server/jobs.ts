/**
 * Background job queue, in PostgreSQL.
 *
 * SELECT … FOR UPDATE SKIP LOCKED is the whole trick: several workers can run
 * against one database without two of them claiming the same job. Jobs that
 * exhaust their attempts become DEAD rather than looping forever, and the
 * reason is kept on the row.
 */
import { getDb } from '@/lib/db';
import { scoped, systemContext, type Ctx } from '@/lib/tenancy';
import { logger } from '@/lib/logger';
import type { JobType } from '@/lib/db/types';
import { sql } from 'kysely';

export interface ClaimedJob {
  id: string;
  org_id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export async function enqueue(
  ctx: Ctx, type: JobType, payload: Record<string, unknown>, runAfter?: Date,
): Promise<string> {
  const row = await scoped(ctx)
    .insert('jobs', {
      type, payload: JSON.stringify(payload), ...(runAfter ? { run_after: runAfter } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return (row as { id: string }).id;
}

/** Claim one due job atomically. Returns null when the queue is empty. */
export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const db = getDb();
  const result = await sql<ClaimedJob>`
    UPDATE jobs SET
      status = 'RUNNING',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = ${workerId},
      updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'QUEUED' AND run_after <= now()
      ORDER BY run_after
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, org_id, type, payload, attempts, max_attempts
  `.execute(db);
  return result.rows[0] ?? null;
}

export async function completeJob(jobId: string) {
  await getDb().updateTable('jobs')
    .set({ status: 'DONE', locked_at: null, locked_by: null, updated_at: new Date() })
    .where('id', '=', jobId).execute();
}

export async function failJob(job: ClaimedJob, error: string) {
  const exhausted = job.attempts >= job.max_attempts;
  const backoffMs = Math.min(15 * 60_000, 5_000 * 2 ** job.attempts);
  await getDb().updateTable('jobs')
    .set({
      status: exhausted ? 'DEAD' : 'QUEUED',
      last_error: error.slice(0, 4000),
      locked_at: null,
      locked_by: null,
      run_after: exhausted ? new Date() : new Date(Date.now() + backoffMs),
      updated_at: new Date(),
    })
    .where('id', '=', job.id).execute();
  logger.warn(exhausted ? 'job dead' : 'job will retry', {
    jobId: job.id, type: job.type, attempts: job.attempts, error: error.slice(0, 300),
  });
}

/** Release jobs left RUNNING by a worker that died. */
export async function requeueStale(olderThanMs = 30 * 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const res = await getDb().updateTable('jobs')
    .set({ status: 'QUEUED', locked_at: null, locked_by: null, updated_at: new Date() })
    .where('status', '=', 'RUNNING')
    .where('locked_at', '<', cutoff)
    .executeTakeFirst();
  const n = Number(res.numUpdatedRows ?? 0);
  if (n) logger.warn('requeued stale jobs', { count: n });
  return n;
}

export async function queueDepth() {
  const rows = await getDb()
    .selectFrom('jobs')
    .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy('status')
    .execute();
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export function jobContext(orgId: string) {
  return systemContext(orgId);
}
