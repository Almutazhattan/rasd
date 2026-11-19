import { requireAuth } from '@/server/http/context';
import { expiringDocuments, listCompanyDocuments } from '@/server/documents';
import { Alert, Breadcrumb, Card, DateText, EmptyState, PageHeader, Pill, Row } from '@/components/ui';
import { UploadDocument } from '@/components/client/forms';

export const metadata = { title: 'وثائق المنشأة — رَصْد' };
export const dynamic = 'force-dynamic';

const KINDS = [
  { value: 'cr', label: 'سجل تجاري' },
  { value: 'iso', label: 'شهادة أيزو' },
  { value: 'zakat', label: 'شهادة الزكاة' },
  { value: 'gosi', label: 'شهادة التأمينات' },
  { value: 'classification', label: 'شهادة تصنيف' },
  { value: 'reference', label: 'عقد أو مشروع مرجعي' },
  { value: 'financial', label: 'قوائم مالية' },
  { value: 'other', label: 'أخرى' },
];

export default async function DocumentsPage() {
  const ctx = await requireAuth();
  const [docs, expiring] = await Promise.all([listCompanyDocuments(ctx), expiringDocuments(ctx, 60)]);

  return (
    <div>
      <Breadcrumb items={[{ href: '/app/company', label: 'المنشأة' }, { label: 'الوثائق' }]} />
      <PageHeader
        kicker="الأدلة"
        title="وثائق المنشأة"
        lead="الوثيقة التي يُستخرج نصّها تصبح قابلة للاستشهاد بها بمرجع صفحة. وما لا يُستخرج نصّه لا يُستخدم كدليل."
      />

      {expiring.length > 0 && (
        <div className="mb-10">
          <Alert tone="warn" title={`${expiring.length} وثيقة تنتهي خلال ٦٠ يوماً`}>
            <ul className="space-y-2">
              {(expiring as Row[]).map((d) => (
                <li key={d.id}>· {d.title} — <DateText value={d.expires_at} /></li>
              ))}
            </ul>
            <p className="mt-3 text-xs">الوثيقة المنتهية سبب شائع للاستبعاد، ويرفعها وكيل الالتزام كبند حاجز.</p>
          </Alert>
        </div>
      )}

      <section className="mb-14">
        {docs.length === 0 ? (
          <EmptyState
            title="لا وثائق مرفوعة"
            body="ارفع السجل التجاري والشهادات والعقود المرجعية. بدونها يبقى كل بند التزام «غير محدَّد»."
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الوثيقة</th><th>النوع</th><th>الصفحات</th><th>النص المستخرج</th>
                  <th>الانتهاء</th><th>الرفع</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(docs as Row[]).map((d) => {
                  const extracted = d.extracted_at && Number(d.text_chars ?? 0) > 40;
                  return (
                    <tr key={d.id}>
                      <td className="max-w-xs"><span className="block truncate text-sm">{d.title}</span></td>
                      <td><Pill>{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</Pill></td>
                      <td className="tnum text-sm">{d.page_count ?? '—'}</td>
                      <td>
                        {extracted
                          ? <span className="chip border border-ok/30 text-[10px] text-ok tnum">
                              {Number(d.text_chars).toLocaleString('en')} حرفاً
                            </span>
                          : <span className="chip border border-sand/40 text-[10px] text-sand">لم يُستخرج</span>}
                      </td>
                      <td className="text-sm"><DateText value={d.expires_at} /></td>
                      <td className="text-sm"><DateText value={d.created_at} /></td>
                      <td>
                        <a className="text-xs text-blue-soft" href={`/api/documents/${d.id}/download?kind=company`}>
                          تحميل
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-5 text-xl">رفع وثيقة</h2>
        <Card>
          <UploadDocument endpoint="/api/documents" kinds={KINDS} />
        </Card>
      </section>
    </div>
  );
}
