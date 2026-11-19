import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { getProfile, readiness } from '@/server/company';
import { Alert, Card, DateText, PageHeader, Pill, Provenance, Row, Stat } from '@/components/ui';
import { ConfirmProfileButton, ProfileForm } from '@/components/client/forms';
import { ChildRecordForms } from '@/components/client/company-forms';
import type { Provenance as Prov } from '@/lib/db/types';

export const metadata = { title: 'المنشأة — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function CompanyPage() {
  const ctx = await requireAuth();
  const [data, ready] = await Promise.all([getProfile(ctx), readiness(ctx)]);
  const profile = (data?.profile ?? null) as Row | null;
  const confirmed = Boolean(profile?.confirmed_at);

  return (
    <div>
      <PageHeader
        kicker="الذاكرة المؤسسية"
        title="ملف المنشأة"
        lead="هذه البيانات هي ما يقارنه رَصْد بمتطلبات كل منافسة. كلما كانت موثّقة، قلّ اعتماد التحليل على الاستنتاج."
        actions={<Link href="/app/company/documents" className="btn-ghost text-sm">وثائق المنشأة</Link>}
      />

      <div className="mb-10 grid gap-5 sm:grid-cols-4">
        <Stat label="جاهزية المنشأة" value={`${ready.score}/100`} tone={ready.score < 50 ? 'warn' : 'ok'} />
        <Stat label="القدرات" value={data?.capabilities.length ?? 0} />
        <Stat label="الشهادات" value={data?.certifications.length ?? 0} />
        <Stat label="المشاريع المرجعية" value={data?.pastProjects.length ?? 0} />
      </div>

      {!confirmed && (
        <div className="mb-10">
          <Alert tone="warn" title="الملف غير مؤكد بشرياً">
            يستخدم رَصْد هذه البيانات في التحليل، لكنه يرفع نقطة موافقة لتأكيدها. أي تعديل لاحق
            يُلغي التأكيد ويعيد طلب المراجعة.
          </Alert>
        </div>
      )}

      {ready.findings.length > 0 && (
        <div className="mb-10">
          <Alert tone="info" title="ما ينقص الملف">
            <ul className="space-y-2">
              {ready.findings.map((f) => <li key={f.ar}>· {f.ar}</li>)}
            </ul>
          </Alert>
        </div>
      )}

      <section className="mb-14">
        <h2 className="mb-5 text-xl">البيانات الأساسية</h2>
        <Card>
          <ProfileForm initial={profile} />
          <div className="hair my-7" />
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="text-xs text-muted">
              {confirmed
                ? <>مؤكد في <DateText value={profile?.confirmed_at} withTime /></>
                : 'لم يُؤكَّد بعد.'}
            </div>
            <ConfirmProfileButton confirmed={confirmed} />
          </div>
        </Card>
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-xl">القدرات والشهادات والمشاريع</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <h3 className="text-lg">القدرات</h3>
            {(data?.capabilities.length ?? 0) === 0 ? (
              <p className="mt-5 text-sm text-muted">لا قدرات مسجّلة.</p>
            ) : (
              <ul className="mt-5 space-y-3 text-sm">
                {(data!.capabilities as Row[]).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 border-b border-white/[.05] pb-3 last:border-0">
                    <span>{c.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs tnum text-muted">{c.level}/5</span>
                      <Provenance value={c.provenance as Prov} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="text-lg">الشهادات</h3>
            {(data?.certifications.length ?? 0) === 0 ? (
              <p className="mt-5 text-sm text-muted">لا شهادات مسجّلة.</p>
            ) : (
              <ul className="mt-5 space-y-3 text-sm">
                {(data!.certifications as Row[]).map((c) => {
                  const expired = c.expires_at && new Date(c.expires_at).getTime() < Date.now();
                  return (
                    <li key={c.id} className="border-b border-white/[.05] pb-3 last:border-0">
                      <div className="flex items-center justify-between gap-3">
                        <span>{c.name}</span>
                        <Provenance value={c.provenance as Prov} />
                      </div>
                      <div className="mt-1 text-xs text-muted/70">
                        {c.issuer ?? '—'} · انتهاء <DateText value={c.expires_at} />
                        {expired && <span className="text-danger"> · منتهية</span>}
                        {!c.expires_at && <span className="text-sand"> · بلا تاريخ انتهاء</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="text-lg">المشاريع المرجعية</h3>
            {(data?.pastProjects.length ?? 0) === 0 ? (
              <p className="mt-5 text-sm text-muted">لا مشاريع مسجّلة.</p>
            ) : (
              <ul className="mt-5 space-y-3 text-sm">
                {(data!.pastProjects as Row[]).map((p) => (
                  <li key={p.id} className="border-b border-white/[.05] pb-3 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">{p.title}</span>
                      <Provenance value={p.provenance as Prov} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted/70">
                      {p.client && <Pill>{p.client}</Pill>}
                      {p.sector && <Pill>{p.sector}</Pill>}
                      {p.value_band && <Pill>{p.value_band}</Pill>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      <section>
        <h2 className="mb-5 text-xl">إضافة سجل</h2>
        <Card>
          <p className="mb-7 text-sm text-muted">
            السجل المرتبط بوثيقة مرفوعة يُحفظ بوسم «مؤكد»؛ وبدون وثيقة يبقى «من المنشأة».
          </p>
          <ChildRecordForms />
        </Card>
      </section>
    </div>
  );
}
