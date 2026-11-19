/**
 * Test harness: a real PostgreSQL database.
 *
 * TEST_DATABASE_URL must point at a database the test run may wipe. Each file
 * calls resetDatabase() to apply db/migrations from scratch, so the tests
 * exercise the same SQL that production runs — not an emulation of it.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { closeDb, getDb } from '@/lib/db';
import { __resetEnv } from '@/lib/env';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://rasd@127.0.0.1:5433/rasd_test';

export function configureTestEnv() {
  (process.env as Record<string, string>).NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
  process.env.LOG_LEVEL = 'error';
  delete process.env.ANTHROPIC_API_KEY;
  __resetEnv();
}

export async function resetDatabase() {
  configureTestEnv();
  await closeDb();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    // Same bookkeeping as scripts/migrate.ts, so the tests exercise the real
    // migration path rather than a shortcut that skips it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      await pool.query(await readFile(join(MIGRATIONS, f), 'utf8'));
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [f]);
    }
  } finally {
    await pool.end();
  }
  return getDb();
}

export async function teardown() {
  await closeDb();
}
