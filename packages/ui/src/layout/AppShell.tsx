// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The frame that never leaves.
 *
 * Rail on the left, one 640px column in the middle, discovery on the right. Navigating swaps the
 * middle column and nothing else — which is the whole difference between an application and a set
 * of pages that happen to share a header. Under 1280px the right rail goes; under 834px the rail
 * becomes a bottom bar and the column is the screen.
 *
 * # Framework-neutral, deliberately
 *
 * Nothing here imports from `next/*`. The host passes `pathname`, a `Link` and an `Image`, so this
 * same shell renders in the Next application and in any gallery that wants to show it. That is
 * what keeps one implementation of the design instead of two.
 */

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '../base/Icon';
import { Avatar } from '../base/Avatar';

export type LinkComponent = ComponentType<{
  href: string;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children: ReactNode;
  'aria-current'?: 'page' | undefined;
  'aria-label'?: string | undefined;
}>;

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** A count the reader has not seen yet. `null` means we could not read it — nothing is shown. */
  badge?: number | null | undefined;
};

/**
 * The destinations, in the order they appear.
 *
 * Vault sits in the rail rather than inside a settings page. Money was the first thing this
 * product did, so it is a place you go, not a preference you find.
 */
export const NAV: readonly NavItem[] = [
  { href: '/feed', label: 'Home', icon: 'home' },
  { href: '/explore', label: 'Explore', icon: 'explore' },
  { href: '/creators', label: 'Creators', icon: 'creators' },
  { href: '/agents', label: 'Agents', icon: 'agents' },
  { href: '/alerts', label: 'Alerts', icon: 'alerts' },
  { href: '/messages', label: 'Messages', icon: 'messages' },
  { href: '/vault', label: 'Vault', icon: 'vault' },
  { href: '/studio', label: 'Studio', icon: 'studio' },
];

/** What fits on a phone. Five, and the fifth is you. */
export const BOTTOM: readonly NavItem[] = [
  { href: '/feed', label: 'Home', icon: 'home' },
  { href: '/explore', label: 'Explore', icon: 'explore' },
  { href: '/alerts', label: 'Alerts', icon: 'alerts' },
  { href: '/messages', label: 'Messages', icon: 'messages' },
];

export type Viewer =
  | { signedIn: false }
  | { signedIn: true; address: string; handle: string | null; displayName: string | null; avatarUrl?: string | null };

/** `/feed` is current when the path is `/feed` or below it, so a post keeps Home lit. */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WeirMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="15" fill="none" stroke="var(--w-mint)" strokeWidth="1.6" />
      <path
        d="M7 12.5c2.2 0 2.2 5 4.5 5s2.3-5 4.5-5 2.2 5 4.5 5 2.3-5 4.5-5"
        fill="none"
        stroke="var(--w-mint)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M7 19.5c2.2 0 2.2 4 4.5 4s2.3-4 4.5-4 2.2 4 4.5 4 2.3-4 4.5-4"
        fill="none"
        stroke="rgba(140,247,198,0.4)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Badge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || value <= 0) return null;
  return (
    <span className="w-nav__badge">
      {value > 99 ? '99+' : value}
      <span className="w-vh"> unread</span>
    </span>
  );
}

