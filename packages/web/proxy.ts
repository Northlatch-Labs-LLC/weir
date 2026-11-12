// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse, type NextRequest } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readSiteMode } from '@/lib/site-mode';
import { passIsValid, passTokenFrom } from '@/lib/access-codes';
import { isAlwaysOpen } from '@/lib/front-door';
import { locales, defaultLocale, isValidLocale } from '@/lib/i18n/config';

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

function getLocaleFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 0) {
    const first = parts[0] as string;
    if (isValidLocale(first)) return first;
  }
  return null;
  return null;
}

function stripLocale(pathname: string): string {
  const locale = getLocaleFromPath(pathname);
  if (locale) {
    return pathname.replace(new RegExp(`^/${locale}`), '') || '/';
  }
  return pathname;
}

function preferredLocale(request: NextRequest): string {
  // 1. Locale cookie
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value ?? '';
  if (cookieLocale && isValidLocale(cookieLocale)) return cookieLocale;

  // 2. Accept-Language header
  const acceptLang = request.headers.get('accept-language');
  if (acceptLang) {
    for (const entry of acceptLang.split(',')) {
      const lang = entry.split(';')[0]?.trim().toLowerCase();
      if (lang === 'ro' || lang === 'ro-ro') return 'ro';
      if (lang === 'en' || lang === 'en-gb' || lang === 'en-us') return 'en';
    }
  }

  return defaultLocale;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Handle locale detection and redirect for root path
  if (pathname === '/') {
    const locale = preferredLocale(request);
    const to = request.nextUrl.clone();
    to.pathname = locale === defaultLocale ? `/en` : `/${locale}`;
    return NextResponse.redirect(to, 307);
  }

  // Strip locale prefix for auth checks
  const pathWithoutLocale = stripLocale(pathname);

  if (isAlwaysOpen(pathWithoutLocale)) return letThrough(request);

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
  const locale = getLocaleFromPath(pathname) || preferredLocale(request);
  to.pathname = `/${locale}/waitlist`;
  to.search =
    pathWithoutLocale.startsWith('/') && !pathWithoutLocale.startsWith('//')
      ? `?from=${encodeURIComponent(pathWithoutLocale)}`
      : '';

  return NextResponse.redirect(to, 307);
}
