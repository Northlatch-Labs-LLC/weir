// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * zkLogin: the parts where being wrong is silent.
 *
 * Most of this feature fails loudly — a bad proof is refused by the network, a bad signature does
 * not verify. These tests cover the rest: the places where a mistake produces something that looks
 * exactly like success and is discovered months later as "my account is gone".
 *
 * The salt derivation is the sharpest of them. It is frozen by definition: change any input, or the
 * order of any two, and every address this deployment ever issued moves. Nothing about that failure
 * throws, logs, or looks wrong — the new address is perfectly valid and perfectly empty.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthUrl,
  checkProveResponse,
  GOOGLE_AUTH_ENDPOINT,
  KEY_CLAIM_NAME,
  maxEpochFrom,
  MAX_EPOCH_WINDOW,
  readIdTokenFromFragment,
  readUnverifiedClaims,
  sessionExpired,
} from '../lib/zklogin';
import {
  deriveUserSalt,
  MIN_SEED_BYTES,
  PROVER_KEY_HEADER,
  requestProof,
  SALT_BYTES,
  zkLoginConfig,
} from '../lib/zklogin-server';

const root = join(import.meta.dirname, '..');

/** A well-formed seed. Not a real one — this value exists only inside this file. */
const SEED = new Uint8Array(32).map((_, i) => (i * 7 + 11) % 256);

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'k' })}.${b64(payload)}.c2ln`;
}

describe('the Google authorization URL', () => {
  /*
   * Quoted from the Sui zkLogin integration guide:
   *
   *   https://accounts.google.com/o/oauth2/v2/auth
   *     ?client_id=$CLIENT_ID &response_type=id_token &redirect_uri=$REDIRECT_URL
   *     &scope=openid &nonce=$NONCE
   *
   * Asserted field by field. A wrong `response_type` sends the user through the authorization-code
   * flow instead, where Google returns a code this application has no way to exchange — and the
   * failure surfaces as a blank callback page rather than as anything naming the cause.
   */
  const url = new URL(
    buildAuthUrl({ clientId: 'cid.apps.googleusercontent.com', redirectUri: 'https://x/cb', nonce: 'N' }),
  );

  it('targets the documented endpoint', () => {
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
  });

  it('uses the implicit flow, so the token never reaches a server as part of the redirect', () => {
    expect(url.searchParams.get('response_type')).toBe('id_token');
  });

  it('asks for identity and nothing else', () => {
    expect(url.searchParams.get('scope')).toBe('openid');
  });

  it('carries the client id, redirect and nonce', () => {
    expect(url.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb');
    expect(url.searchParams.get('nonce')).toBe('N');
  });

  it('requests no additional scopes — profile or email would be data we have no use for', () => {
    expect(url.searchParams.get('scope')).not.toContain('profile');
    expect(url.searchParams.get('scope')).not.toContain('email');
  });
});

describe('reading the redirect', () => {
  it('finds the token', () => {
    const r = readIdTokenFromFragment(`#id_token=${jwtWith({ sub: 'a' })}&other=1`);
    expect(r.ok).toBe(true);
  });

  it('reports a user who declined as what it is, not as a parse failure', () => {
    const r = readIdTokenFromFragment('#error=access_denied&error_description=User%20said%20no');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toBe('User said no');
  });

  it('refuses a truncated token rather than passing it downstream', () => {
    const r = readIdTokenFromFragment('#id_token=abc.def');
    expect(r.ok).toBe(false);
  });

  it('refuses an empty fragment', () => {
    expect(readIdTokenFromFragment('').ok).toBe(false);
  });
});

