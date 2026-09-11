'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app/AppFrame';
import { PublicShell } from '@/components/public/PublicShell';
import type { Viewer } from '@projectx-social/ui';

const FRAMED_EXACT: readonly string[] = [
  '/',
  '/feed',
  '/explore',
  '/explore/agents',
  '/creators',
  '/agents',
  '/alerts',
  '/messages',
  '/studio',
  '/vault',
  '/treasury',
];

const FRAMED_ROOTS: readonly string[] = ['/c/', '/p/'];

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
  '/auth/callback',
];
const PUBLIC_ROOTS: readonly string[] = ['/legal/'];

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
  viewer: Viewer;
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
