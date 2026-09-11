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
vi.mock('@/components/design/Reveals', () => ({ Reveals: () => null }));
vi.mock('@/components/shell/SiteFooter', () => ({ SiteFooter: () => <footer /> }));
/*
  The wallet control needs the signer provider, which needs a wallet registry. What is under test
  here is that the frame gives it a place on every route, not what it does when clicked — that is
  `test/wallet-accounts.test.tsx`.
*/
vi.mock('@/components/WalletConnect', () => ({
  WalletConnect: () => <button type="button" data-testid="wallet-connect" />,
}));
/*
  The discovery column reads the store and is an async server component; a test renderer cannot
  await one. What is under test here is that the frame HAS a rail on every wrapped route, not what
  the rail found — `test/backing.test.ts` and the store's own tests cover the reads.
*/
vi.mock('@/components/shell/Discovery', () => ({
  Discovery: () => <div data-testid="discovery" />,
}));

const { PageTabs } = await import('../components/shell/PageTabs');
const { AppShell, carriesItsOwnFrame, isPublicPage } = await import('../components/shell/AppShell');
const { DESTINATIONS } = await import('../lib/site-map');

afterEach(() => {
  cleanup();
  pathname = '/explore';
  session = { ok: true, value: null };
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
  /*
    A route that does NOT build its own frame, so the shell wraps it.

    The chrome is chosen from `usePathname()` now, not from a request header, because a root layout
    is rendered once and reused for every client-side navigation beneath it — so a choice made from
    a header was a choice made on the first paint of the session and never revisited. Measured
    before the change: clicking "Explore" from `/security` left the public header on screen with the
    application rail drawn inside it, two `<main>` elements and two footers; clicking "Security"
    from `/explore` produced a page with no chrome at all.

    This block's pathname therefore has to be a wrapped one. The file's default is `/explore`, which
    builds its own.
  */
  const wrapped = '/earnings';
  async function shell() {
    pathname = wrapped;
    return render(await AppShell({ children: <p>page</p> }));
  }

  afterEach(() => { pathname = '/explore'; });

  it('follows the pathname, so a client-side navigation changes the chrome', async () => {
    /*
      The defect this whole indirection exists for. Same layout render, three pathnames, three
      answers — because the answer is computed where `usePathname()` can change it.
    */
    session = { ok: true, value: null };
    const frame = await AppShell({ children: <p>page</p> });

    pathname = '/earnings';
    const wrappedRender = render(frame);
    expect(wrappedRender.container.querySelector('nav.w-rail')).not.toBeNull();
    expect(wrappedRender.container.querySelector('.w-land__bar')).toBeNull();
    cleanup();

    pathname = '/security';
    const publicRender = render(frame);
    expect(publicRender.container.querySelector('.w-land__bar')).not.toBeNull();
    expect(publicRender.container.querySelector('nav.w-rail')).toBeNull();
    cleanup();

    pathname = '/feed';
    const ownRender = render(frame);
    expect(ownRender.container.querySelector('nav.w-rail')).toBeNull();
    expect(ownRender.container.querySelector('.w-land__bar')).toBeNull();
    expect(ownRender.getByText('page')).toBeTruthy();
  });

  it('reads a trailing slash as the same route', async () => {
    /*
      `/vault` and `/vault/` are one route and were not one string, so a trailing slash fell through
      every exact match and got the wrapped frame ON TOP of the frame `/vault` builds for itself.
      Two rails, from a slash.
    */
    expect(carriesItsOwnFrame('/vault/')).toBe(true);
    expect(carriesItsOwnFrame('/feed/')).toBe(true);
    expect(isPublicPage('/security/')).toBe(true);
    expect(isPublicPage('/legal/terms/')).toBe(true);
  });

  it('wraps a route that does not build its own', async () => {
    session = { ok: true, value: null };
    const { getByText, container } = await shell();
    expect(getByText('page')).toBeTruthy();
    expect(container.querySelector('nav.w-rail')).not.toBeNull();
    expect(container.querySelector('nav.w-bottom')).not.toBeNull();
    /*
      And the discovery column. Without it these pages rendered a 640px column with 372px of blank
      ground beside it on every route that had not been rebuilt — which is most of what made a
      populated product look deserted.
    */
    expect(container.querySelector('aside.w-aside')).not.toBeNull();
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

  it('gives a proved session the account menu, not a link to its own page', async () => {
    /*
      The rail used to name the member in a plain `a.w-rail__account` pointing at their creator
      page. That link was the whole of the account area, so a signed-in reader could not see which
      address they were signed in as, switch to another the wallet holds, or sign out — `AccountMenu`
      holds all three and nothing mounted it. It is mocked in this file; that it is MOUNTED is the
      assertion.
    */
    session = { ok: true, value: '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b' };
    const { container, getByTestId } = await shell();
    expect(getByTestId('account-menu')).toBeTruthy();
    expect(container.querySelector('a.w-rail__account')).toBeNull();
  });

  it('treats a failed session read as a guest, never as a member', async () => {
    session = { ok: false, failure: { kind: 'transport' } };
    const { container, queryByTestId } = await shell();
    expect(container.querySelector('a.w-rail__account')).toBeNull();
    expect(queryByTestId('account-menu')).toBeNull();
  });

  it('gives the rail a Publish that goes somewhere', async () => {
    /*
      It was `<button onClick={onPublish}>` and the frame passes no `onPublish`, so the rail's most
      prominent control did nothing when pressed. Publishing is `/studio`.
    */
    session = { ok: true, value: '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b' };
    const { container } = await shell();
    const publish = container.querySelector('.w-rail__publish');
    expect(publish?.tagName).toBe('A');
    expect(publish?.getAttribute('href')).toContain('/studio');
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
    for (const path of ['/', '/feed', '/explore', '/explore/agents', '/creators', '/agents', '/alerts', '/messages', '/studio', '/vault', '/c/nova', '/p/0xabc']) {
      expect(carriesItsOwnFrame(path), `${path} builds its own frame`).toBe(true);
    }
  });

  it('does not mistake a sub-route for one', () => {
    /*
      `/explore/agents` is no longer here: it was rebuilt onto `packages/ui` and draws its own frame
      now, so it moved to the list above. A sub-route is still not framed by its parent — the point
      of this test — which `/agents/build` and the rest still prove.
    */
    for (const path of ['/agents/build', '/agents/declare', '/agents/nova', '/vault/0xabc', '/signin', '/join', '/creator', '/earnings', '/purchases', '/security', '/legal/terms']) {
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
    /*
      They are deleted now, not merely unmounted, so this walks for their NAMES rather than their
      imports: an import of a file that does not exist fails the build, but a new component called
      `SiteHeader` reintroducing the second header is exactly the thing this was written to catch,
      and it would compile.
    */
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
