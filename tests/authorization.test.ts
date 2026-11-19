/**
 * Authorization: the permission matrix, and the fact that it is enforced in
 * the service layer rather than by the UI.
 *
 * Each case calls a real service function with a low-privilege context and
 * asserts FORBIDDEN — which is the only proof that hiding a button is not what
 * is protecting the action.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { can, PERMISSIONS, ROLE_PERMISSIONS, assertCan, type Permission } from '@/lib/rbac';
import { register, changeMemberRole, removeMember, inviteMember } from '@/server/accounts';
import { updateWeights, startAnalysis } from '@/server/analysis';
import { confirmProfile, saveProfile } from '@/server/company';
import { decideApproval, requestApproval } from '@/server/approvals';
import { deleteTender, addManualTender } from '@/server/tenders';
import { scoped, type AuthContext } from '@/lib/tenancy';
import type { Role } from '@/lib/db/types';

let owner: AuthContext;
let memberUserId: string;

function as(role: Role, userId = owner.userId): AuthContext {
  return { ...owner, role, userId };
}

beforeAll(async () => {
  await resetDatabase();
  const o = await register({
    name: 'Owner', email: 'owner@authz.test', password: 'a-long-password-1', orgName: 'Authz Org',
  });
  owner = { userId: o.userId, orgId: o.orgId, role: 'OWNER', email: 'owner@authz.test', name: 'Owner' };

  const m = await register({
    name: 'Member', email: 'member@authz.test', password: 'a-long-password-1', orgName: 'Other Org',
  });
  memberUserId = m.userId;
  await scoped(owner).insert('memberships', { user_id: memberUserId, role: 'MEMBER' }).execute();
});
afterAll(teardown);

describe('permission matrix', () => {
  it('read-only members can read and cannot write', () => {
    expect(can('MEMBER', 'tender:read')).toBe(true);
    expect(can('MEMBER', 'analysis:read')).toBe(true);
    expect(can('MEMBER', 'analysis:run')).toBe(false);
    expect(can('MEMBER', 'draft:write')).toBe(false);
    expect(can('MEMBER', 'approval:decide')).toBe(false);
    expect(can('MEMBER', 'member:invite')).toBe(false);
  });

  it('reviewers decide but do not run analyses or export', () => {
    expect(can('REVIEWER', 'approval:decide')).toBe(true);
    expect(can('REVIEWER', 'draft:write')).toBe(true);
    expect(can('REVIEWER', 'analysis:run')).toBe(false);
    expect(can('REVIEWER', 'draft:export')).toBe(false);
  });

  it('analysts run work but do not approve it', () => {
    expect(can('ANALYST', 'analysis:run')).toBe(true);
    expect(can('ANALYST', 'document:upload')).toBe(true);
    expect(can('ANALYST', 'approval:request')).toBe(true);
    expect(can('ANALYST', 'approval:decide')).toBe(false);
    expect(can('ANALYST', 'draft:export')).toBe(false);
    expect(can('ANALYST', 'member:invite')).toBe(false);
  });

  it('procurement managers approve and export; only admins manage members', () => {
    expect(can('PROCUREMENT_MANAGER', 'approval:decide')).toBe(true);
    expect(can('PROCUREMENT_MANAGER', 'draft:export')).toBe(true);
    expect(can('PROCUREMENT_MANAGER', 'weights:update')).toBe(true);
    expect(can('PROCUREMENT_MANAGER', 'member:invite')).toBe(false);
    expect(can('ADMIN', 'member:invite')).toBe(true);
  });

  it('only the owner can delete the organization', () => {
    expect(can('OWNER', 'org:delete')).toBe(true);
    expect(can('ADMIN', 'org:delete')).toBe(false);
  });

  it('every role has a defined permission set and no unknown permissions', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const [role, set] of Object.entries(ROLE_PERMISSIONS)) {
      expect(set.size, role).toBeGreaterThan(0);
      for (const p of set) expect(known.has(p), `${role}:${p}`).toBe(true);
    }
  });

  it('assertCan throws FORBIDDEN naming the role and the permission', () => {
    try {
      assertCan('MEMBER', 'analysis:run' as Permission);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('FORBIDDEN');
      expect((err as { publicMessage: string }).publicMessage).toContain('MEMBER');
      expect((err as { publicMessage: string }).publicMessage).toContain('analysis:run');
    }
  });
});

describe('services enforce it, not the UI', () => {
  it('a read-only member cannot start an analysis', async () => {
    const tenderId = await addManualTender(owner, {
      title: 'منافسة اختبار الصلاحيات', entity: 'جهة اختبار',
    });
    await expect(startAnalysis(as('MEMBER'), tenderId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(startAnalysis(as('REVIEWER'), tenderId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(startAnalysis(as('ANALYST'), tenderId)).resolves.toBeTruthy();
  });

  it('an analyst cannot change evaluation weights', async () => {
    const weights = {
      technicalFit: 30, experience: 20, complianceReadiness: 20,
      resources: 10, financialReadiness: 10, geographic: 10,
    };
    await expect(updateWeights(as('ANALYST'), weights)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(updateWeights(as('PROCUREMENT_MANAGER'), weights)).resolves.toBeUndefined();
  });

  it('an analyst cannot confirm the company profile', async () => {
    await saveProfile(owner, { legalName: 'شركة الاختبار' });
    await expect(confirmProfile(as('ANALYST'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(confirmProfile(as('ADMIN'))).resolves.toBeUndefined();
  });

  it('an analyst cannot decide an approval they requested', async () => {
    const requestId = await requestApproval(as('ANALYST'), {
      type: 'RECOMMENDATION', subjectType: 'analysis',
      subjectId: '00000000-0000-0000-0000-000000000001', title: 'طلب اختبار',
    });
    await expect(decideApproval(as('ANALYST'), requestId, 'APPROVED'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a reviewer cannot approve a request they raised themselves', async () => {
    const reviewer = as('REVIEWER');
    const requestId = await requestApproval(reviewer, {
      type: 'UNCERTAIN_ANALYSIS', subjectType: 'analysis',
      subjectId: '00000000-0000-0000-0000-000000000002', title: 'طلب المراجع نفسه',
    });
    await expect(decideApproval(reviewer, requestId, 'APPROVED'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Another reviewer can.
    await expect(decideApproval({ ...reviewer, userId: memberUserId }, requestId, 'APPROVED'))
      .resolves.toMatchObject({ status: 'APPROVED' });
  });

  it('a rejection without a reason is refused', async () => {
    const requestId = await requestApproval(owner, {
      type: 'RECOMMENDATION', subjectType: 'analysis',
      subjectId: '00000000-0000-0000-0000-000000000003', title: 'طلب للرفض',
    });
    await expect(decideApproval({ ...owner, userId: memberUserId, role: 'REVIEWER' }, requestId, 'REJECTED'))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      decideApproval({ ...owner, userId: memberUserId, role: 'REVIEWER' }, requestId, 'REJECTED', 'ناقص دليل'),
    ).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('a decided request cannot be decided again', async () => {
    const requestId = await requestApproval(owner, {
      type: 'EXPORT', subjectType: 'export',
      subjectId: '00000000-0000-0000-0000-000000000004', title: 'طلب مكرر',
    });
    const reviewer = { ...owner, userId: memberUserId, role: 'REVIEWER' as Role };
    await decideApproval(reviewer, requestId, 'APPROVED');
    await expect(decideApproval(reviewer, requestId, 'REJECTED', 'تغيير الرأي'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a member cannot delete a tender; a manager can', async () => {
    const tenderId = await addManualTender(owner, { title: 'منافسة للحذف', entity: 'جهة' });
    await expect(deleteTender(as('MEMBER'), tenderId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteTender(as('PROCUREMENT_MANAGER'), tenderId)).resolves.toBeUndefined();
  });

  it('role changes are guarded: no self-change, no owner demotion by an admin', async () => {
    await expect(changeMemberRole(owner, owner.userId, 'MEMBER'))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(changeMemberRole(as('ADMIN'), owner.userId, 'MEMBER'))
      .rejects.toMatchObject({ code: 'VALIDATION' }); // still self: same userId
    await expect(changeMemberRole(as('ADMIN', memberUserId), owner.userId, 'MEMBER'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' }); // only an owner may touch the owner
    await expect(changeMemberRole(owner, memberUserId, 'ANALYST')).resolves.toBeUndefined();
  });

  it('the owner cannot be removed, and nobody can remove themselves', async () => {
    await expect(removeMember(owner, owner.userId)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(removeMember(as('ADMIN', memberUserId), owner.userId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a member cannot invite anyone', async () => {
    await expect(inviteMember(as('MEMBER'), { email: 'x@y.com', role: 'ANALYST' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
