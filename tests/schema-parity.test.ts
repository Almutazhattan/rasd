/**
 * Schema parity.
 *
 * db/migrations/*.sql is authoritative; src/lib/db/types.ts is the typed
 * mirror of it. Nothing stops the two drifting apart except this test, which
 * reads the live database's information_schema and compares it to the
 * declaration — so "type-safe queries" keeps meaning something after the next
 * migration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { getDb } from '@/lib/db';
import { sql } from 'kysely';
import { TENANT_TABLES, type Database } from '@/lib/db/types';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The declared tables, read from the Database interface's own key list.
const DECLARED: (keyof Database)[] = [
  'organizations', 'users', 'memberships', 'sessions', 'verification_tokens', 'invitations',
  'integrations', 'company_profiles', 'company_documents', 'capabilities', 'certifications',
  'past_projects', 'tenders', 'tender_documents', 'document_chunks', 'tender_qa',
  'tender_requirements', 'tender_changes', 'scoring_weights', 'analyses', 'score_dimensions',
  'evidence', 'compliance_items', 'risks', 'agent_runs', 'agent_steps', 'response_drafts',
  'approval_requests', 'approval_decisions', 'response_sections', 'requirement_mappings',
  'draft_versions', 'comments', 'notifications', 'notification_preferences', 'audit_logs',
  'jobs', 'saved_searches', 'bookmarks', 'reports',
];

let liveTables: Set<string>;
let orgIdTables: Set<string>;

beforeAll(async () => {
  await resetDatabase();
  const db = getDb();
  const tables = await db
    .selectFrom('information_schema.tables' as never)
    .select(['table_name' as never])
    .where('table_schema' as never, '=', 'public' as never)
    .execute();
  liveTables = new Set((tables as { table_name: string }[]).map((t) => t.table_name));

  const columns = await db
    .selectFrom('information_schema.columns' as never)
    .select(['table_name' as never])
    .where('table_schema' as never, '=', 'public' as never)
    .where('column_name' as never, '=', 'org_id' as never)
    .execute();
  orgIdTables = new Set((columns as { table_name: string }[]).map((c) => c.table_name));
});
afterAll(teardown);

describe('declared tables match the database', () => {
  it('every declared table exists', () => {
    const missing = DECLARED.filter((t) => !liveTables.has(t));
    expect(missing, `declared but absent: ${missing.join(', ')}`).toEqual([]);
  });

  it('every database table is declared', () => {
    const undeclared = [...liveTables].filter(
      (t) => !DECLARED.includes(t as keyof Database) && t !== '_migrations',
    );
    expect(undeclared, `in the database but undeclared: ${undeclared.join(', ')}`).toEqual([]);
  });
});

describe('tenancy coverage', () => {
  it('every table with org_id is listed in TENANT_TABLES', () => {
    // sessions is the one deliberate exception: its org_id is a pointer to the
    // session's active workspace, and a session must be resolvable *before*
    // any tenant scope exists. It is therefore read through src/lib/session.ts
    // keyed by the session token, never through ScopedDb.
    const EXEMPT = new Set(['sessions']);
    const unguarded = [...orgIdTables]
      .filter((t) => !EXEMPT.has(t))
      .filter((t) => !TENANT_TABLES.includes(t as never));
    expect(
      unguarded,
      `these tables carry org_id but are not in TENANT_TABLES, so ScopedDb cannot reach them: ${unguarded.join(', ')}`,
    ).toEqual([]);
  });

  it('every TENANT_TABLES entry really has an org_id column', () => {
    const wrong = TENANT_TABLES.filter((t) => !orgIdTables.has(t));
    expect(wrong, `listed as tenant-scoped without an org_id column: ${wrong.join(', ')}`).toEqual([]);
  });

  it('org_id is NOT NULL wherever it exists, so a row cannot escape its tenant', async () => {
    const nullable = await getDb()
      .selectFrom('information_schema.columns' as never)
      .select(['table_name' as never])
      .where('table_schema' as never, '=', 'public' as never)
      .where('column_name' as never, '=', 'org_id' as never)
      .where('is_nullable' as never, '=', 'YES' as never)
      .execute();
    const names = (nullable as { table_name: string }[]).map((r) => r.table_name);
    // sessions.org_id is intentionally nullable: a signed-in user between
    // workspaces has no active one.
    expect(names.filter((n) => n !== 'sessions')).toEqual([]);
  });

  it('org_id columns cascade from organizations, so deleting a tenant removes its data', async () => {
    // information_schema needs a join the typed builder cannot express; raw SQL
    // is the honest tool here.
    const { rows } = await sql<{ table_name: string; delete_rule: string }>`
      SELECT k.table_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage k
        ON k.constraint_name = rc.constraint_name
       AND k.constraint_schema = rc.constraint_schema
      WHERE k.table_schema = 'public' AND k.column_name = 'org_id'
    `.execute(getDb());

    const offenders = rows
      .filter((f) => f.delete_rule !== 'CASCADE' && f.table_name !== 'sessions')
      .map((f) => `${f.table_name}: ${f.delete_rule}`);
    expect(offenders).toEqual([]);
  });
});

describe('migrations', () => {
  it('are recorded so they are applied exactly once', async () => {
    const rows = await getDb().selectFrom('_migrations').select('name').execute();
    expect(rows.map((r) => r.name)).toContain('0001_init.sql');
    // One row per file: a second apply would violate the primary key.
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
  });

  it('declare the enums the type file expects', async () => {
    const sql = await readFile(join(process.cwd(), 'db', 'migrations', '0001_init.sql'), 'utf8');
    for (const enumName of [
      'role', 'provenance', 'source_kind', 'verification_status', 'tender_status',
      'analysis_status', 'verdict', 'run_status', 'step_status', 'severity',
      'compliance_status', 'approval_type', 'approval_status', 'job_type', 'job_status',
      'notification_kind', 'report_kind',
    ]) {
      expect(sql, enumName).toContain(`CREATE TYPE ${enumName} AS ENUM`);
    }
  });
});