describe('unverified claims', () => {
  it('reads iss, aud and sub', () => {
    const r = readUnverifiedClaims(jwtWith({ iss: 'https://accounts.google.com', aud: 'c', sub: 's' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sub).toBe('s');
  });

  it('refuses an array audience rather than silently taking the first element', () => {
    // An `aud` array means a token shaped for a flow this code does not implement. Reducing it to
    // `aud[0]` would derive an address from one of several audiences, chosen by array order.
    const r = readUnverifiedClaims(jwtWith({ iss: 'i', aud: ['a', 'b'], sub: 's' }));
    expect(r.ok).toBe(false);
  });

  it('refuses a token missing sub', () => {
    expect(readUnverifiedClaims(jwtWith({ iss: 'i', aud: 'a' })).ok).toBe(false);
  });
});

describe('maxEpoch', () => {
  it('is the current epoch plus the window', () => {
    const r = maxEpochFrom(1220n);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1220 + Number(MAX_EPOCH_WINDOW));
  });

  it('refuses epoch 0 — no live network reports it, so it is what a failed read looks like', () => {
    expect(maxEpochFrom(0n).ok).toBe(false);
  });

  it('refuses an epoch too large to represent exactly, rather than losing precision silently', () => {
    expect(maxEpochFrom(BigInt(Number.MAX_SAFE_INTEGER)).ok).toBe(false);
  });
});

describe('session expiry', () => {
  // Both sides of the boundary. `maxEpoch` is inclusive: the network accepts a proof *at* maxEpoch,
  // so treating it as expired would throw away the last valid day of every session.
  it('is live before maxEpoch', () => {
    expect(sessionExpired({ maxEpoch: 1222 }, 1220n)).toBe(false);
  });
  it('is live at exactly maxEpoch', () => {
    expect(sessionExpired({ maxEpoch: 1222 }, 1222n)).toBe(false);
  });
  it('is dead one epoch past maxEpoch', () => {
    expect(sessionExpired({ maxEpoch: 1222 }, 1223n)).toBe(true);
  });
});

describe('the proving service response', () => {
  const good = {
    proofPoints: { a: ['1'], b: [['1']], c: ['1'] },
    issBase64Details: { value: 'v', indexMod4: 1 },
    headerBase64: 'h',
  };

  it('accepts a well-formed proof', () => {
    expect(checkProveResponse(good).ok).toBe(true);
  });

  // A prover behind a proxy can answer 200 with an error page. Without this check that body flows
  // into ZkLoginSigner and fails inside BCS serialisation, several steps from the cause.
  it.each([
    ['an HTML error page', 'not json at all'],
    ['a 200 with an error body', { error: 'rate limited' }],
    ['missing proofPoints', { ...good, proofPoints: undefined }],
    ['missing issBase64Details', { ...good, issBase64Details: undefined }],
    ['missing headerBase64', { ...good, headerBase64: undefined }],
    ['indexMod4 as a string', { ...good, issBase64Details: { value: 'v', indexMod4: '1' } }],
    ['null', null],
  ])('refuses %s', (_label, body) => {
    expect(checkProveResponse(body).ok).toBe(false);
  });
});

describe('configuration', () => {
  const full = {
    PROJECTX_SOCIAL_GOOGLE_CLIENT_ID: 'cid',
    PROJECTX_SOCIAL_ZKLOGIN_REDIRECT_URI: 'https://x/cb',
    PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL: 'https://prover.example/v1',
    PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY: 'a-shared-secret',
    PROJECTX_SOCIAL_ZKLOGIN_SEED: '00'.repeat(32),
  };

  it('accepts a complete configuration', () => {
    expect(zkLoginConfig(full).ok).toBe(true);
  });

  it.each(Object.keys(full))('refuses a configuration missing %s, and names it', (key) => {
    const partial = { ...full, [key]: undefined };
    const r = zkLoginConfig(partial);
    expect(r.ok).toBe(false);
    // The message must name the variable. "Configuration error" sends somebody reading four files.
    if (!r.ok) expect(r.failure.detail).toContain(key);
  });

  it('calls absence unconfigured, not malformed', () => {
    // Load-bearing: an unconfigured deployment shows a calm "not available here" and keeps
    // offering wallets, where a malformed one is loud. Collapsing them hides a broken prover.
    const r = zkLoginConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('unconfigured');
  });

  it('refuses a seed shorter than the minimum, because it can never be rotated', () => {
    const r = zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_SEED: '00'.repeat(MIN_SEED_BYTES - 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('malformed');
  });

  it('refuses a non-hex seed rather than deriving from a partial parse', () => {
    expect(zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_SEED: 'not-hex-at-all' }).ok).toBe(false);
  });

  it('refuses a plaintext prover URL — the JWT travels to it', () => {
    expect(zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL: 'http://prover.example/v1' }).ok).toBe(false);
  });

  it('allows a prover on this machine, where there is no network to intercept', () => {
    expect(zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL: 'http://localhost:8080/v1' }).ok).toBe(true);
  });

  /*
    The shared secret that keeps the proving machine from being spent by strangers.

    The prover is a dedicated 16 GB VM at a public hostname, and Vercel's functions egress from
    addresses that change, so there is nothing to allowlist — an edge rule keyed on a secret header
    is the control. These assert the two halves that make it real: the deployment cannot forget the
    secret, and the request actually carries it.
  */
  it('refuses a remote prover with no shared secret, because the machine would be open', () => {
    const { PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY: _omitted, ...noKey } = full;
    const r = zkLoginConfig(noKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toContain('PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY');
  });

  it('calls a missing shared secret malformed, not unconfigured', () => {
    const { PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY: _omitted, ...noKey } = full;
    const r = zkLoginConfig(noKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('malformed');
  });

  it('does not demand a secret for a prover on this machine, which has no edge in front of it', () => {
    // A requirement satisfiable by any junk value teaches people to type junk into the variable
    // that protects production.
    const { PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY: _omitted, ...noKey } = full;
    expect(
      zkLoginConfig({ ...noKey, PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL: 'http://localhost:8080/v1' }).ok,
    ).toBe(true);
  });

  it('treats a whitespace-only secret as absent rather than sending a blank header', () => {
    const r = zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY: '   ' });
    expect(r.ok).toBe(false);
  });

  /*
    The off switch beats a complete configuration, which is the whole point of it.

    This deployment was found serving a live Google button from a full set of variables while its
    prover had already been torn down — the feature was decided off and the configuration did not
    know. Deleting a variable would also have worked, and would have looked like an accident.
  */
  it('is off when switched off, even with everything else set', () => {
    const r = zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '1' });
    expect(r.ok).toBe(false);
    // Calm, not loud: the sign-in panel keeps offering wallets instead of rendering a fault.
    if (!r.ok) expect(r.failure.kind).toBe('unconfigured');
  });

  it('does not leak which variables exist when it is switched off', () => {
    const r = zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '1' });
    if (!r.ok) {
      for (const name of Object.keys(full)) expect(r.failure.detail).not.toContain(name);
    }
  });

  it('stays on for any value that is not the switch', () => {
    // A half-set flag must not turn a working deployment off by surprise.
    expect(zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '' }).ok).toBe(true);
    expect(zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '0' }).ok).toBe(true);
  });
});

