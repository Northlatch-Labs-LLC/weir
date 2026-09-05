// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The footer's Copyright link has to land on something.
 *
 * So this renders the real document with the real renderer and looks for the id. No copy of the
 * slug rule lives here — a second implementation could agree with itself and disagree with `Prose`.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prose } from '../components/legal/Prose';
import { COPYRIGHT, FOOTER } from '../lib/site-map';

const terms = readFileSync(join(process.cwd(), 'content/legal/terms.md'), 'utf8');

const [path, fragment] = COPYRIGHT.href.split('#');

describe('the copyright link resolves', () => {
  it('points into the Terms, at a fragment', () => {
    expect(path).toBe('/legal/terms');
    expect(fragment).toBeTruthy();
  });

  it('lands on a heading that exists in the rendered document', () => {
    const { container } = render(<Prose source={terms} />);
    /*
      An attribute selector, not `#id`. The anchor begins with a digit — "7-content-moderation…" —
      and a CSS identifier may not, so `querySelector('#7-…')` is a syntax error rather than a miss.
      The id is still valid HTML and fragment navigation is not CSS, so the link itself works; only
      a selector written the obvious way does not.
    */
    const target = container.querySelector(`[id="${fragment}"]`);
    expect(target, `no heading renders with id "${fragment}" — the footer link scrolls nowhere`).not.toBeNull();
    expect(target?.textContent).toContain('Content moderation');
  });

  it('lands on the section that carries the designated agent', () => {
    const section = terms.split(/^## /m).find((part) => part.startsWith('7.'));
    expect(section, 'no section 7 in the Terms').toBeDefined();
    expect(section).toContain('designated agent');
    expect(section).toContain('17 U.S.C. § 512(c)(3)');
  });
});

describe('the footer carries it', () => {
  it('lists Copyright alongside the three documents', () => {
    expect(FOOTER.legal.map((d) => d.label)).toEqual([
      'Terms of service',
      'Privacy policy',
      'Creator terms',
      'Copyright',
    ]);
  });

  it('is a citation, not a destination — it must stay out of the page map', async () => {
    /*
      `DESTINATIONS` is the list of routes and a sibling test asserts every key in it resolves to a
      page. A fragment href would fail that, correctly: this is a link into a page already on the
      map, not a page of its own.
    */
    const { DESTINATIONS } = await import('../lib/site-map');
    expect(DESTINATIONS.has(COPYRIGHT.href)).toBe(false);
  });
});
