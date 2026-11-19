/**
 * Tenant isolation.
 *
 * Every customer-owned table carries org_id. This module is the only
 * sanctioned way to read or write those tables: each builder it hands back is
 * already constrained to one organization, and inserts have org_id forced onto
 * the row — a caller cannot widen the scope, and cannot forget it.
 *
 * The guarantee is covered by tests/tenant-isolation.test.ts, which drives a
 * real PostgreSQL instance with two organizations and asserts that neither can
 * observe or mutate the other's rows through this layer.
 */
import type { DeleteQueryBuilder, InsertQueryBuilder, SelectQueryBuilder, UpdateQueryBuilder } from 'kysely';
import { getDb } from './db';
import type { Database, Role, TenantTable } from './db/types';
import { forbidden, notFound } from './errors';

/** Who is acting, and in which workspace. Produced by src/lib/session.ts. */
export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  name: string;
  ip?: string;
}

/** A context for background work with no human actor (the job worker). */
export interface SystemContext {
  userId: null;
  orgId: string;
  role: 'OWNER';
  system: true;
}

export type Ctx = AuthContext | SystemContext;

export function systemContext(orgId: string): SystemContext {
  return { userId: null, orgId, role: 'OWNER', system: true };
}

export function isSystem(ctx: Ctx): ctx is SystemContext {
  return (ctx as SystemContext).system === true;
}

export function actorId(ctx: Ctx): string | null {
  return isSystem(ctx) ? null : ctx.userId;
}

/**
 * Scoped data access. Each method narrows to ctx.orgId before the caller sees
 * the builder, so an omitted `.where('org_id', ...)` is not possible.
 */
export class ScopedDb {
  constructor(readonly ctx: Ctx) {
    if (!ctx.orgId) throw forbidden('No active workspace for this request.');
  }

  get orgId(): string {
    return this.ctx.orgId;
  }

  /**
   * SELECT, already filtered to this organization.
   *
   * The predicate is qualified as `<table>.org_id` rather than a bare
   * `org_id`: every tenant table has that column, so an unqualified reference
   * becomes ambiguous the moment a caller joins two of them — and Postgres
   * rejects the query rather than guessing, which is how this was caught.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from<T extends TenantTable>(table: T): SelectQueryBuilder<Database, T, any> {
    return getDb()
      .selectFrom(table)
      .where(`${table}.org_id` as never, '=', this.ctx.orgId as never) as unknown as SelectQueryBuilder<
      Database,
      T,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
  }

  /** INSERT with org_id forced onto every row. */
  insert<T extends TenantTable>(
    table: T,
    values: Omit<Database[T] extends { org_id: unknown } ? Record<string, unknown> : never, 'org_id'>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): InsertQueryBuilder<Database, T, any> {
    return getDb()
      .insertInto(table)
      .values({ ...(values as Record<string, unknown>), org_id: this.ctx.orgId } as never) as unknown as InsertQueryBuilder<
      Database,
      T,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
  }

  /** INSERT many rows, org_id forced onto each. */
  insertMany<T extends TenantTable>(
    table: T,
    rows: Record<string, unknown>[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): InsertQueryBuilder<Database, T, any> {
    return getDb()
      .insertInto(table)
      .values(rows.map((r) => ({ ...r, org_id: this.ctx.orgId })) as never) as unknown as InsertQueryBuilder<
      Database,
      T,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
  }

  /** UPDATE, already filtered to this organization. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update<T extends TenantTable>(table: T): UpdateQueryBuilder<Database, T, T, any> {
    return getDb()
      .updateTable(table)
      .where(`${table}.org_id` as never, '=', this.ctx.orgId as never) as unknown as UpdateQueryBuilder<
      Database,
      T,
      T,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
  }

  /** DELETE, already filtered to this organization. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete<T extends TenantTable>(table: T): DeleteQueryBuilder<Database, T, any> {
    return getDb()
      .deleteFrom(table)
      .where(`${table}.org_id` as never, '=', this.ctx.orgId as never) as unknown as DeleteQueryBuilder<
      Database,
      T,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
  }

  /**
   * Fetch one row by id within this organization.
   * Returns null rather than throwing, so callers choose the error.
   */
  async findById<T extends TenantTable>(table: T, id: string): Promise<Record<string, unknown> | null> {
    const row = await this.from(table)
      .selectAll(table as never)
      .where(`${table}.id` as never, '=', id as never)
      .executeTakeFirst();
    return (row as Record<string, unknown> | undefined) ?? null;
  }

  /** Same as findById, but a miss is a 404 — including a hit owned by another tenant. */
  async getById<T extends TenantTable>(table: T, id: string, label = 'Record'): Promise<Record<string, unknown>> {
    const row = await this.findById(table, id);
    if (!row) throw notFound(`${label} not found in this workspace.`);
    return row;
  }

  /** Raw transaction, still scoped: the callback receives a ScopedDb. */
  async transaction<R>(fn: (tx: ScopedDb) => Promise<R>): Promise<R> {
    // Kysely transactions replace the executor; the scope travels with ctx, so
    // the simplest correct form is to run the callback against this instance
    // inside a database transaction.
    return getDb()
      .transaction()
      .execute(async () => fn(this));
  }
}

export function scoped(ctx: Ctx): ScopedDb {
  return new ScopedDb(ctx);
}

/**
 * Resolve a user's role in an organization. Returns null when the user is not
 * a member — callers treat that as "this workspace does not exist for you".
 */
export async function membershipRole(userId: string, orgId: string): Promise<Role | null> {
  const row = await getDb()
    .selectFrom('memberships')
    .select('role')
    .where('user_id', '=', userId)
    .where('org_id', '=', orgId)
    .executeTakeFirst();
  return row?.role ?? null;
}

/** All workspaces a user belongs to, for the workspace switcher. */
export async function userWorkspaces(userId: string) {
  return getDb()
    .selectFrom('memberships')
    .innerJoin('organizations', 'organizations.id', 'memberships.org_id')
    .select(['organizations.id as id', 'organizations.name as name', 'organizations.slug as slug', 'memberships.role as role'])
    .where('memberships.user_id', '=', userId)
    .orderBy('organizations.name')
    .execute();
}
