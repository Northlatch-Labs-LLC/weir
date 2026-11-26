// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// Every write a signature authorises is counted against the address that signed it, in one place,
// and the count is atomic.
//
// On 2026-11-25 a scan of weir.social sent a hundred comments from one key in five seconds and
// nothing refused one of them. The limit that was meant to hold that back counted requests per
// address-in-memory, which on a serverless deployment means per function instance: a burst
// spreads across the instances that happen to be warm and the cap multiplies by that number. It
// was also spent before anything was proved, so it could be drained for somebody else.
//
// The budget now lives in verifyAction, spent after the proof and before the signature. These
// tests are the scan's request, repeated here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, useTestDatabase } from './helpers/database';

const ORIGIN = 'https://weir.social';

useTestDatabase();

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key?.startsWith('PROJECTX_SOCIAL_') && process.env[key] === undefined) {
    process.env[key] = rest.join('=').trim();
  }
}

const { statementFor, throttleResponse, verifyAction } = await import('../lib/identity');
const { QUOTAS } = await import('../lib/rate-limit');

afterAll(closeDatabase);
afterEach(() => vi.useRealTimers());

type Action = Parameters<typeof statementFor>[0];

/** A fresh key for every test: a budget belongs to an address, so an address must be new. */
function signer(): {
  address: string;
  write: (handle?: string) => Promise<Parameters<typeof verifyAction>[0]>;
  read: () => Promise<Parameters<typeof verifyAction>[0]>;
} {
  const keypair = new Ed25519Keypair();
  const address = keypair.getPublicKey().toSuiAddress();
  const signed = async (action: Action): Promise<Parameters<typeof verifyAction>[0]> => {
    const timestampMs = Date.now();
    const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
    const { signature } = await keypair.signPersonalMessage(message);
    return { address, signature, timestampMs, action, origin: ORIGIN };
  };
  return {
    address,
    write: (handle = 'alice') => signed({ kind: 'follow', handle, following: true }),
    read: () => signed({ kind: 'read-content' }),
  };
}

describe('a signed write, counted against the address that signed it', () => {
  it('is admitted up to the budget and refused after it', async () => {
    const who = signer();
    for (let i = 0; i < QUOTAS.signedWrite.capacity; i += 1) {
      expect((await verifyAction(await who.write())).ok, `write ${i + 1}`).toBe(true);
    }
    const over = await verifyAction(await who.write());
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.failure.kind).toBe('budget-exhausted');
  });

  it('holds when they all arrive at once: exactly the budget is admitted, however many are sent', async () => {
    const who = signer();
    const sent = QUOTAS.signedWrite.capacity + 20;
    const results = await Promise.all(
      Array.from({ length: sent }, async (_unused, i) => verifyAction(await who.write(`creator_${i}`))),
    );
    const admitted = results.filter((r) => r.ok).length;
    const refused = results.filter((r) => !r.ok);

    expect(admitted).toBe(QUOTAS.signedWrite.capacity);
    expect(refused).toHaveLength(20);
    for (const r of refused) {
      if (r.ok) continue;
      expect(r.failure.kind).toBe('budget-exhausted');
      const response = throttleResponse(r);
      expect(response?.status).toBe(429);
      expect(Number((response?.headers as Headers).get('retry-after'))).toBeGreaterThan(0);
    }
  });

  it('is refused as a thing to wait for, not as a bad signature, and keeps the signature it came with', async () => {
    const who = signer();
    for (let i = 0; i < QUOTAS.signedWrite.capacity; i += 1) await verifyAction(await who.write());
    expect(throttleResponse(await verifyAction(await who.write()))?.status).toBe(429);

    // The request that was over the budget.
    const held = await who.write('held');
    const refused = await verifyAction(held);
    expect(throttleResponse(refused)?.status).toBe(429);

    // One token later, the very same signed request goes through: it was never spent.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + QUOTAS.signedWrite.msPerToken);
    expect((await verifyAction(held)).ok).toBe(true);
  });

  it('cannot be drained for somebody else: an unsigned request naming an address costs that address nothing', async () => {
    const victim = signer();
    const input = await victim.write();
    for (let i = 0; i < QUOTAS.signedWrite.capacity * 2; i += 1) {
      const result = await verifyAction({ ...input, signature: `AAAA${i}` });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(throttleResponse(result)).toBeNull();
    }
    // The address still has all of it.
    for (let i = 0; i < QUOTAS.signedWrite.capacity; i += 1) {
      expect((await verifyAction(await victim.write())).ok).toBe(true);
    }
  });

  it('does not count a signed read, which changes nothing', async () => {
    const who = signer();
    for (let i = 0; i < QUOTAS.signedWrite.capacity + 10; i += 1) {
      expect((await verifyAction(await who.read())).ok).toBe(true);
    }
    for (let i = 0; i < QUOTAS.signedWrite.capacity; i += 1) {
      expect((await verifyAction(await who.write())).ok).toBe(true);
    }
  });

  it('is a refusal without a Retry-After when the budget itself could not be read', async () => {
    const who = signer();
    const rateLimit = await import('../lib/rate-limit');
    const spy = vi.spyOn(rateLimit, 'spendQuota').mockResolvedValue({ allowed: false, kind: 'unavailable', reason: 'store down' });
    try {
      const result = await verifyAction(await who.write());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe('transport');
    } finally {
      spy.mockRestore();
    }
  });
});
