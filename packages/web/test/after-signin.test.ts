// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * Where a reader lands once they have signed in.
 *
 * # The defect
 *
 * Three places decided this — the sign-in page's `next` guard, the Google callback's fallback and
 * the panel's default — and all three said `/`. A reader who pressed Sign in on the front page
 * signed in and was put back on the front page, with nothing on it that was theirs. The signed-in
 * reader's home is the feed: their account in the rail, their alerts, their vault. One rule, used
 * by all three.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afterSignIn, FEED, isPathOnThisSite } from '../lib/after-signin';

/*
  Four strings that pass a check written on the raw string and still leave this site.

  A browser edits a URL before it resolves it: it deletes tab, line-feed and carriage-return
  wherever they appear, and reads `\` as `/`. Only then does it look for an authority. So each of
  these is `//evil.example` by the time anything decides where it goes, and each begins with a
  single `/` as far as `startsWith` can tell. The first two are also what the page receives from
  `?next=%2F%5Cevil.example` and `?next=%2F%09%2Fevil.example`, once the query string is decoded.
*/
const ANOTHER_ORIGIN = [
  ['a backslash where the second slash goes', '/\\evil.example'],
  ['a tab between the slashes', '/\t/evil.example'],
  ['a line feed between the slashes', '/\n/evil.example'],
  ['a carriage return between the slashes', '/\r/evil.example'],
] as const;

describe('afterSignIn', () => {
  it('honours a path on this site', () => {
    expect(afterSignIn('/c/heron')).toBe('/c/heron');
    expect(afterSignIn('/p/pmt1?x=1#comments')).toBe('/p/pmt1?x=1#comments');
  });

  it('lands on the feed when nothing was asked for', () => {
    expect(afterSignIn(undefined)).toBe(FEED);
    expect(afterSignIn(null)).toBe(FEED);
    expect(afterSignIn('')).toBe(FEED);
  });

  it('lands on the feed rather than back on the front page', () => {
    expect(afterSignIn('/')).toBe(FEED);
  });

  it('lands on the feed rather than on another origin', () => {
    expect(afterSignIn('https://evil.example/steal')).toBe(FEED);
    expect(afterSignIn('//evil.example/steal')).toBe(FEED);
    expect(afterSignIn('javascript:alert(1)')).toBe(FEED);
  });

  it('lands on the feed rather than on another origin written the way a browser reads it', () => {
    for (const [spelling, asked] of ANOTHER_ORIGIN) {
      expect(afterSignIn(asked), spelling).toBe(FEED);
      expect(isPathOnThisSite(asked), spelling).toBe(false);
    }
  });

  it('and those really do leave: the check that was here passed every one of them', () => {
    for (const [spelling, asked] of ANOTHER_ORIGIN) {
      // What the guard used to ask, and what it used to answer.
      expect(asked.startsWith('/') && !asked.startsWith('//'), spelling).toBe(true);
      // Where a browser goes. The parser is the standard's; a browser runs the same steps.
      expect(new URL(asked, 'https://weir.social').origin, spelling).toBe('https://evil.example');
    }
  });

  it('and arrives in the query string encoded, so the decoded form is the one that matters', () => {
    const query = new URLSearchParams('next=%2F%5Cevil.example&tab=%2F%09%2Fevil.example');
    expect(query.get('next')).toBe(ANOTHER_ORIGIN[0][1]);
    expect(query.get('tab')).toBe(ANOTHER_ORIGIN[1][1]);
    expect(afterSignIn(query.get('next'))).toBe(FEED);
    expect(afterSignIn(query.get('tab'))).toBe(FEED);
  });

  it('keeps a path a browser does not rewrite: a space in a query, an encoded backslash in a path', () => {
    expect(isPathOnThisSite('/explore?q=some words')).toBe(true);
    expect(afterSignIn('/explore?q=some words')).toBe('/explore?q=some words');
    expect(isPathOnThisSite('/c/a%5Cb')).toBe(true);
    expect(isPathOnThisSite('/p/abc#//not-an-origin')).toBe(true);
  });

  it('refuses what does not parse at all', () => {
    expect(isPathOnThisSite('')).toBe(false);
    expect(isPathOnThisSite('feed')).toBe(false);
    expect(isPathOnThisSite('https:////')).toBe(false);
  });

  it('does not send a reader back to a door they have just come through', () => {
    expect(afterSignIn('/signin')).toBe(FEED);
    expect(afterSignIn('/join')).toBe(FEED);
    expect(afterSignIn('/auth/callback')).toBe(FEED);
  });
});

describe('the access-code panel asks the same question of `from`', () => {
  it('through the shared function, not a check of its own', () => {
    const panel = readFileSync(join(import.meta.dirname, '../components/app/WaitlistPanel.tsx'), 'utf8');
    expect(panel).toContain('isPathOnThisSite(back)');
    // The check that could be read past, gone from the panel.
    expect(panel).not.toContain("startsWith('//')");
    for (const source of ['app/signin/page.tsx', 'components/app/SigninPanel.tsx', 'app/(app)/auth/callback/page.tsx']) {
      expect(readFileSync(join(import.meta.dirname, '..', source), 'utf8')).not.toContain("startsWith('//')");
    }
  });
});