export function LeftRail({
  pathname,
  Link,
  nav = NAV,
  viewer,
  onPublish,
}: {
  pathname: string;
  Link: LinkComponent;
  nav?: readonly NavItem[] | undefined;
  viewer: Viewer;
  onPublish?: (() => void) | undefined;
}) {
  return (
    <nav className="w-rail" aria-label="Weir">
      <Link href="/feed" className="w-rail__brand" aria-label="Weir, home">
        <WeirMark />
        <span className="w-rail__wordmark">weir</span>
      </Link>

      {nav.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} className="w-nav" aria-current={current ? 'page' : undefined}>
            <Icon name={item.icon} size={20} strokeWidth={current ? 1.9 : 1.6} />
            <span>{item.label}</span>
            <Badge value={item.badge} />
          </Link>
        );
      })}

      {viewer.signedIn ? (
        <>
          <button type="button" className="w-btn w-btn--primary w-rail__publish" onClick={onPublish}>
            Publish
          </button>
          <Link href={viewer.handle === null ? '/vault' : `/c/${viewer.handle}`} className="w-rail__account">
            <Avatar address={viewer.address} src={viewer.avatarUrl} size={40} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--w-sans)', fontSize: 14, fontWeight: 600, color: 'var(--w-ink-10)' }}>
                {viewer.displayName ?? viewer.handle ?? 'Your account'}
              </span>
              {viewer.handle === null ? null : (
                <span style={{ fontFamily: 'var(--w-mono)', fontSize: 12, color: 'var(--w-ink-7)' }}>
                  @{viewer.handle}
                </span>
              )}
            </span>
          </Link>
        </>
      ) : (
        <Link href="/signin" className="w-btn w-btn--primary w-rail__publish">
          Sign in
        </Link>
      )}
    </nav>
  );
}

export function BottomBar({
  pathname,
  Link,
  items = BOTTOM,
  viewer,
}: {
  pathname: string;
  Link: LinkComponent;
  items?: readonly NavItem[] | undefined;
  viewer: Viewer;
}) {
  const all: readonly NavItem[] = viewer.signedIn
    ? [...items, { href: '/vault', label: 'Vault', icon: 'vault' as IconName }]
    : [...items, { href: '/signin', label: 'Sign in', icon: 'profile' as IconName }];

  return (
    <nav className="w-bottom" aria-label="Weir">
      {all.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} className="w-bottom__item" aria-current={current ? 'page' : undefined}>
            <Icon name={item.icon} size={24} strokeWidth={current ? 2 : 1.6} />
            <span className="w-bottom__label">{item.label}</span>
            <Badge value={item.badge} />
          </Link>
        );
      })}
    </nav>
  );
}

/** The column header: the name of where you are, and the tabs that narrow it. */
export function ColumnHeader({
  title,
  sub,
  tabs,
  Link,
  pathname,
}: {
  title: string;
  sub?: string | undefined;
  tabs?: ReadonlyArray<{ href: string; label: string }> | undefined;
  Link?: LinkComponent | undefined;
  pathname?: string | undefined;
}) {
  return (
    <header className="w-head">
      <div className={tabs === undefined ? 'w-head__row w-head__row--plain' : 'w-head__row'}>
        <h1 id="w-title" tabIndex={-1}>
          {title}
        </h1>
        {sub === undefined ? null : <span className="w-head__sub">{sub}</span>}
      </div>
      {tabs === undefined || Link === undefined ? null : (
        <div className="w-tabs" role="tablist">
          {tabs.map((t) => {
            const current = pathname === t.href;
            return (
              <Link key={t.href} href={t.href} className="w-tab" aria-current={current ? 'page' : undefined}>
                <span>{t.label}</span>
                <span className="w-tab__rule" />
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}

export function AppShell({
  pathname,
  Link,
  viewer,
  nav,
  aside,
  children,
  onPublish,
}: {
  pathname: string;
  Link: LinkComponent;
  viewer: Viewer;
  nav?: readonly NavItem[] | undefined;
  aside?: ReactNode;
  children: ReactNode;
  onPublish?: (() => void) | undefined;
}) {
  return (
    <div className="w-app">
      <a className="w-skip" href="#w-main">
        Skip to content
      </a>
      <div className="w-app__inner">
        <LeftRail pathname={pathname} Link={Link} nav={nav} viewer={viewer} onPublish={onPublish} />
        <main id="w-main" className="w-column">
          {children}
        </main>
        {aside === undefined ? null : (
          <aside className="w-aside" aria-label="Discover">
            <div className="w-aside__sticky">{aside}</div>
          </aside>
        )}
      </div>
      <BottomBar pathname={pathname} Link={Link} viewer={viewer} />
    </div>
  );
}
