import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { facets, searchTenders } from '@/server/tenders';
import { providerStates } from '@/server/providers';
import {
  Card, DateText, DaysLeft, EmptyState, IntegrationBadge, PageHeader, Pill, Row, SourceBadge,
} from '@/components/ui';
import { DiscoverButton } from '@/components/client/forms';
import { ManualTenderForm } from '@/components/client/tender-forms';

export const metadata = { title: 'الفرص — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function Opportunities({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string' && v !== '') flat[k] = v;
  }

  const [result, f] = await Promise.all([searchTenders(ctx, flat), facets(ctx)]);
  const providers = providerStates();

  return (
    <div>
      <PageHeader
        kicker="الفرص"
        title="اكتشاف المنافسات"
        lead="كل سجل يحتفظ بمصدره ووقت استرجاعه وحالة توثيقه."
        actions={<DiscoverButton />}
      />

      <div className="mb-10 flex flex-wrap gap-2">
        {providers.map((p) => (
          <IntegrationBadge key={p.key} state={p.state} label={p.label.ar} />
        ))}
      </div>

      <form className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="lg:col-span-2">
          <span className="label">بحث</span>
          <input className="input" name="q" defaultValue={flat.q ?? ''} placeholder="عنوان، جهة، نطاق عمل، رقم مرجعي" />
        </label>
        <label>
          <span className="label">القطاع</span>
          <select className="input" name="sector" defaultValue={flat.sector ?? ''}>
            <option value="">الكل</option>
            {f.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span className="label">المنطقة</span>
          <select className="input" name="region" defaultValue={flat.region ?? ''}>
            <option value="">الكل</option>
            {f.regions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span className="label">الحالة</span>
          <select className="input" name="status" defaultValue={flat.status ?? ''}>
            <option value="">الكل</option>
            <option value="OPEN">مفتوحة</option>
            <option value="CLOSING_SOON">تُغلق قريباً</option>
            <option value="CLOSED">مغلقة</option>
            <option value="AWARDED">تمت ترسيتها</option>
            <option value="CANCELLED">ملغاة</option>
          </select>
        </label>
        <label>
          <span className="label">الترتيب</span>
          <select className="input" name="sort" defaultValue={flat.sort ?? 'closing'}>
            <option value="closing">الأقرب إغلاقاً</option>
            <option value="published">الأحدث نشراً</option>
            <option value="title">الاسم</option>
          </select>
        </label>
        <label className="flex items-end gap-3">
          <input type="checkbox" name="bookmarkedOnly" value="true"
            defaultChecked={flat.bookmarkedOnly === 'true'} className="h-4 w-4 accent-[color:var(--blue)]" />
          <span className="text-sm text-muted">المحفوظة فقط</span>
        </label>
        <label className="flex items-end gap-3">
          <input type="checkbox" name="includeDemo" value="false"
            defaultChecked={flat.includeDemo === 'false'} className="h-4 w-4 accent-[color:var(--blue)]" />
          <span className="text-sm text-muted">استثناء التوضيحية</span>
        </label>
        <div className="flex items-end gap-3">
          <button className="btn-primary" type="submit">تطبيق</button>
          <Link href="/app/opportunities" className="btn-quiet text-sm">مسح</Link>
        </div>
      </form>

      {result.items.length === 0 ? (
        <EmptyState
          title="لا نتائج"
          body="لا سجلات تطابق هذا البحث. جرّب تخفيف المرشّحات، أو اكتشف فرصاً من المصادر، أو أضف منافسة يدوياً."
          action={<DiscoverButton />}
        />
      ) : (
        <>
          <p className="mb-5 text-xs text-muted">
            {result.total} سجلاً · صفحة {result.page} من {result.pages}
          </p>
          <div className="space-y-4">
            {(result.items as Row[]).map((t) => (
              <Card key={t.id} className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/opportunities/${t.id}`} className="text-lg hover:text-blue-soft">
                      {t.title}
                    </Link>
                    <p className="mt-2 text-sm text-muted">{t.entity}</p>
                    {t.summary && <p className="mt-3 line-clamp-2 text-sm text-muted/80">{t.summary}</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <SourceBadge isDemo={t.is_demo} verification={t.verification} sourceName={t.source_name} />
                      {t.sector && <Pill>{t.sector}</Pill>}
                      {t.region && <Pill>{t.region}</Pill>}
                      {t.estimated_value_band && <Pill>{t.estimated_value_band}</Pill>}
                      {t.bond_required && <Pill>ضمان مطلوب</Pill>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <DaysLeft value={t.closes_at} />
                    <div className="mt-2 text-xs text-muted/60">
                      إغلاق <DateText value={t.closes_at} />
                    </div>
                    <div className="mt-1 text-xs text-muted/60">
                      نشر <DateText value={t.published_at} />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {result.pages > 1 && (
            <div className="mt-10 flex flex-wrap gap-2">
              {Array.from({ length: Math.min(result.pages, 12) }, (_, i) => i + 1).map((p) => {
                const params = new URLSearchParams(flat);
                params.set('page', String(p));
                return (
                  <Link
                    key={p}
                    href={`/app/opportunities?${params.toString()}`}
                    className={p === result.page ? 'btn-primary px-4 py-2 text-xs' : 'btn-ghost px-4 py-2 text-xs'}
                  >
                    {p}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}

      <section className="mt-14">
        <h2 className="mb-5 text-xl">إضافة منافسة يدوياً</h2>
        <Card>
          <p className="mb-7 text-sm text-muted">
            تُحفظ المنافسة المُدخلة يدوياً بوسم «غير موثّقة»: أدخلها شخص ولم تُطابق بمصدر رسمي.
          </p>
          <ManualTenderForm />
        </Card>
      </section>
    </div>
  );
}
