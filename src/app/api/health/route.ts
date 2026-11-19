import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { aiState, demoState, etimadState, mailState } from '@/lib/env';
import { sql } from 'kysely';

export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness in one place. The database check is a real query, and
 * integration states are reported as they are — a deployment with no AI key
 * says so here rather than failing later inside a run.
 */
export async function GET() {
  const started = Date.now();
  let database: 'up' | 'down' = 'down';
  let error: string | null = null;
  try {
    await sql`SELECT 1`.execute(getDb());
    database = 'up';
  } catch (err) {
    error = err instanceof Error ? err.message : 'unknown database error';
  }
  const payload = {
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    error,
    integrations: { ai: aiState(), etimad: etimadState(), demo: demoState(), mail: mailState() },
    latencyMs: Date.now() - started,
    at: new Date().toISOString(),
  };
  return NextResponse.json(payload, { status: database === 'up' ? 200 : 503 });
}
