// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The whole zkLogin pipeline, end to end, with no Google account and no proving service.
 *
 * # What this actually proves
 *
 * Everything between "user clicks sign in" and "we have a Sui address" runs here for real: an
 * ephemeral keypair, a nonce that commits to it, an authorization URL, a signed identity token,
 * signature verification, salt derivation, address-seed derivation and the address itself.
 *
 * Two things are simulated and it is worth being exact about which:
 *
 *  - **Google's signing key.** A locally generated RSA key stands in, served through a key set the
 *    verifier is pointed at. The *verification logic* is the real `jwtVerify` doing real RS256
 *    against a real JWKS; only the identity of the signer differs. That is what makes the rejection
 *    cases below meaningful — a test that could only ever produce rejected tokens would pass
 *    equally against a function that rejected everything, real users included.
 *  - **The proof.** Generating one needs the proving service. Nothing here fakes a proof, and no
 *    test in this file asserts anything about proof validity.
 *
 * # The address is checked two independent ways
 *
 * `jwtToAddress(jwt, salt)` and `computeZkLoginAddressFromSeed(genAddressSeed(...))` are separate
 * code paths through the SDK that must agree. The route uses the second because it needs the seed
 * anyway; this asserts it lands where the first says it should. A single-path test would confirm
 * only that the code does what it does.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import { createLocalJWKSet, exportJWK } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  computeZkLoginAddressFromSeed,
  genAddressSeed,
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  jwtToAddress,
} from '@mysten/sui/zklogin';
import {
  buildAuthUrl,
  KEY_CLAIM_NAME,
  normaliseIssuer,
  readIdTokenFromFragment,
  readUnverifiedClaims,
} from '../lib/zklogin';
import { deriveUserSalt, forgetProverProbe, nonceFor, proverReachable, requestProof, verifyGoogleIdToken } from '../lib/zklogin-server';

const CLIENT_ID = '1234567890-testclient.apps.googleusercontent.com';
const ISSUER = 'https://accounts.google.com';
const SUBJECT = '109876543210987654321';
const REDIRECT = 'http://localhost:3000/auth/callback';
const SEED = new Uint8Array(32).map((_, i) => (i * 31 + 7) % 256);

/** Stands in for Google's signing key. Generated per run; never leaves this process. */
let privateKey: KeyObject;
let keys: Parameters<typeof verifyGoogleIdToken>[0]['keys'];

beforeAll(async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  keys = createLocalJWKSet({ keys: [jwk] });
});

function issueToken(claims: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = `${b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${b64(claims)}`;
  const signature = nodeSign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
  return `${head}.${signature}`;
}

const oneHourFromNow = () => Math.floor(Date.now() / 1000) + 3600;

/**
 * One sign-in commitment and the nonce it produces.
 *
 * The verifier derives the nonce from a commitment now, so a test cannot hand it a literal. Every
 * case below that is not *about* the nonce needs a real one anyway, and this is how they get it.
 */
function commitmentFor(maxEpoch = 1222) {
  const ephemeral = Ed25519Keypair.generate();
  const jwtRandomness = generateRandomness();
  return {
    ephemeral,
    commitment: {
      extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(ephemeral.getPublicKey()),
      maxEpoch,
      jwtRandomness,
    },
    nonce: generateNonce(ephemeral.getPublicKey(), maxEpoch, jwtRandomness),
  };
}

/**
 * Shared by the cases that check the signature, the audience, the issuer and the expiry.
 *
 * Those used to pass the literal `'N'` as both the token's nonce and the expected one, which is no
 * longer expressible. Sharing one real commitment keeps them about what they are actually about.
 */
const { commitment: COMMITMENT, nonce: NONCE } = commitmentFor();

