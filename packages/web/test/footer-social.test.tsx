// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The footer names where to follow the work, and names the right accounts.
 *
 * A footer link to a social account is a claim about identity: a reader who follows it should land
 * on us. The three destinations are pinned here as exact URLs, so a typo, a lookalike handle or a
 * renamed organisation fails in CI rather than on a stranger's screen. They open in a new tab with
 * `noreferrer`, as every off-site link in this footer does, and they are present when the site is
 * gated too — a shut door still says where we are.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/shell/SiteHeader', () => ({ WeirMark: () => null }));

import { SOCIAL, SiteFooter } from '@/components/shell/SiteFooter';

const X_URL = 'https://x.com/weirsocial';
const GITHUB_URL = 'https://github.com/Northlatch-Labs-LLC';
const MOLTBOOK_URL = 'https://www.moltbook.com/u/weirsocial';

/** The deployment line's fetch, answering nothing: this file is about the links, not the ids. */
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));

afterEach(cleanup);

function followLinks(container: HTMLElement): HTMLAnchorElement[] {
  const nav = container.querySelector('nav[aria-label="Follow"]');
  expect(nav, 'the Follow column is rendered').not.toBeNull();
  return Array.from(nav!.querySelectorAll('a'));
}

describe('the Follow column', () => {
  it('links exactly our X account, our GitHub organisation and our Moltbook account', () => {
    const { container } = render(<SiteFooter />);
    expect(followLinks(container).map((a) => a.getAttribute('href'))).toEqual([X_URL, GITHUB_URL, MOLTBOOK_URL]);
  });

  it('shows the handle beside each name, so a reader can check it before leaving', () => {
    const { container } = render(<SiteFooter />);
    const text = followLinks(container).map((a) => a.textContent ?? '');
    expect(text[0]).toContain('X');
    expect(text[0]).toContain('@weirsocial');
    expect(text[1]).toContain('GitHub');
    expect(text[1]).toContain('Northlatch-Labs-LLC');
    expect(text[2]).toContain('Moltbook');
    expect(text[2]).toContain('@weirsocial');
  });

  it('opens off site in a new tab without a referrer, like every other off-site link here', () => {
    const { container } = render(<SiteFooter />);
    for (const a of followLinks(container)) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('stays on the shut door', () => {
    const { container } = render(<SiteFooter gated />);
    expect(followLinks(container).map((a) => a.getAttribute('href'))).toEqual([X_URL, GITHUB_URL, MOLTBOOK_URL]);
  });

  it('is the list the component exports, and that list is three entries', () => {
    // The column renders from `SOCIAL`; a fourth channel added there appears here, and one added
    // inline in the markup would not — so the two are held to each other.
    expect(SOCIAL.map((s) => s.href)).toEqual([X_URL, GITHUB_URL, MOLTBOOK_URL]);
  });
});
