/**
 * Forward-only SQL migrator.
 *
 * Applies db/migrations/*.sql in filename order inside a transaction each,
 * recording applied names in _migrations. `--reset` drops and recreates the
 * public schema first (development and test only; it refuses in production).
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --reset
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'db', 'migrations');

async function main() {
  const reset = process.argv.includes('--reset');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  if (reset && process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to --reset with NODE_ENV=production.');
  }

  const pool = new Pool({ connectionString: url });
  try {
    if (reset) {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('· schema reset');
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await pool.query<{ name: string }>('SELECT name FROM _migrations');
    const done = new Set(rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✓ ${file}`);
        applied++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ ${file} — rolled back`);
        throw err;
      } finally {
        client.release();
      }
    }
    console.log(applied ? `${applied} migration(s) applied.` : 'Already up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
