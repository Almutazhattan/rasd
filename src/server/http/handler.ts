/**
 * Route-handler plumbing: one error contract, one JSON shape, one place where
 * rate limiting and request-body validation happen.
 *
 * The response body never carries a stack trace, a SQL fragment or a provider
 * message — only the AppError's publicMessage. Detail goes to the log with the
 * request id so an operator can correlate the two.
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

export type Json = Record<string, unknown> | unknown[];

export function ok(data: Json | null, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function created(data: Json) {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export function fail(err: unknown, requestId: string) {
  if (isAppError(err)) {
    if (err.status >= 500) {
      logger.error('request failed', { requestId, code: err.code, detail: err.detail });
    } else {
      logger.info('request rejected', { requestId, code: err.code });
    }
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.publicMessage }, requestId },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'Some fields need attention.',
          fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        requestId,
      },
      { status: 422 },
    );
  }
  logger.error('unhandled error', {
    requestId,
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
  });
  return NextResponse.json(
    { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong on our side.' }, requestId },
    { status: 500 },
  );
}

/** Wrap a handler: assigns a request id, converts thrown AppErrors to responses. */
export function handler<T extends unknown[]>(
  fn: (...args: T) => Promise<NextResponse>,
): (...args: T) => Promise<NextResponse> {
  return async (...args: T) => {
    const requestId = randomUUID();
    try {
      const res = await fn(...args);
      res.headers.set('x-request-id', requestId);
      return res;
    } catch (err) {
      return fail(err, requestId);
    }
  };
}

export async function body<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError('VALIDATION', 'Expected a JSON request body.');
  }
  return schema.parse(raw);
}

export function query<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const url = new URL(req.url);
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  return schema.parse(obj);
}

// ─────────────────────────── rate limiting ───────────────────────────
//
// A fixed-window counter in process memory. It is the right shape for a single
// instance and the wrong shape for several: behind more than one replica,
// move the counter to Redis or Postgres. Stated here rather than discovered
// in production — see docs/LIMITATIONS.md.

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max?: number, windowMs?: number) {
  const e = env();
  const limit = max ?? e.RATE_LIMIT_MAX;
  const span = windowMs ?? e.RATE_LIMIT_WINDOW_MS;
  const now = Date.now();

  if (windows.size > 10_000) {
    for (const [k, v] of windows) if (v.resetAt < now) windows.delete(k);
  }

  const current = windows.get(key);
  if (!current || current.resetAt < now) {
    windows.set(key, { count: 1, resetAt: now + span });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throw new AppError('RATE_LIMITED', 'Too many attempts. Try again in a moment.');
  }
}

export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || req.headers.get('x-real-ip') || 'unknown';
  return `${scope}:${ip}`;
}
