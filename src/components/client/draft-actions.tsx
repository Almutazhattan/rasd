'use client';

import { useRouter } from 'next/navigation';
import { FormError, FormOk, useSubmit } from './forms';

/**
 * Export needs two approvals: the draft itself, then an EXPORT checkpoint.
 * The server enforces both — this button only asks for the second one.
 */
export function RequestExportApproval({ draftId, approved }: { draftId: string; approved: boolean }) {
  const router = useRouter();
  const { busy, error, done, submit } = useSubmit();

  return (
    <div className="space-y-3">
      <FormError error={error} />
      <FormOk message={done} />
      <button
        className="btn-ghost text-sm"
        disabled={busy || !approved}
        title={approved ? undefined : 'اعتمد المسودة أولاً من نقطة موافقة المسودة.'}
        onClick={async () => {
          await submit(`/api/drafts/${draftId}/export-approval`, 'POST', undefined, {
            successMessage:
              'أُنشئ طلب اعتماد التصدير. يعتمده مراجع من صفحة الموافقات، ثم يصبح التصدير متاحاً.',
            onSuccess: () => router.refresh(),
          });
        }}
      >
        {busy ? '…' : 'طلب اعتماد التصدير'}
      </button>
    </div>
  );
}
