'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Which chrome a route wears, decided where the decision can change.
 *
 * # The defect this fixes
 *
 * This choice used to be made in `AppShell`, a server component in the ROOT layout, from a pathname
 * header the proxy sets. A root layout is rendered once and then reused for every client-side
 * navigation under it — the App Router does not re-run it when you click a link. So the chrome was
 * chosen on the first paint of the session and never changed again, while each new page went on
 * rendering whatever frame it builds for itself inside the stale one.
 *
 * Measured, on a dev server, before this file existed:
 *
 *   /security -> click "Explore"   two `<main>` elements, two footers, the public header bar still
 *                                  on screen with the application rail drawn inside it
 *   /explore  -> click "Security"  zero rails, zero footers, zero `<main>` — the page rendered with
 *                                  no chrome at all
 *
 * That is the doubled rail, the doubled aside and the doubled account row in the screenshots, and
 * it is why the application "breaks on navigation": nothing was wrong with either page, only with
 * where the choice between them was made.
 *
 * # Why a client component
 *
 * `usePathname()` changes on every navigation, so this re-renders and re-picks. Everything that
 * needs the server — the proved session, the discovery rail — is computed once in the layout and
 * handed down as props and children, which is fine because none of it varies by route: the session
 * is the session and the rail is the same rail everywhere. When the session changes, `SessionBridge`
 * calls `router.replace`, the server tree is refetched, and those props arrive updated.
 */

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app/AppFrame';
import { PublicShell } from '@/components/public/PublicShell';
import type { Viewer } from '@projectx-social/ui';

/*
  Routes whose page renders `AppFrame` itself.

  Exact, not prefixed, and that distinction is a bug this list previously had: `/agents` matched as
  a prefix, so `/agents/build` and `/agents/declare` counted as framed, were handed through, and
  rendered with no navigation at all. Sub-routes are framed here unless they are listed themselves.
*/
const FRAMED_EXACT: readonly string[] = [
  '/',
  '/feed',
  '/explore',
  '/creators',
  '/agents',
  '/alerts',
  '/messages',
  '/studio',
  '/vault',
];

/* Handle and post pages: every path beneath these roots is a framed screen. */
const FRAMED_ROOTS: readonly string[] = ['/c/', '/p/'];

/*
  Pages you read before you have an account.

  These wear the front door's header and footer rather than the application's rail. The rail lists
  Vault, Studio, Messages and Alerts — eight rooms a visitor cannot enter — and its mark links to
  `/feed`, so somebody who clicked through from the front page landed in a menu of places they could
  not go, with no route back to the page they came from.
*/
const PUBLIC_EXACT: readonly string[] = [
  '/security',
  '/disclosure',
  '/waitlist',
  '/signin',
  '/join',
  '/add-funds',
  '/agents/build',
  '/agents/reference',
  '/agents/declare',
];
const PUBLIC_ROOTS: readonly string[] = ['/legal/'];

/**
 * One spelling of a path.
 *
 * `/vault` and `/vault/` are the same route and were not the same string, so a trailing slash — from
 * a hand-typed address, an old link, an external referrer — fell through every exact match and got
 * the wrapped frame on top of the frame the page builds for itself. Two rails, from a slash.
 */
export function normalisePath(pathname: string | null): string | null {
  if (pathname === null) return null;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function isPublicPage(pathname: string | null): boolean {
  const path = normalisePath(pathname);
  if (path === null) return false;
  if (PUBLIC_EXACT.includes(path)) return true;
  return PUBLIC_ROOTS.some((root) => path.startsWith(root));
}

export function carriesItsOwnFrame(pathname: string | null): boolean {
  const path = normalisePath(pathname);
  if (path === null) return false;
  if (FRAMED_EXACT.includes(path)) return true;
  return FRAMED_ROOTS.some((root) => path.startsWith(root));
}

export function ChromeRouter({
  viewer,
  discovery,
  children,
}: {
  /** The proved session, read once on the server. `?reader=` is a claim and never reaches this. */
  viewer: Viewer;
  /** The discovery rail, read once on the server and the same on every wrapped route. */
  discovery: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  if (carriesItsOwnFrame(pathname)) return <>{children}</>;
  if (isPublicPage(pathname)) return <PublicShell>{children}</PublicShell>;

  return (
    <AppFrame viewer={viewer} aside={discovery}>
      {/* A gutter for pages written before the column existed. See `.w-legacy`. */}
      <div className="w-legacy">{children}</div>
    </AppFrame>
  );
}
