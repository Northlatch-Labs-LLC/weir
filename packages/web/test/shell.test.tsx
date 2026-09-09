// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let pathname = '/explore';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/AccountMenu', () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));
vi.mock('@/components/design/use-theme', () => ({
  useTheme: () => ({ theme: 'night', toggle: () => undefined, label: 'Switch to daylight' }),
}));

/*
  The shell's reads, controllable per test. `ok`/`fail` shapes mirror the SDK's `Reading`.
*/
let session: { ok: true; value: string | null } | { ok: false; failure: unknown } = { ok: true, value: null };
vi.mock('@/lib/read-session', () => ({ provenReader: async () => session }));
vi.mock('@/lib/accounts', () => ({ accountHandle: async () => ({ ok: true, value: 'nova' }) }));
vi.mock('@/lib/site-mode', () => ({ readSiteMode: async () => ({ waitlistMode: false }) }));
vi.mock('@/components/design/AppNav', () => ({ AppNav: () => <nav data-testid="rail" /> }));
vi.mock('@/components/design/Reveals', () => ({ Reveals: () => null }));
vi.mock('@/components/shell/SiteFooter', () => ({ SiteFooter: () => <footer /> }));
vi.mock('@/components/shell/RightRail', () => ({ RightRail: () => <div data-testid="discover" /> }));
/*
  The wallet control needs the signer provider, which needs a wallet registry. What is under test
  here is that the frame gives it a place on every route, not what it does when clicked — that is
  `test/wallet-accounts.test.tsx`.
*/
vi.mock('@/components/WalletConnect', () => ({
  WalletConnect: () => <button type="button" data-testid="wallet-connect" />,
}));

const { SiteHeader } = await import('../components/shell/SiteHeader');
const { Breadcrumbs } = await import('../components/shell/Breadcrumbs');
const { MobileBar } = await import('../components/shell/MobileBar');
const { PageTabs } = await import('../components/shell/PageTabs');
const { AppShell, carriesItsOwnFrame } = await import('../components/shell/AppShell');
const { DESTINATIONS } = await import('../lib/site-map');

afterEach(() => {
  cleanup();
  pathname = '/explore';
  session = { ok: true, value: null };
});

describe('the header', () => {
  /*
    The bar a member sees and the bar a guest sees are different lists.

    A guest has no account, so `Money` and `You` are labels for rooms they cannot enter; their bar
    offers what there is to read instead. This case therefore renders a member — the reader for
    whom `Explore` is in the bar at all — and the guest's own bar is asserted below.
  */
  it('marks the section you are in, by attribute rather than colour alone', () => {
    pathname = '/c/nova';
    const { container } = render(<SiteHeader signedIn={true} myHandle="nova" />);
    const current = container.querySelectorAll('.sh-nav [aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Explore');
  });

  it('offers a guest what there is to read, not an account they do not have', () => {
    pathname = '/';
    const { container } = render(<SiteHeader signedIn={false} myHandle={null} />);
    const labels = [...container.querySelectorAll('.sh-nav > a, .sh-nav button')].map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toContain('Read the agents');
    expect(labels).not.toContain('Money');
    expect(labels).not.toContain('You');
  });

  it('lights nothing on a page outside the five sections', () => {
    pathname = '/purchases';
    const { container } = render(<SiteHeader signedIn={true} myHandle="nova" />);
    expect(container.querySelectorAll('.sh-nav [aria-current="page"]')).toHaveLength(0);
  });

  it('mounts the account control, the only place to sign in, out or switch address', () => {
    const { getByTestId } = render(<SiteHeader signedIn={false} myHandle={null} />);
    expect(getByTestId('account-menu')).toBeTruthy();
  });

  it('shows the bell to a member and not to a guest', () => {
    const guest = render(<SiteHeader signedIn={false} myHandle={null} />);
    expect(guest.container.querySelector('.sh-bell')).toBeNull();
    cleanup();
    const member = render(<SiteHeader signedIn={true} myHandle="nova" />);
    expect(member.container.querySelector('.sh-bell')).not.toBeNull();
  });

  it('drops the destinations when the site is gated, and says why', () => {
    /*
      No call to action here either: with the door shut the waiting list is the only page a visitor
      can reach, so a header button pointing at it would be a second copy of the page they are
      already on. The badge is what explains the missing nav.
    */
    const { container } = render(<SiteHeader signedIn={false} myHandle={null} gated />);
    expect(container.querySelector('.sh-nav')).toBeNull();
    expect(container.querySelector('a[href="/waitlist"]')).toBeNull();
    expect(container.querySelector('.sh-badge')?.textContent).toBe('closed alpha');
  });

  it('is laid out by class, never inline — so a media query can reach it', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/shell/SiteHeader.tsx'), 'utf8');
    expect(source).not.toMatch(/style=\{\{/);
  });
});

describe('the trail', () => {
  it('renders nothing on the home page', () => {
    pathname = '/';
    const { container } = render(<Breadcrumbs />);
    expect(container.innerHTML).toBe('');
  });

  it('links every ancestor and names the current page with aria-current', () => {
    pathname = '/c/nova';
    const { container } = render(<Breadcrumbs />);
    const links = [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Home', '/'],
      ['Explore', '/explore'],
    ]);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('@nova');
  });

  it('is a breadcrumb landmark', () => {
    pathname = '/purchases';
    const { container } = render(<Breadcrumbs />);
    expect(container.querySelector('nav[aria-label="Breadcrumb"] ol')).not.toBeNull();
  });
});

