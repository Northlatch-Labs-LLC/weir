// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The accounts this site claims as its own.
 *
 * A link to a social account is a claim about identity: whoever follows it should land on us. The
 * three destinations are pinned here as exact strings, so a typo, a lookalike handle or a renamed
 * organisation fails in CI rather than on a stranger's screen.
 *
 * # What changed, and what it means for this file
 *
 * These used to be asserted by rendering `SiteFooter` and reading its Follow column. That footer
 * was part of the site shell the application replaced, and it has been deleted — so the assertions
 * about its markup are gone with it, and this pins what survived: the list itself, which
 * `lib/structured-data.ts` publishes as the organisation's `sameAs`.
 *
 * For a while after that delete, `SOCIAL` had exactly one consumer and it was JSON-LD — so the only
 * thing on this site saying where to follow the work was metadata addressed to crawlers, and a
 * person reading the page could not reach any of the accounts. The public footer carries them
 * again, and the last case below is what stops that happening a second time.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOCIAL } from '../lib/social-links';

const X_URL = 'https://x.com/weirsocial';
const GITHUB_URL = 'https://github.com/Northlatch-Labs-LLC';
const MOLTBOOK_URL = 'https://www.moltbook.com/u/weirsocial';

describe('the accounts we claim', () => {
  it('are exactly our X account, our GitHub organisation and our Moltbook account, in that order', () => {
    expect(SOCIAL.map((link) => link.href)).toEqual([X_URL, GITHUB_URL, MOLTBOOK_URL]);
  });

  it('each carry a name and the handle they resolve to, because a bare URL names nobody', () => {
    for (const link of SOCIAL) {
      expect(link.name.trim().length).toBeGreaterThan(0);
      expect(link.handle.trim().length).toBeGreaterThan(0);
    }
  });

  it('are all https, since every one of them is a claim rendered to strangers', () => {
    for (const link of SOCIAL) {
      expect(link.href.startsWith('https://')).toBe(true);
    }
  });
});

describe('a person can actually reach them', () => {
  /*
    Read as source rather than rendered.

    `PublicShell` is a client component wired to `usePathname`, and standing a router up to assert
    three anchors tests the router. What has to hold is narrower and this is the whole of it: the
    footer maps the shared list instead of carrying its own copy. A hand-typed footer is how a
    `sameAs` and a visible link end up naming different accounts, and the one nobody can see is the
    one that stays wrong.
  */
  const footer = readFileSync(join(process.cwd(), 'components/public/PublicShell.tsx'), 'utf8');

  it('renders the accounts in the public footer', () => {
    expect(footer).toMatch(/SOCIAL\.map\(/);
    expect(footer).toMatch(/aria-label="Follow"/);
  });

  it('reads them from the list the metadata reads, rather than repeating the URLs', () => {
    for (const link of SOCIAL) {
      expect(footer, `${link.href} is typed into the footer instead of read from SOCIAL`).not.toContain(
        link.href,
      );
    }
  });

  it('opens them safely, because every one of them leaves this site', () => {
    expect(footer).toMatch(/rel="noreferrer"/);
  });
});
