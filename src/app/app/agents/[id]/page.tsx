import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { runTree } from '@/agents/runner';
import { getAnalysis } from '@/server/analysis';
import { Breadcrumb, Card, DateText, EmptyState, PageHeader, Pill, Row, RunStatusBadge } from '@/components/ui';
import { Refresher } from '@/components/client/forms';
import { getAgent } from '@/agents/registry';
import type { RunStatus } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

const STEP_TONE: Record<string, string> = {
  SUCCEEDED: 'border-ok/25 text-ok',
  FAILED: 'border-danger/35 text-danger',
  INVALID_OUTPUT: 'border-sand/35 text-sand',
  RETRYING: 'border-sand/35 text-sand',
  SKIPPED: 'border-white/15 text-muted',
  PENDING: 'border-white/15 text-muted',
  RUNNING: 'border-blue/35 text-blue-soft',
};

export default async function AgentRunPage({ params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  const [{ runs, steps }, analysis] = await Promise.all([
    runTree(ctx, params.id),
    getAnalysis(ctx, params.id).catch(() => null),
  ]);

  const tender = analysis?.tender as Row | undefined;
  const a = analysis?.analysis as Row | undefined;
  const live = (runs as Row[]).some((r) => r.status === 'RUNNING' || r.status === 'PENDING');

  return (
    <div>
      <Breadcrumb
        items={[
          { href: '/app/opportunities', label: 'الفرص' },
          { href: `/app/analysis/${params.id}`, label: 'التحليل' },
          { label: 'سجل الوكلاء' },
        ]}
      />
      <PageHeader
        kicker="سجل التنفيذ"
        title="ماذا فعل كل وكيل، بالترتيب"
        lead={tender ? String(tender.title) : undefined}
        actions={
          <div className="flex items-center gap-3">
            {live && <Refresher seconds={5} />}
            <Link href={`/app/analysis/${params.id}`} className="btn-ghost text-sm">عودة إلى التحليل</Link>
          </div>
        }
      />

      {runs.length === 0 ? (
        <EmptyState
          title="لا تشغيلات مسجّلة"
          body={
            a?.status === 'PROVIDER_UNCONFIGURED'
              ? 'لم يُنفَّذ أي وكيل لأن مزوّد الذكاء الاصطناعي غير مُهيّأ في هذا النشر.'
              : 'لم يبدأ التحليل بعد.'
          }
        />
      ) : (
        <div className="space-y-6">
          {(runs as Row[]).map((run) => {
            const def = (() => {
              try {
                return getAgent(String(run.agent_key));
              } catch {
                return null;
              }
            })();
            const runSteps = (steps as Row[]).filter((s) => s.run_id === run.id);
            const plan = Array.isArray(run.plan) ? (run.plan as Row[]) : [];

            return (
              <Card key={run.id}>
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <h2 className="text-lg">{def?.title.ar ?? String(run.agent_key)}</h2>
                    <p className="mt-2 text-xs text-muted/70" dir="ltr">{String(run.agent_key)}</p>
                    {def && <p className="mt-3 max-w-xl text-sm text-muted">{def.role.ar}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2 text-xs text-muted">
                    <RunStatusBadge value={run.status as RunStatus} />
                    {run.model && <span dir="ltr">{String(run.model)}</span>}
                    {(run.input_tokens || run.out_tokens) && (
                      <span className="tnum" dir="ltr">
                        in {run.input_tokens ?? 0} / out {run.out_tokens ?? 0}
                      </span>
                    )}
                    <span><DateText value={run.started_at} withTime /></span>
                  </div>
                </div>

                {run.error && (
                  <p className="mt-5 rounded-xl border border-danger/35 bg-danger/[.07] p-4 text-xs text-muted">
                    {String(run.error)}
                  </p>
                )}

                {plan.length > 0 && (
                  <div className="mt-7">
                    <h3 className="lbl">خطة التنفيذ</h3>
                    <ol className="space-y-2 text-xs text-muted">
                      {plan.map((p, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="tnum text-muted/50">{i + 1}.</span>
                          <Pill>{String(p.agent)}</Pill>
                          <span>{String(p.reason ?? '')}</span>
                          {Array.isArray(p.dependsOn) && p.dependsOn.length > 0 && (
                            <span className="text-muted/50" dir="ltr">
                              depends on: {(p.dependsOn as string[]).join(', ')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {runSteps.length > 0 && (
                  <div className="mt-7">
                    <h3 className="lbl">الخطوات ({runSteps.length})</h3>
                    <ol className="space-y-2">
                      {runSteps.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-3 text-xs">
                          <span className="tnum w-6 text-muted/50">{s.ordinal}</span>
                          <span className={`chip border ${STEP_TONE[String(s.status)] ?? 'border-white/15 text-muted'}`}>
                            {String(s.status)}
                          </span>
                          <span className="text-muted" dir="ltr">{String(s.label)}</span>
                          {s.duration_ms !== null && (
                            <span className="tnum text-muted/50" dir="ltr">{s.duration_ms}ms</span>
                          )}
                          {s.message && (
                            <span className="min-w-0 flex-1 truncate text-muted/60" title={String(s.message)}>
                              {String(s.message)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
