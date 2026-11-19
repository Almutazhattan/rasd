import Link from 'next/link';
import { Alert, Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'عرض تجريبي لرَصْد' };

export default function Demo() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <PageHeader
        kicker="عرض تجريبي"
        title="جرّب رَصْد على بيانات توضيحية"
        lead="أنشئ مساحة عمل، ثم اكتشف فرصاً من مزوّد البيانات التوضيحية وشغّل تحليلاً كاملاً."
      />
      <div className="space-y-7">
        <Alert tone="warn" title="ما تراه في وضع العرض">
          مزوّد البيانات التوضيحية يُنشئ سجلات منافسات وهمية موسومة بوضوح. لا تُعرض في أي موضع دون
          وسم «بيانات توضيحية»، ولا تُستخدم لاتخاذ قرار.
        </Alert>
        <Card>
          <h2 className="text-xl">خطوات التجربة</h2>
          <ol className="mt-5 space-y-4 text-sm text-muted">
            <li>١. أنشئ مساحة عمل من صفحة التسجيل.</li>
            <li>٢. أكمل ملف المنشأة وأكّده، وارفع وثيقة أو اثنتين.</li>
            <li>٣. من صفحة الفرص اضغط «اكتشف فرصاً من المصادر».</li>
            <li>٤. افتح فرصة وشغّل التحليل، ثم تابع سجل الوكلاء خطوة بخطوة.</li>
            <li>٥. راجع نقاط الموافقة، ثم أعِدّ مسودة عرض وصدّرها بعد الاعتماد.</li>
          </ol>
          <div className="mt-7 flex flex-wrap gap-4">
            <Link href="/register" className="btn-primary">إنشاء مساحة عمل</Link>
            <Link href="/how-it-works" className="btn-ghost">كيف تعمل</Link>
          </div>
        </Card>
        <Alert tone="info" title="تنفيذ الوكلاء يحتاج مزوّد ذكاء اصطناعي">
          بلا مفتاح مزوّد مُهيّأ، تكتمل مهمة التحليل بحالة «المزوّد غير مُهيّأ» وبلا نتائج — ولا
          تُولَّد نتائج وهمية. اضبط ANTHROPIC_API_KEY لتشغيل الوكلاء فعلياً.
        </Alert>
      </div>
    </main>
  );
}
