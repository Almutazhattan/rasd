import Link from 'next/link';
import { Card, PageHeader, ProvenanceLegend } from '@/components/ui';
import { AGENT_LIST } from '@/agents/registry';
import { DEFAULT_WEIGHTS, DIMENSION_LABELS } from '@/lib/scoring';

export const metadata = { title: 'كيف تعمل رَصْد' };

export default function HowItWorks() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <PageHeader
        kicker="كيف تعمل"
        title="من إعلان المنافسة إلى قرار مبنيّ على دليل"
        lead="الشرح الكامل لما يفعله رَصْد، وما لا يفعله."
      />

      <section className="mb-14">
        <h2 className="mb-5 text-2xl">المسار</h2>
        <ol className="space-y-5">
          {[
            ['اكتشاف', 'يسترجع رَصْد سجلات المنافسات من المصادر المصرّح بها، ويوحّدها، ويحتفظ لكل سجل بمصدره ووقت استرجاعه ورابطه وحالة توثيقه.'],
            ['استخراج', 'يُستخرج نصّ الوثائق صفحةً صفحة، فكل متطلب يُسجَّل مع الوثيقة ورقم الصفحة. الوثيقة الممسوحة ضوئياً تُعلَّم «غير مقروءة» ولا تُستنتج محتوياتها.'],
            ['مطابقة', 'يقارن وكيل التوافق المتطلبات بقدرات المنشأة وشهاداتها ومشاريعها، ويضع لكل بُعد درجة ودليلاً ومصدر الدليل.'],
            ['التزام ومخاطر', 'يتحقق وكيل الالتزام من المتطلبات الإلزامية، ويرفع ما قد يسبب الاستبعاد مستقلاً. ثم يقيس وكيل المخاطر مخاطر المدة والتنفيذ والموارد والالتزام التعاقدي.'],
            ['حساب الدرجة', 'يُحسب الوزن في كود المنصة لا في النموذج اللغوي، وتُحفظ المنهجية كاملة مع التحليل.'],
            ['ضبط الجودة', 'يراجع وكيل مستقل المراجع والتعارض والادعاءات غير المدعومة، ويطلب مراجعة بشرية عند الحاجة.'],
            ['مراجعة بشرية', 'نقاط موافقة صريحة: المتطلبات الحرجة، التحليل غير المؤكد، التوصية، المسودة، والتصدير.'],
          ].map(([title, body], i) => (
            <li key={title as string}>
              <Card>
                <div className="flex items-baseline gap-4">
                  <span className="tnum text-sm text-blue-soft">0{i + 1}</span>
                  <div>
                    <h3 className="text-lg">{title}</h3>
                    <p className="mt-3 text-sm text-muted">{body}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-2xl">كيف تُحسب درجة التوافق</h2>
        <Card>
          <p className="text-sm text-muted">
            نموذج موزون بستة أبعاد منفصلة. الأوزان الافتراضية أدناه، وهي قابلة للتعديل من المستخدم
            المخوّل، وتُحفظ نسخة الأوزان المستخدمة مع كل تحليل حتى تبقى النتيجة قابلة لإعادة البناء.
          </p>
          <div className="mt-7 space-y-3">
            {Object.entries(DEFAULT_WEIGHTS).map(([key, weight]) => (
              <div key={key} className="flex items-baseline justify-between border-b border-white/[.05] pb-3">
                <span className="text-sm">{DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS].ar}</span>
                <span className="tnum text-sm text-muted">{weight}%</span>
              </div>
            ))}
          </div>
          <div className="mt-7 rounded-xl border border-sand/35 bg-sand/[.07] p-5 text-sm">
            <p className="text-ink">الدرجة لا تُخفي سبباً للاستبعاد.</p>
            <p className="mt-2 text-muted">
              المتطلب الإلزامي الناقص يُرفع مستقلاً، ويضع حدّاً أعلى للتوصية بغضّ النظر عن الدرجة:
              فرصة بدرجة ٩٤ ومعها شهادة إلزامية منتهية لا تُعرض كفرصة قوية.
            </p>
          </div>
        </Card>
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-2xl">الوكلاء وأدواتهم</h2>
        <div className="space-y-4">
          {AGENT_LIST.map((agent) => (
            <Card key={agent.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-lg">{agent.title.ar}</h3>
                <span className="text-xs text-muted/60" dir="ltr">{agent.key}</span>
              </div>
              <p className="mt-3 text-sm text-muted">{agent.role.ar}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {agent.tools.map((t) => (
                  <span key={t} className="chip border border-white/12 text-[11px] text-muted" dir="ltr">{t}</span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-14">
        <h2 className="mb-5 text-2xl">تمييز مصادر المعلومات</h2>
        <Card>
          <ProvenanceLegend />
          <p className="mt-5 text-sm text-muted">
            كل بند في التحليل يحمل أحد هذه الوسوم. الوكلاء ممنوعون من ترقية بند من «من المنشأة» أو
            «استنتاج آلي» إلى «مؤكد»، والمؤكد وحده هو ما تدعمه وثيقة مرفوعة بمرجع صفحة.
          </p>
        </Card>
      </section>

      <section>
        <h2 className="mb-5 text-2xl">ما لا يفعله رَصْد</h2>
        <Card>
          <ul className="space-y-4 text-sm text-muted">
            <li>· لا يقدّم أي عرض حكومي تلقائياً. التصدير يسلّمك ملفاً، والتقديم مسؤوليتك.</li>
            <li>· لا يختلق خبرة أو شهادة أو رقماً مالياً لم تُدخله المنشأة.</li>
            <li>· لا يعرض بيانات توضيحية كأنها منافسة رسمية قائمة — كل سجل عرض موسوم.</li>
            <li>· لا يرجّح احتمال الفوز، ولا يؤكد الأهلية دون دليل كافٍ.</li>
            <li>· لا يمثّل تنفيذ وكيل لم يُنفَّذ: بلا مزوّد ذكاء اصطناعي مُهيّأ، يظهر التحليل بحالة «المزوّد غير مُهيّأ» وبلا نتائج.</li>
          </ul>
        </Card>
      </section>

      <div className="mt-14 flex gap-4">
        <Link href="/register" className="btn-primary">ابدأ مساحة عمل</Link>
        <Link href="/pricing" className="btn-ghost">الأسعار</Link>
      </div>
    </main>
  );
}
