/**
 * Database access. A single pg Pool per process, wrapped by Kysely.
 *
 * Nothing outside src/lib/tenancy.ts and src/server/** should import `db`
 * directly for customer-owned tables: tenancy.ts is what guarantees org
 * scoping. Reaching for `db` here bypasses that guarantee.
 */
import { Kysely, PostgresDialect, type LogEvent } from 'kysely';
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import type { Database } from './types';
import { env } from '../env';
import { logger } from '../logger';

export type { Database } from './types';

let pool: Pool | null = null;
let instance: Kysely<Database> | null = null;

function makePool(): Pool {
  const e = env();
  const serverless = Boolean(process.env.VERCEL);
  const p = new Pool({
    connectionString: e.DATABASE_URL,
    // Each serverless instance gets its own pool; keep it small so many
    // concurrent instances stay inside the database's connection limit.
    max: e.NODE_ENV === 'test' ? 4 : serverless ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // node-postgres returns NUMERIC as string; we use integer/real columns only.
  });
  p.on('error', (err) => logger.error('pg pool error', { err: err.message }));
  // On Vercel Fluid compute, release idle connections before the instance suspends.
  if (serverless) attachDatabasePool(p);
  return p;
}

export function getDb(): Kysely<Database> {
  if (instance) return instance;
  pool = makePool();
  instance = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log: (ev: LogEvent) => {
      if (ev.level === 'error') {
        logger.error('query failed', { ms: Math.round(ev.queryDurationMillis) });
      } else if (env().LOG_LEVEL === 'debug') {
        logger.debug('query', { sql: ev.query.sql, ms: Math.round(ev.queryDurationMillis) });
      }
    },
  });
  return instance;
}

/** For tests and graceful shutdown. */
export async function closeDb() {
  if (instance) await instance.destroy();
  instance = null;
  pool = null;
}

/** Replace the instance. Tests only. */
export function __setDb(k: Kysely<Database> | null) {
  instance = k;
}
