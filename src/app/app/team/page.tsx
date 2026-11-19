import { requireAuth } from '@/server/http/context';
import { listInvitations, listMembers } from '@/server/accounts';
import { can, ROLE_LABELS } from '@/lib/rbac';
import { Alert, Card, DateText, PageHeader, Pill, Row } from '@/components/ui';
import { InviteForm } from '@/components/client/forms';
import { MemberRow } from '@/components/client/team-actions';
import { mailState } from '@/lib/env';
import type { Role } from '@/lib/db/types';

export const metadata = { title: 'الفريق — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const ctx = await requireAuth();
  const [members, invitations] = await Promise.all([listMembers(ctx), listInvitations(ctx)]);
  const mayManage = can(ctx.role, 'member:invite');

  const roleOptions = (Object.keys(ROLE_LABELS) as Role[])
    .filter((r) => r !== 'OWNER')
    .map((r) => ({ value: r, label: ROLE_LABELS[r].ar }));

  return (
    <div>
      <PageHeader
        kicker="الفريق"
        title="الأعضاء والصلاحيات"
        lead="الصلاحية تُفرَض في الخدمة قبل كل عملية، لا بإخفاء عناصر الواجهة."
      />

      <section className="mb-14">
        <h2 className="mb-5 text-xl">الأعضاء</h2>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>العضو</th><th>البريد</th><th>الدور</th><th>الانضمام</th><th></th></tr>
            </thead>
            <tbody>
              {(members as Row[]).map((m) => (
                <MemberRow
                  key={m.id}
                  member={{
                    id: String(m.id), name: String(m.name), email: String(m.email),
                    role: String(m.role) as Role, joinedAt: String(m.joined_at),
                    verified: Boolean(m.email_verified),
                  }}
                  roleLabels={Object.fromEntries(
                    (Object.keys(ROLE_LABELS) as Role[]).map((r) => [r, ROLE_LABELS[r].ar]),
                  )}
                  canManage={mayManage && m.id !== ctx.userId}
                  isYou={m.id === ctx.userId}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {mayManage && (
        <section className="mb-14">
          <h2 className="mb-5 text-xl">دعوة عضو</h2>
          <Card>
            {mailState() !== 'CONNECTED' && (
              <div className="mb-7">
                <Alert tone="warn" title="البريد غير مُهيّأ">
                  لن تُرسل رسالة دعوة. سيظهر لك رمز الدعوة بعد الإنشاء لتسلّمه للمدعو بنفسك.
                </Alert>
              </div>
            )}
            <InviteForm roles={roleOptions} />
          </Card>
        </section>
      )}

      {invitations.length > 0 && (
        <section>
          <h2 className="mb-5 text-xl">دعوات معلّقة</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>البريد</th><th>الدور</th><th>الحالة</th><th>تنتهي</th></tr></thead>
              <tbody>
                {(invitations as Row[]).map((i) => (
                  <tr key={i.id}>
                    <td dir="ltr" className="text-sm">{i.email}</td>
                    <td><Pill>{ROLE_LABELS[i.role as Role]?.ar ?? i.role}</Pill></td>
                    <td className="text-sm text-muted">{i.status}</td>
                    <td className="text-sm"><DateText value={i.expires_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-14">
        <h2 className="mb-5 text-xl">ما يستطيعه كل دور</h2>
        <Card>
          <ul className="space-y-4 text-sm text-muted">
            <li><span className="text-ink">مالك المنشأة</span> — كل الصلاحيات، ونقل الملكية وحذف مساحة العمل.</li>
            <li><span className="text-ink">مدير النظام</span> — إدارة الأعضاء والإعدادات وتأكيد ملف المنشأة.</li>
            <li><span className="text-ink">مدير المنافسات</span> — تشغيل التحليلات، الاعتماد، التصدير، تعديل الأوزان، وقراءة سجل التدقيق.</li>
            <li><span className="text-ink">محلل</span> — رفع الوثائق، تشغيل التحليل، تحرير المسودات، وطلب الموافقات.</li>
            <li><span className="text-ink">مراجع</span> — اعتماد أو رفض الطلبات، وتحرير المسودات.</li>
            <li><span className="text-ink">عضو</span> — قراءة فقط.</li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
