import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'أسعار رَصْد' };

const PLANS = [
  { name: 'أساسية', for: 'للمنشآت الصغيرة التي تبدأ بالمنافسات الحكومية',
    features: ['اكتشاف الفرص وتنبيهاتها', 'ملف منشأة واحد', 'تحليل توافق محدود شهرياً', 'مستخدمان'],
    cta: 'ابدأ', featured: false },
  { name: 'احترافية', for: 'لفرق المنافسات التي تعمل على فرص متعددة أسبوعياً',
    features: ['تحليل غير محدود للتوافق والالتزام', 'تحليل المخاطر وإعداد المسودات',
      'مسارات موافقة بشرية', 'تقارير وتصدير', 'حتى عشرة مستخدمين'],
    cta: 'اطلب عرضاً', featured: true },
  { name: 'مؤسسية', for: 'للمنشآت الكبيرة ومتعددة القطاعات',
    features: ['أوزان تقييم مخصّصة', 'تكاملات ومصادر إضافية',
      'صلاحيات متقدمة وسجل تدقيق موسّع', 'دعم مخصص واتفاقية مستوى خدمة'],
    cta: 'تواصل معنا', featured: false },
];

export default function Pricing() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <PageHeader
        kicker="الأسعار"
        title="باقــات تنمو مع حجم منافســاتك"
        lead="تُحدَّد القيمة النهائية بعد تقييم حجم الاستخدام والتكاملات المطلوبة."
      />
      <div className="grid items-start gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div key={plan.name} className={plan.featured ? 'lg:-mt-5' : ''}>
            <Card className={plan.featured
              ? 'flex h-full flex-col border-blue/40 bg-blue/[.08] shadow-[0_30px_80px_-40px_rgba(47,107,255,.5)]'
              : 'flex h-full flex-col'}>
              {plan.featured && (
                <span className="chip mb-5 self-start border border-sand/40 text-[10px] uppercase tracking-[.16em] text-sand">
                  الأكثر اختياراً
                </span>
              )}
              <h3 className="text-xl">{plan.name}</h3>
              <p className="mt-3 text-sm text-muted">{plan.for}</p>
              <div className="hair my-7" />
              <ul className="flex-1 space-y-3.5 text-sm text-muted">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blue" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/demo" className={plan.featured ? 'btn-primary mt-7' : 'btn-ghost mt-7'}>
                {plan.cta}
              </Link>
            </Card>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center text-xs text-muted/60">
        استهلاك نماذج الذكاء الاصطناعي يُحتسب على مفاتيح مزوّدك في النشر الخاص، ويظهر في تقرير تنفيذ
        الوكلاء بعدد الرموز لكل تشغيل.
      </p>
    </main>
  );
}
