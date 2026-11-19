/**
 * Account and workspace services: registration, sign-in, workspace creation,
 * invitations, membership changes.
 *
 * Every function here is transport-agnostic — no cookies, no Request — so the
 * same code paths are exercised by tests and by route handlers.
 */
import { getDb } from '@/lib/db';
import type { Role } from '@/lib/db/types';
import { hashPassword, needsRehash, verifyPassword } from '@/lib/password';
import { hashToken, newToken } from '@/lib/tokens';
import { conflict, forbidden, notFound, unauthenticated, validation } from '@/lib/errors';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { membershipRole, scoped, type AuthContext } from '@/lib/tenancy';
import { logger } from '@/lib/logger';
import { mailState } from '@/lib/env';
import { z } from 'zod';

const EMAIL = z.string().email().max(254).transform((v) => v.trim().toLowerCase());

export const registerInput = z.object({
  name: z.string().min(2).max(120),
  email: EMAIL,
  password: z.string().min(10).max(200),
  orgName: z.string().min(2).max(160),
  locale: z.enum(['ar', 'en']).default('ar'),
});

function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return base || 'workspace';
}

async function uniqueSlug(desired: string): Promise<string> {
  const db = getDb();
  let slug = slugify(desired);
  for (let i = 0; i < 50; i++) {
    const hit = await db.selectFrom('organizations').select('id').where('slug', '=', slug).executeTakeFirst();
    if (!hit) return slug;
    slug = `${slugify(desired)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  throw conflict('Could not allocate a workspace address.');
}

/**
 * Register a user and create their workspace. The first user of a workspace
 * becomes its OWNER. Returns the ids plus the email-verification token, which
 * the caller delivers (or logs, when SMTP is not configured).
 */
export async function register(raw: unknown) {
  const input = registerInput.parse(raw);
  const db = getDb();

  const existing = await db.selectFrom('users').select('id').where('email', '=', input.email).executeTakeFirst();
  if (existing) throw conflict('An account already exists for this email address.');

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.orgName);

  const result = await db.transaction().execute(async (tx) => {
    const org = await tx
      .insertInto('organizations')
      .values({ name: input.orgName, slug, locale: input.locale })
      .returning(['id', 'slug'])
      .executeTakeFirstOrThrow();

    const user = await tx
      .insertInto('users')
      .values({ email: input.email, name: input.name, password_hash: passwordHash, locale: input.locale })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await tx.insertInto('memberships').values({ org_id: org.id, user_id: user.id, role: 'OWNER' }).execute();

    // Default evaluation weights; adjustable later by an authorized user.
    await tx.insertInto('scoring_weights').values({ org_id: org.id }).execute();

    const token = newToken(24);
    await tx
      .insertInto('verification_tokens')
      .values({
        user_id: user.id,
        purpose: 'email_verify',
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 48),
      })
      .execute();

    return { orgId: org.id, slug: org.slug, userId: user.id, verifyToken: token };
  });

  await audit(
    { userId: result.userId, orgId: result.orgId, role: 'OWNER', email: input.email, name: input.name },
    'auth.register',
    { type: 'user', id: result.userId },
    { orgName: input.orgName },
  );

  if (mailState() !== 'CONNECTED') {
    logger.warn('email not configured — verification link not sent', {
      userId: result.userId,
      hint: 'set SMTP_URL to deliver verification email',
    });
  }
  return result;
}

/**
 * Verify a password. Returns the user and their default workspace, or throws
 * UNAUTHENTICATED. The same error is used for unknown email and wrong password
 * so the response cannot be used to enumerate accounts.
 */
export async function signIn(rawEmail: string, password: string) {
  const email = EMAIL.parse(rawEmail);
  const db = getDb();
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'password_hash', 'locale', 'email_verified'])
    .where('email', '=', email)
    .executeTakeFirst();

  if (!user) {
    // Spend comparable time so timing does not reveal account existence.
    await verifyPassword(password, 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    throw unauthenticated('Email or password is incorrect.');
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw unauthenticated('Email or password is incorrect.');

  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(password);
    await db.updateTable('users').set({ password_hash: upgraded }).where('id', '=', user.id).execute();
  }

  const membership = await db
    .selectFrom('memberships')
    .select(['org_id', 'role'])
    .where('user_id', '=', user.id)
    .orderBy('created_at')
    .executeTakeFirst();

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    emailVerified: user.email_verified,
    orgId: membership?.org_id ?? null,
    role: membership?.role ?? null,
  };
}

export async function verifyEmail(token: string): Promise<boolean> {
  const db = getDb();
  const row = await db
    .selectFrom('verification_tokens')
    .select(['id', 'user_id', 'expires_at', 'used_at'])
    .where('token_hash', '=', hashToken(token))
    .where('purpose', '=', 'email_verify')
    .executeTakeFirst();
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return false;

  await db.transaction().execute(async (tx) => {
    await tx.updateTable('verification_tokens').set({ used_at: new Date() }).where('id', '=', row.id).execute();
    await tx.updateTable('users').set({ email_verified: new Date() }).where('id', '=', row.user_id).execute();
  });
  return true;
}

/**
 * Begin a password reset. Always resolves, whether or not the address exists,
 * so the endpoint cannot be used to discover registered addresses.
 */
export async function requestPasswordReset(rawEmail: string): Promise<{ token: string | null }> {
  const email = EMAIL.parse(rawEmail);
  const db = getDb();
  const user = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
  if (!user) return { token: null };

  const token = newToken(24);
  await db
    .insertInto('verification_tokens')
    .values({
      user_id: user.id,
      purpose: 'password_reset',
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 1000 * 60 * 60),
    })
    .execute();
  return { token };
}

export async function completePasswordReset(token: string, newPassword: string): Promise<boolean> {
  const db = getDb();
  const row = await db
    .selectFrom('verification_tokens')
    .select(['id', 'user_id', 'expires_at', 'used_at'])
    .where('token_hash', '=', hashToken(token))
    .where('purpose', '=', 'password_reset')
    .executeTakeFirst();
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return false;

  const hash = await hashPassword(newPassword);
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('verification_tokens').set({ used_at: new Date() }).where('id', '=', row.id).execute();
    await tx.updateTable('users').set({ password_hash: hash }).where('id', '=', row.user_id).execute();
    // Every existing session is dropped: a reset must end other devices.
    await tx.deleteFrom('sessions').where('user_id', '=', row.user_id).execute();
  });
  return true;
}

// ───────────────────────────── team management ─────────────────────────────

export const inviteInput = z.object({
  email: EMAIL,
  role: z.enum(['ADMIN', 'PROCUREMENT_MANAGER', 'ANALYST', 'REVIEWER', 'MEMBER']),
});

export async function inviteMember(ctx: AuthContext, raw: unknown) {
  assertCan(ctx.role, 'member:invite');
  const input = inviteInput.parse(raw);
  const s = scoped(ctx);

  const already = await getDb()
    .selectFrom('memberships')
    .innerJoin('users', 'users.id', 'memberships.user_id')
    .select('memberships.id')
    .where('memberships.org_id', '=', ctx.orgId)
    .where('users.email', '=', input.email)
    .executeTakeFirst();
  if (already) throw conflict('That person is already a member of this workspace.');

  const token = newToken(24);
  await s
    .insert('invitations', {
      email: input.email,
      role: input.role,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      status: 'PENDING',
    })
    .onConflict((oc) =>
      oc.columns(['org_id', 'email']).doUpdateSet({
        role: input.role,
        token_hash: hashToken(token),
        status: 'PENDING',
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      }),
    )
    .execute();

  await audit(ctx, 'member.invite', { type: 'invitation' }, { email: input.email, role: input.role });
  return { token, emailDelivery: mailState() };
}

/** Accept an invitation as an already-registered, signed-in user. */
export async function acceptInvitation(userId: string, email: string, token: string) {
  const db = getDb();
  const inv = await db
    .selectFrom('invitations')
    .select(['id', 'org_id', 'email', 'role', 'status', 'expires_at'])
    .where('token_hash', '=', hashToken(token))
    .executeTakeFirst();

  if (!inv || inv.status !== 'PENDING') throw notFound('This invitation is no longer valid.');
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    await db.updateTable('invitations').set({ status: 'EXPIRED' }).where('id', '=', inv.id).execute();
    throw notFound('This invitation has expired.');
  }
  if (inv.email !== email.toLowerCase()) {
    throw forbidden('This invitation was issued to a different email address.');
  }

  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('memberships')
      .values({ org_id: inv.org_id, user_id: userId, role: inv.role })
      .onConflict((oc) => oc.columns(['org_id', 'user_id']).doUpdateSet({ role: inv.role }))
      .execute();
    await tx.updateTable('invitations').set({ status: 'ACCEPTED' }).where('id', '=', inv.id).execute();
  });

  return { orgId: inv.org_id, role: inv.role as Role };
}

export async function changeMemberRole(ctx: AuthContext, userId: string, role: Role) {
  assertCan(ctx.role, 'member:update');
  if (userId === ctx.userId) throw validation('You cannot change your own role.');

  const current = await membershipRole(userId, ctx.orgId);
  if (!current) throw notFound('That person is not a member of this workspace.');
  if (current === 'OWNER' && ctx.role !== 'OWNER') throw forbidden('Only the owner can change the owner role.');
  if (role === 'OWNER' && ctx.role !== 'OWNER') throw forbidden('Only the current owner can hand over ownership.');

  await scoped(ctx).update('memberships').set({ role }).where('user_id' as never, '=', userId as never).execute();
  await audit(ctx, 'member.update', { type: 'membership', id: userId }, { role });
}

export async function removeMember(ctx: AuthContext, userId: string) {
  assertCan(ctx.role, 'member:remove');
  if (userId === ctx.userId) throw validation('You cannot remove yourself. Transfer ownership first.');

  const current = await membershipRole(userId, ctx.orgId);
  if (!current) throw notFound('That person is not a member of this workspace.');
  if (current === 'OWNER') throw forbidden('The workspace owner cannot be removed.');

  await scoped(ctx).delete('memberships').where('user_id' as never, '=', userId as never).execute();
  await getDb().deleteFrom('sessions').where('user_id', '=', userId).where('org_id', '=', ctx.orgId).execute();
  await audit(ctx, 'member.remove', { type: 'membership', id: userId });
}

export async function listMembers(ctx: AuthContext) {
  return getDb()
    .selectFrom('memberships')
    .innerJoin('users', 'users.id', 'memberships.user_id')
    .select([
      'users.id as id', 'users.name as name', 'users.email as email',
      'memberships.role as role', 'memberships.created_at as joined_at',
      'users.email_verified as email_verified',
    ])
    .where('memberships.org_id', '=', ctx.orgId)
    .orderBy('memberships.created_at')
    .execute();
}

export async function listInvitations(ctx: AuthContext) {
  return scoped(ctx)
    .from('invitations')
    .select(['id', 'email', 'role', 'status', 'expires_at', 'created_at'])
    .orderBy('created_at', 'desc')
    .execute();
}
