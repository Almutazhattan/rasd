/**
 * Session records. Pure data logic — no Next.js imports — so it is testable
 * against a real database. The cookie glue lives in src/server/auth-context.ts.
 */
import { getDb } from './db';
import type { Role } from './db/types';
import { hashToken, newToken } from './tokens';
import { membershipRole } from './tenancy';
import { SESSION_TTL_MS } from './cookie-names';

export { SESSION_COOKIE, SESSION_TTL_MS } from './cookie-names';

const RENEW_AFTER_MS = 1000 * 60 * 60; // refresh last_seen at most hourly

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  locale: string;
  emailVerified: Date | null;
  orgId: string | null;
  role: Role | null;
}

export async function createSession(
  userId: string,
  orgId: string | null,
  meta: SessionMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb()
    .insertInto('sessions')
    .values({
      user_id: userId,
      token_hash: hashToken(token),
      org_id: orgId,
      expires_at: expiresAt,
      ip: meta.ip ?? null,
      user_agent: meta.userAgent?.slice(0, 400) ?? null,
    })
    .execute();
  return { token, expiresAt };
}

/**
 * Resolve a session token. Returns null for unknown, expired, or
 * no-longer-a-member sessions — the last case matters when someone is removed
 * from a workspace while signed in.
 */
export async function resolveSession(token: string | undefined | null): Promise<ResolvedSession | null> {
  if (!token) return null;
  const db = getDb();
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as session_id', 'sessions.org_id as org_id', 'sessions.expires_at as expires_at',
      'sessions.last_seen as last_seen', 'users.id as user_id', 'users.email as email',
      'users.name as name', 'users.locale as locale', 'users.email_verified as email_verified',
    ])
    .where('sessions.token_hash', '=', hashToken(token))
    .executeTakeFirst();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.deleteFrom('sessions').where('id', '=', row.session_id).execute();
    return null;
  }

  let role: Role | null = null;
  if (row.org_id) {
    role = await membershipRole(row.user_id, row.org_id);
    if (!role) {
      // Membership revoked: drop the workspace from the session, keep the user
      // signed in so they land on the workspace picker.
      await db.updateTable('sessions').set({ org_id: null }).where('id', '=', row.session_id).execute();
      return { ...shape(row), orgId: null, role: null };
    }
  }

  if (Date.now() - new Date(row.last_seen).getTime() > RENEW_AFTER_MS) {
    await db.updateTable('sessions').set({ last_seen: new Date() }).where('id', '=', row.session_id).execute();
  }

  return { ...shape(row), role };
}

function shape(row: {
  session_id: string; user_id: string; email: string; name: string;
  locale: string; email_verified: Date | null; org_id: string | null;
}): ResolvedSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    locale: row.locale,
    emailVerified: row.email_verified,
    orgId: row.org_id,
    role: null,
  };
}

/** Point an existing session at another workspace, if the user is a member. */
export async function setSessionOrg(sessionId: string, userId: string, orgId: string): Promise<boolean> {
  const role = await membershipRole(userId, orgId);
  if (!role) return false;
  await getDb().updateTable('sessions').set({ org_id: orgId }).where('id', '=', sessionId).execute();
  return true;
}

export async function revokeSession(token: string): Promise<void> {
  await getDb().deleteFrom('sessions').where('token_hash', '=', hashToken(token)).execute();
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await getDb().deleteFrom('sessions').where('user_id', '=', userId).execute();
}

/** Housekeeping, called by the worker. */
export async function pruneExpiredSessions(): Promise<number> {
  const res = await getDb().deleteFrom('sessions').where('expires_at', '<', new Date()).executeTakeFirst();
  return Number(res.numDeletedRows ?? 0);
}
