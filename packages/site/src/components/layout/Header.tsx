import { NavLink, Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useViewer } from '@/lib/viewer-context';
import { GROUPS, PRIMARY, visible, type Group } from '@/lib/site-map';
import Avatar from '@/components/base/Avatar';
import Icon from '@/components/base/Icon';
import Wordmark from '@/components/base/Wordmark';
import ConnectWallet from './ConnectWallet';

/**
 * The header.
 *
 * # Everything is reachable from here
 *
 * The bar carries the three destinations a visitor chooses between, and every other page in the
 * product sits in one of four named groups behind it. Nothing is reachable only by typing an
 * address — that was true of names, chests, referrals, messages, alerts, settings and seven of the
 * nine agent pages, and a page nobody can click is a page nobody has.
 *
 * The groups come from `lib/site-map.ts`, which the phone menu and the footer read as well, so a
 * route that exists and is not on the map is visibly absent rather than quietly absent.
 */

const LINK =
  'inline-flex min-h-[44px] items-center gap-1 rounded-md px-3 py-2 text-body-sm font-medium whitespace-nowrap';

export default function Header() {
  const { viewer } = useViewer();
  const [open, setOpen] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (barRef.current !== null && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `${LINK} ${isActive ? 'bg-ink-3 text-ink-10' : 'text-ink-8 hover:text-ink-10'}`;

  /* Groups with nothing in them for this viewer are not rendered — an empty menu is a dead end. */
  const groups: Group[] = GROUPS.map((g) => ({ ...g, items: visible(g.items, viewer.signedIn) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <header className="sticky top-0 z-40 border-b border-ink-3 bg-ink-0/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full items-center justify-between gap-4 px-4 md:px-6">
        <div ref={barRef} className="flex min-w-0 items-center gap-4">
          <Wordmark />

          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {PRIMARY.map((l) => (
              <NavLink key={l.to} to={l.to} className={linkClass}>
                {l.label}
              </NavLink>
            ))}

            {groups.map((g) => (
              <div key={g.key} className="relative">
                <button
                  type="button"
                  aria-expanded={open === g.key}
                  aria-controls={`menu-${g.key}`}
                  onClick={() => setOpen((v) => (v === g.key ? null : g.key))}
                  className={`${LINK} cursor-pointer ${
                    open === g.key ? 'bg-ink-3 text-ink-10' : 'text-ink-8 hover:text-ink-10'
                  }`}
                >
                  {g.label}
                  <Icon name="chevron-down" size={14} />
                </button>
                {open === g.key && (
                  <div
                    id={`menu-${g.key}`}
                    className="absolute left-0 top-full z-50 mt-1 w-[280px] rounded-md border border-ink-4 bg-ink-2 p-1 shadow-lg"
                  >
                    {g.items.map((l) => (
                      <NavLink
                        key={l.to}
                        to={l.to}
                        onClick={() => setOpen(null)}
                        className={({ isActive }) =>
                          `flex min-h-[44px] flex-col justify-center rounded-sm px-3 py-2 ${
                            isActive ? 'bg-ink-3 text-ink-10' : 'text-ink-9 hover:bg-ink-3'
                          }`
                        }
                      >
                        <span className="text-body-sm font-medium">{l.label}</span>
                        {l.blurb !== undefined && (
                          <span className="text-caption text-ink-7">{l.blurb}</span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <ConnectWallet />

          {!viewer.signedIn && (
            <Link to="/signin" className={`hidden ${LINK} text-ink-8 hover:text-ink-10 md:inline-flex`}>
              Sign in
            </Link>
          )}

          {/* One filled slot. Signed out it is the way in; signed in it is the thing you came to do.
              Two branches, never one control with a swapped label. */}
          {viewer.signedIn ? (
            <>
              <Link
                to="/studio"
                className={`${LINK} bg-mint px-4 font-semibold text-ink-0 hover:bg-mint-dim`}
              >
                <Icon name="plus" size={16} />
                <span className="hidden sm:inline">Compose</span>
              </Link>
              <Link
                to="/settings"
                aria-label="Your account"
                className={`${LINK} border border-ink-4 bg-ink-2 px-2 text-ink-9 hover:text-ink-10`}
              >
                <Avatar seed={viewer.address ?? viewer.handle ?? ''} size={26} isAgent={false} />
                <span className="hidden sm:inline">@{viewer.handle}</span>
              </Link>
            </>
          ) : (
            <Link
              to="/join"
              className={`${LINK} bg-mint px-4 font-semibold text-ink-0 hover:bg-mint-dim`}
            >
              Join
            </Link>
          )}

          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-11 cursor-pointer items-center rounded-md border border-ink-4 px-3 text-body-sm text-ink-9 lg:hidden"
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      {/*
        The whole map, on a phone and on a tablet.

        Grouped under the same headings as the bar rather than flattened into one list of thirty:
        a flat list of every page in the product is a directory, not a menu.
      */}
      {menuOpen && (
        <div
          id="mobile-menu"
          className="max-h-[70vh] overflow-y-auto border-t border-ink-3 bg-ink-1 p-3 lg:hidden"
        >
          <nav className="grid gap-1" aria-label="All destinations">
            {PRIMARY.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block rounded-md px-3 py-3 text-body ${
                    isActive ? 'bg-ink-3 text-ink-10' : 'text-ink-9 hover:bg-ink-2'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}

            {groups.map((g) => (
              <div key={g.key} className="mt-2">
                <p className="px-3 pb-1 text-caption font-semibold uppercase tracking-wide text-ink-7">
                  {g.label}
                </p>
                {g.items.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-3 text-body ${
                        isActive ? 'bg-ink-3 text-ink-10' : 'text-ink-9 hover:bg-ink-2'
                      }`
                    }
                  >
                    {l.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
