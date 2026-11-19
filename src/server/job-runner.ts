/**
 * Job execution, shared by the long-running worker (`npm run worker`) and by
 * serverless hosts such as Vercel, where no process lives between requests.
 *
 * On a serverless host the queue is drained in two ways:
 *   - kickJobs(): after a request enqueues work, the same function invocation
 *     keeps running in the background (waitUntil) and drains the queue within
 *     a time budget.
 *   - /api/cron/jobs: a scheduled sweep that requeues stale jobs, enqueues the
 *     deadline sweep and drains whatever is left.
 *
 * Both paths claim jobs with FOR UPDATE SKIP LOCKED, so they cannot collide
 * with each other or with a classic worker pointed at the same database.
 */
import { claimJob, completeJob, enqueue, failJob, jobContext, requeueStale, type ClaimedJob } from './jobs';
import { AnalysisYield, executeAnalysis } from './analysis';
import { discover } from './providers';
import { createDraft } from './drafts';
import { notify } from './notifications';
import { scoped } from '@/lib/tenancy';
import { expiringDocuments } from './documents';
import { logger } from '@/lib/logger';

/** Returns 'yielded' when the work must continue in a fresh invocation. */
export async function handleJob(job: ClaimedJob, deadlineAt?: number): Promise<void | 'yielded'> {
  const ctx = jobContext(job.org_id);
  const payload = job.payload ?? {};

  switch (job.type) {
    case 'RUN_ANALYSIS': {
      const analysisId = String(payload.analysisId ?? '');
      if (!analysisId) throw new Error('RUN_ANALYSIS without analysisId');
      try {
        const status = await executeAnalysis(ctx, analysisId, { deadlineAt });
        logger.info('analysis finished', { analysisId, status });
      } catch (err) {
        if (!(err instanceof AnalysisYield)) throw err;
        // Out of time in this invocation: continue in a fresh one. Completed
        // stages are reused, so nothing is repeated.
        await enqueue(ctx, 'RUN_ANALYSIS', payload);
        logger.info('analysis continues in next invocation', { analysisId, nextStage: err.stage });
        return 'yielded';
      }
      return;
    }
    case 'DISCOVER_TENDERS': {
      const outcome = await discover(ctx, (payload.query as Record<string, never>) ?? {});
      logger.info('discovery finished', {
        orgId: job.org_id, imported: outcome.imported, updated: outcome.updated,
      });
      return;
    }
    case 'DRAFT_RESPONSE': {
      const analysisId = String(payload.analysisId ?? '');
      if (!analysisId) throw new Error('DRAFT_RESPONSE without analysisId');
      await createDraft(ctx, analysisId);
      return;
    }
    case 'DEADLINE_SWEEP': {
      const s = scoped(ctx);
      const soon = new Date(Date.now() + 5 * 86_400_000);
      const closing = (await s
        .from('tenders')
        .select(['id', 'title', 'closes_at'])
        .where('closes_at' as never, 'is not' as never, null as never)
        .where('closes_at' as never, '<=' as never, soon as never)
        .where('status' as never, 'in' as never, ['OPEN', 'CLOSING_SOON'] as never)
        .execute()) as { id: string; title: string; closes_at: Date }[];

      for (const t of closing) {
        const days = Math.ceil((new Date(t.closes_at).getTime() - Date.now()) / 86_400_000);
        await notify(ctx, {
          kind: 'DEADLINE',
          title: `تبقّى ${days} يوم لإغلاق «${t.title.slice(0, 60)}»`,
          link: `/app/opportunities/${t.id}`,
        });
        if (days <= 0) {
          await s.update('tenders').set({ status: 'CLOSED' }).where('id' as never, '=', t.id as never).execute();
        } else if (days <= 5) {
          await s.update('tenders').set({ status: 'CLOSING_SOON' }).where('id' as never, '=', t.id as never).execute();
        }
      }

      for (const doc of (await expiringDocuments(ctx, 30)) as { title: string }[]) {
        await notify(ctx, {
          kind: 'MISSING_DOCUMENT',
          title: `وثيقة تقترب من الانتهاء: ${doc.title.slice(0, 70)}`,
          body: 'الوثيقة المنتهية قد تسبب الاستبعاد من المنافسة.',
          link: '/app/company/documents',
        });
      }
      return;
    }
    case 'PROCESS_DOCUMENT':
    case 'SEND_NOTIFICATIONS':
      // Both are performed inline by their services today; the job types exist
      // so the work can move here without a schema change.
      logger.info('job type handled inline', { type: job.type });
      return;
  }
}

/**
 * Claim, run and settle a single job. Returns false when the queue is empty,
 * 'yielded' when the job handed its remaining work to a fresh invocation.
 */
export async function runOneJob(workerId: string, deadlineAt?: number): Promise<boolean | 'yielded'> {
  const job = await claimJob(workerId);
  if (!job) return false;
  logger.info('job claimed', { jobId: job.id, type: job.type, attempt: job.attempts });
  let result: boolean | 'yielded' = true;
  try {
    if ((await handleJob(job, deadlineAt)) === 'yielded') result = 'yielded';
    await completeJob(job.id);
  } catch (err) {
    await failJob(job, err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
  }
  return result;
}

/**
 * Drain due jobs until the queue is empty or the time budget is spent. A job
 * is only started while budget remains; a started job is allowed to finish
 * (the host's maxDuration is the hard ceiling, and requeueStale recovers a job
 * whose invocation was cut off).
 */
export async function drainJobs(opts: {
  budgetMs: number; workerId?: string;
  /** Hard end of this invocation; analysis stages will not start past it. */
  hardDeadlineAt?: number;
}): Promise<number> {
  const workerId = opts.workerId ?? `fn-${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + opts.budgetMs;
  let ran = 0;
  while (Date.now() < deadline) {
    const had = await runOneJob(workerId, opts.hardDeadlineAt);
    if (!had) break;
    ran++;
    // A yield means this invocation is out of time: the re-queued job belongs
    // to the next one. Claiming it here would only yield again.
    if (had === 'yielded') break;
  }
  return ran;
}

/** Function maxDuration on the serverless host (routes export maxDuration = 300). */
export const INVOCATION_MS = 300_000;

/** True when running on a serverless host with no separate worker process. */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL) || process.env.INLINE_JOBS === 'true';
}

/**
 * After a request enqueues work, keep the invocation alive in the background
 * to process it. No-op outside serverless hosts — there the worker does it.
 * Never throws into the request: a failure here leaves the job queued for the
 * next kick or cron sweep.
 */
export async function kickJobs(budgetMs = 240_000): Promise<void> {
  if (!isServerless()) return;
  // The invocation ends at maxDuration (300 s) from its start; keep a margin.
  const hardDeadlineAt = Date.now() + INVOCATION_MS - 15_000;
  const work = (async () => {
    // A job RUNNING longer than any invocation can live was cut off: release it.
    await requeueStale(INVOCATION_MS + 60_000);
    return drainJobs({ budgetMs, hardDeadlineAt });
  })().catch((err) => {
    logger.error('inline job drain failed', { err: err instanceof Error ? err.message : String(err) });
  });
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(work);
  } catch {
    // Not on Vercel's runtime: the promise still runs while the process lives.
  }
}
