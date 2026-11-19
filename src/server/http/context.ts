/**
 * Request → AuthContext.
 *
 * The cookie glue around src/lib/session.ts. Route handlers and server
 * components call requireAuth(); nothing downstream reads cookies.
 */
import { cookies, headers } from 'next/headers';
import { createSession, resolveSession, revokeSession, SESSION_COOKIE, SESSION_TTL_MS, setSessionOrg } from '@/lib/session';
import { forbidden, unauthenticated } from '@/lib/errors';
import { env } from '@/lib/env';
import type { AuthContext } from '@/lib/tenancy';
import type { Role } from '@/lib/db/types';

export interface SessionView {
  userId: string;
  email: string;
  name: string;
  locale: string;
  emailVerified: boolean;
  orgId: string | null;
  role: Role | null;
  sessionId: string;
}

function clientIp(): string | undefined {
  const h = headers();
  const fwd = h.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined;
}

export async function currentSession(): Promise<SessionView | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const resolved = await resolveSession(token);
  if (!resolved) return null;
  return {
    userId: resolved.userId,
    email: resolved.email,
    name: resolved.name,
    locale: resolved.locale,
    emailVerified: Boolean(resolved.emailVerified),
    orgId: resolved.orgId,
    role: resolved.role,
    sessionId: resolved.sessionId,
  };
}

/** Signed-in user with an active workspace, or an AppError. */
export async function requireAuth(): Promise<AuthContext> {
  const s = await currentSession();
  if (!s) throw unauthenticated('Sign in to continue.');
  if (!s.orgId || !s.role) throw forbidden('Choose a workspace to continue.');
  return {
    userId: s.userId, orgId: s.orgId, role: s.role,
    email: s.email, name: s.name, ip: clientIp(),
  };
}

export async function startSessionCookie(userId: string, orgId: string | null) {
  const { token, expiresAt } = await createSession(userId, orgId, {
    ip: clientIp(), userAgent: headers().get('user-agent'),
  });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function endSessionCookie() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  cookies().delete(SESSION_COOKIE);
}

export async function switchWorkspace(orgId: string): Promise<boolean> {
  const s = await currentSession();
  if (!s) throw unauthenticated();
  return setSessionOrg(s.sessionId, s.userId, orgId);
}
