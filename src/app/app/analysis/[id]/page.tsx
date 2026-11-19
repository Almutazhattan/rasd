import Link from 'next/link';
import { notFound as nf } from 'next/navigation';
import { requireAuth } from '@/server/http/context';
import { getAnalysis } from '@/server/analysis';
import { kickJobs } from '@/server/job-runner';
import { listApprovals } from '@/server/approvals';
import { isAppError } from '@/lib/errors';
import {
  Alert, AnalysisStatusBadge, ApprovalBadge, Breadcrumb, Card, ComplianceBadge, DateText,
  EmptyState, Meter, PageHeader, Pill, Provenance, ProvenanceLegend, Row, ScoreRing,
  SeverityBadge, SourceBadge, VerdictBadge,
} from '@/components/ui';
import { ApprovalDecision, CreateDraftButton, Refresher } from '@/components/client/forms';
import { DIMENSION_LABELS } from '@/lib/scoring';
import type {
  AnalysisStatus, ApprovalStatus, ComplianceStatus, Provenance as Prov, Severity, Verdict,
} from '@/lib/db/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default async function AnalysisPage({ params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  let data;
  try {
    data = await getAnalysis(ctx, params.id);
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') nf();
    throw err;
  }

  const a = data.analysis as Row;
  const t = data.tender as Row;
  const approvals = (await listApprovals(ctx, 'ALL')) as Row[];
  const mine = approvals.filter((x) => x.analysis_id === params.id);
  const methodology = (a.methodology ?? {}) as Row;
  const blocking = (data.compliance as Row[]).filter((c) => c.blocking);
  const inFlight = a.status === 'QUEUED' || a.status === 'RUNNING';
  // Serverless hosts have no worker: a view of queued work nudges the queue.
  if (a.status === 'QUEUED') await kickJobs();

  return (
    <div>
      <Breadcrumb
        items={[
          { href: '/app/opportunities', label: 'الفرص' },
          { href: `/app/opportunities/${t.id}`, label: String(t.title).slice(0, 40) },
          { label: 'التحليل' },
        ]}
      />
      <PageHeader
        kicker="تحليل فرصة"
        title={String(t.title)}
        lead={String(t.entity)}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AnalysisStatusBadge value={a.status as AnalysisStatus} />
            <Link href={`/app/agents/${params.id}`} className="btn-ghost text-sm">سجل الوكلاء</Link>
            <Link href={`/api/reports?kind=OPPORTUNITY_ANALYSIS&analysisId=${params.id}&format=csv`}
              className="btn-ghost text-sm">تصدير CSV</Link>
            <CreateDraftButton analysisId={params.id} />
          </div>
        }
      />

      {inFlight && (
        <div className="mb-10">
          <Alert tone="info" title="التحليل قيد التنفيذ">
            يعمل المنسّق والوكلاء المتخصصون الآن. يمكنك مغادرة الصفحة — التنفيذ في الخلفية ولا يتوقف
            بإغلاق المتصفح. <Refresher seconds={6} />
          </Alert>
        </div>
      )}

      {a.status === 'PROVIDER_UNCONFIGURED' && (
        <div className="mb-10">
          <Alert tone="warn" title="لم يُنفَّذ أي وكيل">
            {String(a.failure_reason ?? 'لا مزوّد ذكاء اصطناعي مُهيّأ في هذا النشر.')}
          </Alert>
        </div>
      )}

      {a.status === 'FAILED' && (
        <div className="mb-10">
          <Alert tone="danger" title="تعذّر إكمال التحليل">
            {String(a.failure_reason ?? 'سبب غير معروف.')}
          </Alert>
        </div>
      )}

      {blocking.length > 0 && (
        <div className="mb-10">
          <Alert tone="danger" title={`${blocking.length} متطلب إلزامي قد يؤدي إلى الاستبعاد`}>
            <ul className="space-y-2">
              {blocking.map((c) => (
                <li key={c.id}>· {c.label}{c.note ? ` — ${c.note}` : ''}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs">
              هذه البنود معروضة مستقلةً عن الدرجة: الدرجة المرتفعة لا تلغي سبب استبعاد.
            </p>
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[auto,1fr]">
        <Card className="flex flex-col items-center justify-center">
          <ScoreRing
            score={a.score ?? null}
            blockingGaps={Number(a.blocking_gaps ?? 0)}
            confidence={a.confidence ?? null}
          />
          <div className="mt-7">
            <VerdictBadge value={(a.verdict as Verdict) ?? null} />
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <SourceBadge isDemo={t.is_demo} verification={t.verification} sourceName={t.source_name} />
          </div>
        </Card>

        <Card>
          <h2 className="text-lg">الأبعاد الموزونة</h2>
          {data.dimensions.length === 0 ? (
            <p className="mt-5 text-sm text-muted">لم تُحسب أبعاد بعد.</p>
          ) : (
            <div className="mt-7 space-y-5">
              {(data.dimensions as Row[]).map((d) => (
                <div key={d.id}>
                  <Meter
                    label={`${DIMENSION_LABELS[d.key as keyof typeof DIMENSION_LABELS]?.ar ?? d.key} · وزن ${d.weight}`}
                    value={Number(d.raw)}
                  />
                  {d.rationale && <p className="mt-2 text-xs text-muted/70">{d.rationale}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {a.summary && (
        <Card className="mt-6">
          <h2 className="text-lg">التوصية وشرحها</h2>
          <p className="mt-5 whitespace-pre-wrap text-sm text-muted">{a.summary}</p>

          <div className="mt-7 grid gap-6 sm:grid-cols-3">
            {[
              ['الافتراضات', a.assumptions as string[]],
              ['معلومات ناقصة', a.missing_info as string[]],
              ['الخطوات التالية', a.next_actions as string[]],
            ].map(([label, items]) => (
              <div key={label as string}>
                <h3 className="lbl">{label as string}</h3>
                {(items as string[])?.length ? (
                  <ul className="space-y-2 text-xs text-muted">
                    {(items as string[]).map((x, i) => <li key={i}>· {x}</li>)}
                  </ul>
                ) : (
                  <p className="text-xs text-muted/60">—</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg">قائمة الالتزام</h2>
          {data.compliance.length === 0 ? (
            <p className="mt-5 text-sm text-muted">لا بنود التزام مسجّلة.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {(data.compliance as Row[]).map((c) => (
                <li key={c.id} className="border-b border-white/[.05] pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ComplianceBadge value={c.status as ComplianceStatus} />
                    {c.mandatory && <span className="chip border border-white/20 text-[10px] text-muted">إلزامي</span>}
                    {c.blocking && <span className="chip border border-danger/40 text-[10px] text-danger">قد يستبعد</span>}
                    <Provenance value={c.provenance as Prov} />
                  </div>
                  <p className="mt-3 text-sm">{c.label}</p>
                  {c.note && <p className="mt-2 text-xs text-muted">{c.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-lg">المخاطر</h2>
          {data.risks.length === 0 ? (
            <p className="mt-5 text-sm text-muted">لا مخاطر مسجّلة.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {(data.risks as Row[]).map((r) => (
                <li key={r.id} className="border-b border-white/[.05] pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge value={r.severity as Severity} />
                    <Pill>{r.category}</Pill>
                    <span className="text-xs tnum text-muted/60">
                      احتمال {r.likelihood}/5 · أثر {r.impact}/5
                    </span>
                  </div>
                  <p className="mt-3 text-sm">{r.title}</p>
                  {r.detail && <p className="mt-2 text-xs text-muted">{r.detail}</p>}
                  {r.mitigation && <p className="mt-2 text-xs text-blue-soft">تخفيف: {r.mitigation}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-lg">الأدلة</h2>
          <ProvenanceLegend />
        </div>
        {data.evidence.length === 0 ? (
          <p className="mt-5 text-sm text-muted">لا أدلة مسجّلة.</p>
        ) : (
          <ul className="mt-7 space-y-3">
            {(data.evidence as Row[]).map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3 border-b border-white/[.04] pb-3 last:border-0">
                <Provenance value={e.provenance as Prov} />
                <span className="min-w-0 flex-1 text-sm text-muted">{e.statement}</span>
                {e.doc_ref && (
                  <span className="shrink-0 text-xs text-muted/60">
                    {e.doc_ref}{e.page_ref ? ` · ص${e.page_ref}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <h2 className="text-lg">المنهجية</h2>
        <p className="mt-3 text-sm text-muted">
          الأوزان والصيغة المستخدمة في هذا التحليل بالتحديد، محفوظة معه — فالنتيجة قابلة لإعادة
          البناء حتى لو تغيّرت أوزان مساحة العمل لاحقاً.
        </p>
        {methodology.formula && (
          <p className="mt-5 rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-xs text-muted" dir="ltr">
            {String(methodology.formula)}
          </p>
        )}
        {Array.isArray(methodology.verdictRules) && (
          <ul className="mt-5 space-y-2 text-xs text-muted">
            {(methodology.verdictRules as { ar: string }[]).map((r, i) => <li key={i}>· {r.ar}</li>)}
          </ul>
        )}
        {methodology.verdictOverridden === true && (
          <p className="mt-5 text-xs text-sand">
            تجاوز المحرك التوصية المقترحة من الوكيل ({String(methodology.proposedVerdict)}) وطبّق
            التوصية المحسوبة، لأن قواعد الأهلية تمنع ما اقترحه.
          </p>
        )}
        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-blue-soft">عرض المنهجية كاملة</summary>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-[11px] text-muted" dir="ltr">
            {JSON.stringify(methodology, null, 2)}
          </pre>
        </details>
      </Card>

      <section className="mt-14">
        <h2 className="mb-5 text-xl">نقاط الموافقة</h2>
        {mine.length === 0 ? (
          <EmptyState title="لا نقاط موافقة لهذا التحليل" body="تُنشأ نقاط الموافقة عند اكتمال التحليل." />
        ) : (
          <div className="space-y-4">
            {mine.map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ApprovalBadge value={r.status as ApprovalStatus} />
                      <Pill>{r.type}</Pill>
                    </div>
                    <p className="mt-3 text-sm">{r.title}</p>
                    {r.detail && <p className="mt-2 text-xs text-muted">{r.detail}</p>}
                    <p className="mt-2 text-xs text-muted/60"><DateText value={r.created_at} withTime /></p>
                  </div>
                  {r.status === 'PENDING' && <ApprovalDecision requestId={r.id} />}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
