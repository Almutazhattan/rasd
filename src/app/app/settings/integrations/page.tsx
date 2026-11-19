import { requireAuth } from '@/server/http/context';
import { providerStates } from '@/server/providers';
import { aiKeyName, aiModel, aiState, demoState, env, etimadState, mailState } from '@/lib/env';
import { Alert, Breadcrumb, Card, IntegrationBadge, PageHeader } from '@/components/ui';

export const metadata = { title: 'التكاملات — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  await requireAuth();
  const e = env();
  const rows = [
    {
      key: 'ai',
      label: `مزوّد الذكاء الاصطناعي (${({ anthropic: 'Anthropic', gemini: 'Google Gemini', groq: 'Groq', none: 'معطّل' } as const)[e.AI_PROVIDER]})`,
      state: aiState(),
      detail: `النموذج المضبوط: ${aiModel()}`,
      vars: ['AI_PROVIDER', aiKeyName(), aiKeyName().replace('_API_KEY', '_MODEL')],
      note:
        'بلا مفتاح، تُسجَّل كل محاولة تشغيل بحالة «المزوّد غير مُهيّأ» ولا تُنتج نتائج. ' +
        'لا يُحاكي النظام تنفيذ وكيل لم يُنفَّذ.',
    },
    {
      key: 'etimad',
      label: 'منصة اعتماد',
      state: etimadState(),
      detail: e.ETIMAD_API_BASE ? 'عنوان مضبوط' : 'لا عنوان مضبوط',
      vars: ['ETIMAD_API_BASE', 'ETIMAD_API_KEY'],
      note:
        'لا تنشر اعتماد واجهة برمجية عامة ذاتية الخدمة؛ الوصول يتطلب اتفاقية ومفاتيح. المُحوِّل ' +
        'مكتوب ومُوثَّق لكنه لم يُختبر مقابل الخدمة الحقيقية من هذا المستودع — راجع docs/INTEGRATIONS.md.',
    },
    {
      key: 'demo',
      label: 'مزوّد البيانات التوضيحية',
      state: demoState(),
      detail: 'أربعة سجلات توضيحية موسومة',
      vars: ['ENABLE_DEMO_PROVIDER'],
      note: 'كل سجل يُحفظ بوسم DEMO_DATA ويُعرض موسوماً في كل موضع. لا يُقدَّم كمنافسة رسمية أبداً.',
    },
    {
      key: 'smtp',
      label: 'البريد الصادر',
      state: mailState(),
      detail: e.SMTP_URL ? 'عنوان SMTP مضبوط' : 'لا عنوان SMTP',
      vars: ['SMTP_URL', 'MAIL_FROM'],
      note:
        'بلا SMTP، تُسجَّل روابط التحقق والدعوة في سجل الخادم ويُعلَن ذلك في الواجهة بدل الإيحاء ' +
        'بأن رسالة أُرسلت.',
    },
    {
      key: 'storage',
      label: 'تخزين الملفات',
      state: e.STORAGE_DRIVER === 'local' ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: `المحرّك: ${e.STORAGE_DRIVER}`,
      vars: ['STORAGE_DRIVER', 'STORAGE_LOCAL_DIR', 'S3_BUCKET', 'S3_REGION'],
      note:
        'المحرّك المحلي جاهز للتطوير. محرّك S3 منفذ كواجهة فقط ويرفض العمل بوضوح بدل الكتابة في ' +
        'مكان غير متوقع.',
    },
  ];

  return (
    <div>
      <Breadcrumb items={[{ href: '/app/settings', label: 'الإعدادات' }, { label: 'التكاملات' }]} />
      <PageHeader
        kicker="التكاملات"
        title="حالة كل تكامل، كما هي"
        lead="التكامل غير المُهيّأ يُعلَن غير مُهيّأ. لا نعرض نجاحاً لم يحدث."
      />

      <div className="mb-10">
        <Alert tone="info" title="أين تُضبط هذه القيم">
          كل القيم تُقرأ من متغيّرات البيئة على الخادم، ولا تُقرأ ولا تُرسل إلى المتصفح أبداً. انسخ
          ‎.env.example‎ إلى ‎.env‎ واضبطها هناك، ثم أعد تشغيل التطبيق والعامل الخلفي.
        </Alert>
      </div>

      <div className="space-y-5">
        {rows.map((r) => (
          <Card key={r.key}>
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <h2 className="text-lg">{r.label}</h2>
                <p className="mt-2 text-xs text-muted/70">{r.detail}</p>
              </div>
              <IntegrationBadge state={r.state} label="" />
            </div>
            <p className="mt-5 text-sm text-muted">{r.note}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {r.vars.map((v) => (
                <code key={v} className="chip border border-white/12 text-[11px] text-muted" dir="ltr">{v}</code>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <section className="mt-14">
        <h2 className="mb-5 text-xl">مزودات المنافسات المسجّلة</h2>
        <div className="flex flex-wrap gap-2">
          {providerStates().map((p) => (
            <IntegrationBadge key={p.key} state={p.state} label={p.label.ar} />
          ))}
        </div>
      </section>
    </div>
  );
}
