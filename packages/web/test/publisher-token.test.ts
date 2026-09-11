// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { grantUpload, LIFETIME_SECONDS, TIER_EPOCHS } from '@/lib/publisher-token';
import { MAX_EPOCHS } from '@/lib/walrus';

const SECRET = 'x'.repeat(48);
const ENV = { PROJECTX_WALRUS_PUBLISHER_JWT_SECRET: SECRET };
const OWNER = `0x${'a1'.repeat(32)}`;

async function grant(over: Record<string, unknown> = {}) {
  return grantUpload({ owner: OWNER, size: 1024, tier: 'durable', env: ENV, ...over });
}

describe('a grant authorises exactly one upload', () => {
  it('signs a token the publisher can verify with the shared secret', async () => {
    const result = await grant();
    if (!result.ok) throw new Error(result.failure.detail);

    const verified = await jwtVerify(result.value.token, new TextEncoder().encode(SECRET));
    expect(verified.payload['send_object_to']).toBe(OWNER);
  });

  it('is refused by any other secret', async () => {
    const result = await grant();
    if (!result.ok) throw new Error(result.failure.detail);

    await expect(
      jwtVerify(result.value.token, new TextEncoder().encode('y'.repeat(48))),
    ).rejects.toThrow();
  });

  it('declares HS256, which is what the publisher is configured to expect', async () => {
    const result = await grant();
    if (!result.ok) throw new Error(result.failure.detail);
    expect(decodeProtectedHeader(result.value.token).alg).toBe('HS256');
  });
});

describe('the claims are exact, never ceilings', () => {
  it('states the size rather than a maximum', async () => {
    const result = await grant({ size: 4096 });
    if (!result.ok) throw new Error(result.failure.detail);

    const claims = decodeJwt(result.value.token);
    expect(claims['size']).toBe(4096);
    expect(claims['max_size']).toBeUndefined();
  });

  it('states the epochs rather than a maximum', async () => {
    const result = await grant();
    if (!result.ok) throw new Error(result.failure.detail);

    const claims = decodeJwt(result.value.token);
    expect(claims['epochs']).toBe(MAX_EPOCHS);
    expect(claims['max_epochs']).toBeUndefined();
  });

  it('never sends both forms, which Walrus rejects outright', async () => {
    const result = await grant();
    if (!result.ok) throw new Error(result.failure.detail);

    const claims = decodeJwt(result.value.token);
    expect('max_epochs' in claims && 'epochs' in claims).toBe(false);
    expect('max_size' in claims && 'size' in claims).toBe(false);
  });

  it('prices the tier, and does not take a duration from the caller', async () => {
    const ephemeral = await grant({ tier: 'ephemeral' });
    const durable = await grant({ tier: 'durable' });
    if (!ephemeral.ok || !durable.ok) throw new Error('expected both grants');

    expect(decodeJwt(ephemeral.value.token)['epochs']).toBe(TIER_EPOCHS.ephemeral);
    expect(decodeJwt(durable.value.token)['epochs']).toBe(TIER_EPOCHS.durable);
    expect(TIER_EPOCHS.durable).toBeLessThanOrEqual(MAX_EPOCHS);
  });

  it('echoes what it authorised, so the caller does not guess the query string', async () => {
    const result = await grant({ size: 777, tier: 'ephemeral' });
    if (!result.ok) throw new Error(result.failure.detail);
    expect(result.value).toMatchObject({ epochs: TIER_EPOCHS.ephemeral, size: 777 });
  });
});

describe('replay and lifetime', () => {
  it('carries a unique jti every time', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const result = await grant();
      if (!result.ok) throw new Error(result.failure.detail);
      ids.add(String(decodeJwt(result.value.token).jti));
    }
    expect(ids.size).toBe(25);
  });

  it('sets exp - iat to exactly LIFETIME_SECONDS, which the publisher requires', async () => {
    const result = await grant();
    if (!result.ok) throw new Error(result.failure.detail);

    const { iat, exp } = decodeJwt(result.value.token);
    expect(typeof iat).toBe('number');
    expect((exp as number) - (iat as number)).toBe(LIFETIME_SECONDS);
  });

  it('keeps the lifetime short enough to be worth little if captured', () => {
    expect(LIFETIME_SECONDS).toBeGreaterThan(0);
    expect(LIFETIME_SECONDS).toBeLessThanOrEqual(300);
  });
});

describe('it fails closed', () => {
  it('mints nothing when no secret is configured', async () => {
    const result = await grant({ env: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('unconfigured');
  });

  it('refuses a secret too short to resist offline attack', async () => {
    const result = await grant({ env: { PROJECTX_WALRUS_PUBLISHER_JWT_SECRET: 'short' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('malformed');
  });

  it('refuses an owner that is not a Sui address', async () => {
    for (const owner of ['', 'not-an-address', '0x123', OWNER.slice(0, -1), `${OWNER}ff`]) {
      expect((await grant({ owner })).ok).toBe(false);
    }
  });

  it('refuses a size that is not a positive whole number', async () => {
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect((await grant({ size })).ok).toBe(false);
    }
  });
});
