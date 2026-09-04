// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The one-click unsubscribe token, and the header that carries its link.
 *
 * `weir.social/waitlist` promises, in these words: "Your email is used to tell you when the doors
 * open and for nothing else — one click unsubscribes." Until this file existed the second half of
 * that sentence was a promise the code could not keep: `app/api` had no unsubscribe route, and the
 * word appeared once, in a comment. Nothing may be sent to that list until the promise is real,
 * so this is the first half of making it real and `app/unsubscribe/route.ts` is the second.
 *
 * # No `server-only`, and no local imports
 *
 * Two callers need these functions and they run in different worlds: the route handler, compiled by
 * Next, and `scripts/send-waitlist-email.mjs`, a plain Node process that mints one link per
 * recipient. Node resolves this file directly by its `.ts` path and strips the types, which works
 * only while the file imports nothing but the standard library — so it does, and it will not gain a
 * local import.
 *
 * `server-only` is left off for the same reason, and it is safe to leave off because nothing here
 * reads the environment. Every function takes the secret as an argument; the two places that read
 * `WEIR_EMAIL_TOKEN_SECRET` out of the environment are the route and the script, each of which is
 * already server-side by construction. A module that held the read would be a module a client
 * component could import.
 *
 * # What the token is
 *
 * The address, and an HMAC-SHA256 over it under a purpose string. That is all it is, and the two
 * properties that matter follow from it:
 *
 *  - **It cannot be forged.** Without the secret, no address can be turned into a working link, so
 *    nobody can unsubscribe somebody else — and, just as important, nobody can walk the list by
 *    trying addresses and watching which links work. Every link answers the same way.
 *  - **It is single-purpose.** {@link UNSUBSCRIBE_PURPOSE} is inside the signed bytes, so the same
 *    secret used later for some other signed link cannot produce a token this accepts, and a token
 *    from here cannot be replayed at whatever that other thing turns out to be.
 *
 * # There is no expiry, deliberately
 *
 * An unsubscribe link that stops working is a promise with a footnote. Somebody who finds the mail
 * a year later and wants out must get out, and the link in that mail is the only thing they have.
 * The token grants exactly one power — removing its own address from a mailing list — and that
 * power does not become more dangerous with age.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The domain separator inside every signature.
 *
 * Versioned, so that if the token shape ever changes the old shape stops verifying rather than
 * being reinterpreted under new rules.
 */
export const UNSUBSCRIBE_PURPOSE = 'weir.waitlist.unsubscribe.v1';

/** Where the link points. `proxy.ts` exempts this path, or the link 307s to the waiting list. */
export const UNSUBSCRIBE_PATH = '/unsubscribe';

/** The environment variable holding the signing secret. The NAME lives here; the value never does. */
export const UNSUBSCRIBE_SECRET_VAR = 'WEIR_EMAIL_TOKEN_SECRET';

/**
 * The shortest secret this will accept.
 *
 * HMAC-SHA256 takes a key of any length and a short one is a weak one. Thirty-two characters is the
 * width of the digest itself; anything less is a key an attacker could search, and a searched key
 * is a forged unsubscribe for every address somebody cares to guess.
 */
export const MIN_SECRET_LENGTH = 32;

/**
 * The secret, or a refusal that says which variable is missing and never what is in it.
 *
 * Refusing loudly rather than defaulting: a default secret would make every deployment's links
 * verify on every other deployment, and a missing one would otherwise surface as "this link is not
 * valid" to a person trying to leave a list — the failure mode this whole file exists to prevent.
 */
export function requireSecret(value: string | undefined): string {
  const secret = (value ?? '').trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${UNSUBSCRIBE_SECRET_VAR} must be set to at least ${MIN_SECRET_LENGTH} characters. ` +
        'It signs the unsubscribe links in every message sent to the waiting list, so a missing ' +
        'or short value means those links can be forged or cannot be honoured.',
    );
  }
  return secret;
}

/** The signature over one encoded payload, base64url, no padding. */
function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${UNSUBSCRIBE_PURPOSE}:${payload}`, 'utf8')
    .digest('base64url');
}

/**
 * A token for one address.
 *
 * The address is signed exactly as it is given. This module does not decide what an address is:
 * `db/014_waitlist.sql` carries `CHECK (email = lower(email))`, so a row's address is already the
 * canonical one, and re-canonicalising here would be a second opinion able to drift from the
 * column's. What goes in is what comes out.
 */
export function mintUnsubscribeToken(email: string, secret: string | undefined): string {
  const key = requireSecret(secret);
  if (email === '') throw new Error('an unsubscribe token needs an address to be about');
  const payload = Buffer.from(email, 'utf8').toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

/**
 * The address inside a token, or `null` if the token was not minted here.
 *
 * `null` for every failure — a wrong signature, a wrong purpose, a wrong secret, a token cut in
 * half, a token with an extra dot — because the caller has nothing different to do about any of
 * them and the reader on the other end has nothing to learn from being told which.
 *
 * The comparison is `timingSafeEqual`. A byte-at-a-time comparison leaks, through timing, how much
 * of a guessed signature was right, which turns forging one into a few thousand requests.
 */
export function readUnsubscribeToken(token: string, secret: string | undefined): string | null {
  const key = requireSecret(secret);

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (payload === undefined || signature === undefined) return null;
  if (payload === '' || signature === '') return null;

  const expected = Buffer.from(sign(payload, key), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  // Length first: `timingSafeEqual` throws on a mismatch rather than returning false.
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  const email = Buffer.from(payload, 'base64url').toString('utf8');
  return email === '' ? null : email;
}

/**
 * The link that goes in the message.
 *
 * `origin` is passed in rather than read from anywhere, because the one thing that must never
 * happen is a production message carrying a link to a development host — and the way that happens
 * is a module guessing an origin from an environment that was not set.
 */
export function unsubscribeUrl(origin: string, email: string, secret: string | undefined): string {
  const base = origin.replace(/\/+$/, '');
  if (base === '') throw new Error('an unsubscribe link needs the origin it will be opened at');
  const token = mintUnsubscribeToken(email, secret);
  return `${base}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * The two headers that make a mail client show its own unsubscribe button.
 *
 * RFC 2369 gives `List-Unsubscribe`; RFC 8058 adds `List-Unsubscribe-Post`, whose exact value is
 * fixed by the specification and is the difference between a client offering one click and a client
 * offering a link. Both are returned together, because a `List-Unsubscribe` without the POST header
 * asks the reader to visit a page, and the page is what these headers exist to spare them.
 *
 * No `mailto:` variant is offered. The convention allows one and a client will prefer it, and Weir
 * has no mailbox anybody reads — `dmca@weir.social` is a route, not an inbox. Advertising an
 * unsubscribe address that nobody opens is worse than advertising none.
 *
 * The URL is refused if it carries anything that could end a header line. A caller cannot reach
 * this with an attacker's string today, and header injection is not a class of bug worth leaving
 * one refactor away.
 */
export function listUnsubscribeHeaders(url: string): {
  'List-Unsubscribe': string;
  'List-Unsubscribe-Post': string;
} {
  if (url === '' || /[\s<>,]/.test(url)) {
    throw new Error('an unsubscribe URL for a header may not contain whitespace, <, > or a comma');
  }
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
