import Link from 'next/link';
import { notFound as nf } from 'next/navigation';
import { requireAuth } from '@/server/http/context';
import { getTender } from '@/server/tenders';
import { isAppError } from '@/lib/errors';
import {
  Alert, AnalysisStatusBadge, Breadcrumb, Card, DateText, DaysLeft, PageHeader, Pill,
  Provenance, Row, SourceBadge, VerdictBadge,
} from '@/components/ui';
import { BookmarkButton, RunAnalysisButton, UploadDocument } from '@/components/client/forms';
import type { AnalysisStatus, Provenance as Prov, Verdict } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

export default async function TenderPage({ params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  let data;
  try {
    data = await getTender(ctx, params.id);
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') nf();
    throw err;
  }

  const t = data.tender as Row;
  const mandatory = (data.requirements as Row[]).filter((r) => r.mandatory);

  return (
    <div>
      <Breadcrumb items={[{ href: '/app/opportunities', label: 'الفرص' }, { label: t.title }]} />
      <PageHeader
        kicker={t.entity}
        title={t.title}
        actions={
          <div className="flex flex-wrap gap-3">
            <BookmarkButton tenderId={params.id} bookmarked={data.bookmarked} />
            <RunAnalysisButton tenderId={params.id} />
          </div>
        }
      />

      {t.is_demo && (
        <div className="mb-10">
          <Alert tone="warn" title="بيانات توضيحية">
            هذا السجل من مزوّد البيانات التوضيحية: ليس منافسة حكومية قائمة، ولا يُستخدم لاتخاذ قرار.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-6">
          <Card>
            <h2 className="text-lg">نظرة عامة</h2>
            <dl className="mt-5 grid gap-5 sm:grid-cols-2">
              {[
                ['الجهة المتعاقدة', t.entity],
                ['الرقم المرجعي', t.reference_no ?? '—'],
                ['القطاع', t.sector ?? '—'],
                ['المنطقة', t.region ?? '—'],
                ['النوع', t.type ?? '—'],
                ['نطاق القيمة', t.estimated_value_band ?? 'غير معلن'],
                ['ضمان ابتدائي', t.bond_required === null ? 'غير معلن' : t.bond_required ? 'مطلوب' : 'غير مطلوب'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="lbl">{label}</dt>
                  <dd className="text-sm">{value as string}</dd>
                </div>
              ))}
              <div>
                <dt className="lbl">تاريخ النشر</dt>
                <dd className="text-sm"><DateText value={t.published_at} /></dd>
              </div>
              <div>
                <dt className="lbl">تاريخ الإغلاق</dt>
                <dd className="text-sm">
                  <DateText value={t.closes_at} /> · <DaysLeft value={t.closes_at} />
                </dd>
              </div>
            </dl>

            {t.summary && (
              <>
                <div className="hair my-7" />
                <h3 className="text-sm">الملخص</h3>
                <p className="mt-3 text-sm text-muted">{t.summary}</p>
              </>
            )}
            {t.scope_of_work && (
              <>
                <div className="hair my-7" />
                <h3 className="text-sm">نطاق العمل</h3>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{t.scope_of_work}</p>
              </>
            )}
            {t.submission_notes && (
              <>
                <div className="hair my-7" />
                <h3 className="text-sm">تعليمات التقديم</h3>
                <p className="mt-3 text-sm text-muted">{t.submission_notes}</p>
              </>
            )}
          </Card>

          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg">المتطلبات المستخرجة</h2>
              <span className="text-xs text-muted">
                {data.requirements.length} بنداً · {mandatory.length} إلزامي
              </span>
            </div>
            {data.requirements.length === 0 ? (
              <p className="mt-5 text-sm text-muted">
                لم تُستخرج متطلبات بعد. شغّل التحليل بعد رفع وثائق المنافسة — يستخرج وكيل فهم
                الوثائق المتطلبات مع مرجع الصفحة لكل بند.
              </p>
            ) : (
              <ul className="mt-5 space-y-4">
                {(data.requirements as Row[]).map((r) => (
                  <li key={r.id} className="border-b border-white/[.05] pb-4 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill>{r.category}</Pill>
                      {r.mandatory && <span className="chip border border-danger/40 text-[10px] text-danger">إلزامي</span>}
                      <Provenance value={r.provenance as Prov} />
                      {r.doc_ref && (
                        <span className="text-xs text-muted/70">
                          {r.doc_ref}{r.page_ref ? ` · ص${r.page_ref}` : ''}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm text-muted">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-lg">وثائق المنافسة</h2>
            {data.documents.length === 0 ? (
              <p className="mt-5 text-sm text-muted">لا وثائق مرفوعة لهذه المنافسة.</p>
            ) : (
              <ul className="mt-5 space-y-4">
                {(data.documents as Row[]).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[.05] pb-4 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{d.title}</p>
                      <p className="mt-1 text-xs text-muted/60">
                        {Math.round(Number(d.byte_size) / 1024)} ك.ب
                        {d.page_count ? ` · ${d.page_count} صفحة` : ''}
                      </p>
                      {!d.readable && d.note && <p className="mt-2 text-xs text-sand">{d.note}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {d.readable
                        ? <span className="chip border border-ok/30 text-[10px] text-ok">مقروءة</span>
                        : <span className="chip border border-sand/40 text-[10px] text-sand">غير مقروءة</span>}
                      <a className="btn-quiet text-xs" href={`/api/documents/${d.id}/download?kind=tender`}>تحميل</a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="hair my-7" />
            <h3 className="mb-5 text-sm">رفع كراسة أو ملحق</h3>
            <UploadDocument endpoint={`/api/tenders/${params.id}/documents`} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="text-lg">المصدر والتوثيق</h2>
            <div className="mt-5 space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <SourceBadge isDemo={t.is_demo} verification={t.verification} sourceName={t.source_name} />
              </div>
              <div>
                <div className="lbl">وقت الاسترجاع</div>
                <DateText value={t.retrieved_at} withTime />
              </div>
              {t.source_url && (
                <div>
                  <div className="lbl">رابط المصدر</div>
                  <a href={t.source_url} target="_blank" rel="noopener noreferrer"
                    className="break-all text-xs text-blue-soft" dir="ltr">
                    {t.source_url}
                  </a>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="text-lg">التحليلات</h2>
            {data.analyses.length === 0 ? (
              <p className="mt-5 text-sm text-muted">لم يُشغّل تحليل لهذه الفرصة بعد.</p>
            ) : (
              <ul className="mt-5 space-y-4">
                {(data.analyses as Row[]).map((a) => (
                  <li key={a.id} className="border-b border-white/[.05] pb-4 last:border-0">
                    <Link href={`/app/analysis/${a.id}`} className="text-sm hover:text-blue-soft">
                      تحليل <DateText value={a.created_at} />
                    </Link>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <AnalysisStatusBadge value={a.status as AnalysisStatus} />
                      <VerdictBadge value={(a.verdict as Verdict) ?? null} />
                      {a.score !== null && <span className="text-xs tnum text-muted">{a.score}/100</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.changes.length > 0 && (
            <Card>
              <h2 className="text-lg">سجل التعديلات</h2>
              <ul className="mt-5 space-y-4 text-xs">
                {(data.changes as Row[]).map((c, i) => (
                  <li key={i} className="border-b border-white/[.05] pb-3 last:border-0">
                    <div className="text-muted" dir="ltr">{c.field}</div>
                    <div className="mt-1 text-muted/60">
                      <span className="line-through">{String(c.before ?? '—').slice(0, 60)}</span>
                      {' → '}
                      <span className="text-ink">{String(c.after ?? '—').slice(0, 60)}</span>
                    </div>
                    <div className="mt-1 text-muted/50"><DateText value={c.noticed_at} withTime /></div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.qa.length > 0 && (
            <Card>
              <h2 className="text-lg">أسئلة وأجوبة</h2>
              <ul className="mt-5 space-y-4 text-sm">
                {(data.qa as Row[]).map((q, i) => (
                  <li key={i}>
                    <p className="text-ink">{q.question}</p>
                    <p className="mt-2 text-muted">{q.answer ?? 'بلا إجابة منشورة'}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
