import Link from 'next/link';
import { Card, ProvenanceLegend } from '@/components/ui';
import { AGENT_LIST } from '@/agents/registry';

const STAGES = [
  {
    n: '01', title: 'اكتشاف مستمر',
    body: 'يراقب رَصْد المصادر الحكومية المصرّح بها، ويوحّد السجلات، ويستبعد المكرر، ويرتّب الفرص وفق نشاط منشأتك ونطاقها.',
  },
  {
    n: '02', title: 'فهم الوثائق',
    body: 'يستخرج النطاق والمتطلبات والشروط والتواريخ والمرفقات المطلوبة، مع الإشارة إلى الوثيقة والصفحة التي جاء منها كل بند.',
  },
  {
    n: '03', title: 'تقييم قابل للتفسير',
    body: 'يطابق المتطلبات بقدراتك وشهاداتك، ويحسب درجة موزونة بستة أبعاد منفصلة، مع عرض الدليل خلف كل رقم.',
  },
  {
    n: '04', title: 'مسودة ومراجعة بشرية',
    body: 'يُنظّم أقسام العرض ويربط كل متطلب بردّه ودليله. لا يُعتمد شيء ولا يُصدَّر إلا بموافقتك.',
  },
];

export default function Home() {
  return (
    <div>
      <header className="relative flex min-h-[86svh] items-center overflow-hidden pb-24 pt-28">
        <div className="aurora">
          <span className="blade blade-1" />
          <span className="blade blade-2" />
          <span className="blade blade-3" />
          <div className="grain" />
          <div className="vignette" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-7xl px-6">
          <div className="max-w-4xl">
            <span className="chip border border-white/12 bg-white/[.04] text-[11px] uppercase tracking-[.18em] text-muted">
              منصة ذكاء اصطناعي وكيلي
            </span>
            <h1 className="mt-7 text-[2.6rem] leading-[1.3] sm:text-6xl lg:text-[4.2rem]">
              المنافســات الحكوميــة،
              <br />
              <span className="font-light text-sand">بذكاء يتجــاوز البحــث.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg text-muted sm:text-xl">
              رَصْد يفهم منشأتك، ويكتشف الفرص المناسبة باستمرار، ويقرأ وثائق المنافسة، ويقيس التوافق،
              ويكشف الفجوات والمخاطر، ويشرح أسبابه — ثم يُعدّ مسودة العرض. والقرار يبقى لك.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link href="/register" className="btn-primary">ابدأ مساحة عمل</Link>
              <Link href="/how-it-works" className="btn-ghost">كيف تعمل</Link>
            </div>
            <p className="mt-14 text-[11px] uppercase tracking-[.2em] text-muted/60">
              المملكة العربية السعودية · بالعربية والإنجليزية
            </p>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="ambient" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="lbl text-[11px] tracking-[.22em] text-blue/90">التحدي</p>
            <h2 className="mt-5 text-3xl sm:text-5xl">
              الفرصــة ليست في العثور على المنافســة، <span className="font-light text-sand">بل في فهمها قبل الآخريــن.</span>
            </h2>
            <p className="mt-7 text-lg text-muted">
              منصات المنافسات تعرض الإعلانات. أما العمل الحقيقي — قراءة كراسة الشروط، واستخراج
              المتطلبات الإلزامية، ومطابقتها بقدرات المنشأة، وتقدير المخاطر قبل انتهاء المدة — فيبقى
              يدوياً ومكلفاً ومعرضاً للخطأ.
            </p>
          </div>

          <div className="mt-20 grid gap-6 md:grid-cols-3">
            {[
              ['كراسات بمئات الصفحات', 'متطلبات فنية وإدارية ومالية متناثرة بين الملاحق والأسئلة والأجوبة وتعديلات لاحقة.'],
              ['مُهل قصيرة', 'قرار المشاركة يحتاج أسبوعاً من المراجعة، والمدة المتاحة غالباً أقل من ذلك.'],
              ['استبعاد لأسباب شكلية', 'وثيقة ناقصة أو شهادة منتهية تكفي لإخراج عرض قوي من المنافسة.'],
            ].map(([title, body]) => (
              <Card key={title}>
                <h3 className="text-xl text-sand">{title}</h3>
                <div className="hair my-5" />
                <p className="text-sm text-muted">{body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="lbl text-[11px] tracking-[.22em] text-blue/90">كيف تعمل</p>
            <h2 className="mt-5 text-4xl sm:text-5xl">
              من الإعلــان
              <br />
              <span className="font-light text-sand">إلى مســودة جاهزة للمراجعــة.</span>
            </h2>
          </div>

          <div className="mt-20 grid gap-6 md:grid-cols-2">
            {STAGES.map((s, i) => (
              <Card key={s.n} className={i === 3 ? 'border-blue/40 bg-blue/[.07]' : ''}>
                <div className="flex items-start justify-between">
                  <span className="chip border border-white/12 tnum text-xs">{s.n}</span>
                </div>
                <h3 className="mt-5 text-2xl">{s.title}</h3>
                <p className="mt-3 text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="ambient" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="lbl text-[11px] tracking-[.22em] text-blue/90">المحرك</p>
            <h2 className="mt-5 text-4xl sm:text-5xl">
              ثمانيــة وكلاء متخصصيــن، <span className="font-light text-sand">ومنسّــق واحــد.</span>
            </h2>
            <p className="mt-7 text-lg text-muted">
              ليس محادثاً واحداً يتقلّب بين الأدوار. كل وكيل له مسؤولية محددة، وأدوات خاصة، ومخرجات
              منظمة تُتحقَّق من مخططها، وسجل تنفيذ محفوظ يمكن تتبّعه ومراجعته خطوة بخطوة.
            </p>
          </div>

          <div className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {AGENT_LIST.filter((a) => a.key !== 'recommendation').map((agent, i) => (
              <Card key={agent.key} className="flex flex-col">
                <div className="flex items-start justify-between">
                  <span className="text-xs tnum text-muted/50">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg">{agent.title.ar}</h3>
                <div className="hair my-4" />
                <p className="text-sm text-muted">{agent.role.ar}</p>
                <p className="mt-4 text-xs text-muted/60">{agent.tools.length} أداة مخصّصة</p>
              </Card>
            ))}
          </div>

          <div className="mt-14 max-w-3xl space-y-5">
            <p className="text-sm text-muted">
              يفصل رَصْد بين المعلومة المؤكدة، والمعلومة المُدخَلة من المنشأة، والاستنتاج الآلي،
              والمعلومة الناقصة — ولا يقدّم ترجيحاً بالفوز أو تأكيداً للأهلية دون دليل كافٍ.
            </p>
            <ProvenanceLegend />
          </div>
        </div>
      </section>

      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <Card className="p-9 text-center sm:p-14">
            <h2 className="text-3xl sm:text-5xl">
              ابدأ بفرصــة واحدة، <span className="font-light text-sand">وقــرار أوضــح.</span>
            </h2>
            <p className="mx-auto mt-7 max-w-xl text-muted">
              أنشئ مساحة عمل منشأتك، ارفع وثائقها، واطلب تحليل أول فرصة.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link href="/register" className="btn-primary">إنشاء مساحة عمل</Link>
              <Link href="/demo" className="btn-ghost">اطلب عرضاً تجريبياً</Link>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