describe('reaching the prover past its edge', () => {
  /** Captures the request `requestProof` makes, and answers whatever the test wants. */
  function stubFetch(answer: Response): () => Request {
    let seen: Request | null = null;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      seen = new Request(url, init);
      return Promise.resolve(answer);
    });
    return () => {
      if (seen === null) throw new Error('the prover was never called');
      return seen;
    };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('carries the shared secret, or the edge refuses every proof', async () => {
    const captured = stubFetch(Response.json({ proof: 'yes' }));
    await requestProof({
      proverUrl: 'https://prover.example/v1',
      proverKey: 'a-shared-secret',
      payload: {},
    });
    expect(captured().headers.get(PROVER_KEY_HEADER)).toBe('a-shared-secret');
  });

  it('sends no such header for a prover on this machine', async () => {
    // An empty header value is not the same as no header, and a rule written as "present and equal"
    // versus "equal" would treat them differently. Send nothing rather than nothing-shaped.
    const captured = stubFetch(Response.json({ proof: 'yes' }));
    await requestProof({ proverUrl: 'http://localhost:8080/v1', proverKey: '', payload: {} });
    expect(captured().headers.has(PROVER_KEY_HEADER)).toBe(false);
  });

  it('names the edge when it answers 403, rather than blaming the prover', async () => {
    /*
      The prover has no notion of forbidden — it answers 400 for bad input and 200 with a proof
      otherwise. So a 403 is the rule in front of it, and reporting "the prover answered 403" sends
      somebody to read logs on a machine that never saw the request.
    */
    stubFetch(new Response('denied', { status: 403 }));
    const r = await requestProof({
      proverUrl: 'https://prover.example/v1',
      proverKey: 'wrong',
      payload: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.detail).toContain('edge');
      expect(r.failure.detail).toContain('PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY');
    }
  });
});

