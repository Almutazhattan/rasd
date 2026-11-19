import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'تواصل مع رَصْد' };

export default function Contact() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <PageHeader kicker="التواصل" title="تواصل معنا" lead="للاستفسارات والشراكات وطلبات العرض." />
      <Card>
        <dl className="space-y-7 text-sm">
          <div>
            <dt className="lbl">البريد الإلكتروني</dt>
            <dd dir="ltr" className="text-ink">hello@rasd.sa</dd>
          </div>
          <div>
            <dt className="lbl">الموقع</dt>
            <dd className="text-ink">الرياض · جازان، المملكة العربية السعودية</dd>
          </div>
          <div>
            <dt className="lbl">طلب عرض تجريبي</dt>
            <dd className="text-muted">
              املأ نموذج الطلب في صفحة العرض التجريبي، ونعرض لك رَصْد على منافسة فعلية في قطاعك.
            </dd>
          </div>
        </dl>
      </Card>
      <p className="mt-7 text-xs text-muted/60">
        لا يوجد إرسال بريد مُهيّأ في هذا النشر افتراضياً؛ راجع docs/INTEGRATIONS.md لتهيئة SMTP.
      </p>
    </main>
  );
}
