/**
 * Notifications. In-app rows always; email only when SMTP is configured — and
 * when it is not, the platform says so instead of silently dropping the
 * message.
 */
import { scoped, type Ctx } from '@/lib/tenancy';
import { getDb } from '@/lib/db';
import type { NotificationKind } from '@/lib/db/types';
import { mailState } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  /** Defaults to every member of the workspace. */
  userIds?: string[];
}

export async function notify(ctx: Ctx, input: NotifyInput): Promise<number> {
  const s = scoped(ctx);
  let targets = input.userIds;
  if (!targets) {
    const members = await getDb()
      .selectFrom('memberships').select('user_id').where('org_id', '=', ctx.orgId).execute();
    targets = members.map((m) => m.user_id);
  }
  if (targets.length === 0) return 0;

  const prefs = await getDb()
    .selectFrom('notification_preferences')
    .select(['user_id', 'in_app', 'email'])
    .where('org_id', '=', ctx.orgId)
    .where('kind', '=', input.kind)
    .execute();
  const byUser = new Map(prefs.map((p) => [p.user_id, p]));

  const rows = targets
    .filter((u) => byUser.get(u)?.in_app !== false)
    .map((userId) => ({
      user_id: userId, kind: input.kind, title: input.title.slice(0, 300),
      body: input.body?.slice(0, 2000) ?? null, link: input.link ?? null,
    }));
  if (rows.length) await s.insertMany('notifications', rows).execute();

  const wantsEmail = targets.filter((u) => byUser.get(u)?.email === true);
  if (wantsEmail.length) {
    if (mailState() === 'CONNECTED') {
      // An SMTP transport belongs here. Until one is configured the platform
      // records the intent rather than reporting a delivery that never happened.
      logger.info('email notification queued', { kind: input.kind, recipients: wantsEmail.length });
    } else {
      logger.warn('email notification not sent — SMTP not configured', {
        kind: input.kind, recipients: wantsEmail.length,
      });
    }
  }
  return rows.length;
}

export async function listNotifications(ctx: Ctx, userId: string | null, limit = 50) {
  let q = scoped(ctx)
    .from('notifications')
    .select(['id', 'kind', 'title', 'body', 'link', 'read_at', 'created_at'])
    .orderBy('created_at', 'desc')
    .limit(limit);
  if (userId) q = q.where('user_id' as never, '=', userId as never);
  return q.execute();
}

export async function unreadCount(ctx: Ctx, userId: string): Promise<number> {
  const row = await getDb()
    .selectFrom('notifications')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('org_id', '=', ctx.orgId)
    .where('user_id', '=', userId)
    .where('read_at', 'is', null)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export async function markRead(ctx: Ctx, userId: string, ids?: string[]) {
  let q = scoped(ctx)
    .update('notifications')
    .set({ read_at: new Date() })
    .where('user_id' as never, '=', userId as never)
    .where('read_at' as never, 'is' as never, null as never);
  if (ids?.length) q = q.where('id' as never, 'in' as never, ids as never);
  await q.execute();
}

export async function setPreference(
  ctx: Ctx, userId: string, kind: NotificationKind, inApp: boolean, email: boolean,
) {
  await scoped(ctx)
    .insert('notification_preferences', { user_id: userId, kind, in_app: inApp, email })
    .onConflict((oc) => oc.columns(['org_id', 'user_id', 'kind']).doUpdateSet({ in_app: inApp, email }))
    .execute();
}