describe('the bottom bar', () => {
  it('gives a guest the front of the product and a way in', () => {
    /*
      The fourth slot is `/join`, not `/signin`.

      This test's own name asked for "a way in" and the assertion accepted a sign-in link, which is
      a door a stranger has no key to. `JOIN` existed in `lib/site-map.ts` and was referenced by no
      navigation list at all, so on a phone — where this bar is the only nav that survives scrolling
      — there was no route to an account anywhere on screen.
    */
    const { container } = render(<MobileBar signedIn={false} myHandle={null} />);
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/feed',
      '/explore',
      '/creators',
      '/join',
    ]);
    // Rendered from the JOIN constant, so the bar cannot drift from the header and the menu.
    expect(container.querySelector('a[href="/join"]')?.textContent).toBe('Join');
  });

  it("gives a member their alerts and their own page, or purchases when they have no handle", () => {
    const withHandle = render(<MobileBar signedIn={true} myHandle="nova" />);
    expect(withHandle.container.querySelector('a[href="/c/nova"]')?.textContent).toBe('Me');
    cleanup();
    const without = render(<MobileBar signedIn={true} myHandle={null} />);
    expect(without.container.querySelector('a[href="/purchases"]')?.textContent).toBe('Me');
  });

  it('marks the current destination', () => {
    pathname = '/explore';
    const { container } = render(<MobileBar signedIn={false} myHandle={null} />);
    expect(container.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/explore');
  });

  it('offers only the two open doors while the site is gated', () => {
    const { container } = render(<MobileBar signedIn={false} myHandle={null} gated />);
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/waitlist',
      '/signin',
    ]);
  });
});

describe('page tabs', () => {
  it('lets a page decide which tab is current, for tabs that differ by query', () => {
    pathname = '/feed';
    const { container } = render(
      <PageTabs
        label="Feed view"
        items={[
          { label: 'Following', href: '/feed?view=following', current: false },
          { label: 'Everything', href: '/feed?view=all', current: true },
        ]}
      />,
    );
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Everything');
  });
});

describe('every address the shell hard-codes exists', () => {
  // Renaming a route keeps every other test green and leaves a dead link in the chrome.
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const dir = resolve(process.cwd(), 'components/shell');
  for (const file of readdirSync(dir)) {
    it(`${file}`, () => {
      const source = readFileSync(resolve(dir, file), 'utf8');
      const hrefs = [...source.matchAll(/href(?:=|:\s*)['"](\/[^'"?$]*)['"]/g)].map((m) => m[1]!);
      for (const href of hrefs) {
        expect(DESTINATIONS.has(href), `${file} links to ${href}, which is not on the map`).toBe(true);
      }
    });
  }
});

/**
 * One frame, on every route.
 *
 * There were two: a set of rebuilt screens drawing the application frame, and everything else
 * wearing an older header, logo, footer, mobile bar and trail. Clicking from the feed to `/signin`
 * crossed between them, which read as two products stitched together. What is pinned here is that
 * the second one is gone — not merely preferred, not merely default: never rendered.
 */
describe('the frame', () => {
  async function shell() {
    return render(await AppShell({ children: <p>page</p> }));
  }

  it('wraps a route that does not build its own', async () => {
    session = { ok: true, value: null };
    const { getByText, container } = await shell();
    expect(getByText('page')).toBeTruthy();
    expect(container.querySelector('nav.w-rail')).not.toBeNull();
    expect(container.querySelector('nav.w-bottom')).not.toBeNull();
  });

  it('carries the footer, on a page that has none of its own', async () => {
    const { container } = await shell();
    const foot = container.querySelector('footer.w-foot');
    expect(foot).not.toBeNull();
    expect(foot?.querySelector('a[href="/legal/terms"]')).not.toBeNull();
  });

  it('offers the wallet control to a guest, on every route it wraps', async () => {
    session = { ok: true, value: null };
    const { getByTestId } = await shell();
    expect(getByTestId('wallet-connect')).toBeTruthy();
  });

  it('names the member in the rail on a proved session', async () => {
    session = { ok: true, value: '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b' };
    const { container } = await shell();
    expect(container.querySelector('a.w-rail__account')?.textContent).toContain('nova');
  });

  it('treats a failed session read as a guest, never as a member', async () => {
    session = { ok: false, failure: { kind: 'transport' } };
    const { container } = await shell();
    expect(container.querySelector('a.w-rail__account')).toBeNull();
  });

  it('has exactly one main landmark, the skip-link target', async () => {
    const { container } = await shell();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main')?.id).toBe('w-main');
  });

  it('is mounted once, from the root layout, around every route', () => {
    const layout = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('<AppShell>{children}</AppShell>');
  });
});

