import { handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { AGENT_LIST } from '@/agents/registry';
import { aiState, env } from '@/lib/env';
import { scoped } from '@/lib/tenancy';

export const GET = handler(async () => {
  const ctx = await requireAuth();
  const recent = await scoped(ctx)
    .from('agent_runs')
    .select(['id', 'agent_key', 'status', 'attempts', 'model', 'input_tokens', 'out_tokens',
      'started_at', 'finished_at', 'error', 'analysis_id'])
    .orderBy('created_at', 'desc')
    .limit(60)
    .execute();

  return ok({
    provider: { state: aiState(), model: env().ANTHROPIC_MODEL },
    agents: AGENT_LIST.map((a) => ({
      key: a.key, title: a.title, role: a.role, tools: a.tools,
      maxIterations: a.maxIterations, maxAttempts: a.maxAttempts, timeoutMs: a.timeoutMs,
    })),
    recentRuns: recent,
  } as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
