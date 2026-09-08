import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_HINT_COOKIE } from '@/lib/auth';

/**
 * Auth gate (review loop 2 decision): the session lives in localStorage, but
 * this file runs server-side — so it reads the presence-only hint cookie the
 * session writers maintain (`SESSION_HINT_COOKIE`; no token material, TTL
 * matches the token's).
 *
 * - No hint + anything except the auth pages → `/login`.
 * - Hint + an auth page → the app root (signed-in users don't loiter on
 *   /login//register).
 *
 * The hint is a UX gate, not an enforcement boundary: the backend still
 * rejects every unauthenticated API call, and an expired token reads as
 * signed-out through `readSession()` regardless of a not-yet-expired cookie.
 */
const AUTH_PATHS = ['/login', '/register'];

/**
 * The gate decision, as a plain function (bun:test has no Next runtime —
 * `proxy` is the thin Next-shaped wrapper around this). `next` passes
 * through; `redirect` names the destination path.
 */
export type GateDecision = { kind: 'redirect'; pathname: string } | { kind: 'next' };

export function gate(pathname: string, hasHint: boolean): GateDecision {
  const isAuthPath = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!hasHint && !isAuthPath) return { kind: 'redirect', pathname: '/login' };
  if (hasHint && isAuthPath) return { kind: 'redirect', pathname: '/' };
  return { kind: 'next' };
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasHint = request.cookies.has(SESSION_HINT_COOKIE);
  const decision = gate(pathname, hasHint);
  if (decision.kind === 'redirect') {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};