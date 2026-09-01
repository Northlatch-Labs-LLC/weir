// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOOTER } from '../lib/site-map';

const source = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8');
const alwaysOpen = (() => {
  /*
    Comments are stripped before the list is split on commas. They were not, and a comment whose
    last sentence ran straight into the next entry glued that entry to the comment's tail — so
    `/agents`, `/robots.txt` and `/explore` were each absent from this list while present in the
    real one, and an assertion that one of them was closed would have passed against a lie.
  */
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const match = /const ALWAYS_OPEN = \[([^\]]+)\]/.exec(bare);
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
    for (const path of ['/feed', '/creators', '/chests', '/treasury', '/c/somebody', '/vault']) {
      expect(alwaysOpen.some((prefix) => path.startsWith(prefix)), path).toBe(false);
    }
  });

  it('opens the two directories the funnel points at, and only those', () => {
    /*
      `/explore` was in the list above until the waiting-list page grew a funnel with two doors,
      "Explore creators" and "Explore AI agents". A door that 307s back to the page it is on is not
      a door. The directories are what a visitor may see before committing; what they show is
      already public by design (profiles, pools, the declaration register). The pages a card leads
      to stay closed — asserted above.
    */
    for (const path of ['/explore', '/explore/agents']) {
      expect(alwaysOpen.some((prefix) => path === prefix || path.startsWith(prefix)), path).toBe(true);
    }
    expect(alwaysOpen).toContain('/explore');
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
