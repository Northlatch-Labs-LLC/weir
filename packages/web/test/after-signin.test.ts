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

import { describe, expect, it } from 'vitest';
import { afterSignIn, FEED } from '../lib/after-signin';

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

  it('does not send a reader back to a door they have just come through', () => {
    expect(afterSignIn('/signin')).toBe(FEED);
    expect(afterSignIn('/join')).toBe(FEED);
    expect(afterSignIn('/auth/callback')).toBe(FEED);
  });
});