/** One complete sign-in, from keypair to address, exactly as the app performs it. */
async function runSignIn(overrides: { maxEpoch?: number } = {}) {
  const maxEpoch = overrides.maxEpoch ?? 1222;

  // 1 — the browser generates an ephemeral key and a nonce committing to it.
  const ephemeral = Ed25519Keypair.generate();
  const randomness = generateRandomness();
  const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, randomness);

  // 2 — the user goes to Google and comes back with the token in the fragment.
  const authUrl = new URL(buildAuthUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, nonce }));
  const jwt = issueToken({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: SUBJECT,
    nonce: authUrl.searchParams.get('nonce'),
    exp: oneHourFromNow(),
    iat: Math.floor(Date.now() / 1000),
  });
  const fragment = readIdTokenFromFragment(`#id_token=${jwt}`);
  expect(fragment.ok).toBe(true);

  // 3 — the server verifies it, then derives.
  const claims = await verifyGoogleIdToken({
    jwt,
    clientId: CLIENT_ID,
    // The commitment, not the nonce. The verifier re-derives the nonce from these three and
    // compares it against the one Google signed, so this asserts a real sign-in still passes.
    commitment: {
      extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(ephemeral.getPublicKey()),
      maxEpoch,
      jwtRandomness: randomness,
    },
    keys,
  });
  if (!claims.ok) throw new Error(`verification failed: ${claims.failure.detail}`);

  const salt = deriveUserSalt({
    seed: SEED,
    iss: claims.value.iss,
    aud: claims.value.aud,
    sub: claims.value.sub,
  });
  const addressSeed = genAddressSeed(salt, KEY_CLAIM_NAME, claims.value.sub, claims.value.aud);
  const address = computeZkLoginAddressFromSeed(addressSeed, claims.value.iss, false);

  return { ephemeral, nonce, randomness, maxEpoch, jwt, salt, addressSeed, address };
}

