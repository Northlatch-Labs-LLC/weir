// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse, type NextRequest } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readSiteMode } from '@/lib/site-mode';
import { passIsValid, passTokenFrom } from '@/lib/access-codes';
import { isAlwaysOpen, isSchedulerReached } from '@/lib/front-door';
import { cspFor, CSP_NONCE_HEADER } from '@/lib/csp';
import { edgeRequiredRefusal } from '@/lib/rate-limit';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$).*)',
  ],
};

export { ALWAYS_OPEN } from '@/lib/front-door';

export const PATHNAME_HEADER = 'x-weir-pathname';

function letThrough(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
  // One nonce per document request, minted here where the response headers are reachable,
  // handed to the server components through the request header and written into the
  // enforced policy on the response. lib/csp.ts owns the policy text; this owns the
  // freshness. Requests that render no HTML (API routes) carry a harmless extra header.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  headers.set(CSP_NONCE_HEADER, nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', cspFor(nonce));
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The platform's scheduler reaches its route without passing through the edge.
  if (isSchedulerReached(pathname)) return letThrough(request);

  // Before anything is read from the database or answered: a deployment that is served through an
  // edge serves nobody else. Does nothing until it is asked to (PROJECTX_SOCIAL_REQUIRE_EDGE), so
  // that it can be switched on only after the edge is known to present its secret.
  const unedged = edgeRequiredRefusal(request);
  if (unedged !== null) return unedged;

  if (isAlwaysOpen(pathname)) return letThrough(request);

  const mode = await readSiteMode();
  if (!mode.waitlistMode) return letThrough(request);

  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );
  if (await isSiteAdmin(viewer)) return letThrough(request);

  if (await passIsValid(passTokenFrom(request.headers.get('cookie')))) return letThrough(request);

  const to = request.nextUrl.clone();
  to.pathname = '/waitlist';
  to.search =
    pathname.startsWith('/') && !pathname.startsWith('//')
      ? `?from=${encodeURIComponent(pathname)}`
      : '';

  return NextResponse.redirect(to, 307);
}
