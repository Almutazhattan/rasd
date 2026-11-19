'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSubmit } from './forms';

export function MemberRow({
  member, roleLabels, canManage, isYou,
}: {
  member: { id: string; name: string; email: string; role: string; joinedAt: string; verified: boolean };
  roleLabels: Record<string, string>;
  canManage: boolean;
  isYou: boolean;
}) {
  const router = useRouter();
  const { busy, submit, error } = useSubmit();
  const [role, setRole] = useState(member.role);

  return (
    <tr>
      <td className="text-sm">
        {member.name}
        {isYou && <span className="ms-2 text-xs text-muted/60">(أنت)</span>}
        {!member.verified && <span className="ms-2 text-xs text-sand">بريد غير مُفعَّل</span>}
        {error && <div className="mt-2 text-xs text-danger">{error.message}</div>}
      </td>
      <td dir="ltr" className="text-sm text-muted">{member.email}</td>
      <td>
        {canManage ? (
          <select
            className="input py-2 text-xs"
            value={role}
            disabled={busy}
            onChange={async (e) => {
              const next = e.target.value;
              setRole(next);
              const r = await submit(`/api/team/${member.id}`, 'PATCH', { role: next }, {
                onSuccess: () => router.refresh(),
              });
              if (!r.ok) setRole(member.role);
            }}
          >
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        ) : (
          <span className="chip border border-white/15 text-muted">{roleLabels[member.role] ?? member.role}</span>
        )}
      </td>
      <td className="text-sm" dir="ltr">{member.joinedAt.slice(0, 10)}</td>
      <td>
        {canManage && member.role !== 'OWNER' && (
          <button
            className="text-xs text-danger"
            disabled={busy}
            onClick={async () => {
              await submit(`/api/team/${member.id}`, 'DELETE', undefined, {
                onSuccess: () => router.refresh(),
              });
            }}
          >
            إزالة
          </button>
        )}
      </td>
    </tr>
  );
}
