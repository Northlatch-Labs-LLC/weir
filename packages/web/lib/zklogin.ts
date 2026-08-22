// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * zkLogin: an account from a Google sign-in, with no wallet and no seed phrase.
 *
 * # Why this exists
 *
 * Everything this platform does is reachable only after someone installs a browser extension and
 * writes down twelve words. Most people will not, and the ones who will are already served by four
 * other products. zkLogin removes both steps: a person signs in with an account they already have,
 * and the address they get is an ordinary Sui address that the contracts already accept. No
 * contract changed for this. Not one.
 *
 * # What is actually happening
 *
 * A zkLogin address is derived from the OpenID claims (`iss`, `aud`, `sub`) plus a per-user *salt*.
 * To spend from it you present a zero-knowledge proof that you hold a JWT matching those claims,
 * wrapped around a signature from an *ephemeral* keypair that the proof is bound to. The proof is
 * valid only up to `maxEpoch`, after which the session is dead and a new sign-in is needed.
 *
 * Three secrets, and it matters which is which:
 *
 *  - the **ephemeral private key**, generated in the browser, never sent anywhere;
 *  - the **JWT**, which Google returns in the URL *fragment* — so it never reaches a web server
 *    as part of the redirect, and only goes to ours because we choose to send it;
 *  - the **salt**, which this deployment derives (see `zklogin-server.ts`).
 *
 * Holding any one of them is not enough to move money. The salt alone identifies an address; it
 * does not control it. That distinction is the whole reason the salt can be derived server-side at
 * all, and it is stated again where the derivation happens.
 *
 * # This file is isomorphic on purpose
 *
 * No `server-only`, no `client-only`. The ephemeral keypair and the nonce must be generated in the
 * browser — a nonce minted on a server would let that server sit in the middle of every session —
 * while the JWT verification and the salt derivation must not be. Keeping the pure, shared parts
 * here means the drift tests can exercise them without a DOM or a network.
 */

import { fail, ok, type Reading } from '@projectx-social/sdk';

/**
 * The claim that names the user inside their JWT.
 *
 * `sub` is Google's stable per-user, per-client identifier. The alternative the protocol allows is
 * `email`, and it is a trap: an email address can be reassigned by a workspace administrator, and
 * whoever receives it next would derive the *same* Sui address and inherit the funds. `sub` never
 * moves between people.
 */
export const KEY_CLAIM_NAME = 'sub' as const;

/**
 * Google's issuer values.
 *
 * Two of them, because Google has emitted both spellings for years and a token carrying the bare
 * form is not a forgery. Accepting only one would reject a genuine sign-in intermittently, which
 * is the kind of bug that gets diagnosed as "flaky login" for a month.
 */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;

/**
 * Collapse the two spellings to one, before anything derives from the issuer.
 *
 * **This is not cosmetic and skipping it loses people's money.** `iss` feeds the salt, the salt
 * feeds the address seed, and the seed feeds the address. Google emits both spellings, so without
 * this the same person signing in twice can land on two different addresses — funds split across
 * them, each perfectly valid, with nothing raising an error.
 *
 * The SDK already normalises inside `computeZkLoginAddressFromSeed`, which is what makes the bug
 * so quiet: the *address parameter* agrees while the *seed* does not, so the mismatch survives
 * every check that compares an address to itself.
 */
export function normaliseIssuer(iss: string): string {
  if (iss === 'accounts.google.com') return 'https://accounts.google.com';
  return iss;
}

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * How many epochs a session stays valid.
 *
 * A Sui epoch is roughly 24 hours, so two epochs is between one and two days depending on where in
 * the current epoch the session starts. That range is deliberate and is the security parameter of
 * the whole scheme: the ephemeral key sits in browser storage, and `maxEpoch` is the only thing
 * that stops a copy of it being useful forever.
 *
 * Raising this buys convenience with exactly one currency — the window in which a stolen
 * `sessionStorage` entry can still sign. Two is the value the protocol documentation uses in its
 * own example, and going beyond it should be a decision somebody argues for, not a default that
 * drifted upward.
 */
export const MAX_EPOCH_WINDOW = 2n;

