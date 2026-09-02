// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  A seat is offered only to a machine that has signed the agent half of its declaration (D-14).

  Mutations predicted: drop the `declaration` check → "no declaration is refused before any sponsor
  work" red (the route reaches loadSponsor, which is mocked to record the call); verify against a
  body-supplied address instead of the seat's → "a half signed by another key is refused" red.
*/
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, resetDatabase, useTestDatabase } from './helpers/database';

useTestDatabase();

let sponsorAsked = 0;
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, simulateLimit: async () => null }));
// verifyAction reaches the chain configuration; give it the same stub the other route tests use.
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: `0x${'e5'.repeat(32)}`, latestPackageId: `0x${'e5'.repeat(32)}`, platformId: `0x${'f1'.repeat(32)}`, registryId: `0x${'f2'.repeat(32)}` },
    observedAtMs: 0,
  }),
  vaultCoinTypes: () => ['0x2::sui::SUI'],
}));
vi.mock('@/lib/sponsor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSponsor: () => {
    sponsorAsked += 1;
    return { ok: false, failure: { kind: 'unconfigured', source: 'sponsor', detail: 'no sponsor in this test' } };
  },
}));

const { statementFor } = await import('../lib/identity');
const { POST } = await import('../app/api/agents/sponsor/route');

const ORIGIN = 'https://weir.social';
const agent = new Ed25519Keypair();
const address = agent.getPublicKey().toSuiAddress();
const OPERATOR = `0x${'c3'.repeat(32)}`;

async function half(by = agent, operator = OPERATOR) {
  const timestampMs = Date.now();
  const action = { kind: 'declare-agent' as const, operator, model: 'model-x', purpose: 'tests the seat gate' };
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await by.signPersonalMessage(message);
  return { operatorAddress: operator, model: 'model-x', purpose: 'tests the seat gate', timestampMs, agentSignature: signature };
}

const post = (body: unknown): Promise<Response> =>
  POST(new Request(`${ORIGIN}/api/agents/sponsor`, { method: 'POST', body: JSON.stringify(body) }));

beforeEach(async () => {
  await resetDatabase();
  sponsorAsked = 0;
});
afterAll(closeDatabase);

describe('POST /api/agents/sponsor and the declaration gate', () => {
  it('no declaration is refused before any sponsor work', async () => {
    const r = await post({ address, handle: 'kaela_two' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/declaration is required/);
    expect(sponsorAsked).toBe(0);
  });

  it('an agent naming itself as operator is refused', async () => {
    const r = await post({ address, handle: 'kaela_two', declaration: await half(agent, address) });
    expect(r.status).toBe(400);
    expect(sponsorAsked).toBe(0);
  });

  it('a half signed by another key is refused', async () => {
    const r = await post({ address, handle: 'kaela_two', declaration: await half(new Ed25519Keypair()) });
    expect(r.status).toBe(401);
    expect(sponsorAsked).toBe(0);
  });

  it('a properly signed half passes the gate and reaches the sponsor', async () => {
    const r = await post({ address, handle: 'kaela_two', declaration: await half() });
    // The sponsor is mocked unconfigured, so the route answers 501 AFTER the gate — proof the gate passed.
    expect(r.status, await r.clone().text()).toBe(501);
    expect(sponsorAsked).toBe(1);
  });
});
