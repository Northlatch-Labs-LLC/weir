// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// How fast one source can take seats from the sponsored offer, measured at the route.
//
// An external scan of weir.social (2026-11-25) took a seat with a throwaway key — one signed
// request, no transaction ever sent — and watched the offer's count fall by one. The per-address
// rule ("one each") did not matter, because a key costs nothing to make; and the only limit in
// front of the request was counted in one function instance's memory.
//
// This is that request, repeated from one source until it is told to wait, and then made once
// from another source to show the wait is the source's and not the offer's.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  rateLimit: () => null,
  simulateLimit: async () => null,
}));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: `0x${'e5'.repeat(32)}` },
    observedAtMs: 0,
  }),
}));

// The sponsor key and the chain are not what is counted here. The seat is real, the budget is real.
const sponsorKey = Ed25519Keypair.generate();
vi.mock('@/lib/sponsor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSponsor: () => ({ ok: true, value: { address: sponsorKey.getPublicKey().toSuiAddress(), keypair: sponsorKey } }),
  confirmClaimsFromChain: async () => ({ ok: true, value: 0 }),
  sponsorAccountOpen: async (input: { seat: number }) => ({
    ok: true,
    value: { bytes: 'AA==', sponsorSignature: 'AA==', sponsorAddress: sponsorKey.getPublicKey().toSuiAddress(), seat: input.seat, gasBudgetMist: '1' },
  }),
}));

const { POST } = await import('../app/api/agents/sponsor/route');
const { QUOTAS } = await import('../lib/rate-limit');
const { seatsRemaining, SPONSORSHIP_SEATS } = await import('../lib/sponsor');
const { statementFor } = await import('../lib/identity');

const ORIGIN = 'https://weir.social';
const OPERATOR = `0x${'c3'.repeat(32)}`;

/** A brand-new key, and the declaration it signs: exactly what a throwaway would send. */
async function throwaway(): Promise<Record<string, unknown>> {
  const key = Ed25519Keypair.generate();
  const address = key.getPublicKey().toSuiAddress();
  const timestampMs = Date.now();
  const action = { kind: 'declare-agent' as const, operator: OPERATOR, model: 'any', purpose: 'any' };
  const { signature } = await key.signPersonalMessage(new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN)));
  let n = 0;
  const handle = `t${Date.now().toString(36)}${address.slice(-8)}${(n += 1)}`;
  return { address, handle, declaration: { operatorAddress: OPERATOR, model: 'any', purpose: 'any', timestampMs, agentSignature: signature } };
}

const ask = (body: Record<string, unknown>, ip: string): Promise<Response> =>
  POST(
    new Request(`${ORIGIN}/api/agents/sponsor`, {
      method: 'POST',
      headers: { 'x-real-ip': ip },
      body: JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  await testDb().query('DELETE FROM agent_sponsorships');
});
afterAll(closeDatabase);

describe('POST /api/agents/sponsor, from one source', () => {
  it('takes a seat for a key that will never register, which is the problem', async () => {
    const ip = `2001:db8:1:${Date.now().toString(16)}::1`;
    const before = await seatsRemaining(Date.now());
    expect(before.ok && before.value).toBe(SPONSORSHIP_SEATS);

    const taken = await ask(await throwaway(), ip);
    expect(taken.status, await taken.clone().text()).toBe(200);
    const after = await seatsRemaining(Date.now());
    expect(after.ok && after.value).toBe(SPONSORSHIP_SEATS - 1);
  });

  it('is told to wait after a handful, and told how long', async () => {
    const ip = `2001:db8:2:${Date.now().toString(16)}::1`;
    for (let i = 0; i < QUOTAS.sponsorHold.capacity; i += 1) {
      const held = await ask(await throwaway(), ip);
      expect(held.status, `hold ${i + 1}: ${await held.clone().text()}`).toBe(200);
    }
    const over = await ask(await throwaway(), ip);
    expect(over.status).toBe(429);
    const retry = Number(over.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(QUOTAS.sponsorHold.msPerToken / 1000);
    expect(((await over.json()) as { bucket: string }).bucket).toBe('sponsorHold');

    const left = await seatsRemaining(Date.now());
    expect(left.ok && left.value).toBe(SPONSORSHIP_SEATS - QUOTAS.sponsorHold.capacity);
  });

  it('and the wait is the source’s, not the offer’s: another source takes the next seat', async () => {
    const first = `2001:db8:3:${Date.now().toString(16)}::1`;
    for (let i = 0; i < QUOTAS.sponsorHold.capacity; i += 1) await ask(await throwaway(), first);
    expect((await ask(await throwaway(), first)).status).toBe(429);

    const elsewhere = await ask(await throwaway(), `2001:db8:4:${Date.now().toString(16)}::1`);
    expect(elsewhere.status).toBe(200);
  });

  it('has at most a handful of seats at any moment, however long it keeps asking', async () => {
    // A hold lasts SEAT_HOLD_MS; the bucket refills one every msPerToken. Within one hold's life a
    // source can take capacity + floor(hold / refill) seats, and no more. Asserted from the two
    // constants so that a change to either is a change here.
    const { SEAT_HOLD_MS } = await import('../lib/sponsor');
    const most = QUOTAS.sponsorHold.capacity + Math.floor(SEAT_HOLD_MS / QUOTAS.sponsorHold.msPerToken);
    expect(most).toBeLessThanOrEqual(8);
    expect(most).toBeLessThan(SPONSORSHIP_SEATS / 2);
  });
});
