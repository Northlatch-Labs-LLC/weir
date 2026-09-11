// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * Proving who is *reading*, not just who is claiming to.
 *
 * # The hole this closes
 *
 * `readEntitlements(address)` asks the chain what that address owns, and `canRead` decides from the
 * answer. Both are right. Neither can tell whether the caller *is* that address — and four call
 * sites took it straight out of `?reader=` in the URL.
 *
 * Buyers are enumerable from public chain events, so anyone could name one and be served their post
 * bodies, their paid comments, and their decrypted media. Encryption at rest did not help: this
 * server holds the blob key and decrypts before responding, so the request handler was the only
 * gate there was.
 *
 * The mistake was not in the entitlement code. It was believing that because an address cannot
 * *forge* ownership, naming one grants nothing. The attacker never forges ownership — they borrow
 * the entitlement of somebody who genuinely has it. A confused deputy.
 *
 * # Why a cookie, when nothing else here is a session
 *
 * `identity.ts` says, correctly, "this is not a session — nothing is stored, nothing is issued, and
 * there is nothing to steal". That stance is right for writes and it does not survive contact with
 * reads, for one mechanical reason: media is fetched by `<img src>`, which cannot carry a POST body
 * or a header. The proof has to travel in something the browser attaches on its own.
 *
 * A signature in the query string was the alternative, and it loses on how this application is
 * built rather than on theory: `Shell.withReader` appends `?reader=` to every link in the frame, so
 * people sharing a page would paste their own live credential into chats and issue trackers. It
 * would also land in access logs and `Referer` headers.
 *
 * So this *is* a bearer token, and the honest thing is to say so and bound it:
 *
 *   - It grants **reads only**. Every write still requires a fresh single-use signature through
 *     `verifyAction`. A stolen session cannot post, spend, unlock, or follow.
 *   - It grants **only what the address already owns**. The chain is still consulted per request;
 *     this merely settles *whose* entitlements to ask about.
 *   - It is `HttpOnly`, so script cannot read it, and `SameSite=Lax`, so another origin cannot
 *     navigate a browser into using it.
 *   - It expires, and it is revocable — which `?reader=` never was.
 *
 * # The token is never stored
 *
 * The row holds `sha256(token)`. Anyone who reads `read_sessions` learns which sessions exist and
 * can impersonate none of them. Same reasoning as `used_signatures`, and the same reason the
 * lookup is by digest rather than by a value we could accidentally log.
 *
 * # The same session, carried in a header, for callers that are not browsers
 *
 * A program holding a key is the case the cookie was never shaped for. It has no cookie jar it
 * wants to keep, no `<img src>` problem to solve, and no browser to attach anything on its own —
 * and telling it to parse `Set-Cookie` and replay the value is asking it to reimplement a browser
 * to obtain a credential we already handed it.
 *
 * So {@link provenReaderFor} accepts `Authorization: Bearer <token>` as well. Four things are worth
 * being precise about, because the boundary is the whole value here:
 *
 *   - **It is the same session.** Same row, same `sha256(token)` lookup, same expiry compared in
 *     the query, same revocation by address. There is no second table, no second lifetime and no
 *     second authority. A token revoked by `DELETE /api/session` is dead in both carriers at once,
 *     because there is only one thing to revoke.
 *   - **It grants exactly what the cookie grants: reads, and only of what that address already owns
 *     on chain.** Every write still requires a fresh single-use signature through `verifyAction`.
 *     None of the bounds above is relaxed by a byte.
 *   - **The cookie decides whenever a cookie is present**, and the header is consulted only in its
 *     absence. A browser sends no `Authorization` header, so nothing about a browser request
 *     changes — same query, same answer, same number of queries.
 *   - **The header is not a weaker carrier than the cookie; on one axis it is stronger.**
 *     `Authorization` is not a CORS-safelisted request header, so another origin cannot make a
 *     browser attach it without a preflight this application does not answer. It is immune to the
 *     cross-site request the cookie needs `SameSite=Lax` to refuse.
 *
 * What *did* change, and it belongs here rather than in a commit message: `POST /api/session` now
 * returns the token in its JSON body as well as in `Set-Cookie`. `HttpOnly` still keeps script from
 * reading the stored cookie, but a script that runs *during* a mint can now read the response — so
 * cross-site scripting on this origin, which could already act as the reader through the ambient
 * cookie, can additionally lift a token and use it elsewhere for a day. That is a real widening of
 * a narrow window, it is the price of machine callers, and it is written down rather than implied.
 */

import { cache } from 'react';
import { createHash, randomBytes } from 'node:crypto';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { db, normaliseAddress } from './db';

/**
 * The cookie's name.
 *
 * Deliberately not `session`: this is not one in the sense anybody expects. It authenticates a
 * reader and authorises nothing.
 */
export const READ_SESSION_COOKIE = 'projectx_read';

