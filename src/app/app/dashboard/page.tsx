import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { dashboard } from '@/server/dashboard';
import {
  Alert, AnalysisStatusBadge, Card, DateText, DaysLeft, EmptyState, IntegrationBadge,
  PageHeader, RunStatusBadge, SourceBadge, Stat, VerdictBadge,
  Row,
} from '@/components/ui';
import { DiscoverButton } from '@/components/client/forms';
import type { AnalysisStatus, RunStatus, Verdict } from '@/lib/db/types';

export const metadata = { title: 'اللوحة — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const ctx = await requireAuth();
  const d = await dashboard(ctx, ctx.userId);

  return (
    <div>
      <PageHeader
        kicker="لوحة التشغيل"
        title="حالة منافساتك الآن"
        lead="كل رقم في هذه الصفحة محسوب من سجلات مساحة عملك، لا من قيم افتراضية."
        actions={<DiscoverButton />}
      />

      {d.integrations.ai !== 'CONNECTED' && (
        <div className="mb-10">
          <Alert tone="warn" title="مزوّد الذكاء الاصطناعي غير مُهيّأ">
            يمكنك استعراض الفرص ورفع الوثائق، لكن تشغيل الوكلاء يتوقف بحالة «المزوّد غير مُهيّأ» بلا
            نتائج — لا تُولَّد نتائج وهمية. اضبط ANTHROPIC_API_KEY ثم أعد التشغيل.
          </Alert>
        </div>
      )}

      {d.counts.demoTenders > 0 && (
        <div className="mb-10">
          <Alert tone="warn" title={`${d.counts.demoTenders} سجلاً توضيحياً في مساحة العمل`}>
            سجلات مزوّد البيانات التوضيحية موسومة في كل موضع تظهر فيه، ولا تمثّل منافسات حكومية قائمة.
          </Alert>
        </div>
      )}

      {d.emptyWorkspace ? (
        <EmptyState
          title="لا فرص في مساحة عملك بعد"
          body="اكتشف فرصاً من المصادر المُهيّأة، أو أضف منافسة يدوياً إن كان إعلانها بين يديك."
          action={
            <div className="flex gap-4">
              <DiscoverButton />
              <Link href="/app/opportunities" className="btn-ghost">إضافة منافسة يدوياً</Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="فرص مفتوحة" value={d.counts.openTenders} hint={`من ${d.counts.totalTenders} سجلاً`} />
            <Stat label="تُغلق خلال أسبوع" value={d.counts.closingSoon}
              tone={d.counts.closingSoon > 0 ? 'warn' : 'default'} />
            <Stat label="تحتاج مراجعة بشرية" value={d.counts.needsReview}
              tone={d.counts.needsReview > 0 ? 'warn' : 'default'} />
            <Stat label="موافقات معلّقة" value={d.counts.pendingApprovals}
              tone={d.counts.pendingApprovals > 0 ? 'warn' : 'default'} />
            <Stat label="تحليلات قيد التنفيذ" value={d.counts.analysesRunning} />
            <Stat label="تحليلات مكتملة" value={d.counts.completed} tone="ok" />
            <Stat label="مخاطر عالية أو حرجة" value={d.counts.highRisk}
              tone={d.counts.highRisk > 0 ? 'danger' : 'default'} />
            <Stat label="جاهزية المنشأة" value={`${d.readiness.score}/100`}
              tone={d.readiness.score < 50 ? 'warn' : 'ok'} hint="من الوثائق والشهادات والمشاريع على الملف" />
          </div>

          <div className="mb-14 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg">توزيع درجات التوافق</h2>
              <p className="mt-3 text-xs text-muted">من التحليلات المكتملة فقط.</p>
              <div className="mt-7 space-y-4">
                {Object.entries(d.distribution).map(([band, n]) => {
                  const total = Object.values(d.distribution).reduce((a, b) => a + b, 0) || 1;
                  return (
                    <div key={band}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="tnum" dir="ltr">{band}</span>
                        <span className="tnum text-muted">{n}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.07]">
                        <div className="h-full rounded-full bg-blue" style={{ width: `${(n / total) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h2 className="text-lg">مُهل قادمة</h2>
              {d.deadlines.length === 0 ? (
                <p className="mt-5 text-sm text-muted">لا مُهل قادمة مسجّلة.</p>
              ) : (
                <ul className="mt-5 space-y-4">
                  {(d.deadlines as Row[]).map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-4 border-b border-white/[.05] pb-4 last:border-0">
                      <div className="min-w-0">
                        <Link href={`/app/opportunities/${t.id}`} className="block truncate text-sm hover:text-blue-soft">
                          {t.title}
                        </Link>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted">{t.entity}</span>
                          <SourceBadge isDemo={Boolean(t.is_demo)} verification="" sourceName="" />
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <DaysLeft value={t.closes_at} />
                        <div className="mt-1 text-muted/60"><DateText value={t.closes_at} /></div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg">أحدث التحليلات</h2>
              {d.recentAnalyses.length === 0 ? (
                <p className="mt-5 text-sm text-muted">لم يُشغّل أي تحليل بعد.</p>
              ) : (
                <ul className="mt-5 space-y-4">
                  {(d.recentAnalyses as Row[]).map((a) => (
                    <li key={a.id} className="border-b border-white/[.05] pb-4 last:border-0">
                      <Link href={`/app/analysis/${a.id}`} className="block truncate text-sm hover:text-blue-soft">
                        {a.tender_title}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <AnalysisStatusBadge value={a.status as AnalysisStatus} />
                        <VerdictBadge value={(a.verdict as Verdict) ?? null} />
                        {a.score !== null && <span className="text-xs tnum text-muted">{a.score}/100</span>}
                        {Number(a.blocking_gaps) > 0 && (
                          <span className="chip border border-danger/40 text-[10px] text-danger">
                            {a.blocking_gaps} إلزامي ناقص
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="text-lg">نشاط الوكلاء</h2>
              {d.recentRuns.length === 0 ? (
                <p className="mt-5 text-sm text-muted">لا تشغيلات بعد.</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {(d.recentRuns as Row[]).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 text-sm">
                      <span className="truncate text-muted" dir="ltr">{r.agent_key}</span>
                      <div className="flex shrink-0 items-center gap-3">
                        <RunStatusBadge value={r.status as RunStatus} />
                        {r.analysis_id && (
                          <Link href={`/app/agents/${r.analysis_id}`} className="text-xs text-blue-soft">السجل</Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg">سجل النشاط</h2>
              <ul className="mt-5 space-y-3 text-sm">
                {(d.recentActivity as Row[]).map((a, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-4">
                    <span className="truncate text-muted" dir="ltr">{a.action}</span>
                    <span className="shrink-0 text-xs text-muted/60">
                      {a.actor ?? 'النظام'} · <DateText value={a.at} withTime />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2 className="text-lg">حالة التكاملات</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                <IntegrationBadge state={d.integrations.ai} label="مزوّد الذكاء" />
                <IntegrationBadge state={d.integrations.etimad} label="اعتماد" />
                <IntegrationBadge state={d.integrations.demo} label="بيانات توضيحية" />
                <IntegrationBadge state={d.integrations.mail} label="البريد" />
              </div>
              <div className="hair my-7" />
              <h3 className="text-sm">طابور المهام الخلفية</h3>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                {Object.keys(d.queue).length === 0
                  ? <span>الطابور فارغ.</span>
                  : Object.entries(d.queue).map(([status, n]) => (
                      <span key={status} className="chip border border-white/12" dir="ltr">
                        {status}: {n}
                      </span>
                    ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
