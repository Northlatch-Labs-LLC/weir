// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { WeirLockup, WeirMark } from '../brand/WeirMark';
import { WeirLine } from '../brand/WeirLine';
import { Icon, type IconName } from '../base/Icon';
import { Avatar } from '../base/Avatar';
import { SearchBox } from './Discovery';

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
  badge?: number | null | undefined;
};

export const NAV: readonly NavItem[] = [
  { href: '/feed', label: 'Feed', icon: 'home' },
  { href: '/explore', label: 'Explore', icon: 'explore' },
  { href: '/creators', label: 'Earn', icon: 'creators' },
  { href: '/agents', label: 'Agents', icon: 'agents' },
  { href: '/alerts', label: 'Alerts', icon: 'alerts' },
  { href: '/messages', label: 'Messages', icon: 'messages' },
  { href: '/vault', label: 'Vault', icon: 'vault' },
  { href: '/studio', label: 'Studio', icon: 'studio' },
];

export const BOTTOM: readonly NavItem[] = [
  { href: '/feed', label: 'Feed', icon: 'home' },
  { href: '/explore', label: 'Explore', icon: 'explore' },
  { href: '/alerts', label: 'Alerts', icon: 'alerts' },
  { href: '/messages', label: 'Messages', icon: 'messages' },
];

export type Viewer =
  | { signedIn: false }
  | { signedIn: true; address: string; handle: string | null; displayName: string | null; avatarUrl?: string | null };

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
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
  connect,
  account,
}: {
  pathname: string;
  Link: LinkComponent;
  nav?: readonly NavItem[] | undefined;
  viewer: Viewer;
  onPublish?: (() => void) | undefined;
  connect?: ReactNode;
  account?: ReactNode;
}) {
  return (
    <nav className="w-rail" aria-label="Weir">
      {/*
        The lockup, not a mark beside a hand-set lowercase word. The rail and the public header had
        each invented their own pairing, and neither matched the drawn one.
      */}
      <Link href="/" className="w-rail__brand" aria-label="Weir, home">
        <WeirLockup height={19} title="Weir" />
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
          {onPublish === undefined ? (
            <Link href="/studio" className="w-btn w-btn--primary w-rail__publish">
              Publish
            </Link>
          ) : (
            <button type="button" className="w-btn w-btn--primary w-rail__publish" onClick={onPublish}>
              Publish
            </button>
          )}
          {account ?? (
            <>
              {connect}
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
          )}
        </>
      ) : connect === undefined ? (
        <Link href="/signin" className="w-btn w-btn--primary w-rail__publish">
          Sign in
        </Link>
      ) : (
        <div className="w-rail__connect">
          {connect}
          <Link href="/signin" className="w-rail__alt">
            or continue with Google
          </Link>
        </div>
      )}
    </nav>
  );
}

export function ColumnFooter({ Link }: { Link: LinkComponent }) {
  return (
    <footer className="w-foot">
      <div className="w-foot__links">
        <Link href="/explore">Explore</Link>
        <Link href="/creators">Open a page</Link>
        <Link href="/agents">Agents</Link>
        <Link href="/security">Security</Link>
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/creator-terms">Creator terms</Link>
        <Link href="/disclosure">Disclosure</Link>
      </div>
      <div className="w-foot__line">
        <WeirMark size={16} />
        <span>Weir · on Sui · Your favorite notification</span>
      </div>
      {/*
        The water line closes the column, where the reading stops. It is the one place in the app
        shell it can sit without competing with a post: the rail is too narrow for a wave, the aside
        is a working surface, and behind the column it would move under text somebody is reading.
      */}
      <WeirLine height={64} className="w-foot__line-art" />
    </footer>
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

export function ColumnHeader({
  title,
  sub,
  tabs,
  Link,
  pathname,
  back,
}: {
  title: string;
  sub?: string | undefined;
  tabs?: ReadonlyArray<{ href: string; label: string }> | undefined;
  Link?: LinkComponent | undefined;
  pathname?: string | undefined;
  back?: { href: string; label: string } | undefined;
}) {
  return (
    <header className="w-head">
      <div className={tabs === undefined ? 'w-head__row w-head__row--plain' : 'w-head__row'}>
        {back === undefined || Link === undefined ? null : (
          <Link href={back.href} className="w-head__back" aria-label={`Back to ${back.label}`}>
            <Icon name="back" size={20} strokeWidth={2} />
          </Link>
        )}
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
  connect,
  account,
  searchQuery,
  searchHidden,
}: {
  pathname: string;
  Link: LinkComponent;
  viewer: Viewer;
  nav?: readonly NavItem[] | undefined;
  aside?: ReactNode;
  children: ReactNode;
  onPublish?: (() => void) | undefined;
  connect?: ReactNode;
  account?: ReactNode;
  searchQuery?: string | undefined;
  searchHidden?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <div className="w-app">
      <a className="w-skip" href="#w-main">
        Skip to content
      </a>
      <div className="w-app__inner">
        <LeftRail pathname={pathname} Link={Link} nav={nav} viewer={viewer} onPublish={onPublish} connect={connect} account={account} />
        <main id="w-main" className="w-column">
          <div className="w-column__search">
            <SearchBox query={searchQuery ?? ''} hidden={searchHidden} />
          </div>
          {children}
          <ColumnFooter Link={Link} />
        </main>
        {aside === undefined ? null : (
          <aside className="w-aside" aria-label="Discover">
            <div className="w-aside__sticky">
              <SearchBox query={searchQuery ?? ''} hidden={searchHidden} />
              {aside}
            </div>
          </aside>
        )}
      </div>
      {viewer.signedIn ? (
        <Link href="/studio" className="w-fab" aria-label="Publish something">
          <Icon name="plus" size={24} strokeWidth={2.2} />
        </Link>
      ) : null}
      <BottomBar pathname={pathname} Link={Link} viewer={viewer} />
    </div>
  );
}
