import Link from 'next/link';
import { notFound as nf } from 'next/navigation';
import { requireAuth } from '@/server/http/context';
import { getDraft } from '@/server/drafts';
import { isAppError } from '@/lib/errors';
import { listApprovals } from '@/server/approvals';
import {
  Alert, ApprovalBadge, Breadcrumb, Card, DateText, PageHeader, Pill, Provenance, Row,
} from '@/components/ui';
import { ApprovalDecision, SectionEditor } from '@/components/client/forms';
import { RequestExportApproval } from '@/components/client/draft-actions';
import type { ApprovalStatus, Provenance as Prov } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

export default async function ResponsePage({ params }: { params: { id: string } }) {
  const ctx = await requireAuth();
  let data;
  try {
    data = await getDraft(ctx, params.id);
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') nf();
    throw err;
  }

  const draft = data.draft as Row;
  const approvals = ((await listApprovals(ctx, 'ALL')) as Row[]).filter((a) => a.draft_id === params.id);
  const exportApproval = approvals.find((a) => a.type === 'EXPORT');
  const approved = Boolean(draft.approved_at);
  const exportable = approved && exportApproval?.status === 'APPROVED';
  const openPoints = (data.sections as Row[]).flatMap((s) => (s.open_points as string[]) ?? []);
  const missing = (data.mappings as Row[]).filter((m) => m.provenance === 'MISSING');

  return (
    <div>
      <Breadcrumb
        items={[
          { href: '/app/reports', label: 'العروض' },
          { href: `/app/analysis/${draft.analysis_id}`, label: 'التحليل' },
          { label: 'المسودة' },
        ]}
      />
      <PageHeader
        kicker={`النسخة ${draft.version}`}
        title={String(draft.title)}
        lead="مسودة للمراجعة البشرية. لا تُقدِّم المنصة أي عرض حكومي — التصدير يسلّمك ملفاً والتقديم مسؤوليتك."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {exportable ? (
              <>
                <a className="btn-primary text-sm" href={`/api/drafts/${params.id}/export?format=md`}>تصدير Markdown</a>
                <a className="btn-ghost text-sm" href={`/api/drafts/${params.id}/export?format=html`}>تصدير للطباعة</a>
              </>
            ) : (
              <RequestExportApproval draftId={params.id} approved={approved} />
            )}
          </div>
        }
      />

      {!approved && (
        <div className="mb-10">
          <Alert tone="warn" title="المسودة غير معتمدة بعد">
            لا يمكن تصدير مسودة قبل اعتمادها من مراجع، ثم اعتماد نقطة موافقة التصدير. التحرير بعد
            الاعتماد يُعيد المسودة إلى المراجعة تلقائياً.
          </Alert>
        </div>
      )}

      {openPoints.length > 0 && (
        <div className="mb-10">
          <Alert tone="info" title={`${openPoints.length} نقطة تحتاج استكمالاً من المنشأة`}>
            <ul className="space-y-2">
              {openPoints.slice(0, 12).map((p, i) => <li key={i}>· {p}</li>)}
            </ul>
            <p className="mt-3 text-xs">
              هذه نقاط لم تجد لها الوكلاء سنداً في سجلات المنشأة، فلم تُكتب بافتراض — وهي أهمّ ما
              تخرج به المسودة.
            </p>
          </Alert>
        </div>
      )}

      <div className="space-y-6">
        {(data.sections as Row[]).map((s) => (
          <Card key={s.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg">{s.heading}</h2>
              {Array.isArray(s.open_points) && (s.open_points as string[]).length > 0 && (
                <span className="chip border border-sand/35 text-[10px] text-sand">
                  {(s.open_points as string[]).length} نقطة مفتوحة
                </span>
              )}
            </div>
            <div className="mt-5">
              <SectionEditor
                draftId={params.id}
                sectionId={String(s.id)}
                heading={String(s.heading)}
                body={String(s.body ?? '')}
              />
            </div>
            {Array.isArray(s.open_points) && (s.open_points as string[]).length > 0 && (
              <ul className="mt-5 space-y-2 text-xs text-sand/90">
                {(s.open_points as string[]).map((p, i) => <li key={i}>· {p}</li>)}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <section className="mt-14">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-xl">مصفوفة المتطلبات</h2>
          <span className="text-xs text-muted">
            {data.mappings.length} متطلباً · {missing.length} بلا سند
          </span>
        </div>
        {data.mappings.length === 0 ? (
          <Card><p className="text-sm text-muted">لا متطلبات مربوطة بهذه المسودة.</p></Card>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>المتطلب</th><th>إلزامي</th><th>الردّ</th><th>المصدر</th><th>المرجع</th></tr>
              </thead>
              <tbody>
                {(data.mappings as Row[]).map((m) => (
                  <tr key={m.id}>
                    <td className="max-w-md text-sm">{m.requirement}</td>
                    <td>{m.mandatory ? <Pill>نعم</Pill> : <span className="text-xs text-muted/60">لا</span>}</td>
                    <td className="max-w-md text-sm text-muted">
                      {m.response ?? <span className="text-danger">— بلا ردّ مدعوم —</span>}
                    </td>
                    <td><Provenance value={m.provenance as Prov} /></td>
                    <td className="text-xs text-muted/70">
                      {m.doc_ref ? `${m.doc_ref}${m.page_ref ? ` · ص${m.page_ref}` : ''}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg">نقاط الموافقة</h2>
          {approvals.length === 0 ? (
            <p className="mt-5 text-sm text-muted">لا طلبات موافقة.</p>
          ) : (
            <ul className="mt-5 space-y-5">
              {approvals.map((a) => (
                <li key={a.id} className="border-b border-white/[.05] pb-5 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ApprovalBadge value={a.status as ApprovalStatus} />
                    <Pill>{a.type}</Pill>
                  </div>
                  <p className="mt-3 text-sm">{a.title}</p>
                  {a.status === 'PENDING' && (
                    <div className="mt-4"><ApprovalDecision requestId={String(a.id)} /></div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-lg">النسخ والتعليقات</h2>
          <h3 className="lbl mt-5">النسخ</h3>
          <ul className="space-y-2 text-xs text-muted">
            {(data.versions as Row[]).map((v) => (
              <li key={v.id}>
                النسخة {v.version} · <DateText value={v.created_at} withTime />
                {v.note ? ` — ${v.note}` : ''}
              </li>
            ))}
          </ul>
          <div className="hair my-7" />
          <h3 className="lbl">التعليقات</h3>
          {data.comments.length === 0 ? (
            <p className="text-xs text-muted/60">لا تعليقات.</p>
          ) : (
            <ul className="space-y-3 text-xs">
              {(data.comments as Row[]).map((c) => (
                <li key={c.id}>
                  <span className="text-ink">{c.author}</span>
                  <span className="text-muted/50"> · <DateText value={c.created_at} withTime /></span>
                  <p className="mt-1 text-muted">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="mt-10 text-xs text-muted/60">
        <Link href={`/app/analysis/${draft.analysis_id}`} className="hover:text-ink">
          عودة إلى التحليل الذي بُنيت عليه هذه المسودة
        </Link>
      </p>
    </div>
  );
}
