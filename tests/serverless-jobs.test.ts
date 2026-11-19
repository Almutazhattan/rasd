/**
 * Serverless job processing (Vercel): the shared job runner, the queue kick
 * after a request enqueues work, and the cron sweep route.
 *
 * The long-running worker and these paths share runOneJob, so the guarantees
 * the worker gives — one claim per job, failures retried then DEAD — hold on
 * a host with no worker process too.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { getDb } from '@/lib/db';
import { __resetEnv } from '@/lib/env';
import { register } from '@/server/accounts';
import { enqueue } from '@/server/jobs';
import { drainJobs, isServerless, kickJobs } from '@/server/job-runner';
import { GET as cronGET } from '@/app/api/cron/jobs/route';
import type { AuthContext } from '@/lib/tenancy';

let ctx: AuthContext;
const CRON = 'cron-secret-for-tests-0123456789';

beforeAll(async () => {
  await resetDatabase();
  const r = await register({
    name: 'Jobs Owner', email: 'owner@jobs.test', password: 'jobs-password-1', orgName: 'Jobs Co',
  });
  ctx = { userId: r.userId, orgId: r.orgId, role: 'OWNER', email: 'owner@jobs.test', name: 'Jobs Owner' };
});

afterEach(() => {
  delete process.env.VERCEL;
  delete process.env.INLINE_JOBS;
  delete process.env.CRON_SECRET;
  __resetEnv();
});

afterAll(teardown);

async function statusOf(id: string) {
  const row = await getDb().selectFrom('jobs').select(['status', 'attempts', 'last_error'])
    .where('id', '=', id).executeTakeFirstOrThrow();
  return row;
}

async function until(fn: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

describe('job runner', () => {
  it('drains due jobs and marks them DONE', async () => {
    const id = await enqueue(ctx, 'DEADLINE_SWEEP', {});
    const ran = await drainJobs({ budgetMs: 10_000 });
    expect(ran).toBeGreaterThanOrEqual(1);
    expect((await statusOf(id)).status).toBe('DONE');
  });

  it('a failing job is requeued with its error, not lost', async () => {
    const id = await enqueue(ctx, 'RUN_ANALYSIS', {}); // no analysisId → handler throws
    await drainJobs({ budgetMs: 10_000 });
    const s = await statusOf(id);
    expect(s.status).toBe('QUEUED');
    expect(s.attempts).toBe(1);
    expect(s.last_error).toMatch(/without analysisId/);
  });

  it('kickJobs is a no-op outside serverless hosts — the worker owns the queue there', async () => {
    expect(isServerless()).toBe(false);
    const id = await enqueue(ctx, 'DEADLINE_SWEEP', {});
    await kickJobs(5_000);
    await new Promise((r) => setTimeout(r, 200));
    expect((await statusOf(id)).status).toBe('QUEUED');
    await drainJobs({ budgetMs: 10_000 }); // leave the queue clean
  });

  it('kickJobs drains the queue in the background on a serverless host', async () => {
    process.env.INLINE_JOBS = 'true';
    const id = await enqueue(ctx, 'DEADLINE_SWEEP', {});
    await kickJobs(5_000);
    await until(async () => (await statusOf(id)).status === 'DONE');
  });
});

describe('cron route', () => {
  it('refuses every call when CRON_SECRET is not configured', async () => {
    const res = await cronGET(new Request('http://x/api/cron/jobs', { headers: { authorization: 'Bearer ' } }));
    expect(res.status).toBe(401);
  });

  it('refuses a wrong secret', async () => {
    process.env.CRON_SECRET = CRON;
    const res = await cronGET(new Request('http://x/api/cron/jobs', {
      headers: { authorization: `Bearer ${CRON.replace('0', '9')}` },
    }));
    expect(res.status).toBe(401);
  });

  it('with the right secret: requeues stale work, queues the deadline sweep per org and drains', async () => {
    process.env.CRON_SECRET = CRON;
    // A job left RUNNING by an invocation that was cut off an hour ago.
    const stale = await enqueue(ctx, 'DEADLINE_SWEEP', {});
    await getDb().updateTable('jobs')
      .set({ status: 'RUNNING', locked_at: new Date(Date.now() - 3_600_000), locked_by: 'dead-fn' })
      .where('id', '=', stale).execute();

    const res = await cronGET(new Request('http://x/api/cron/jobs', {
      headers: { authorization: `Bearer ${CRON}` },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { requeued: number; deadlineSweepsQueued: number; jobsRun: number } };
    expect(body.data.requeued).toBe(1);
    expect(body.data.deadlineSweepsQueued).toBe(1);
    expect(body.data.jobsRun).toBeGreaterThanOrEqual(2);
    expect((await statusOf(stale)).status).toBe('DONE');

    const left = await getDb().selectFrom('jobs').select('id')
      .where('type', '=', 'DEADLINE_SWEEP').where('status', '!=', 'DONE').execute();
    expect(left).toHaveLength(0);
  });
});
