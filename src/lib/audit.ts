/**
 * Audit trail. Every state-changing action records who did it, to what, and
 * when. Writes are best-effort: an audit failure is logged but never fails the
 * user's action, and never swallows the original error.
 */
import { scoped, actorId, type Ctx } from './tenancy';
import { logger } from './logger';

export type AuditAction =
  | 'auth.register' | 'auth.login' | 'auth.logout' | 'auth.password_reset'
  | 'org.create' | 'org.update' | 'member.invite' | 'member.accept' | 'member.update' | 'member.remove'
  | 'profile.update' | 'profile.confirm' | 'weights.update'
  | 'document.upload' | 'document.delete' | 'document.extract'
  | 'tender.import' | 'tender.discover' | 'tender.delete' | 'tender.bookmark'
  | 'analysis.start' | 'analysis.complete' | 'analysis.fail' | 'analysis.delete'
  | 'agent.run' | 'agent.step' | 'agent.cancel'
  | 'approval.request' | 'approval.decide'
  | 'draft.create' | 'draft.update' | 'draft.approve' | 'draft.export'
  | 'report.create' | 'settings.update';

export async function audit(
  ctx: Ctx,
  action: AuditAction,
  target: { type: string; id?: string | null },
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await scoped(ctx)
      .insert('audit_logs', {
        actor_id: actorId(ctx),
        action,
        target_type: target.type,
        target_id: target.id ?? null,
        meta: JSON.stringify(meta),
        ip: 'ip' in ctx ? (ctx.ip ?? null) : null,
      })
      .execute();
  } catch (err) {
    logger.error('audit write failed', {
      action,
      orgId: ctx.orgId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
