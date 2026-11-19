import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { listReports } from '@/server/reports';
import { listAnalyses } from '@/server/analysis';
import { listDrafts } from '@/server/drafts';
import {
  AnalysisStatusBadge, Card, DateText, EmptyState, PageHeader, Pill, Row, VerdictBadge,
} from '@/components/ui';
import type { AnalysisStatus, Verdict } from '@/lib/db/types';

export const metadata = { title: 'التقارير — رَصْد' };
export const dynamic = 'force-dynamic';

const KINDS: { kind: string; label: string; note: string }[] = [
  { kind: 'COMPANY_READINESS', label: 'جاهزية المنشأة', note: 'ما على الملف فعلاً، وما ينقصه.' },
  { kind: 'COMPLIANCE', label: 'الالتزام', note: 'كل بنود الالتزام، والحاجزة منها أولاً.' },
  { kind: 'RISK', label: 'المخاطر', note: 'المخاطر المسجّلة مرتبة بالشدة.' },
  { kind: 'TENDER_COMPARISON', label: 'مقارنة الفرص', note: 'الفرص المحلَّلة بدرجاتها وفجواتها.' },
  { kind: 'AGENT_EXECUTION', label: 'تنفيذ الوكلاء', note: 'التشغيلات وحالاتها واستهلاك الرموز.' },
  { kind: 'DECISION_HISTORY', label: 'سجل القرارات', note: 'من اعتمد ماذا ومتى وبأي تعليق.' },
  { kind: 'ACTIVITY', label: 'النشاط', note: 'سجل التدقيق الكامل لمساحة العمل.' },
];

export default async function ReportsPage() {
  const ctx = await requireAuth();
  const [saved, analyses, drafts] = await Promise.all([
    listReports(ctx), listAnalyses(ctx, 30), listDrafts(ctx),
  ]);

  return (
    <div>
      <PageHeader
        kicker="التقارير"
        title="مركز التقارير"
        lead="كل تقرير مبنيّ من سجلات مساحة عملك. تقرير مساحة عمل فارغة تقرير فارغ يقول ذلك."
      />

      <section className="mb-14">
        <h2 className="mb-5 text-xl">تقارير جاهزة</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {KINDS.map((k) => (
            <Card key={k.kind} className="flex flex-col">
              <h3 className="text-lg">{k.label}</h3>
              <p className="mt-3 flex-1 text-sm text-muted">{k.note}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a className="btn-ghost text-xs" href={`/api/reports?kind=${k.kind}&format=csv`}>CSV</a>
                <a className="btn-quiet text-xs" href={`/api/reports?kind=${k.kind}&format=json&save=true`}>
                  JSON وحفظ
                </a>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-xl">التحليلات</h2>
        {analyses.length === 0 ? (
          <EmptyState title="لا تحليلات" body="شغّل تحليلاً من صفحة أي فرصة." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>المنافسة</th><th>الحالة</th><th>التوصية</th><th>الدرجة</th><th>إلزامي ناقص</th><th>التاريخ</th><th></th></tr>
              </thead>
              <tbody>
                {(analyses as Row[]).map((a) => (
                  <tr key={a.id}>
                    <td className="max-w-xs">
                      <Link href={`/app/analysis/${a.id}`} className="block truncate text-sm hover:text-blue-soft">
                        {a.tender_title}
                      </Link>
                      {a.is_demo && <span className="chip mt-1 border border-sand/40 text-[10px] text-sand">توضيحية</span>}
                    </td>
                    <td><AnalysisStatusBadge value={a.status as AnalysisStatus} /></td>
                    <td><VerdictBadge value={(a.verdict as Verdict) ?? null} /></td>
                    <td className="tnum text-sm">{a.score ?? '—'}</td>
                    <td className="tnum text-sm">
                      {Number(a.blocking_gaps) > 0
                        ? <span className="text-danger">{a.blocking_gaps}</span>
                        : <span className="text-muted/60">0</span>}
                    </td>
                    <td className="text-sm"><DateText value={a.created_at} /></td>
                    <td>
                      <a className="text-xs text-blue-soft"
                        href={`/api/reports?kind=OPPORTUNITY_ANALYSIS&analysisId=${a.id}&format=csv`}>
                        CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-xl">مسودات العروض</h2>
        {drafts.length === 0 ? (
          <EmptyState title="لا مسودات" body="أعِدّ مسودة من صفحة أي تحليل مكتمل." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>المسودة</th><th>المنافسة</th><th>النسخة</th><th>الاعتماد</th><th>التصدير</th></tr></thead>
              <tbody>
                {(drafts as Row[]).map((d) => (
                  <tr key={d.id}>
                    <td className="max-w-xs">
                      <Link href={`/app/response/${d.id}`} className="block truncate text-sm hover:text-blue-soft">
                        {d.title}
                      </Link>
                    </td>
                    <td className="max-w-xs"><span className="block truncate text-sm text-muted">{d.tender_title}</span></td>
                    <td className="tnum text-sm">{d.version}</td>
                    <td className="text-sm">
                      {d.approved_at
                        ? <span className="chip border border-ok/30 text-[10px] text-ok">معتمدة</span>
                        : <span className="chip border border-sand/40 text-[10px] text-sand">غير معتمدة</span>}
                    </td>
                    <td className="text-sm"><DateText value={d.exported_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {saved.length > 0 && (
        <section>
          <h2 className="mb-5 text-xl">تقارير محفوظة</h2>
          <div className="space-y-3">
            {(saved as Row[]).map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm">{r.title}</p>
                  <p className="mt-1 text-xs text-muted/60"><DateText value={r.created_at} withTime /></p>
                </div>
                <Pill>{String(r.kind)}</Pill>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
