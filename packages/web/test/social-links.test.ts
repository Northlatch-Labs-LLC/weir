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
 * That is also the finding worth writing down. `SOCIAL` now has exactly one consumer, and it is
 * JSON-LD. Nothing in the live application renders these links where a person can see them, so the
 * only thing on this site that says where to follow the work is metadata addressed to crawlers.
 */

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
