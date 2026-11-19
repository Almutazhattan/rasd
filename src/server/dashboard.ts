/**
 * Dashboard read model.
 *
 * Every figure on the dashboard is a query against stored rows. There are no
 * placeholder numbers in this file, and a workspace with no data produces
 * zeroes with an explanation rather than an illustrative chart.
 */
import { getDb } from '@/lib/db';
import { scoped, type Ctx } from '@/lib/tenancy';
import { aiState, demoState, etimadState, mailState } from '@/lib/env';
import { readiness } from './company';
import { queueDepth } from './jobs';

export async function dashboard(ctx: Ctx, userId: string | null) {
  const s = scoped(ctx);
  const db = getDb();
  const now = new Date();
  const in7 = new Date(Date.now() + 7 * 86_400_000);

  const count = async (
    table: 'tenders' | 'analyses' | 'approval_requests' | 'bookmarks' | 'agent_runs',
    build?: (q: ReturnType<typeof s.from>) => ReturnType<typeof s.from>,
  ) => {
    let q = s.from(table);
    if (build) q = build(q);
    const row = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirst();
    return Number((row as { n?: string } | undefined)?.n ?? 0);
  };

  const [
    totalTenders, openTenders, closingSoon, bookmarked,
    analysesRunning, needsReview, completed, pendingApprovals, demoTenders,
  ] = await Promise.all([
    count('tenders'),
    count('tenders', (q) => q.where('status' as never, 'in' as never, ['OPEN', 'CLOSING_SOON'] as never)),
    count('tenders', (q) =>
      q.where('closes_at' as never, '>=' as never, now as never)
       .where('closes_at' as never, '<=' as never, in7 as never)),
    count('bookmarks'),
    count('analyses', (q) => q.where('status' as never, 'in' as never, ['QUEUED', 'RUNNING'] as never)),
    count('analyses', (q) => q.where('status' as never, '=' as never, 'NEEDS_HUMAN_REVIEW' as never)),
    count('analyses', (q) => q.where('status' as never, '=' as never, 'COMPLETE' as never)),
    count('approval_requests', (q) => q.where('status' as never, '=' as never, 'PENDING' as never)),
    count('tenders', (q) => q.where('is_demo' as never, '=' as never, true as never)),
  ]);

  // Score distribution, from completed analyses only.
  const scoreRows = (await s
    .from('analyses')
    .select(['score', 'verdict', 'blocking_gaps'])
    .where('score' as never, 'is not' as never, null as never)
    .execute()) as { score: number; verdict: string | null; blocking_gaps: number }[];

  const distribution = { '0-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 };
  for (const r of scoreRows) {
    if (r.score < 40) distribution['0-39'] += 1;
    else if (r.score < 60) distribution['40-59'] += 1;
    else if (r.score < 80) distribution['60-79'] += 1;
    else distribution['80-100'] += 1;
  }

  const highRisk = Number(
    (
      await db
        .selectFrom('risks')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('org_id', '=', ctx.orgId)
        .where('severity', 'in', ['HIGH', 'CRITICAL'])
        .executeTakeFirst()
    )?.n ?? 0,
  );

  const [deadlines, recentActivity, recentRuns, recentAnalyses] = await Promise.all([
    s.from('tenders')
      .select(['id', 'title', 'entity', 'closes_at', 'status', 'is_demo'])
      .where('closes_at' as never, '>=' as never, now as never)
      .orderBy('closes_at')
      .limit(8)
      .execute(),
    db.selectFrom('audit_logs')
      .leftJoin('users', 'users.id', 'audit_logs.actor_id')
      .select(['audit_logs.action as action', 'audit_logs.target_type as target_type',
        'audit_logs.created_at as at', 'users.name as actor'])
      .where('audit_logs.org_id', '=', ctx.orgId)
      .orderBy('audit_logs.created_at', 'desc')
      .limit(12)
      .execute(),
    s.from('agent_runs')
      .select(['id', 'agent_key', 'status', 'started_at', 'finished_at', 'analysis_id'])
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute(),
    s.from('analyses')
      .innerJoin('tenders', 'tenders.id', 'analyses.tender_id')
      .select(['analyses.id as id', 'analyses.status as status', 'analyses.score as score',
        'analyses.verdict as verdict', 'analyses.blocking_gaps as blocking_gaps',
        'tenders.title as tender_title', 'analyses.created_at as created_at'])
      .orderBy('analyses.created_at', 'desc')
      .limit(6)
      .execute(),
  ]);

  const unread = userId
    ? Number(
        (
          await db
            .selectFrom('notifications')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('org_id', '=', ctx.orgId)
            .where('user_id', '=', userId)
            .where('read_at', 'is', null)
            .executeTakeFirst()
        )?.n ?? 0,
      )
    : 0;

  return {
    counts: {
      totalTenders, openTenders, closingSoon, bookmarked, analysesRunning,
      needsReview, completed, pendingApprovals, highRisk, demoTenders, unread,
    },
    distribution,
    deadlines,
    recentActivity,
    recentRuns,
    recentAnalyses,
    readiness: await readiness(ctx),
    integrations: {
      ai: aiState(), etimad: etimadState(), demo: demoState(), mail: mailState(),
    },
    queue: await queueDepth(),
    emptyWorkspace: totalTenders === 0,
  };
}
