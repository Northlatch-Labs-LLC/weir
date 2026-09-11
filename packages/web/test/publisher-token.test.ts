// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The token that authorises spending the publisher's wallet.
 *
 * # What is actually at stake
 *
 * The failures worth pinning are therefore the ones that widen what a token permits: a ceiling
 * where an exact value was intended, a missing replay id, an absent secret quietly treated as
 * blank, an owner field passed through unchecked.
 */

import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { grantUpload, LIFETIME_SECONDS, TIER_EPOCHS } from '@/lib/publisher-token';
import { MAX_EPOCHS } from '@/lib/walrus';

/** Synthetic. Long enough to pass the minimum-length rule, and not a secret in use anywhere. */
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
    /*
      The distinction that matters. `max_size` would let a token minted for a 1 KB avatar be spent
      on an 8 MB blob — the publisher would be within its rules and the cost would be ours.
    */
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
    // Documented constraint: `epochs` with `max_epochs`, or `size` with `max_size`, is a rejected
    // token. A token refused at the publisher looks identical to an outage from the creator's side.
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
    // The publisher suppresses replays by remembering `jti`. A repeated one would either be
    // refused as a replay or — worse, if we generated it predictably — be forgeable.
    const ids = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const result = await grant();
      if (!result.ok) throw new Error(result.failure.detail);
      ids.add(String(decodeJwt(result.value.token).jti));
    }
    expect(ids.size).toBe(25);
  });

  it('sets exp - iat to exactly LIFETIME_SECONDS, which the publisher requires', async () => {
    /*
      Not "within a reasonable window" — exactly. The publisher compares `exp - iat` against its
      own `--jwt-expiring-sec` for equality and rejects any other value:

          if (self.exp - self.iat.unwrap_or_default()) != auth_config.expiring_sec { … }

      A publisher started with 120 therefore refuses every token minted here, and says
      `the expiration in the query does not match the token` — a message that names the query,
      while the query has nothing to do with it. That cost three wrong guesses when it happened.
    */
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
    /*
      An unset secret must not become an empty one. A publisher started without
      `--jwt-decode-secret` accepts anything, so a deployment where both sides silently agreed on
      "" would be exactly the open publisher the documentation warns against.
    */
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
    // This field decides who owns the blob we paid for. A malformed one is not a thing to discover
    // at the publisher, after the WAL is spent.
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
