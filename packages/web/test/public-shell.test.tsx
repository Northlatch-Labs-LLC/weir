// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
      '/agents/reference',
      '/agents/declare',
      '/legal/terms',
      '/legal/privacy',
      '/legal/creator-terms',
    ]) {
      expect(isPublicPage(path), `${path} is read before you have an account`).toBe(true);
    }
  });

  it('leaves the product alone', () => {
    for (const path of ['/feed', '/explore', '/creators', '/agents', '/vault', '/studio', '/alerts', '/messages', '/c/wren', '/p/0xabc', '/earnings', '/purchases']) {
      expect(isPublicPage(path), `${path} is part of the product`).toBe(false);
    }
  });

  it('never claims a page belongs to both shells', () => {
    for (const path of ['/', '/feed', '/security', '/join', '/legal/terms', '/c/wren', '/agents/build']) {
      expect(isPublicPage(path) && carriesItsOwnFrame(path), `${path} is in both shells`).toBe(false);
    }
  });

  it('wraps an unknown page rather than treating it as public', () => {
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
    for (const href of ['/explore', '/explore/agents', '/agents/build', '/signin', '/join']) {
      expect(hrefs, `the header lost ${href}`).toContain(href);
    }
    expect(hrefs).not.toContain('/security');
  });

  it('marks where you are', () => {
    pathname = '/explore';
    const { container } = render(<PublicHeader />);
    const current = container.querySelectorAll('.w-land__nav [aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe('/explore');
  });

  it('does not offer the page you are already on', () => {
    pathname = '/join';
    expect(
      [...render(<PublicHeader />).container.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).not.toContain('/join');

    pathname = '/signin';
    expect(
      [...render(<PublicHeader />).container.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).not.toContain('/signin');
  });

  it('opens a menu rather than hiding the links', () => {
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
