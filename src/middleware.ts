/**
 * Edge middleware: a cheap first gate only.
 *
 * It checks for the presence of a session cookie so a signed-out visitor is
 * redirected without a database round trip. It deliberately does NOT validate
 * the session — middleware runs on the edge runtime with no database access,
 * and a cookie's presence proves nothing. Real authentication and tenancy
 * checks happen in src/app/app/layout.tsx and in every route handler through
 * requireAuth(). Removing this file would change performance, not security.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/cookie-names';

export function middleware(req: NextRequest) {
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  if (!hasCookie && (pathname.startsWith('/app') || pathname === '/onboarding')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/onboarding'],
};
