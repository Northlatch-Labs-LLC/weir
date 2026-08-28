// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
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
import { beforeAll, describe, expect, it } from 'vitest';
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
import { deriveUserSalt, verifyGoogleIdToken } from '../lib/zklogin-server';

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
    expectedNonce: nonce,
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
    const ephemeral = Ed25519Keypair.generate();
    const nonceA = generateNonce(ephemeral.getPublicKey(), 1222, generateRandomness());
    const nonceB = generateNonce(ephemeral.getPublicKey(), 1222, generateRandomness());

    const jwt = issueToken({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: nonceA, exp: oneHourFromNow(),
    });
    // Google signed this perfectly. It belongs to another session, and that is the whole check.
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: nonceB, keys });
    expect(result.ok).toBe(false);
  });

  it('a token signed by a key the key set does not contain', async () => {
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const head = `${b64({ alg: 'RS256', kid: 'test-key' })}.${b64({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: 'N', exp: oneHourFromNow(),
    })}`;
    const forged = `${head}.${nodeSign('RSA-SHA256', Buffer.from(head), stranger.privateKey).toString('base64url')}`;

    const result = await verifyGoogleIdToken({ jwt: forged, clientId: CLIENT_ID, expectedNonce: 'N', keys });
    expect(result.ok).toBe(false);
  });

  it('a token with the signature swapped for another token’s', async () => {
    const a = issueToken({ iss: ISSUER, aud: CLIENT_ID, sub: 'user-a', nonce: 'N', exp: oneHourFromNow() });
    const b = issueToken({ iss: ISSUER, aud: CLIENT_ID, sub: 'user-b', nonce: 'N', exp: oneHourFromNow() });
    const spliced = `${a.split('.').slice(0, 2).join('.')}.${b.split('.')[2]}`;

    const result = await verifyGoogleIdToken({ jwt: spliced, clientId: CLIENT_ID, expectedNonce: 'N', keys });
    expect(result.ok).toBe(false);
  });

  it('an expired token, with no grace period', async () => {
    const jwt = issueToken({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: 'N',
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: 'N', keys });
    expect(result.ok).toBe(false);
  });

  it('a token issued for a different application', async () => {
    // Someone else's Google app, same user. Accepting it would let any site holding a token for
    // this user derive their address here.
    const jwt = issueToken({
      iss: ISSUER, aud: 'another-app.apps.googleusercontent.com', sub: SUBJECT,
      nonce: 'N', exp: oneHourFromNow(),
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: 'N', keys });
    expect(result.ok).toBe(false);
  });

  it('a token from an issuer that is not Google', async () => {
    const jwt = issueToken({
      iss: 'https://accounts.evil.example', aud: CLIENT_ID, sub: SUBJECT,
      nonce: 'N', exp: oneHourFromNow(),
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: 'N', keys });
    expect(result.ok).toBe(false);
  });

  it('a token carrying no nonce at all', async () => {
    const jwt = issueToken({ iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, exp: oneHourFromNow() });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: 'N', keys });
    expect(result.ok).toBe(false);
  });

  it('accepts Google’s other issuer spelling, which is not a forgery', async () => {
    // Google has emitted both `accounts.google.com` and `https://accounts.google.com` for years.
    // Rejecting the bare form would fail genuine sign-ins intermittently.
    const jwt = issueToken({
      iss: 'accounts.google.com', aud: CLIENT_ID, sub: SUBJECT, nonce: 'N', exp: oneHourFromNow(),
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: 'N', keys });
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
      const jwt = issueToken({ iss, aud: CLIENT_ID, sub: SUBJECT, nonce: 'N', exp: oneHourFromNow() });
      const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: 'N', keys });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.iss).toBe('https://accounts.google.com');
    }
  });

  it('both spellings therefore reach the same address', async () => {
    const addressFor = async (iss: string) => {
      const jwt = issueToken({ iss, aud: CLIENT_ID, sub: SUBJECT, nonce: 'N', exp: oneHourFromNow() });
      const claims = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, expectedNonce: 'N', keys });
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