describe('the salt derivation, which is frozen', () => {
  const base = { seed: SEED, iss: 'https://accounts.google.com', aud: 'client-1', sub: 'user-1' };

  it('is deterministic — the same user gets the same address forever', () => {
    expect(deriveUserSalt(base)).toBe(deriveUserSalt(base));
  });

  it('fits in the field element the circuit takes', () => {
    // A zkLogin salt must be < 2^128. A wider value is not representable and the proof would be
    // rejected — but only at proving time, after the user has already left for Google.
    expect(deriveUserSalt(base)).toBeLessThan(2n ** BigInt(SALT_BYTES * 8));
  });

  it.each([
    ['a different subject', { sub: 'user-2' }],
    ['a different audience', { aud: 'client-2' }],
    ['a different issuer', { iss: 'https://accounts.example.com' }],
  ])('separates %s', (_label, change) => {
    expect(deriveUserSalt({ ...base, ...change })).not.toBe(deriveUserSalt(base));
  });

  it('separates two deployments with different seeds', () => {
    const other = new Uint8Array(32).fill(9);
    expect(deriveUserSalt({ ...base, seed: other })).not.toBe(deriveUserSalt(base));
  });

  /*
   * The known-answer test, and the only one here that actually freezes the derivation.
   *
   * Everything above checks *properties* — determinism, separation, range — and every one of them
   * still passes if the construction is changed wholesale. Swap `iss || aud` to `aud || iss`, move
   * from SHA-256 to SHA-512, take the bytes little-endian instead of big-endian: the result is
   * still deterministic, still separates users, still fits the field. And every address this
   * deployment ever issued has moved, with no error anywhere.
   *
   * So the answer itself is recorded. This number was produced by running the derivation, not
   * copied from a specification, and it is expected to never change again. If a code change makes
   * this test fail, the change is not a refactor — it is a migration that strands every existing
   * account, and it needs a plan rather than a new expected value.
   */
  it('produces the exact value it produced on the day it was written', () => {
    expect(deriveUserSalt(base).toString()).toBe('294619703521231074274689404914523017675');
  });

  it('is sensitive to the order of iss and aud, not merely to their contents', () => {
    // Swapping the two is a plausible edit — they are adjacent, same-typed strings — and produces
    // a perfectly valid salt for an address nobody controls.
    const swapped = deriveUserSalt({ ...base, iss: base.aud, aud: base.iss });
    expect(swapped).not.toBe(deriveUserSalt(base));
  });

  it('derives the claim name from one place', () => {
    expect(KEY_CLAIM_NAME).toBe('sub');
  });
});

describe('the prover payload, which no compiler checks', () => {
  /*
   * Field names as documented:
   *   { "jwt", "extendedEphemeralPublicKey", "maxEpoch", "jwtRandomness", "salt", "keyClaimName" }
   *
   * The route builds this object as a typed `ProveRequest`, so a rename in the interface would be
   * caught — but a rename in *both* would not, and the prover would answer 400 with a message about
   * a field nobody here recognises. So the source is read from disk and the names asserted.
   */
  const source = readFileSync(join(root, 'lib/zklogin.ts'), 'utf8');
  const body = source.slice(
    source.indexOf('export interface ProveRequest'),
    source.indexOf('export interface ProveResponse'),
  );

  it.each([
    'jwt',
    'extendedEphemeralPublicKey',
    'maxEpoch',
    'jwtRandomness',
    'salt',
    'keyClaimName',
  ])('still carries %s', (field) => {
    expect(body).toMatch(new RegExp(`^\\s*${field}:`, 'm'));
  });

  it('sends maxEpoch as a number, not a string', () => {
    // The prover rejects a string here, and the SDK's signer takes a number too. Quoting it is a
    // one-character mistake that costs a round trip to Google to discover.
    expect(body).toMatch(/^\s*maxEpoch: number;/m);
  });
});

describe('the address derivation is pinned to the non-legacy form', () => {
  /*
   * `legacyAddress` selects between two incompatible hashings of the same inputs. It is not a
   * preference: it decides which address a Google account maps to. Flipping it would not migrate
   * anybody — it would point every existing user at an empty address that looks legitimate.
   *
   * Asserted by reading the call sites, because there is no runtime value to check.
   */
  it.each([
    ['app/api/zklogin/complete/route.ts', /computeZkLoginAddressFromSeed\([^)]*,\s*false\)/],
    ['components/SignerProvider.tsx', /legacyAddress:\s*false/],
  ])('%s derives with legacyAddress false', (path, pattern) => {
    expect(readFileSync(join(root, path), 'utf8')).toMatch(pattern);
  });

  it('constructs the signer with the expected address, so a wrong flag throws instead of signing', () => {
    const source = readFileSync(join(root, 'components/SignerProvider.tsx'), 'utf8');
    const constructor = source.slice(
      source.indexOf('new ZkLoginSigner('),
      source.indexOf('return zkLoginSignerAdapter'),
    );
    expect(constructor).toMatch(/address:\s*session\.address/);
  });
});
