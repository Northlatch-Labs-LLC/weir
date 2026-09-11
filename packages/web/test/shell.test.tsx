// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
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

let session: { ok: true; value: string | null } | { ok: false; failure: unknown } = { ok: true, value: null };
vi.mock('@/lib/read-session', () => ({ provenReader: async () => session }));
vi.mock('@/lib/accounts', () => ({ accountHandle: async () => ({ ok: true, value: 'nova' }) }));
vi.mock('@/lib/site-mode', () => ({ readSiteMode: async () => ({ waitlistMode: false }) }));
vi.mock('@/components/design/Reveals', () => ({ Reveals: () => null }));
vi.mock('@/components/shell/SiteFooter', () => ({ SiteFooter: () => <footer /> }));
vi.mock('@/components/WalletConnect', () => ({
  WalletConnect: () => <button type="button" data-testid="wallet-connect" />,
}));
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

describe('the frame', () => {
  const wrapped = '/earnings';
  async function shell() {
    pathname = wrapped;
    return render(await AppShell({ children: <p>page</p> }));
  }

  afterEach(() => { pathname = '/explore'; });

  it('follows the pathname, so a client-side navigation changes the chrome', async () => {
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

describe('routes that build their own frame', () => {
  it('recognises the screens that do', () => {
    for (const path of ['/', '/feed', '/explore', '/explore/agents', '/creators', '/agents', '/alerts', '/messages', '/studio', '/vault', '/c/nova', '/p/0xabc']) {
      expect(carriesItsOwnFrame(path), `${path} builds its own frame`).toBe(true);
    }
  });

  it('does not mistake a sub-route for one', () => {
    for (const path of ['/agents/build', '/agents/declare', '/agents/nova', '/vault/0xabc', '/signin', '/join', '/creator', '/earnings', '/purchases', '/security', '/legal/terms']) {
      expect(carriesItsOwnFrame(path), `${path} must be wrapped`).toBe(false);
    }
  });

  it('wraps when there is no request to ask — an extra frame is fixable, a missing one is not', () => {
    expect(carriesItsOwnFrame(null)).toBe(false);
  });

  it('every framed path is a page that renders the frame', () => {
    const { existsSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const app = resolve(process.cwd(), 'app');
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