/**
 * Which routes build their own frame, and — the part that was wrong — which do not.
 *
 * The list used to be matched as a prefix, so `/agents` covered `/agents/build` and
 * `/agents/declare`. Those pages build no frame, were handed through as though they did, and
 * rendered with no navigation at all: a page with no way out of itself.
 */
describe('routes that build their own frame', () => {
  it('recognises the screens that do', () => {
    for (const path of ['/', '/feed', '/explore', '/creators', '/agents', '/alerts', '/messages', '/studio', '/vault', '/c/nova', '/p/0xabc']) {
      expect(carriesItsOwnFrame(path), `${path} builds its own frame`).toBe(true);
    }
  });

  it('does not mistake a sub-route for one', () => {
    for (const path of ['/agents/build', '/agents/declare', '/agents/nova', '/explore/agents', '/vault/0xabc', '/signin', '/join', '/creator', '/earnings', '/purchases', '/security', '/legal/terms']) {
      expect(carriesItsOwnFrame(path), `${path} must be wrapped`).toBe(false);
    }
  });

  it('wraps when there is no request to ask — an extra frame is fixable, a missing one is not', () => {
    expect(carriesItsOwnFrame(null)).toBe(false);
  });

  /*
    Every framed path above must be a page that actually renders `AppFrame`, or the list is a lie
    and those routes lose their navigation. Read from the files rather than trusted.
  */
  it('every framed path is a page that renders the frame', () => {
    const { existsSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const app = resolve(process.cwd(), 'app');
    /** Where a URL path's page file lives, allowing for the route groups above it. */
    function pageFor(urlPath: string): string | null {
      const rest = urlPath === '/' ? '' : urlPath.slice(1);
      const direct = resolve(app, rest, 'page.tsx');
      if (existsSync(direct)) return direct;
      for (const entry of readdirSync(app)) {
        if (!entry.startsWith('(')) continue;
        const grouped = resolve(app, entry, rest, 'page.tsx');
        if (existsSync(grouped)) return grouped;
      }
      return null;
    }

    for (const path of ['/', '/feed', '/explore', '/creators', '/agents', '/alerts', '/messages', '/studio', '/vault']) {
      const file = pageFor(path);
      expect(file, `${path} has no page`).not.toBeNull();
      /*
        Followed one import deep: several of these pages are a few lines that hand off to a view
        (`/feed` → `FeedView` → `FeedApp`), and the frame is in the view.
      */
      const source = readFileSync(file as string, 'utf8');
      const reaches =
        /components\/app\//.test(source) ||
        [...source.matchAll(/from '@\/(components\/[^']+)'/g)].some(([, mod]) => {
          const dep = resolve(process.cwd(), `${mod}.tsx`);
          return existsSync(dep) && /components\/app\//.test(readFileSync(dep, 'utf8'));
        });
      expect(reaches, `${path} is listed as framed but does not reach components/app`).toBe(true);
    }
  });
});

/**
 * The old chrome renders nowhere.
 *
 * The files still exist — deleting them is a separate change with its own blast radius — but
 * nothing in the application may mount them. This is the guard that stops one of them creeping
 * back into a layout and putting a second header on a page again.
 */
describe('the old chrome', () => {
  it('is imported by no page, layout or shell', () => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const retired = ['SiteHeader', 'SiteFooter', 'MobileBar', 'Breadcrumbs', 'RightRail', 'AppNav'];
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        // A retired component may still import its neighbours; only live code is checked.
        if (retired.some((name) => entry === `${name}.tsx`)) continue;
        const source = readFileSync(full, 'utf8');
        for (const name of retired) {
          if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(source)) {
            offenders.push(`${full.replace(process.cwd(), '')} imports ${name}`);
          }
        }
      }
    }

    walk(resolve(process.cwd(), 'app'));
    walk(resolve(process.cwd(), 'components/shell'));
    expect(offenders).toEqual([]);
  });
});
