// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

const { commitment: COMMITMENT, nonce: NONCE } = commitmentFor();

async function runSignIn(overrides: { maxEpoch?: number } = {}) {
  const maxEpoch = overrides.maxEpoch ?? 1222;

  const ephemeral = Ed25519Keypair.generate();
  const randomness = generateRandomness();
  const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, randomness);

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

  const claims = await verifyGoogleIdToken({
    jwt,
    clientId: CLIENT_ID,
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
    expect(address).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('lands on the address the SDK derives by the other route', async () => {
    const { jwt, salt, address } = await runSignIn();
    expect(address).toBe(jwtToAddress(jwt, salt, false));
  });

  it('gives the same address on every sign-in by the same person', async () => {
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
    const { ephemeral } = await runSignIn();
    const extended = getExtendedEphemeralPublicKey(ephemeral.getPublicKey());
    expect(extended).toBe(ephemeral.getPublicKey().toSuiPublicKey());
    expect(extended).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe('tokens that must be refused', () => {
  it('a token for a different sign-in attempt — replay across sessions', async () => {
    const sessionA = commitmentFor();
    const sessionB = commitmentFor();

    const jwt = issueToken({
      iss: ISSUER, aud: CLIENT_ID, sub: SUBJECT, nonce: sessionA.nonce, exp: oneHourFromNow(),
    });
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
    const jwt = issueToken({
      iss: 'accounts.google.com', aud: CLIENT_ID, sub: SUBJECT, nonce: NONCE, exp: oneHourFromNow(),
    });
    const result = await verifyGoogleIdToken({ jwt, clientId: CLIENT_ID, commitment: COMMITMENT, keys });
    expect(result.ok).toBe(true);
  });
});

describe('Google’s two issuer spellings must reach one address', () => {
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
    const { ephemeral, commitment } = commitmentFor();
    expect(commitment.extendedEphemeralPublicKey).toBe(ephemeral.getPublicKey().toSuiPublicKey());
  });
});

describe('the proving service is asked whether it is there', () => {
  const config = {
    googleClientId: 'x', redirectUri: 'https://weir.social/auth/callback',
    proverUrl: 'https://prover.example/v1', proverKey: 'k', seed: new Uint8Array(32),
  };
  beforeEach(() => { forgetProverProbe(); });
  afterEach(() => { vi.unstubAllGlobals(); forgetProverProbe(); });

  it('counts the prover talking as reachable, including a refusal of the empty probe body', async () => {
    for (const status of [200, 400, 404, 405, 422, 500]) {
      forgetProverProbe();
      vi.stubGlobal('fetch', async () => new Response('', { status }));
      expect((await proverReachable(config)).ok, `status ${status}`).toBe(true);
    }
  });

  it('does not count the edge answering for a machine that is gone', async () => {
    for (const status of [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]) {
      forgetProverProbe();
      vi.stubGlobal('fetch', async () => new Response('<!doctype html><html>…</html>', { status }));
      const result = await proverReachable(config);
      expect(result.ok, `status ${status} must not read as reachable`).toBe(false);
      if (!result.ok) expect(result.failure.detail).toContain(String(status));
    }
  });

  it('never puts an edge error page in front of a person', async () => {
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
