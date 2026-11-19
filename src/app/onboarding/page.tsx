import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, Card, PageHeader } from '@/components/ui';
import { ConfirmProfileButton, ProfileForm, UploadDocument } from '@/components/client/forms';
import { currentSession, requireAuth } from '@/server/http/context';
import { getProfile, readiness } from '@/server/company';
import { listCompanyDocuments } from '@/server/documents';
import { DemoWorkspaceCard } from '@/components/client/demo-workspace';
import { aiState } from '@/lib/env';
import { can } from '@/lib/rbac';

export const metadata = { title: 'تهيئة مساحة العمل — رَصْد' };
export const dynamic = 'force-dynamic';

const KINDS = [
  { value: 'cr', label: 'سجل تجاري' },
  { value: 'iso', label: 'شهادة أيزو' },
  { value: 'zakat', label: 'شهادة الزكاة' },
  { value: 'gosi', label: 'شهادة التأمينات' },
  { value: 'classification', label: 'شهادة تصنيف' },
  { value: 'reference', label: 'عقد أو مشروع مرجعي' },
  { value: 'other', label: 'أخرى' },
];

export default async function Onboarding() {
  const session = await currentSession();
  if (!session) redirect('/login');
  const ctx = await requireAuth();

  const [data, docs, ready] = await Promise.all([
    getProfile(ctx), listCompanyDocuments(ctx), readiness(ctx),
  ]);
  const confirmed = Boolean((data?.profile as { confirmed_at: Date | null } | undefined)?.confirmed_at);

  return (
    <main className="mx-auto max-w-4xl px-6 py-14">
      <PageHeader
        kicker="تهيئة"
        title="بيانات منشأتك هي أساس كل تحليل"
        lead="ما تُدخله هنا يُستخدم كمرجع معتمد: كلما كان أدقّ، كان التقييم أقرب للواقع وأقل اعتماداً على الاستنتاج."
        actions={<Link href="/app/dashboard" className="btn-ghost text-sm">تخطَّ إلى اللوحة</Link>}
      />

      {!data && can(ctx.role, 'profile:confirm') && (
        <div className="mb-10">
          <DemoWorkspaceCard aiConnected={aiState() === 'CONNECTED'} />
          <p className="mt-5 text-center text-xs text-muted/60">أو أدخل بيانات منشأتك الحقيقية أدناه.</p>
        </div>
      )}

      <div className="mb-10 grid gap-5 sm:grid-cols-3">
        <Card className="p-5">
          <div className="lbl text-[10px]">جاهزية المنشأة</div>
          <div className="mt-3 text-3xl tnum">{ready.score}<span className="text-base text-muted">/100</span></div>
        </Card>
        <Card className="p-5">
          <div className="lbl text-[10px]">الوثائق المرفوعة</div>
          <div className="mt-3 text-3xl tnum">{docs.length}</div>
        </Card>
        <Card className="p-5">
          <div className="lbl text-[10px]">حالة التأكيد</div>
          <div className="mt-3 text-sm">{confirmed ? 'مؤكد بشرياً' : 'بانتظار التأكيد'}</div>
        </Card>
      </div>

      {ready.findings.length > 0 && (
        <div className="mb-10">
          <Alert tone="warn" title="ما ينقص ملف منشأتك">
            <ul className="space-y-2">
              {ready.findings.map((f) => (
                <li key={f.ar}>· {f.ar}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <section className="mb-14">
        <h2 className="mb-5 text-xl">١. بيانات المنشأة</h2>
        <Card>
          <ProfileForm initial={(data?.profile as Record<string, unknown>) ?? null} />
        </Card>
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-xl">٢. وثائق المنشأة</h2>
        <Card>
          <p className="mb-7 text-sm text-muted">
            يُستخرج نصّ كل وثيقة مع أرقام صفحاتها، فتصبح قابلة للاستشهاد بها كدليل. الوثيقة التي
            لا يُستخرج منها نصّ تُعلَّم «غير مقروءة» ولا تُستعمل كدليل.
          </p>
          <UploadDocument endpoint="/api/documents" kinds={KINDS} />
        </Card>
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-xl">٣. التأكيد البشري</h2>
        <Card>
          <p className="mb-7 text-sm text-muted">
            التأكيد يجعل هذه البيانات مرجعاً معتمداً داخل المنصة. أي تعديل لاحق يُلغي التأكيد
            ويعيد طلب المراجعة — حتى لا يُبنى تحليل على بيانات تغيّرت دون علم أحد.
          </p>
          <ConfirmProfileButton confirmed={confirmed} />
        </Card>
      </section>

      <div className="flex gap-4">
        <Link href="/app/opportunities" className="btn-primary">إلى الفرص</Link>
        <Link href="/app/team" className="btn-ghost">دعوة فريقك</Link>
      </div>
    </main>
  );
}