describe('a complete sign-in', () => {
  it('produces a valid Sui address', async () => {
    const { address } = await runSignIn();
    // 0x plus 64 hex characters. A zkLogin address is an ordinary Sui address — which is the whole
    // reason no contract needed changing for this feature.
    expect(address).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('lands on the address the SDK derives by the other route', async () => {
    // The check that matters. `jwtToAddress` goes token → address directly; the route goes
    // token → salt → seed → address because it needs the seed for the signer. Two independent
    // paths through the SDK. If they disagree, users are sent to an address they do not control
    // and nothing throws.
    const { jwt, salt, address } = await runSignIn();
    expect(address).toBe(jwtToAddress(jwt, salt, false));
  });

  it('gives the same address on every sign-in by the same person', async () => {
    // Different ephemeral key, different nonce, different token — same account. If this were not
    // stable, a user would land on a new empty address each time they signed in.
    const first = await runSignIn();
    const second = await runSignIn();
    expect(second.address).toBe(first.address);
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.jwt).not.toBe(first.jwt);
  });

  it('gives a different address to a different Google account', async () => {
    const mine = await runSignIn();
    const otherSalt = deriveUserSalt({ seed: SEED, iss: ISSUER, aud: CLIENT_ID, sub: 'someone-else' });
    const otherSeed = genAddressSeed(otherSalt, KEY_CLAIM_NAME, 'someone-else', CLIENT_ID);
    expect(computeZkLoginAddressFromSeed(otherSeed, ISSUER, false)).not.toBe(mine.address);
  });

  it('produces the extended ephemeral public key in the form this SDK emits', async () => {
    /*
     * base64, because 2.24.0 implements this as `publicKey.toSuiPublicKey()`. Older versions
     * returned a decimal bigint string, and prover images from that era expect the old form.
     *
     * Pinned because the app passes this value straight through to the proving service without
     * looking at it. A prover that disagrees about the encoding fails at proving time — after the
     * user has already been to Google and back — with an error about the field rather than about
     * the version mismatch that caused it.
     */
    const { ephemeral } = await runSignIn();
    const extended = getExtendedEphemeralPublicKey(ephemeral.getPublicKey());
    expect(extended).toBe(ephemeral.getPublicKey().toSuiPublicKey());
    expect(extended).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe('tokens that must be refused', () => {
  /*
   * Each of these is a token that verifies as a well-formed JWT and must still be rejected. They
   * are the difference between checking a signature and checking that a signature means something.
   */

  it('a token for a different sign-in attempt — replay across sessions', async () => {
    const sessionA = commitmentFor();
    const sessionB = commitmentFor();

    const jwt = issueToken({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: sessionA.nonce, exp: oneHourFromNow(),
    });
    // Google signed this perfectly. It belongs to another session, and that is the whole check.
    const result = await verifyGoogleIdToken({
      jwt, clientId: CLIENT_ID, commitment: sessionB.commitment, keys,
    });
    expect(result.ok).toBe(false);
  });

  it('a token signed by a key the key set does not contain', async () => {
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const head = `${b64({ alg: 'RS256', kid: 'test-key' })}.${b64({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: NONCE, exp: oneHourFromNow(),
    })}`;
    const forged = `${head}.${nodeSign('RSA-SHA256', Buffer.from(head), stranger.privateKey).toString('base64url')}`;

    const result = await verifyGoogleIdToken({ jwt: forged, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(false);
  });

  it('a token with the signature swapped for another token’s', async () => {
    const a = issueToken({ iss: ISSUER, aud: CLIENT_ID, sub: 'user-a', nonce: NONCE, exp: oneHourFromNow() });
    const b = issueToken({ iss: ISSUER, aud: CLIENT_ID, sub: 'user-b', nonce: NONCE, exp: oneHourFromNow() });
    const spliced = `${a.split('.').slice(0, 2).join('.')}.${b.split('.')[2]}`;

    const result = await verifyGoogleIdToken({ jwt: spliced, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(false);
  });

  it('an expired token, with no grace period', async () => {
    const jwt = issueToken({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: NONCE,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(false);
  });

  it('a token issued for a different application', async () => {
    // Someone else's Google app, same user. Accepting it would let any site holding a token for
    // this user derive their address here.
    const jwt = issueToken({
      iss: ISSUER, aud: 'another-app.apps.googleusercontent.com', sub: SUBJECT,
      nonce: NONCE, exp: oneHourFromNow(),
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(false);
  });

  it('a token from an issuer that is not Google', async () => {
    const jwt = issueToken({
      iss: 'https://accounts.evil.example', aud: CLIENT_ID, sub: SUBJECT,
      nonce: NONCE, exp: oneHourFromNow(),
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(false);
  });

  it('a token carrying no nonce at all', async () => {
    const jwt = issueToken({ iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, exp: oneHourFromNow() });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(false);
  });

  it('accepts Google’s other issuer spelling, which is not a forgery', async () => {
    // Google has emitted both `accounts.google.com` and `https://accounts.google.com` for years.
    // Rejecting the bare form would fail genuine sign-ins intermittently.
    const jwt = issueToken({
      iss: 'accounts.google.com', aud: CLIENT_ID, sub: SUBJECT, nonce: NONCE, exp: oneHourFromNow(),
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(true);
  });
});

describe('Google’s two issuer spellings must reach one address', () => {
  /*
   * The bug this suite found. `iss` feeds the salt, the salt feeds the address seed, and the seed
   * feeds the address — while the SDK separately normalises `iss` inside
   * `computeZkLoginAddressFromSeed`. So the address *parameter* agreed across both spellings while
   * the *seed* did not, and one person signing in twice could land on two different addresses with
   * funds split between them and nothing raising an error.
   *
   * Fixed by normalising once, in the verifier, before anything derives.
   */
  it('both spellings verify to the same issuer', async () => {
    for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
      const jwt = issueToken({ iss, aud: CLIENT_ID, sub: SUBJECT, nonce: NONCE, exp: oneHourFromNow() });
      const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.iss).toBe('https://accounts.google.com');
    }
  });

  it('both spellings therefore reach the same address', async () => {
    const addressFor = async (iss: string) => {
      const jwt = issueToken({ iss, aud: CLIENT_ID, sub: SUBJECT, nonce: NONCE, exp: oneHourFromNow() });
      const claims = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
      if (!claims.ok) throw new Error(claims.failure.detail);
      const salt = deriveUserSalt({ seed: SEED, iss: claims.value.iss, aud: claims.value.aud, sub: claims.value.sub });
      const seed = genAddressSeed(salt, KEY_CLAIM_NAME, claims.value.sub, claims.value.aud);
      return computeZkLoginAddressFromSeed(seed, claims.value.iss, false);
    };
    expect(await addressFor('accounts.google.com')).toBe(await addressFor('https://accounts.google.com'));
  });

  it('normaliseIssuer still matches the SDK’s own implementation', () => {
    // Resolved through the node_modules symlink, never a version-pinned store path: this
    // test exists to catch the SDK changing behavior, and a hardcoded version made it fail
    // on every dependency bump for the wrong reason — file-not-found instead of drift.
    const sdk = readFileSync(
      resolve(
        realpathSync(resolve(import.meta.dirname, '../node_modules/@mysten/sui')),
        'dist/zklogin/utils.mjs',
      ),
      'utf8',
    );
    const body = sdk.slice(sdk.indexOf('function normalizeZkLoginIssuer'));
    expect(body).toContain('"accounts.google.com"');
    expect(body).toContain('"https://accounts.google.com"');
    expect(normaliseIssuer('accounts.google.com')).toBe('https://accounts.google.com');
    expect(normaliseIssuer('https://accounts.google.com')).toBe('https://accounts.google.com');
    // Anything else passes through untouched, exactly as the SDK does.
    expect(normaliseIssuer('https://accounts.example')).toBe('https://accounts.example');
  });
});

describe('what the browser shows before the round trip', () => {
  it('reads the account from the token without verifying it', async () => {
    const { jwt } = await runSignIn();
    const claims = readUnverifiedClaims(jwt);
    expect(claims.ok).toBe(true);
    if (claims.ok) {
      expect(claims.value.sub).toBe(SUBJECT);
      expect(claims.value.aud).toBe(CLIENT_ID);
    }
  });
});

describe('the nonce must be derived, never accepted', () => {
  /*
   * The defect this block exists for.
   *
   * `verifyGoogleIdToken` took an `expectedNonce: string`, and both routes passed
   * `body['nonce']` — a field on the same request that carried the JWT. So the check compared the
   * nonce Google signed against a copy of that nonce supplied by whoever sent the token. It passed
   * unconditionally. A Google identity token for this client id was a bearer credential: present it
   * with its own nonce echoed back and `/complete` returned the account's address and a proof,
   * while `/export` returned the salt.
   *
   * The parameter is now a commitment and the nonce is derived from it. The echo is not merely
   * rejected — it cannot be expressed, because no parameter accepts a nonce. These tests assert the
   * derived comparison actually discriminates, which is the part a type signature cannot promise.
   */

  /** A victim's sign-in: their commitment, and the token Google signed for it. */
  function victim() {
    const session = commitmentFor();
    const jwt = issueToken({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: session.nonce, exp: oneHourFromNow(),
    });
    return { ...session, jwt };
  }

  it('accepts the sign-in the token was actually issued to', async () => {
    const { jwt, commitment } = victim();
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment, keys });
    expect(result.ok).toBe(true);
  });

  it('refuses a stolen token presented with the holder’s own commitment', async () => {
    // The whole attack, in three lines. The thief has a valid, unexpired, correctly-signed token
    // for this application and this user. They have no way to make it verify.
    const { jwt } = victim();
    const thief = commitmentFor();
    const result = await verifyGoogleIdToken({
      jwt, clientId: CLIENT_ID, commitment: thief.commitment, keys,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a commitment differing only in the ephemeral key', async () => {
    const { jwt, commitment } = victim();
    const other = commitmentFor(commitment.maxEpoch);
    const result = await verifyGoogleIdToken({
      jwt,
      clientId: CLIENT_ID,
      commitment: { ...commitment, extendedEphemeralPublicKey: other.commitment.extendedEphemeralPublicKey },
      keys,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a commitment differing only in maxEpoch', async () => {
    // Not cosmetic: maxEpoch is how long the ephemeral key may sign. A token accepted under a
    // raised ceiling would extend a session past the epoch the user consented to.
    const { jwt, commitment } = victim();
    const result = await verifyGoogleIdToken({
      jwt, clientId: CLIENT_ID, commitment: { ...commitment, maxEpoch: commitment.maxEpoch + 1 }, keys,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a commitment differing only in the randomness', async () => {
    const { jwt, commitment } = victim();
    const result = await verifyGoogleIdToken({
      jwt, clientId: CLIENT_ID, commitment: { ...commitment, jwtRandomness: generateRandomness() }, keys,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses, rather than throws, on a commitment that is not well formed', async () => {
    // These arrive from the request body, so every one of them is reachable by a stranger. A throw
    // here would be a 500 for what is a bad request, and a stack trace for what is not a fault.
    const { jwt, commitment } = victim();
    const malformed = [
      { ...commitment, extendedEphemeralPublicKey: 'not base64 at all !!' },
      { ...commitment, extendedEphemeralPublicKey: '' },
      { ...commitment, jwtRandomness: 'not a number' },
      { ...commitment, maxEpoch: 0 },
      { ...commitment, maxEpoch: -1 },
      { ...commitment, maxEpoch: 1.5 },
      { ...commitment, maxEpoch: Number.NaN },
    ];
    for (const bad of malformed) {
      const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: bad, keys });
      expect(result.ok).toBe(false);
    }
  });

  it('derives exactly the nonce the browser generated', () => {
    // `nonceFor` is the server half of a value the browser computes with the SDK. If these ever
    // disagree, every real sign-in fails — so this is the test that would catch a well-meaning
    // reimplementation of `generateNonce` on either side.
    const { ephemeral, commitment, nonce } = commitmentFor();
    const derived = nonceFor(commitment);
    expect(derived.ok).toBe(true);
    if (derived.ok) {
      expect(derived.value).toBe(nonce);
      expect(derived.value).toBe(
        generateNonce(ephemeral.getPublicKey(), commitment.maxEpoch, commitment.jwtRandomness),
      );
    }
  });

  it('reconstructs the ephemeral key the browser sent, byte for byte', () => {
    // `getExtendedEphemeralPublicKey` is `toSuiPublicKey()`, and the server inverts it with
    // `publicKeyFromSuiBytes`. The round trip is what lets the server derive at all.
    const { ephemeral, commitment } = commitmentFor();
    expect(commitment.extendedEphemeralPublicKey).toBe(ephemeral.getPublicKey().toSuiPublicKey());
  });
});

/**
 * Whether the Google button is offered at all.
 *
 * `zkLoginConfig` proves the prover URL is https and a key is set; it cannot prove the machine
 * exists. This deployment has been in exactly that state — the button live, every press ending at a
 * host that had been torn down, discovered only AFTER the round trip to Google with the user's
 * identity token already spent. So availability is measured.
 */
describe('the proving service is asked whether it is there', () => {
  const config = {
    googleClientId: 'x', redirectUri: 'https://weir.social/auth/callback',
    proverUrl: 'https://prover.example/v1', proverKey: 'k', seed: new Uint8Array(32),
  };
  beforeEach(() => { forgetProverProbe(); });
  afterEach(() => { vi.unstubAllGlobals(); forgetProverProbe(); });

  it('counts the prover talking as reachable, including a refusal of the empty probe body', async () => {
    /*
      The probe sends `{}`, which is not a valid proof request. A prover that answers 400 has still
      proved it is running, and that is the whole question. Requiring a 200 would demand a real
      proof — seconds of computation — on every page that offers sign-in.
    */
    for (const status of [200, 400, 404, 405, 422, 500]) {
      forgetProverProbe();
      vi.stubGlobal('fetch', async () => new Response('', { status }));
      expect((await proverReachable(config)).ok, `status ${status}`).toBe(true);
    }
  });

  it('does not count the edge answering for a machine that is gone', async () => {
    /*
      The one that got through. Cloudflare sits in front of the prover and answers even when the
      prover does not: 530 with a "Cloudflare Tunnel error" page is a disconnected `cloudflared`.
      Reading "an HTTP response came back" as "the prover is up" reported `available: true` on a
      deployment where every sign-in ended at that page, which is the exact failure this probe was
      added to prevent.
    */
    for (const status of [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]) {
      forgetProverProbe();
      vi.stubGlobal('fetch', async () => new Response('<!doctype html><html>…</html>', { status }));
      const result = await proverReachable(config);
      expect(result.ok, `status ${status} must not read as reachable`).toBe(false);
      if (!result.ok) expect(result.failure.detail).toContain(String(status));
    }
  });

  it('never puts an edge error page in front of a person', async () => {
    /*
      The callback printed `the prover answered 530: <!doctype html> <!--[if lt IE 7]>…` at somebody
      who had just tried to sign in. The status is the useful part; the document is not.
    */
    vi.stubGlobal('fetch', async () =>
      new Response('<!doctype html><html><head><title>Cloudflare Tunnel error</title></head></html>', { status: 530 }));
    const result = await requestProof({ proverUrl: config.proverUrl, proverKey: 'k', payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.detail).not.toContain('doctype');
      expect(result.failure.detail).not.toContain('<html');
      expect(result.failure.detail).toContain('530');
    }
  });

  it('reports a 403 as the edge refusing the key, not as a working prover', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 403 }));
    const result = await proverReachable(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY');
  });

  it('reports a host that is not there', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    const result = await proverReachable(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('could not be reached');
  });

  it('names a timeout as a timeout', async () => {
    vi.stubGlobal('fetch', async () => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    });
    const result = await proverReachable(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('four seconds');
  });

  it('probes once a minute, not once a page view', async () => {
    /*
      `/api/zklogin/session` is called by every page that offers sign-in. An unbounded probe would
      put a request against the most expensive machine in the deployment on each one.
    */
    let calls = 0;
    vi.stubGlobal('fetch', async () => { calls += 1; return new Response('', { status: 200 }); });
    const t = 1_000_000;
    await proverReachable(config, t);
    await proverReachable(config, t + 59_000);
    expect(calls).toBe(1);
    await proverReachable(config, t + 61_000);
    expect(calls).toBe(2);
  });
});
