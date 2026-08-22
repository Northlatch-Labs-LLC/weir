// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOOTER } from '../lib/site-map';

const source = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8');
const alwaysOpen = (() => {
  const match = /const ALWAYS_OPEN = \[([^\]]+)\]/.exec(source);
  return (match?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

describe('the closed-door exemptions', () => {
  it('found the list at all', () => {
    // Guards the guard: a rename would make every assertion below vacuous.
    expect(alwaysOpen.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the way in open', () => {
    for (const path of ['/waitlist', '/signin', '/auth/callback']) {
      expect(alwaysOpen, path).toContain(path);
    }
  });

  it('keeps every legal document reachable behind the gate', () => {
    for (const destination of FOOTER.legal) {
      expect(
        alwaysOpen.some((prefix) => destination.href.startsWith(prefix)),
        `${destination.href} would redirect to the waiting list`,
      ).toBe(true);
    }
  });

  it('keeps the share card reachable, or every shared link previews as nothing', () => {
    /*
      `og:image` and `twitter:image` both point at `/opengraph-image`. Gated, it answered 307 to the
      waiting list and the scraper got a redirect where a picture should be — so a link pasted into
      a chat client rendered with no preview at all, which reads as broken rather than closed.

      Asserted against the path the metadata actually emits rather than a remembered one: Next
      serves this route with a cache-busting query, and the exemption is matched on the pathname.
    */
    expect(alwaysOpen).toContain('/opengraph-image');
  });

  it('does not exempt the product itself, which is the point of the gate', () => {
    for (const path of ['/feed', '/explore', '/creators', '/chests', '/treasury']) {
      expect(alwaysOpen.some((prefix) => path.startsWith(prefix)), path).toBe(false);
    }
  });
});

describe('the pass', () => {
  it('is honoured after the operator check and before the redirect, and only while closed', () => {
    const admin = source.indexOf('isSiteAdmin(viewer)');
    const pass = source.indexOf('passIsValid(');
    const redirect = source.indexOf('NextResponse.redirect(');
    const open = source.indexOf('if (!mode.waitlistMode) return NextResponse.next();');
    expect(admin).toBeGreaterThan(-1);
    expect(pass).toBeGreaterThan(admin);
    expect(redirect).toBeGreaterThan(pass);
    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(pass);
  });
});
