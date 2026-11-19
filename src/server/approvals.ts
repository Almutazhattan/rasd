/**
 * Human-in-the-loop.
 *
 * An approval request is a gate, not a notice: the actions it guards check for
 * an APPROVED request before they run. Nothing in this platform submits a
 * government tender, and an export of a draft is refused until a reviewer with
 * the right role has approved it.
 */
import { scoped, actorId, type Ctx, type AuthContext } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { notify } from './notifications';
import { conflict, forbidden, notFound, validation } from '@/lib/errors';
import type { ApprovalStatus, ApprovalType } from '@/lib/db/types';

export interface ApprovalInput {
  type: ApprovalType;
  subjectType: 'analysis' | 'draft' | 'profile' | 'export';
  subjectId: string;
  analysisId?: string | null;
  draftId?: string | null;
  title: string;
  detail?: string | null;
}

/** Create a pending request, or return the one already open for this subject. */
export async function requestApproval(ctx: Ctx, input: ApprovalInput): Promise<string> {
  const s = scoped(ctx);
  const open = await s
    .from('approval_requests')
    .select('id')
    .where('subject_id' as never, '=', input.subjectId as never)
    .where('type' as never, '=', input.type as never)
    .where('status' as never, '=', 'PENDING' as never)
    .executeTakeFirst();
  if (open) return (open as { id: string }).id;

  const row = await s
    .insert('approval_requests', {
      type: input.type, subject_type: input.subjectType, subject_id: input.subjectId,
      analysis_id: input.analysisId ?? null, draft_id: input.draftId ?? null,
      requested_by_id: actorId(ctx), title: input.title.slice(0, 300),
      detail: input.detail?.slice(0, 2000) ?? null, status: 'PENDING',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const id = (row as { id: string }).id;

  await notify(ctx, {
    kind: 'APPROVAL_REQUEST',
    title: `طلب موافقة: ${input.title.slice(0, 120)}`,
    link: '/app/approvals',
  });
  await audit(ctx, 'approval.request', { type: 'approval_request', id }, { approvalType: input.type });
  return id;
}

export async function decideApproval(
  ctx: AuthContext,
  requestId: string,
  status: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'>,
  comment?: string,
) {
  assertCan(ctx.role, 'approval:decide');
  const s = scoped(ctx);
  const req = await s.findById('approval_requests', requestId);
  if (!req) throw notFound('Approval request not found in this workspace.');
  const r = req as { status: ApprovalStatus; requested_by_id: string | null; type: ApprovalType; draft_id: string | null };

  if (r.status !== 'PENDING') throw conflict('This request has already been decided.');
  if (status === 'REJECTED' && !comment?.trim()) {
    throw validation('A rejection needs a reason, so the requester knows what to change.');
  }
  // A reviewer approving their own request defeats the checkpoint.
  if (r.requested_by_id && r.requested_by_id === ctx.userId && status === 'APPROVED' && ctx.role !== 'OWNER') {
    throw forbidden('Another reviewer must approve a request you raised yourself.');
  }

  await s.insert('approval_decisions', {
    request_id: requestId, reviewer_id: ctx.userId, status, comment: comment?.slice(0, 2000) ?? null,
  }).execute();

  await s.update('approval_requests').set({ status, decided_at: new Date() })
    .where('id' as never, '=', requestId as never).execute();

  if (status === 'APPROVED' && r.type === 'RESPONSE_DRAFT' && r.draft_id) {
    await s.update('response_drafts').set({ approved_at: new Date(), updated_at: new Date() })
      .where('id' as never, '=', r.draft_id as never).execute();
  }

  await audit(ctx, 'approval.decide', { type: 'approval_request', id: requestId }, { status });
  return { requestId, status };
}

/** True only when an APPROVED request of this type exists for the subject. */
export async function isApproved(ctx: Ctx, type: ApprovalType, subjectId: string): Promise<boolean> {
  const row = await scoped(ctx)
    .from('approval_requests')
    .select('id')
    .where('type' as never, '=', type as never)
    .where('subject_id' as never, '=', subjectId as never)
    .where('status' as never, '=', 'APPROVED' as never)
    .executeTakeFirst();
  return Boolean(row);
}

export async function assertApproved(ctx: Ctx, type: ApprovalType, subjectId: string, what: string) {
  if (!(await isApproved(ctx, type, subjectId))) {
    throw forbidden(`${what} requires an approved ${type.toLowerCase().replace(/_/g, ' ')} checkpoint.`);
  }
}

export async function listApprovals(ctx: Ctx, status: ApprovalStatus | 'ALL' = 'PENDING') {
  let q = scoped(ctx)
    .from('approval_requests')
    .select(['id', 'type', 'status', 'subject_type', 'subject_id', 'analysis_id', 'draft_id',
      'title', 'detail', 'created_at', 'decided_at'])
    .orderBy('created_at', 'desc')
    .limit(200);
  if (status !== 'ALL') q = q.where('status' as never, '=', status as never);
  return q.execute();
}

export async function approvalHistory(ctx: Ctx, requestId: string) {
  return scoped(ctx)
    .from('approval_decisions')
    .innerJoin('users', 'users.id', 'approval_decisions.reviewer_id')
    .select(['approval_decisions.status as status', 'approval_decisions.comment as comment',
      'approval_decisions.created_at as created_at', 'users.name as reviewer'])
    .where('approval_decisions.request_id' as never, '=', requestId as never)
    .orderBy('approval_decisions.created_at')
    .execute();
}