/** Where the browser keeps a session across the OAuth redirect. */
export const SESSION_STORAGE_KEY = 'projectx.zklogin.session';

/**
 * What the browser must remember while the user is away at Google.
 *
 * This survives a full page navigation, so it is stored — and everything in it is chosen to be
 * safe at rest for the length of one sign-in *except* `ephemeralSecretKey`, which is not. That is
 * why it lives in `sessionStorage` rather than `localStorage`: closing the tab discards it, and it
 * is never readable from another origin.
 */
export interface PendingSession {
  /** Bech32 `suiprivkey1…` form of the ephemeral key. Secret. */
  ephemeralSecretKey: string;
  /** Decimal string. Public, but must match what the nonce committed to. */
  jwtRandomness: string;
  maxEpoch: number;
  /** Echoed back by Google inside the JWT; a mismatch means the token is for a different session. */
  nonce: string;
  /** Where to return the user once the session completes. */
  returnTo: string;
}

/** A completed session: everything needed to construct a signer. */
export interface ActiveSession extends PendingSession {
  address: string;
  jwt: string;
  salt: string;
  /** The proof, as returned by the proving service. Opaque here; typed at the SDK boundary. */
  proofPoints: unknown;
  issBase64Details: unknown;
  headerBase64: string;
  addressSeed: string;
}

/**
 * The Google authorization URL.
 *
 * ```text
 * https://accounts.google.com/o/oauth2/v2/auth
 *   ?client_id=$CLIENT_ID
 *   &response_type=id_token
 *   &redirect_uri=$REDIRECT_URL
 *   &scope=openid
 *   &nonce=$NONCE
 * ```
 * — Sui zkLogin integration guide, quoted verbatim so review is a comparison and not a memory test.
 *
 * `response_type=id_token` is the implicit flow, and here that is a feature rather than the usual
 * compromise: the token comes back in the URL *fragment*, which browsers do not transmit to the
 * server. There is no authorization code to exchange, no client secret anywhere, and no server-side
 * callback that sees the token before the user's own browser does.
 *
 * `scope=openid` and nothing else. This asks Google for an identity assertion and no access to
 * anything — not the profile, not the email, not a single API. Asking for more would be asking for
 * data this platform has no use for and would then have to be trusted to protect.
 */
export function buildAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  nonce: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('nonce', input.nonce);
  return url.toString();
}

/**
 * Pull the identity token out of the fragment Google redirected to.
 *
 * Google signals failure in the same fragment (`error=access_denied`), and a user who declined at
 * the consent screen must not see a parse failure — that reads as a broken site rather than as the
 * thing they just chose. So a declared error is surfaced as itself.
 */
export function readIdTokenFromFragment(fragment: string): Reading<string> {
  const source = 'the sign-in redirect';
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);

  const declared = params.get('error');
  if (declared !== null) {
    const description = params.get('error_description');
    return fail('malformed', source, description ?? declared);
  }

  const token = params.get('id_token');
  if (token === null) {
    return fail('malformed', source, 'no identity token came back from the sign-in');
  }
  // Three dot-separated segments. Checked before anything downstream splits on '.' and indexes
  // blindly, which is how a truncated token becomes an undefined that reaches the verifier.
  if (token.split('.').length !== 3) {
    return fail('malformed', source, 'the identity token is not a well-formed JWT');
  }
  return ok(token);
}

/**
 * Read the claims of a JWT **without verifying it**.
 *
 * Deliberately named so no call site can mistake it for verification, because it is exactly the
 * function that would be misused that way. It exists for one job: letting the browser show which
 * account is about to be used before the round trip. Every security decision — deriving a salt,
 * accepting a session — uses `verifyGoogleIdToken` on the server instead.
 */
