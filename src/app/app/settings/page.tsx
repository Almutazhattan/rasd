import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { loadWeights } from '@/server/analysis';
import { can } from '@/lib/rbac';
import { Alert, Card, PageHeader } from '@/components/ui';
import { WeightsForm } from '@/components/client/forms';

export const metadata = { title: 'الإعدادات — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ctx = await requireAuth();
  const weights = await loadWeights(ctx);
  const mayEdit = can(ctx.role, 'weights:update');

  return (
    <div>
      <PageHeader
        kicker="الإعدادات"
        title="إعدادات مساحة العمل"
        actions={
          <div className="flex gap-3">
            <Link href="/app/settings/integrations" className="btn-ghost text-sm">التكاملات</Link>
            <Link href="/app/settings/billing" className="btn-ghost text-sm">الاشتراك</Link>
          </div>
        }
      />

      <section className="mb-14">
        <h2 className="mb-5 text-xl">أوزان التقييم</h2>
        <Card>
          <p className="mb-7 text-sm text-muted">
            تحدّد هذه الأوزان كيف تُجمع الأبعاد الستة في درجة واحدة. تُطبَّق على التحليلات القادمة،
            وكل تحليل سابق يحتفظ بنسخة الأوزان التي استُخدمت فيه — فالنتائج القديمة تبقى قابلة
            لإعادة البناء.
          </p>
          {mayEdit ? (
            <WeightsForm initial={weights as unknown as Record<string, number>} />
          ) : (
            <Alert tone="info" title="دورك لا يملك صلاحية تعديل الأوزان">
              تحتاج دور مدير منافسات أو أعلى. الصلاحية مفروضة في الخدمة.
            </Alert>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-5 text-xl">حدود لا يتجاوزها النظام</h2>
        <Card>
          <ul className="space-y-4 text-sm text-muted">
            <li>· لا يُقدِّم رَصْد أي عرض حكومي تلقائياً، بأي إعداد.</li>
            <li>· الدرجة لا تُلغي متطلباً إلزامياً ناقصاً — يُرفع مستقلاً ويحدّ من التوصية.</li>
            <li>· لا تُصدَّر مسودة قبل اعتماد المسودة واعتماد نقطة التصدير.</li>
            <li>· الوثائق والمصادر الخارجية تُعالج كبيانات غير موثوقة، لا كتعليمات للنظام.</li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