/**
 * How long a proof of readership lasts.
 *
 * Two hours. It was a day, and the argument for a day was about prompt fatigue — re-prompting
 * people mid-session is how they learn to approve prompts without reading them. That argument is
 * real and it is not the whole account: a day means somebody comes back the next morning, connects
 * a wallet out of habit, and the site names them without asking for anything. Nothing was
 * authorised that should not have been, and it still reads as the site having kept hold of them.
 *
 * Two hours is longer than a sitting and shorter than a memory. Signing out ends it immediately —
 * `DELETE /api/session`, from the account menu in the rail.
 *
 * That last clause used to read "the same reasoning `isSingleUse` gives for not spending read
 * signatures". `isSingleUse` no longer gives it: reads are spent like every other kind, because the
 * exemption was reasoned from the signer's side and ignored what the same bytes are worth to
 * somebody who intercepted them.
 */
export const READ_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** What the row holds. The token itself never reaches the database. */
function digestOf(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Pull one cookie out of a `Cookie` header.
 *
 * Written here rather than reached for from `next/headers` because route handlers receive a plain
 * `Request`, and a pure function over the header is the part worth testing: parsing is where a
 * lookalike name (`projectx_reader`) or a value containing `=` goes wrong.
 */
export function cookieFromHeader(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    // Only the first `=` separates. A base64url token contains none, but a future value might.
    const value = part.slice(separator + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

/**
 * The scheme a machine caller presents the same token under. Matched case-insensitively, as
 * RFC 7235 requires of an auth scheme.
 */
export const READ_SESSION_SCHEME = 'Bearer';

/**
 * Pull the token out of an `Authorization` header.
 *
 * Written as a pure function over the header for the same reason {@link cookieFromHeader} is:
 * parsing is where this goes wrong, and a route handler receives a plain `Request`.
 *
 * Every rejection below returns `null` rather than a failure, because a header we do not understand
 * is not an error — it is a caller who is not presenting one of our sessions, which is anonymous.
 * Returning a failure would turn somebody else's `Authorization: Basic …` into a 503 on a public
 * page.
 *
 *   - A different scheme is not ours. `Basic`, `Negotiate` and a bare token with no scheme all
 *     yield nothing.
 *   - Anything with whitespace inside the credential is refused. Our tokens are base64url, which
 *     contains none; a value with a space in it is either an auth-param we do not implement or a
 *     malformed header, and guessing which by taking the first word is how a parser accepts a
 *     credential its author never meant to send.
 */
export function bearerFromHeader(header: string | null): string | null {
  if (header === null) return null;

  const separator = header.indexOf(' ');
  if (separator === -1) return null;
  if (header.slice(0, separator).toLowerCase() !== READ_SESSION_SCHEME.toLowerCase()) return null;

  // 1*SP is legal between the scheme and the credential, so the remainder is trimmed rather than
  // sliced at a single space.
  const token = header.slice(separator + 1).trim();
  if (token === '' || /\s/.test(token)) return null;
  return token;
}

/**
 * Issue a session for an address whose signature has **already been verified**.
 *
 * This function does not check anything. It cannot: it has no signature, no statement and no
 * timestamp. The only caller is `POST /api/session`, immediately after `verifyAction` returns ok,
 * and that ordering is the whole of the security argument. Calling it anywhere else would mint a
 * session for an unproven address, which is the vulnerability it was written to close.
 */
export async function mintReadSession(
  address: string,
): Promise<{ token: string; expiresAtMs: number }> {
  // 32 bytes from the CSPRNG. base64url so it survives as a cookie value with no escaping.
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAtMs = now + READ_SESSION_TTL_MS;

  await db().query(
    `INSERT INTO read_sessions (digest, address, expires_at_ms, created_at_ms)
     VALUES ($1, $2, $3, $4)`,
    [digestOf(token), normaliseAddress(address), expiresAtMs, now],
  );

  /*
    Sweep what can no longer matter. Opportunistic rather than scheduled, and bounded, exactly as
    `verifyAction` sweeps `used_signatures`: this application has no cron, and a table that only
    grows is how a cheap guard becomes the slowest statement here.
  */
  await db().query(
    `DELETE FROM read_sessions
     WHERE digest IN (SELECT digest FROM read_sessions WHERE expires_at_ms <= $1 LIMIT 500)`,
    [now],
  );

  return { token, expiresAtMs };
}

/**
 * The address a token speaks for.
 *
 * `ok(address)` — proved. `ok(null)` — we looked, and this caller is anonymous. `fail(…)` — we
 * could not look.
 *
 * # Why the third case is not folded into the second
 *
 * It is the difference between "you have not bought this" and "we could not check", and only one of
 * those is a paywall. Returning `null` for both was this module's first shape, and it reproduced a
 * defect this application had already fixed once: `readEntitlements` used to report a partial read
 * as an absence, and a reader holding 51 unlocks was told to buy content they already owned. It
 * failed closed, so nothing leaked — it charged a real customer twice instead.
 *
 * A caller that cannot tell the two apart must eventually resolve the ambiguity in one direction or
 * the other, and one of those directions releases paid content on a failed lookup. The type refuses
 * to let them guess.
 *
 * The expiry is compared in the query rather than trusted to the sweep. The sweep is an
 * optimisation; an unswept row must never be able to grant anything.
 */
export async function readerFromToken(token: string | null): Promise<Reading<string | null>> {
  // No cookie is a complete and certain answer: this caller is anonymous. It also costs no query,
  // which keeps an unauthenticated request from spending the read budget on everybody's behalf.
  if (token === null) return ok(null);

  const source = 'read session';
  try {
    const { rows } = await db().query<{ address: string }>(
      'SELECT address FROM read_sessions WHERE digest = $1 AND expires_at_ms > $2',
      [digestOf(token), Date.now()],
    );
    // A token matching no live row *is* a complete answer — expired, or withdrawn. Both mean
    // anonymous rather than unknown, so both are `ok`.
    return ok(rows[0]?.address ?? null);
  } catch (error) {
    return fail(
      'transport',
      source,
      `this session could not be read, so the reader could not be identified: ${
        opaqueDetail(source, error)
      }`,
    );
  }
}

/**
 * The proven reader behind a route handler's request, or `null` for anonymous.
 *
 * **This is the only thing that may decide whose entitlements to read.** `?reader=` survives as a
 * hint to the interface about which account is connected; it has no authority and never had any.
 *
 * # Two carriers, one credential
 *
 * The cookie, for browsers, which is the only thing an `<img src>` can carry. `Authorization:
 * Bearer`, for programs, which have no browser to attach anything on their own. Both hand the same
 * token to the same {@link readerFromToken}, so there is one lookup, one expiry and one revocation
 * — see the file header for why that sameness is the point rather than a convenience.
 *
 * # The cookie wins whenever there is one, and that ordering is deliberate
 *
 * Not a preference between the two. It is what makes "a browser behaves exactly as it did" a
 * property rather than a hope: a browser sends no `Authorization` header, so it never reaches the
 * second line, and no browser request gained a branch, a query or an outcome it did not have
 * before.
 *
 * There is no fallback from a cookie that resolves to nobody, either — an expired or withdrawn
 * cookie is a complete answer, and *then* consulting a header would mean the credential that
 * decided is not the credential the caller led with. One request, one carrier, one answer.
 */
export async function provenReaderFor(request: Request): Promise<Reading<string | null>> {
  const cookie = cookieFromHeader(request.headers.get('cookie'), READ_SESSION_COOKIE);
  if (cookie !== null) return readerFromToken(cookie);
  return readerFromToken(bearerFromHeader(request.headers.get('authorization')));
}

/**
 * The same answer, for a server component, which has no `Request` to read.
 *
 * `next/headers` is imported where it is used rather than at the top of the file. It throws unless
 * it is called inside a request scope, and a static import would drag that constraint into every
 * module that only wanted `cookieFromHeader` — including the unit tests, which have no request and
 * are precisely where the cookie parsing is worth testing.
 *
 * # Cookie only, and left that way on purpose
 *
 * This one resolves the reader for a *rendered page*. A machine caller reads JSON from the routes,
 * where {@link provenReaderFor} accepts the header — so adding it here would widen the surface for
 * a caller that does not exist yet, in the path that renders bodies into HTML. If an agent ever
 * needs server-rendered pages, this is a deliberate change to make then, with the same test.
 */
export const provenReader = cache(async (): Promise<Reading<string | null>> => {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return readerFromToken(store.get(READ_SESSION_COOKIE)?.value ?? null);
});

/**
 * Withdraw every session an address holds.
 *
 * Sign-out, and the answer to "one of these was stolen". `?reader=` had no equivalent: there was
 * nothing to withdraw, because nothing had been issued.
 */
export async function revokeReadSessions(address: string): Promise<void> {
  await db().query('DELETE FROM read_sessions WHERE address = $1', [normaliseAddress(address)]);
}

/**
 * The `Set-Cookie` value carrying a freshly minted session.
 *
 * `secure` is derived from the request rather than from `NODE_ENV`, because what actually decides
 * whether a browser stores the cookie is the scheme it was served over. A `Secure` cookie is
 * silently dropped on plain http, which on a development machine looks exactly like the sign-in
 * having failed for some deeper reason.
 */
export function readSessionCookie(input: {
  token: string;
  expiresAtMs: number;
  secure: boolean;
}): string {
  const maxAgeSeconds = Math.max(0, Math.floor((input.expiresAtMs - Date.now()) / 1000));
  return [
    `${READ_SESSION_COOKIE}=${input.token}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: a paid post reached from a link in somebody's feed reader is an ordinary way
    // to arrive, and Strict would render it locked until the visitor navigated a second time. Lax
    // still refuses to attach the cookie to a cross-site POST, which is where it would matter.
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(input.secure ? ['Secure'] : []),
  ].join('; ');
}

/** The header that clears it. Same attributes, no lifetime — a browser only drops an exact match. */
export function clearedReadSessionCookie(secure: boolean): string {
  return [
    `${READ_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
