import { created, handler } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { loadDemoWorkspace } from '@/server/demo-workspace';
import { kickJobs } from '@/server/job-runner';

/** Fill a new workspace with labelled sample data and start a real analysis. */
export const POST = handler(async () => {
  const ctx = await requireAuth();
  const result = await loadDemoWorkspace(ctx);
  if (result.analysisId) await kickJobs();
  return created(result as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
