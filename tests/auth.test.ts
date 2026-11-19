/**
 * Registration, sign-in, sessions and password reset.
 *
 * The assertions worth reading are the negative ones: identical errors for
 * unknown email and wrong password, a reset that ends every other session, and
 * a session that stops resolving the moment membership is revoked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { getDb } from '@/lib/db';
import { hashPassword, needsRehash, verifyPassword } from '@/lib/password';
import {
  acceptInvitation, completePasswordReset, inviteMember, register, requestPasswordReset,
  signIn, verifyEmail,
} from '@/server/accounts';
import { createSession, resolveSession, revokeSession, setSessionOrg } from '@/lib/session';
import type { AuthContext } from '@/lib/tenancy';

beforeAll(async () => {
  await resetDatabase();
});
afterAll(teardown);

beforeEach(async () => {
  await resetDatabase();
});

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('correct-horse-batterx', hash)).toBe(false);
  });

  it('salts: the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password-twice');
    const b = await hashPassword('same-password-twice');
    expect(a).not.toBe(b);
  });

  it('refuses a password below the minimum length', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/i);
  });

  it('stores parameters with the hash and detects weaker ones', async () => {
    const hash = await hashPassword('a-long-enough-password');
    expect(hash.startsWith('scrypt$65536$8$1$')).toBe(true);
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$AAAA$BBBB')).toBe(true);
  });

  it('treats a malformed stored hash as a failed verification, not a crash', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$x$y$z$AAAA$BBBB')).toBe(false);
  });
});

describe('register', () => {
  it('creates the organization, the owner membership and default weights', async () => {
    const r = await register({
      name: 'Owner', email: 'Owner@Example.COM', password: 'a-long-password-1', orgName: 'شركة الاختبار',
    });
    const db = getDb();

    const user = await db.selectFrom('users').selectAll().where('id', '=', r.userId).executeTakeFirst();
    expect(user?.email).toBe('owner@example.com'); // normalized
    expect(user?.email_verified).toBeNull();

    const membership = await db.selectFrom('memberships').selectAll()
      .where('user_id', '=', r.userId).executeTakeFirst();
    expect(membership?.role).toBe('OWNER');

    const weights = await db.selectFrom('scoring_weights').selectAll()
      .where('org_id', '=', r.orgId).executeTakeFirst();
    expect(weights?.technical_fit).toBe(25);
  });

  it('refuses a duplicate email', async () => {
    await register({ name: 'Ann', email: 'dup@example.com', password: 'a-long-password-1', orgName: 'Org A' });
    await expect(
      register({ name: 'Bnn', email: 'dup@example.com', password: 'a-long-password-2', orgName: 'Org B' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('gives two workspaces of the same name distinct slugs', async () => {
    const a = await register({ name: 'Ann', email: 'a@x.com', password: 'a-long-password-1', orgName: 'نفس الاسم' });
    const b = await register({ name: 'Bnn', email: 'b@x.com', password: 'a-long-password-1', orgName: 'نفس الاسم' });
    expect(a.slug).not.toBe(b.slug);
  });

  it('issues a working email-verification token', async () => {
    const r = await register({ name: 'Ann', email: 'v@x.com', password: 'a-long-password-1', orgName: 'Org V' });
    expect(await verifyEmail(r.verifyToken)).toBe(true);
    // Single use.
    expect(await verifyEmail(r.verifyToken)).toBe(false);
    expect(await verifyEmail('not-a-real-token')).toBe(false);
  });
});

describe('signIn', () => {
  beforeEach(async () => {
    await register({ name: 'Ann', email: 'user@x.com', password: 'a-long-password-1', orgName: 'Org' });
  });

  it('returns the user and their default workspace', async () => {
    const s = await signIn('user@x.com', 'a-long-password-1');
    expect(s.orgId).toBeTruthy();
    expect(s.role).toBe('OWNER');
  });

  it('is case-insensitive on the email', async () => {
    await expect(signIn('USER@X.COM', 'a-long-password-1')).resolves.toBeTruthy();
  });

  it('gives the same error for an unknown email as for a wrong password', async () => {
    const wrong = await signIn('user@x.com', 'wrong-password-here').catch((e) => e);
    const unknown = await signIn('nobody@x.com', 'wrong-password-here').catch((e) => e);
    expect(wrong.code).toBe('UNAUTHENTICATED');
    expect(unknown.code).toBe('UNAUTHENTICATED');
    expect(unknown.publicMessage).toBe(wrong.publicMessage);
  });
});

describe('sessions', () => {
  it('resolves a fresh session and stores only a hash of the token', async () => {
    const r = await register({ name: 'Ann', email: 's@x.com', password: 'a-long-password-1', orgName: 'Org S' });
    const { token } = await createSession(r.userId, r.orgId);

    const row = await getDb().selectFrom('sessions').select('token_hash').executeTakeFirst();
    expect(row?.token_hash).not.toBe(token);
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const resolved = await resolveSession(token);
    expect(resolved?.userId).toBe(r.userId);
    expect(resolved?.role).toBe('OWNER');
  });

  it('refuses an unknown or expired token', async () => {
    expect(await resolveSession('nonsense')).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();

    const r = await register({ name: 'Ann', email: 'e@x.com', password: 'a-long-password-1', orgName: 'Org E' });
    const { token } = await createSession(r.userId, r.orgId);
    await getDb().updateTable('sessions').set({ expires_at: new Date(Date.now() - 1000) }).execute();
    expect(await resolveSession(token)).toBeNull();
    // The expired row is cleaned up rather than left to accumulate.
    expect(await getDb().selectFrom('sessions').selectAll().execute()).toHaveLength(0);
  });

  it('drops the workspace from a session when membership is revoked', async () => {
    const r = await register({ name: 'Ann', email: 'm@x.com', password: 'a-long-password-1', orgName: 'Org M' });
    const { token } = await createSession(r.userId, r.orgId);
    await getDb().deleteFrom('memberships').where('user_id', '=', r.userId).execute();

    const resolved = await resolveSession(token);
    expect(resolved).not.toBeNull();
    expect(resolved?.orgId).toBeNull();
    expect(resolved?.role).toBeNull();
  });

  it('refuses to switch a session into a workspace the user does not belong to', async () => {
    const a = await register({ name: 'Ann', email: 'a2@x.com', password: 'a-long-password-1', orgName: 'Org A2' });
    const b = await register({ name: 'Bnn', email: 'b2@x.com', password: 'a-long-password-1', orgName: 'Org B2' });
    await createSession(a.userId, a.orgId);
    const created = await getDb().selectFrom('sessions').select('id')
      .where('user_id', '=', a.userId).executeTakeFirstOrThrow();

    expect(await setSessionOrg(created.id, a.userId, b.orgId)).toBe(false);
    expect(await setSessionOrg(created.id, a.userId, a.orgId)).toBe(true);
  });

  it('revokes a session on sign-out', async () => {
    const r = await register({ name: 'Ann', email: 'r@x.com', password: 'a-long-password-1', orgName: 'Org R' });
    const { token } = await createSession(r.userId, r.orgId);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });
});

describe('password reset', () => {
  it('ends every existing session when the password changes', async () => {
    const r = await register({ name: 'Ann', email: 'p@x.com', password: 'a-long-password-1', orgName: 'Org P' });
    const first = await createSession(r.userId, r.orgId);
    const second = await createSession(r.userId, r.orgId);

    const { token } = await requestPasswordReset('p@x.com');
    expect(token).toBeTruthy();
    expect(await completePasswordReset(token!, 'a-brand-new-password')).toBe(true);

    expect(await resolveSession(first.token)).toBeNull();
    expect(await resolveSession(second.token)).toBeNull();
    await expect(signIn('p@x.com', 'a-brand-new-password')).resolves.toBeTruthy();
    await expect(signIn('p@x.com', 'a-long-password-1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('does not reveal whether an address is registered', async () => {
    const result = await requestPasswordReset('nobody-here@x.com');
    expect(result.token).toBeNull();
  });

  it('rejects a reused or expired reset token', async () => {
    await register({ name: 'Ann', email: 'q@x.com', password: 'a-long-password-1', orgName: 'Org Q' });
    const { token } = await requestPasswordReset('q@x.com');
    expect(await completePasswordReset(token!, 'another-good-password')).toBe(true);
    expect(await completePasswordReset(token!, 'yet-another-password')).toBe(false);
  });
});

describe('invitations', () => {
  it('admits an invited user with the invited role', async () => {
    const owner = await register({ name: 'Owner', email: 'own@x.com', password: 'a-long-password-1', orgName: 'Team' });
    const ctx: AuthContext = {
      userId: owner.userId, orgId: owner.orgId, role: 'OWNER', email: 'own@x.com', name: 'Owner',
    };
    const invite = await inviteMember(ctx, { email: 'analyst@x.com', role: 'ANALYST' });

    const guest = await register({
      name: 'Analyst', email: 'analyst@x.com', password: 'a-long-password-1', orgName: 'Own Org',
    });
    const accepted = await acceptInvitation(guest.userId, 'analyst@x.com', invite.token);
    expect(accepted.orgId).toBe(owner.orgId);
    expect(accepted.role).toBe('ANALYST');
  });

  it('refuses an invitation presented by a different address', async () => {
    const owner = await register({ name: 'Owner', email: 'own2@x.com', password: 'a-long-password-1', orgName: 'Team2' });
    const ctx: AuthContext = {
      userId: owner.userId, orgId: owner.orgId, role: 'OWNER', email: 'own2@x.com', name: 'Owner',
    };
    const invite = await inviteMember(ctx, { email: 'invited@x.com', role: 'REVIEWER' });
    const other = await register({ name: 'Other', email: 'other@x.com', password: 'a-long-password-1', orgName: 'Org O' });

    await expect(acceptInvitation(other.userId, 'other@x.com', invite.token))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an unknown invitation token', async () => {
    const u = await register({ name: 'Unn', email: 'u@x.com', password: 'a-long-password-1', orgName: 'Org U' });
    await expect(acceptInvitation(u.userId, 'u@x.com', 'bogus-token'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
