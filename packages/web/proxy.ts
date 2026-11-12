// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse, type NextRequest } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readSiteMode } from '@/lib/site-mode';
import { passIsValid, passTokenFrom } from '@/lib/access-codes';
import { isAlwaysOpen } from '@/lib/front-door';

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
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
