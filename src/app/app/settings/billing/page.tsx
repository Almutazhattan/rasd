import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { scoped } from '@/lib/tenancy';
import { getDb } from '@/lib/db';
import { Alert, Breadcrumb, Card, PageHeader, Row, Stat } from '@/components/ui';

export const metadata = { title: 'الاشتراك — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const ctx = await requireAuth();
  const org = await getDb()
    .selectFrom('organizations')
    .select(['name', 'plan', 'created_at'])
    .where('id', '=', ctx.orgId)
    .executeTakeFirst();

  const usage = (await scoped(ctx)
    .from('agent_runs')
    .select([
      (eb) => eb.fn.countAll<string>().as('runs'),
      (eb) => eb.fn.sum<string>('input_tokens').as('input_tokens'),
      (eb) => eb.fn.sum<string>('out_tokens').as('out_tokens'),
    ])
    .executeTakeFirst()) as Row | undefined;

  const members = await getDb()
    .selectFrom('memberships')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('org_id', '=', ctx.orgId)
    .executeTakeFirst();

  return (
    <div>
      <Breadcrumb items={[{ href: '/app/settings', label: 'الإعدادات' }, { label: 'الاشتراك' }]} />
      <PageHeader
        kicker="الاشتراك"
        title="الخطة والاستهلاك"
        lead="الاستهلاك محسوب من سجلات تشغيل الوكلاء الفعلية في مساحة عملك."
      />

      <div className="mb-10">
        <Alert tone="info" title="لا بوابة دفع في هذا الإصدار">
          لا يتضمّن هذا المستودع تكامل فواتير أو بوابة دفع: الخطة حقل على مساحة العمل، والاستهلاك
          معروض كما هو. دمج مزوّد فواتير موثّق في docs/LIMITATIONS.md بدل عرض اشتراك لا يعمل.
        </Alert>
      </div>

      <div className="grid gap-5 sm:grid-cols-4">
        <Stat label="مساحة العمل" value={<span className="text-xl">{org?.name ?? '—'}</span>} />
        <Stat label="الخطة" value={<span className="text-xl">{org?.plan ?? 'starter'}</span>} />
        <Stat label="الأعضاء" value={Number(members?.n ?? 0)} />
        <Stat label="تشغيلات الوكلاء" value={Number(usage?.runs ?? 0)} />
      </div>

      <Card className="mt-6">
        <h2 className="text-lg">استهلاك النماذج</h2>
        <p className="mt-3 text-sm text-muted">
          مجموع الرموز المسجّلة على تشغيلات الوكلاء في هذه المساحة. تُحتسب على مفتاح مزوّدك في النشر
          الخاص، ولا تمرّ بأي فاتورة من رَصْد.
        </p>
        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <Stat label="رموز الإدخال" value={Number(usage?.input_tokens ?? 0).toLocaleString('en')} />
          <Stat label="رموز الإخراج" value={Number(usage?.out_tokens ?? 0).toLocaleString('en')} />
        </div>
        <p className="mt-7 text-xs text-muted/60">
          تفصيل كل تشغيل في <Link href="/app/agents" className="text-blue-soft">صفحة الوكلاء</Link> وفي
          تقرير تنفيذ الوكلاء.
        </p>
      </Card>
    </div>
  );
}
