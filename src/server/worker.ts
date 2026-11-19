/**
 * Job worker.
 *
 * Runs outside the request cycle so a full analysis — several agents, minutes
 * of model calls — survives the browser closing. One process can run many
 * workers; `FOR UPDATE SKIP LOCKED` keeps them from colliding.
 *
 *   npm run worker
 */
import { claimJob, completeJob, failJob, jobContext, requeueStale, type ClaimedJob } from './jobs';
import { executeAnalysis } from './analysis';
import { discover } from './providers';
import { createDraft } from './drafts';
import { notify } from './notifications';
import { scoped } from '@/lib/tenancy';
import { pruneExpiredSessions } from '@/lib/session';
import { expiringDocuments } from './documents';
import { closeDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { aiState } from '@/lib/env';

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const IDLE_MS = 2000;
const SWEEP_EVERY_MS = 5 * 60_000;

let running = true;

async function handle(job: ClaimedJob) {
  const ctx = jobContext(job.org_id);
  const payload = job.payload ?? {};

  switch (job.type) {
    case 'RUN_ANALYSIS': {
      const analysisId = String(payload.analysisId ?? '');
      if (!analysisId) throw new Error('RUN_ANALYSIS without analysisId');
      const status = await executeAnalysis(ctx, analysisId);
      logger.info('analysis finished', { analysisId, status });
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

async function loop() {
  const e = env();
  logger.info('worker started', {
    workerId: WORKER_ID, aiProvider: aiState(e), nodeEnv: e.NODE_ENV,
  });
  if (aiState(e) !== 'CONNECTED') {
    logger.warn(
      'no AI provider configured — analysis jobs will complete with status PROVIDER_UNCONFIGURED ' +
      'and no results, by design',
    );
  }

  let lastSweep = 0;
  while (running) {
    try {
      if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
        lastSweep = Date.now();
        await requeueStale();
        await pruneExpiredSessions();
      }

      const job = await claimJob(WORKER_ID);
      if (!job) {
        await sleep(IDLE_MS);
        continue;
      }

      logger.info('job claimed', { jobId: job.id, type: job.type, attempt: job.attempts });
      try {
        await handle(job);
        await completeJob(job.id);
      } catch (err) {
        await failJob(job, err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
      }
    } catch (err) {
      // A failure in the loop itself (database down) must not kill the worker.
      logger.error('worker loop error', { err: err instanceof Error ? err.message : String(err) });
      await sleep(5000);
    }
  }

  await closeDb();
  logger.info('worker stopped', { workerId: WORKER_ID });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('worker shutting down', { signal });
    running = false;
  });
}

loop().catch((err) => {
  logger.error('worker crashed', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
