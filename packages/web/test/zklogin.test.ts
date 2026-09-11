// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

const SEED = new Uint8Array(32).map((_, i) => (i * 7 + 11) % 256);

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'k' })}.${b64(payload)}.c2ln`;
}

describe('the Google authorization URL', () => {
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
    if (!r.ok) expect(r.failure.detail).toContain(key);
  });

  it('calls absence unconfigured, not malformed', () => {
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
    const { PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY: _omitted, ...noKey } = full;
    expect(
      zkLoginConfig({ ...noKey, PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL: 'http://localhost:8080/v1' }).ok,
    ).toBe(true);
  });

  it('treats a whitespace-only secret as absent rather than sending a blank header', () => {
    const r = zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY: '   ' });
    expect(r.ok).toBe(false);
  });

  it('is off when switched off, even with everything else set', () => {
    const r = zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('unconfigured');
  });

  it('does not leak which variables exist when it is switched off', () => {
    const r = zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '1' });
    if (!r.ok) {
      for (const name of Object.keys(full)) expect(r.failure.detail).not.toContain(name);
    }
  });

  it('stays on for any value that is not the switch', () => {
    expect(zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '' }).ok).toBe(true);
    expect(zkLoginConfig({ ...full, PROJECTX_SOCIAL_ZKLOGIN_DISABLED: '0' }).ok).toBe(true);
  });
});

describe('reaching the prover past its edge', () => {
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
    const captured = stubFetch(Response.json({ proof: 'yes' }));
    await requestProof({ proverUrl: 'http://localhost:8080/v1', proverKey: '', payload: {} });
    expect(captured().headers.has(PROVER_KEY_HEADER)).toBe(false);
  });

  it('names the edge when it answers 403, rather than blaming the prover', async () => {
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

  it('produces the exact value it produced on the day it was written', () => {
    expect(deriveUserSalt(base).toString()).toBe('294619703521231074274689404914523017675');
  });

  it('is sensitive to the order of iss and aud, not merely to their contents', () => {
    const swapped = deriveUserSalt({ ...base, iss: base.aud, aud: base.iss });
    expect(swapped).not.toBe(deriveUserSalt(base));
  });

  it('derives the claim name from one place', () => {
    expect(KEY_CLAIM_NAME).toBe('sub');
  });
});

describe('the prover payload, which no compiler checks', () => {
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
    expect(body).toMatch(/^\s*maxEpoch: number;/m);
  });
});

describe('the address derivation is pinned to the non-legacy form', () => {
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
