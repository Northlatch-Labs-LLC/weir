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

const { SiteHeader } = await import('../components/shell/SiteHeader');
const { Breadcrumbs } = await import('../components/shell/Breadcrumbs');
const { MobileBar } = await import('../components/shell/MobileBar');
const { PageTabs } = await import('../components/shell/PageTabs');
const { AppShell } = await import('../components/shell/AppShell');
const { DESTINATIONS } = await import('../lib/site-map');

afterEach(() => {
  cleanup();
  pathname = '/explore';
  session = { ok: true, value: null };
});

describe('the header', () => {
  it('marks the section you are in, by attribute rather than colour alone', () => {
    pathname = '/c/nova';
    const { container } = render(<SiteHeader signedIn={false} myHandle={null} />);
    const current = container.querySelectorAll('.sh-nav [aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Explore');
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
    const { container } = render(<MobileBar signedIn={false} myHandle={null} />);
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/feed',
      '/explore',
      '/creators',
      '/signin',
    ]);
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
 * The shell opens the rail for members only, on a proved session.
 *
 * Rendered rather than read as source: what is pinned is the branch, and a failed read must land
 * on the guest side of it.
 */
describe('the shell', () => {
  async function shell() {
    return render(await AppShell({ children: <p>page</p> }));
  }

  it('renders neither rail for a guest', async () => {
    session = { ok: true, value: null };
    const { queryByTestId, getByText, container } = await shell();
    expect(queryByTestId('rail')).toBeNull();
    expect(container.querySelector('.weir-shell__rail')).toBeNull();
    expect(getByText('page')).toBeTruthy();
  });

  it('renders the menu rail and the discovery rail for a proved member', async () => {
    session = { ok: true, value: '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b' };
    const { getByTestId, container } = await shell();
    expect(getByTestId('rail')).toBeTruthy();
    expect(container.querySelector('aside.weir-shell__rail')).not.toBeNull();
  });

  it('treats a failed session read as a guest, never as a member', async () => {
    session = { ok: false, failure: { kind: 'transport' } };
    const { queryByTestId } = await shell();
    expect(queryByTestId('rail')).toBeNull();
  });

  it('has exactly one main landmark, the skip-link target', async () => {
    const { container } = await shell();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main')?.id).toBe('main');
  });

  it('is mounted once, from the root layout, around every route', () => {
    const layout = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('<AppShell>{children}</AppShell>');
    // No screen may bring its own header back.
    const design = resolve(process.cwd(), 'components/design');
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    for (const file of readdirSync(design)) {
      const source = readFileSync(resolve(design, file), 'utf8');
      expect(source, `${file} renders its own chrome`).not.toMatch(/<(DesignHeader|DesignFooter|SiteHeader|SiteFooter)\b/);
      expect(source, `${file} nests a second <main>`).not.toMatch(/<main[\s>]/);
    }
  });
});
