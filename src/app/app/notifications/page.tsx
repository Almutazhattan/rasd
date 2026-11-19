import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { listNotifications } from '@/server/notifications';
import { Card, DateText, EmptyState, PageHeader, Pill, Row } from '@/components/ui';
import { MarkNotificationsRead } from '@/components/client/forms';
import { mailState } from '@/lib/env';

export const metadata = { title: 'التنبيهات — رَصْد' };
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  NEW_OPPORTUNITY: 'فرصة جديدة',
  DEADLINE: 'مُهلة',
  ANALYSIS_COMPLETE: 'تحليل جاهز',
  MISSING_DOCUMENT: 'وثيقة ناقصة',
  APPROVAL_REQUEST: 'طلب موافقة',
  RISK_ALERT: 'تنبيه مخاطر',
  AGENT_FAILURE: 'فشل وكيل',
};

export default async function NotificationsPage() {
  const ctx = await requireAuth();
  const items = (await listNotifications(ctx, ctx.userId, 100)) as Row[];

  return (
    <div>
      <PageHeader
        kicker="التنبيهات"
        title="ما يستحق انتباهك"
        actions={<MarkNotificationsRead />}
      />

      {mailState() !== 'CONNECTED' && (
        <p className="mb-7 text-xs text-muted/70">
          البريد غير مُهيّأ في هذا النشر، فالتنبيهات داخل المنصة فقط. راجع docs/INTEGRATIONS.md.
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState title="لا تنبيهات" body="ستظهر هنا الفرص الجديدة والمُهل القادمة واكتمال التحليلات وطلبات الموافقة." />
      ) : (
        <div className="space-y-3">
          {items.map((n) => (
            <Card key={n.id} className={n.read_at ? 'p-5 opacity-70' : 'p-5'}>
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill>{KIND_LABELS[String(n.kind)] ?? String(n.kind)}</Pill>
                    {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-blue" />}
                  </div>
                  <p className="mt-3 text-sm">{n.title}</p>
                  {n.body && <p className="mt-2 text-xs text-muted">{n.body}</p>}
                </div>
                <div className="shrink-0 text-right text-xs text-muted/60">
                  <DateText value={n.created_at} withTime />
                  {n.link && (
                    <div className="mt-2">
                      <Link href={String(n.link)} className="text-blue-soft">فتح</Link>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
