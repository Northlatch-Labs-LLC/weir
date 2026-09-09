// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A page you read before you have an account has a way back to the page you came from.
 *
 * # The defect
 *
 * Every route wore the application frame. Click "How the money works" on the front page and you
 * landed on `/security` inside a navigation rail listing Vault, Studio, Messages and Alerts — eight
 * rooms a visitor cannot enter — with the front page's own nav gone and the mark linking to
 * `/feed`. There was no route back to where you came from, on any informational page in the
 * product. Nothing was broken, nothing 404'd, and the site was a dead end.
 *
 * # Why the classification is tested rather than the render
 *
 * `AppShell` is an async server component that reads the session; what decides this is the route
 * list, and a list is worth pinning exactly. The rendered half — that the header carries a home
 * link and the nav — is asserted below against `PublicHeader` directly.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/security';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { isPublicPage, carriesItsOwnFrame } = await import('../components/shell/AppShell');
const { PublicHeader, PublicFooter } = await import('../components/public/PublicShell');

afterEach(cleanup);

describe('which pages are read before you have an account', () => {
  it('names them', () => {
    for (const path of [
      '/security',
      '/disclosure',
      '/waitlist',
      '/signin',
      '/join',
      '/add-funds',
      '/agents/build',
      '/agents/declare',
      '/legal/terms',
      '/legal/privacy',
      '/legal/creator-terms',
    ]) {
      expect(isPublicPage(path), `${path} is read before you have an account`).toBe(true);
    }
  });

  it('leaves the product alone', () => {
    /*
      The rail belongs on these. A feed, a vault and a studio are places you are, not pages you
      read, and they are useless without the navigation between them.
    */
    for (const path of ['/feed', '/explore', '/creators', '/agents', '/vault', '/studio', '/alerts', '/messages', '/c/wren', '/p/0xabc', '/earnings', '/purchases']) {
      expect(isPublicPage(path), `${path} is part of the product`).toBe(false);
    }
  });

  it('never claims a page belongs to both shells', () => {
    // Two shells on one route is the defect this whole split exists to remove.
    for (const path of ['/', '/feed', '/security', '/join', '/legal/terms', '/c/wren', '/agents/build']) {
      expect(isPublicPage(path) && carriesItsOwnFrame(path), `${path} is in both shells`).toBe(false);
    }
  });

  it('wraps an unknown page rather than treating it as public', () => {
    // A new route that nobody classified gets the product's frame, which has navigation in it. The
    // failure mode of guessing wrong in the other direction is a page with no way out.
    expect(isPublicPage('/something-new')).toBe(false);
    expect(isPublicPage(null)).toBe(false);
  });
});

describe('the public header', () => {
  it('goes home, which is the thing that was missing', () => {
    pathname = '/security';
    const { container } = render(<PublicHeader />);
    const home = container.querySelector('a.w-land__brand');
    expect(home?.getAttribute('href')).toBe('/');
  });

  it('carries the nav a visitor arrived through', () => {
    const { container } = render(<PublicHeader />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const href of ['/creators', '/explore/agents', '/agents/build', '/signin', '/join']) {
      expect(hrefs, `the header lost ${href}`).toContain(href);
    }
    /*
      And not `/security`. A link about custody in the primary nav answers a question the visitor
      has not asked; every comparable platform keeps trust material in the footer, which is where
      this one is.
    */
    expect(hrefs).not.toContain('/security');
  });

  it('marks where you are', () => {
    pathname = '/creators';
    const { container } = render(<PublicHeader />);
    const current = container.querySelectorAll('.w-land__nav [aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe('/creators');
  });

  it('opens a menu rather than hiding the links', () => {
    /*
      Under 834px the plain links are display:none. Without this button that left a phone visitor
      with a wordmark and one button and no route to anything the site says about itself.
    */
    const { container } = render(<PublicHeader />);
    const button = container.querySelector('button.w-land__menu');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#w-public-menu')?.hasAttribute('data-open')).toBe(false);

    fireEvent.click(button as Element);
    expect(container.querySelector('button.w-land__menu')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#w-public-menu')?.hasAttribute('data-open')).toBe(true);
  });
});

describe('the public footer', () => {
  it('offers every public destination, so the foot of the page is not a dead end either', () => {
    const { container } = render(<PublicFooter />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const href of ['/explore', '/creators', '/agents', '/security', '/legal/terms', '/legal/privacy', '/disclosure']) {
      expect(hrefs, `the footer lost ${href}`).toContain(href);
    }
  });
});
