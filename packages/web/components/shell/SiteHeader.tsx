'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The header every route wears.
 *
 * # One header
 *
 * This one reads its destinations from `lib/site-map.ts`, marks the current section with
 * `aria-current`, and is laid out entirely in `weir.css` under `.sh-*` — which is what lets it fit a
 * 320px phone without clipping the account control, the defect measured at 375px before this.
 *
 * # Who is signed in
 *
 * `signedIn` and `myHandle` come from the shell, which read a *proved* session. A failed read passes
 * `false`, so the header renders as a guest: showing guest chrome to a member is a small indignity,
 * and showing member chrome to somebody we could not identify is a leak.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AccountMenu } from '@/components/AccountMenu';
import { Icon } from '@/components/design/icons';
import { useTheme } from '@/components/design/use-theme';
import { PRIMARY, primaryFor } from '@/lib/site-map';

export function WeirMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="sh-mark" aria-hidden>
      <path d="M 0.356 9.1 A 12 12 0 1 0 23.644 9.1 Z" fill="currentColor" />
      <line x1="5" y1="7.5" x2="19" y2="7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="7" y1="5" x2="17" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
      <line x1="9" y1="2.5" x2="15" y2="2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

export function SiteHeader({
  signedIn,
  myHandle,
  gated = false,
}: {
  signedIn: boolean;
  myHandle: string | null;
  /** The front door is shut: the destinations give way to the one way in. */
  gated?: boolean;
}) {
  const pathname = usePathname() ?? '/';
  const here = primaryFor(pathname);
  const { theme, toggle, label: themeLabel } = useTheme();
  const themeIcon = theme === null ? null : <Icon name={theme === 'day' ? 'moon' : 'sun'} size={16} />;

  return (
    <header className="sh-header">
      <div className="sh-header__row">
        <Link href="/" className="sh-logo" aria-label="Weir — home">
          <span className="sh-logo__tile" aria-hidden>
            <WeirMark />
          </span>
          <span className="sh-logo__text">
            <span className="sh-logo__word">weir</span>
            <span className="sh-logo__sub">on sui</span>
          </span>
        </Link>

        {!gated && (
          <nav aria-label="Primary" className="sh-nav">
            {PRIMARY.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="sh-nav__link"
                aria-current={here === d.href ? 'page' : undefined}
              >
                <Icon name={d.icon} size={15} />
                <span>{d.label}</span>
              </Link>
            ))}
          </nav>
        )}

        <div className="sh-tools">
          {/*
            The badge stays; the button does not.

            While the door is shut the waiting list is the only page a visitor can reach, so a
            header button pointing at it is a second copy of the page they are already on. The badge
            still says why the rest of the nav is missing.
          */}
          {gated && <span className="sh-badge">closed alpha</span>}
          <button
            type="button"
            className="sh-iconbtn sh-theme"
            onClick={toggle}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {themeIcon}
          </button>
          {signedIn && (
            <Link
              href="/alerts"
              className="sh-iconbtn sh-bell"
              aria-label="Alerts"
              title="Alerts"
              aria-current={pathname === '/alerts' ? 'page' : undefined}
            >
              <Icon name="bell" size={17} />
            </Link>
          )}
          {!gated && (
            <details className="sh-menu">
              <summary aria-label="Menu" title="Menu" className="sh-iconbtn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </summary>
              <div className="sh-menu__panel">
                {PRIMARY.map((d) => (
                  <Link
                    key={d.href}
                    href={d.href}
                    className="sh-menu__link"
                    aria-current={here === d.href ? 'page' : undefined}
                  >
                    <Icon name={d.icon} size={16} />
                    <span>
                      <span className="sh-menu__label">{d.label}</span>
                      {d.blurb !== undefined && <span className="sh-menu__blurb">{d.blurb}</span>}
                    </span>
                  </Link>
                ))}
                <Link href="/security" className="sh-menu__link">
                  <Icon name="shield" size={16} />
                  <span>
                    <span className="sh-menu__label">Security</span>
                    <span className="sh-menu__blurb">What the contracts guarantee, and what we do not claim</span>
                  </span>
                </Link>
                {signedIn && myHandle !== null && (
                  <Link href={`/c/${myHandle}`} className="sh-menu__link">
                    <Icon name="name" size={16} />
                    <span>
                      <span className="sh-menu__label">My page</span>
                      <span className="sh-menu__blurb">@{myHandle}</span>
                    </span>
                  </Link>
                )}
                <button type="button" className="sh-menu__link sh-menu__theme" onClick={toggle}>
                  {themeIcon}
                  <span className="sh-menu__label">{themeLabel}</span>
                </button>
              </div>
            </details>
          )}
          {/*
            The account control, and the only one there is. It carries the wallet dialog, the
            multi-address picker, focus handling and sign-out, so it is mounted rather than redrawn.
          */}
          <div className="sh-account weir-account">
            <AccountMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
