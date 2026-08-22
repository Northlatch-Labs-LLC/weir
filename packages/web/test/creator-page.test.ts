// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The support vault belongs to an account, and the page must say so.
 *
 * # The defect this pins
 *
 * A support vault is opened against a `SocialAccount`, so it belongs to the address behind a page,
 * not to the page. The creator page finds it by `profile.owner` — which is right — and then wrote
 * "Park SUI in {profile.displayName}'s vault".
 *
 * A creator with two pages therefore had the *same* vault presented on both, each claiming it under
 * a different name. Somebody reading the second page believed they were backing something separate
 * from the first, and a deposit from either landed in the same object. Nothing looked broken; both
 * pages rendered perfectly.
 *
 * # Why this is asserted against the source
 *
 * The page is an async server component that reads the chain and the store, so rendering it here
 * would mean standing up both. What regressed is one interpolation, and that is visible in the
 * source — the same approach `admin.test.ts` takes to the multisig recipe.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(new URL('../app/c/[handle]/page.tsx', import.meta.url), 'utf8');

const CARD = (() => {
  const start = PAGE.indexOf('sui: ownerName');
  const end = PAGE.indexOf('onDeposit', start) === -1 ? PAGE.length : PAGE.indexOf('/>', PAGE.indexOf('depositNote', start));
  if (start === -1) throw new Error('the support vault attribution was not found');
  return PAGE.slice(start, end);
})();

describe('attributing the support vault', () => {
  it('names the account rather than this page', () => {
    // `ownerName` is the account's reverse-resolved name, falling back to its address. Both are
    // properties of the owner, and both stay the same across every page that owner publishes.
    expect(CARD).toContain('ownerName ?? shortId(profile.owner)');
  });

  it('never attributes the vault to the page it happens to be rendered on', () => {
    /*
      The exact regression. `profile.displayName` is per-page, so interpolating it here makes two
      pages of one creator each claim the same on-chain object as their own.
    */
    expect(CARD).not.toContain('profile.displayName');
  });

  it('tells the reader the vault is shared across that account’s pages', () => {
    // Without this, seeing it twice reads as a duplicate rather than as one vault seen from two
    // pages — which is the confusion that surfaced the bug in the first place.
    expect(CARD).toMatch(/belongs to that account rather than to this page/i);
  });

  it('still finds the vault by owner, not by creator vault', () => {
    /*
      Guards the fix against being "corrected" in the wrong direction. Filtering by the creator
      vault would hide a real support vault from every page but one, and hiding a vault from people
      who would fund it is worse than showing it on two.
    */
    expect(PAGE).toContain('v.creator.toLowerCase() === profile.owner.toLowerCase()');
  });
});