export function readUnverifiedClaims(
  jwt: string,
): Reading<{ iss: string; aud: string; sub: string; nonce?: string; email?: string }> {
  const source = 'identity token claims';
  const segments = jwt.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined) {
    return fail('malformed', source, 'the identity token is not a well-formed JWT');
  }
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payload));
    const claims = JSON.parse(json) as Record<string, unknown>;
    // `aud` is `string | string[]` in the OIDC spec. Google issues a single audience for an id_token,
    // and an array here would mean a token shaped for a flow this code does not implement — so it
    // is refused rather than silently reduced to its first element.
    if (
      typeof claims['iss'] !== 'string' ||
      typeof claims['aud'] !== 'string' ||
      typeof claims['sub'] !== 'string'
    ) {
      return fail('malformed', source, 'the token is missing iss, aud or sub');
    }
    return ok({
      iss: claims['iss'],
      aud: claims['aud'],
      sub: claims['sub'],
      ...(typeof claims['nonce'] === 'string' ? { nonce: claims['nonce'] } : {}),
      ...(typeof claims['email'] === 'string' ? { email: claims['email'] } : {}),
    });
  } catch (error) {
    return fail('malformed', source, error instanceof Error ? error.message : String(error));
  }
}

/** base64url → bytes. No padding, `-_` alphabet, per RFC 7515. */
export function base64UrlDecode(text: string): Uint8Array {
  const normalised = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The exact payload the proving service expects.
 *
 * ```json
 * { "jwt", "extendedEphemeralPublicKey", "maxEpoch", "jwtRandomness", "salt", "keyClaimName" }
 * ```
 * — Sui zkLogin integration guide. Every field is a string except `maxEpoch`. This is an untyped
 * positional-by-name boundary with no compiler between us and it, which is why the shape is
 * asserted by a test rather than trusted.
 */
export interface ProveRequest {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName: typeof KEY_CLAIM_NAME;
}

/** The proving service's response, before `addressSeed` is attached to make signer inputs. */
export interface ProveResponse {
  proofPoints: { a: string[]; b: string[][]; c: string[] };
  issBase64Details: { value: string; indexMod4: number };
  headerBase64: string;
}

/**
 * Check a proving-service response before it is used to build a signer.
 *
 * A prover that returns 200 with a body shaped differently — a proxy error page, an HTML challenge,
 * a truncated JSON — would otherwise flow into `ZkLoginSigner` and fail at signing time with an
 * error about BCS serialisation, several steps from the cause.
 */
export function checkProveResponse(body: unknown): Reading<ProveResponse> {
  const source = 'the proving service';
  const b = body as Partial<ProveResponse> | null | undefined;
  const points = b?.proofPoints;
  const iss = b?.issBase64Details;

  if (
    points === undefined ||
    !Array.isArray(points.a) ||
    !Array.isArray(points.b) ||
    !Array.isArray(points.c)
  ) {
    return fail('malformed', source, 'the response carried no usable proofPoints');
  }
  if (iss === undefined || typeof iss.value !== 'string' || typeof iss.indexMod4 !== 'number') {
    return fail('malformed', source, 'the response carried no usable issBase64Details');
  }
  if (typeof b?.headerBase64 !== 'string') {
    return fail('malformed', source, 'the response carried no headerBase64');
  }
  return ok({ proofPoints: points, issBase64Details: iss, headerBase64: b.headerBase64 });
}

/**
 * `maxEpoch` from the epoch the chain reports.
 *
 * Takes the current epoch as a `bigint` because that is what the chain read returns, and returns a
 * `number` because that is what `ZkLoginSigner` and the prover both take. The conversion is done
 * here, once, where the bound can be checked — an epoch is far below `Number.MAX_SAFE_INTEGER`
 * today and will be for longer than this code will live, but the assertion costs nothing and the
 * alternative is a silent precision loss in a value that gates spending.
 */
export function maxEpochFrom(currentEpoch: bigint): Reading<number> {
  const source = 'max epoch';
  if (currentEpoch <= 0n) {
    return fail('malformed', source, `the chain reported epoch ${currentEpoch}`);
  }
  const max = currentEpoch + MAX_EPOCH_WINDOW;
  if (max > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail('malformed', source, 'the epoch is too large to represent exactly');
  }
  return ok(Number(max));
}

/**
 * Is this session still able to sign?
 *
 * Expiry is checked against the chain's epoch, never against wall-clock time. Epochs do not
 * advance on a fixed schedule, so a clock-based guess would be wrong in both directions: offering
 * a dead session, or refusing a live one.
 */
export function sessionExpired(session: { maxEpoch: number }, currentEpoch: bigint): boolean {
  return currentEpoch > BigInt(session.maxEpoch);
}
