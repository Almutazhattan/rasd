import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { scoped } from '@/lib/tenancy';
import { AGENT_LIST } from '@/agents/registry';
import { aiKeyName, aiModel, aiState, env } from '@/lib/env';
import {
  Alert, Card, DateText, IntegrationBadge, PageHeader, Row, RunStatusBadge,
} from '@/components/ui';
import type { RunStatus } from '@/lib/db/types';

export const metadata = { title: 'الوكلاء — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const ctx = await requireAuth();
  const runs = (await scoped(ctx)
    .from('agent_runs')
    .select(['id', 'agent_key', 'status', 'attempts', 'model', 'input_tokens', 'out_tokens',
      'started_at', 'finished_at', 'error', 'analysis_id'])
    .orderBy('created_at', 'desc')
    .limit(40)
    .execute()) as Row[];

  const state = aiState();

  return (
    <div>
      <PageHeader
        kicker="المحرك"
        title="الوكلاء وتشغيلاتهم"
        lead="ثمانية وكلاء بمسؤوليات منفصلة وأدوات محدودة ومخرجات مُتحقَّق من مخططها."
        actions={<IntegrationBadge state={state} label={`المزوّد · ${env().AI_PROVIDER} · ${aiModel()}`} />}
      />

      {state !== 'CONNECTED' && (
        <div className="mb-10">
          <Alert tone="warn" title="المزوّد غير مُهيّأ">
            التشغيل الفعلي يحتاج {aiKeyName()}. بدونه تُسجَّل كل محاولة تشغيل بحالة «المزوّد غير
            مُهيّأ» ولا تُنتج نتائج — لا محاكاة ولا بيانات مُصطنعة.
          </Alert>
        </div>
      )}

      <section className="mb-14">
        <h2 className="mb-5 text-xl">السجل</h2>
        <div className="grid gap-5 lg:grid-cols-2">
          {AGENT_LIST.map((agent) => (
            <Card key={agent.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-lg">{agent.title.ar}</h3>
                <span className="text-xs text-muted/60" dir="ltr">{agent.key}</span>
              </div>
              <p className="mt-3 text-sm text-muted">{agent.role.ar}</p>
              <div className="hair my-5" />
              <div className="flex flex-wrap gap-2">
                {agent.tools.map((t) => (
                  <span key={t} className="chip border border-white/12 text-[10px] text-muted" dir="ltr">{t}</span>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted/60 tnum" dir="ltr">
                max {agent.maxIterations} iterations · {agent.maxAttempts} attempts · {agent.timeoutMs / 1000}s budget
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-5 text-xl">أحدث التشغيلات</h2>
        {runs.length === 0 ? (
          <Card><p className="text-sm text-muted">لا تشغيلات بعد.</p></Card>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الوكيل</th><th>الحالة</th><th>المحاولات</th><th>النموذج</th>
                  <th>الرموز</th><th>البداية</th><th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td dir="ltr" className="text-muted">{r.agent_key}</td>
                    <td><RunStatusBadge value={r.status as RunStatus} /></td>
                    <td className="tnum">{r.attempts}</td>
                    <td dir="ltr" className="text-xs text-muted/70">{r.model ?? '—'}</td>
                    <td className="tnum text-xs" dir="ltr">
                      {(r.input_tokens ?? 0)}/{(r.out_tokens ?? 0)}
                    </td>
                    <td className="text-xs"><DateText value={r.started_at} withTime /></td>
                    <td>
                      {r.analysis_id && (
                        <Link href={`/app/agents/${r.analysis_id}`} className="text-xs text-blue-soft">السجل</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
