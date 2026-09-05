// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The unsubscribe token is the only thing standing between a mailing list and anybody who can guess
// an address. If it can be forged, one request takes a stranger off the list; if it cannot be
// verified, the promise on `weir.social/waitlist` — "one click unsubscribes" — is broken for the
// person holding a real link. Both failures are silent from the outside, so they are pinned here.
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  MIN_SECRET_LENGTH,
  UNSUBSCRIBE_PATH,
  UNSUBSCRIBE_PURPOSE,
  listUnsubscribeHeaders,
  mintUnsubscribeToken,
  readUnsubscribeToken,
  requireSecret,
  unsubscribeUrl,
} from '@/lib/email-token';

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH);
const OTHER_SECRET = 'b'.repeat(MIN_SECRET_LENGTH);
const ADDRESS = 'someone@example.com';

describe('a token round-trips, and only with the secret that made it', () => {
  it('gives back the address it was minted for', () => {
    const token = mintUnsubscribeToken(ADDRESS, SECRET);
    expect(readUnsubscribeToken(token, SECRET)).toBe(ADDRESS);
  });

  it('carries the address it signs and not somebody else’s', () => {
    const mine = mintUnsubscribeToken(ADDRESS, SECRET);
    const theirs = mintUnsubscribeToken('other@example.com', SECRET);
    expect(mine).not.toBe(theirs);
    expect(readUnsubscribeToken(theirs, SECRET)).toBe('other@example.com');
  });

  it('survives an address with the characters a real one has', () => {
    for (const address of ['first.last+tag@sub.domain.org', 'a@b.co', "o'brien@example.com"]) {
      const token = mintUnsubscribeToken(address, SECRET);
      expect(readUnsubscribeToken(token, SECRET), address).toBe(address);
      // Nothing in the token needs escaping once it is in a query string.
      expect(unsubscribeUrl('https://weir.social', address, SECRET)).toContain('token=');
    }
  });

  it('refuses a token minted under a different secret', () => {
    const token = mintUnsubscribeToken(ADDRESS, OTHER_SECRET);
    expect(readUnsubscribeToken(token, SECRET)).toBeNull();
  });

  it('refuses a token minted for a different purpose under the same secret', () => {
    /*
      The forgery a domain separator exists to stop: the same key, the same payload, a different
      purpose string. Without `UNSUBSCRIBE_PURPOSE` inside the signed bytes, any other signed link
      this deployment ever mints becomes an unsubscribe for whatever address it names.
    */
    const payload = Buffer.from(ADDRESS, 'utf8').toString('base64url');
    const elsewhere = createHmac('sha256', SECRET)
      .update(`weir.something.else.v1:${payload}`, 'utf8')
      .digest('base64url');
    expect(readUnsubscribeToken(`${payload}.${elsewhere}`, SECRET)).toBeNull();

    // And the real purpose, over the same bytes, does verify — so the test above is not vacuous.
    const right = createHmac('sha256', SECRET)
      .update(`${UNSUBSCRIBE_PURPOSE}:${payload}`, 'utf8')
      .digest('base64url');
    expect(readUnsubscribeToken(`${payload}.${right}`, SECRET)).toBe(ADDRESS);
  });
});

describe('a tampered token is refused', () => {
  const token = mintUnsubscribeToken(ADDRESS, SECRET);
  const [payload, signature] = token.split('.') as [string, string];

  it('refuses a changed address with the original signature', () => {
    const swapped = Buffer.from('attacker@example.com', 'utf8').toString('base64url');
    expect(readUnsubscribeToken(`${swapped}.${signature}`, SECRET)).toBeNull();
  });

  it('refuses a changed signature over the original address', () => {
    const flipped = signature[0] === 'A' ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    expect(readUnsubscribeToken(`${payload}.${flipped}`, SECRET)).toBeNull();
  });

  it('refuses every single-character edit of the whole token', () => {
    /*
      Not one hand-picked mutation. Every position, changed to something else, so a comparison that
      stopped early or ignored a suffix would show up as a token that still verified.
    */
    for (let i = 0; i < token.length; i += 1) {
      const at = token[i] as string;
      const swapped = at === 'x' ? 'y' : 'x';
      const mutated = `${token.slice(0, i)}${swapped}${token.slice(i + 1)}`;
      if (mutated === token) continue;
      expect(readUnsubscribeToken(mutated, SECRET), `position ${i}`).toBeNull();
    }
  });

  it('refuses what is not a token at all', () => {
    for (const bad of ['', '.', 'nodot', `${payload}.`, `.${signature}`, `${token}.extra`, token.slice(0, -1)]) {
      expect(readUnsubscribeToken(bad, SECRET), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the secret is required and is never echoed', () => {
  it('refuses a missing or short one', () => {
    for (const value of [undefined, '', '   ', 'a'.repeat(MIN_SECRET_LENGTH - 1)]) {
      expect(() => requireSecret(value)).toThrow(/WEIR_EMAIL_TOKEN_SECRET/);
    }
  });

  it('does not put the secret in the refusal', () => {
    // A short secret is still a secret, and a message that quotes it puts it in a log.
    const short = 'hunter2-hunter2';
    try {
      requireSecret(short);
      expect.unreachable('a short secret must be refused');
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
  });

  it('accepts one of exactly the minimum length', () => {
    expect(requireSecret(SECRET)).toBe(SECRET);
  });
});

describe('the link and the headers', () => {
  it('points at the path the proxy exempts', () => {
    const url = unsubscribeUrl('https://weir.social', ADDRESS, SECRET);
    expect(url.startsWith(`https://weir.social${UNSUBSCRIBE_PATH}?token=`)).toBe(true);
  });

  it('does not double the slash when the origin carries one', () => {
    expect(unsubscribeUrl('https://weir.social/', ADDRESS, SECRET)).toContain(
      `https://weir.social${UNSUBSCRIBE_PATH}?`,
    );
  });

  it('makes a link the route can read back', () => {
    const url = unsubscribeUrl('https://weir.social', ADDRESS, SECRET);
    const token = new URL(url).searchParams.get('token');
    expect(token).not.toBeNull();
    expect(readUnsubscribeToken(token as string, SECRET)).toBe(ADDRESS);
  });

  it('emits the two headers RFC 8058 fixes, with the value it fixes', () => {
    const url = unsubscribeUrl('https://weir.social', ADDRESS, SECRET);
    const headers = listUnsubscribeHeaders(url);
    expect(headers['List-Unsubscribe']).toBe(`<${url}>`);
    // The value is specified, not chosen. A mail client matches it literally.
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('refuses a URL that could end a header line', () => {
    for (const bad of ['', 'https://weir.social/a b', 'https://weir.social/a\nX: y', '<https://x>']) {
      expect(() => listUnsubscribeHeaders(bad), JSON.stringify(bad)).toThrow();
    }
  });
});
