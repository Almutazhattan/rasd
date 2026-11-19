/**
 * Job worker.
 *
 * Runs outside the request cycle so a full analysis — several agents, minutes
 * of model calls — survives the browser closing. One process can run many
 * workers; `FOR UPDATE SKIP LOCKED` keeps them from colliding.
 *
 *   npm run worker
 *
 * On serverless hosts (Vercel) there is no worker process: see job-runner.ts.
 */
import { requeueStale } from './jobs';
import { runOneJob } from './job-runner';
import { pruneExpiredSessions } from '@/lib/session';
import { closeDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { aiState } from '@/lib/env';

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const IDLE_MS = 2000;
const SWEEP_EVERY_MS = 5 * 60_000;

let running = true;

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

      const had = await runOneJob(WORKER_ID);
      if (!had) await sleep(IDLE_MS);
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
