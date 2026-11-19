import Link from 'next/link';
import { requireAuth } from '@/server/http/context';
import { listApprovals } from '@/server/approvals';
import { can } from '@/lib/rbac';
import {
  Alert, ApprovalBadge, Card, DateText, EmptyState, PageHeader, Pill, Row,
} from '@/components/ui';
import { ApprovalDecision } from '@/components/client/forms';
import type { ApprovalStatus } from '@/lib/db/types';

export const metadata = { title: 'الموافقات — رَصْد' };
export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<string, string> = {
  COMPANY_PROFILE: 'تأكيد بيانات المنشأة',
  CRITICAL_REQUIREMENTS: 'المتطلبات الحرجة',
  UNCERTAIN_ANALYSIS: 'تحليل غير مؤكد',
  RECOMMENDATION: 'اعتماد التوصية',
  RESPONSE_DRAFT: 'مسودة العرض',
  EXPORT: 'اعتماد التصدير',
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const ctx = await requireAuth();
  const status = (searchParams.status ?? 'PENDING') as ApprovalStatus | 'ALL';
  const items = (await listApprovals(ctx, status)) as Row[];
  const mayDecide = can(ctx.role, 'approval:decide');

  return (
    <div>
      <PageHeader
        kicker="القرار البشري"
        title="طابور الموافقات"
        lead="النقاط التي يتوقف عندها النظام بانتظار قرار إنسان. لا تُعتمد توصية ولا تُصدَّر مسودة دون مرورها من هنا."
        actions={
          <div className="flex flex-wrap gap-2">
            {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((s) => (
              <Link
                key={s}
                href={`/app/approvals?status=${s}`}
                className={status === s ? 'btn-primary px-4 py-2 text-xs' : 'btn-ghost px-4 py-2 text-xs'}
              >
                {s === 'PENDING' ? 'معلّقة' : s === 'APPROVED' ? 'معتمدة' : s === 'REJECTED' ? 'مرفوضة' : 'الكل'}
              </Link>
            ))}
          </div>
        }
      />

      {!mayDecide && (
        <div className="mb-10">
          <Alert tone="info" title="دورك لا يملك صلاحية الاعتماد">
            يمكنك متابعة الطلبات، لكن القرار يحتاج دور مراجع أو مدير منافسات أو أعلى. الصلاحية
            مفروضة في الخدمة لا بإخفاء الأزرار.
          </Alert>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={status === 'PENDING' ? 'لا طلبات معلّقة' : 'لا طلبات'}
          body="تُنشأ الطلبات تلقائياً عند اكتمال تحليل أو إعداد مسودة أو تعديل ملف المنشأة."
        />
      ) : (
        <div className="space-y-4">
          {items.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ApprovalBadge value={r.status as ApprovalStatus} />
                    <Pill>{TYPE_LABELS[String(r.type)] ?? String(r.type)}</Pill>
                  </div>
                  <p className="mt-3 text-sm">{r.title}</p>
                  {r.detail && <p className="mt-2 text-xs text-muted">{r.detail}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted/60">
                    <span>طُلب <DateText value={r.created_at} withTime /></span>
                    {r.decided_at && <span>قُرِّر <DateText value={r.decided_at} withTime /></span>}
                    {r.analysis_id && (
                      <Link href={`/app/analysis/${r.analysis_id}`} className="text-blue-soft">التحليل</Link>
                    )}
                    {r.draft_id && (
                      <Link href={`/app/response/${r.draft_id}`} className="text-blue-soft">المسودة</Link>
                    )}
                  </div>
                </div>
                {r.status === 'PENDING' && mayDecide && <ApprovalDecision requestId={String(r.id)} />}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
