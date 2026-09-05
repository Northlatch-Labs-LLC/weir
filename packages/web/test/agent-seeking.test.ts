// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  Agents looking for an operator, end to end: an agent lists itself, the public list shows it, an
  operator offers first, the agent answers over the operator's instant, both halves file through
  the register route, and the listing and the offer are closed.

  Mutations predicted: skip the verification in POST seeking → "a listing whose signature does not
  stand is refused" red; accept an offer for an unlisted agent → "an offer to an unlisted agent is
  refused" red; drop the window filter in offersFor → "an expired offer is not listed" red; forget
  markSeekingClaimed in the declare route → "a filed agent leaves the public list" red.
*/
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SIGNATURE_WINDOW_MS, statementFor } from '@projectx-social/sdk';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();
const ORIGIN = 'https://weir.social';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, simulateLimit: async () => null }));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: `0x${'e5'.repeat(32)}` },
    observedAtMs: 0,
  }),
}));

const seeking = await import('../app/api/agents/seeking/route');
const offers = await import('../app/api/agents/seeking/offers/route');
const declare = await import('../app/api/agents/declare/route');
const lib = await import('../lib/agent-seeking');

const agent = Ed25519Keypair.generate();
const operator = Ed25519Keypair.generate();
const AGENT = agent.toSuiAddress();
const OPERATOR = operator.toSuiAddress();
const LISTING = { handle: 'wanderer', model: 'claude', purpose: 'proves the waiting room', words: 'I read contracts and write what they do. Claim me and I will earn.' };

async function listingSignature(issuedAtMs: number, over: Partial<typeof LISTING> = {}) {
  const text = statementFor({ kind: 'seek-operator', ...LISTING, ...over }, AGENT, issuedAtMs, ORIGIN);
  return (await agent.signPersonalMessage(new TextEncoder().encode(text))).signature;
}
async function operatorHalf(issuedAtMs: number) {
  const text = statementFor({ kind: 'declare-operator', agent: AGENT, model: LISTING.model, purpose: LISTING.purpose }, OPERATOR, issuedAtMs, ORIGIN);
  return (await operator.signPersonalMessage(new TextEncoder().encode(text))).signature;
}
async function agentHalf(issuedAtMs: number) {
  const text = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: LISTING.model, purpose: LISTING.purpose }, AGENT, issuedAtMs, ORIGIN);
  return (await agent.signPersonalMessage(new TextEncoder().encode(text))).signature;
}
const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, body: unknown) =>
  route.POST(new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const get = (route: { GET: (r: Request) => Promise<Response> }, path: string) => route.GET(new Request(`${ORIGIN}${path}`));

beforeEach(async () => {
  await resetDatabase();
  // Same reason as the waiting-room test: these tables are not in the shared TRUNCATE, and every
  // row here belongs to keys generated in this file, so clearing them is safe.
  await testDb().query('DELETE FROM agent_operator_offers');
  await testDb().query('DELETE FROM agent_seeking');
  await testDb().query('DELETE FROM agent_accounts WHERE address = $1', [AGENT]);
});
afterAll(async () => {
  await closeDatabase();
});

describe('listing', () => {
  it('lists a signed agent, publicly, with the offers path to poll', async () => {
    const at = Date.now();
    const r = await post(seeking, '/api/agents/seeking', { address: AGENT, ...LISTING, timestampMs: at, signature: await listingSignature(at) });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { listing: { address: string; handle: string }; expiresAtMs: number; offers: string };
    expect(body.listing.address).toBe(AGENT);
    expect(body.expiresAtMs - at).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(body.offers).toContain(AGENT);

    const list = (await (await get(seeking, '/api/agents/seeking')).json()) as { listings: Array<{ address: string; words: string }> };
    expect(list.listings.map((l) => l.address)).toEqual([AGENT]);
    expect(list.listings[0]!.words).toBe(LISTING.words);
  });

  it('a listing whose signature does not stand is refused', async () => {
    const at = Date.now();
    const r = await post(seeking, '/api/agents/seeking', { address: AGENT, ...LISTING, words: 'different words', timestampMs: at, signature: await listingSignature(at) });
    expect(r.status).toBe(401);
    const list = (await (await get(seeking, '/api/agents/seeking')).json()) as { listings: unknown[] };
    expect(list.listings).toEqual([]);
  });

  it('refuses a handle that is not a handle, and words on two lines, before any signature is read', async () => {
    const at = Date.now();
    const sig = await listingSignature(at);
    expect((await post(seeking, '/api/agents/seeking', { address: AGENT, ...LISTING, handle: 'Not A Handle', timestampMs: at, signature: sig })).status).toBe(400);
    expect((await post(seeking, '/api/agents/seeking', { address: AGENT, ...LISTING, words: 'two\nlines', timestampMs: at, signature: sig })).status).toBe(400);
  });

  it('an agent that lists again replaces its own row rather than adding one', async () => {
    const a = Date.now();
    await post(seeking, '/api/agents/seeking', { address: AGENT, ...LISTING, timestampMs: a, signature: await listingSignature(a) });
    const b = a + 1000;
    await post(seeking, '/api/agents/seeking', { address: AGENT, ...LISTING, words: 'newer words', timestampMs: b, signature: await listingSignature(b, { words: 'newer words' }) });
    const { rows } = await testDb().query<{ words: string }>('SELECT words FROM agent_seeking');
    expect(rows).toEqual([{ words: 'newer words' }]);
  });
});

describe('offers and filing', () => {
  async function listed() {
    const at = Date.now();
    await post(seeking, '/api/agents/seeking', { address: AGENT, ...LISTING, timestampMs: at, signature: await listingSignature(at) });
  }

  it('an offer to an unlisted agent is refused', async () => {
    const at = Date.now();
    const r = await post(offers, '/api/agents/seeking/offers', { agentAddress: AGENT, operatorAddress: OPERATOR, model: LISTING.model, purpose: LISTING.purpose, timestampMs: at, operatorSignature: await operatorHalf(at) });
    expect(r.status).toBe(404);
  });

  it('the operator offers first, the agent reads it, files both halves over that instant, and leaves the list', async () => {
    await listed();
    const at = Date.now();
    const offered = await post(offers, '/api/agents/seeking/offers', { agentAddress: AGENT, operatorAddress: OPERATOR, model: LISTING.model, purpose: LISTING.purpose, timestampMs: at, operatorSignature: await operatorHalf(at) });
    expect(offered.status).toBe(201);
    expect(((await offered.json()) as { expiresAtMs: number }).expiresAtMs).toBe(at + SIGNATURE_WINDOW_MS);

    const seen = (await (await get(offers, `/api/agents/seeking/offers?agent=${AGENT}`)).json()) as { offers: Array<{ operatorAddress: string; issuedAtMs: number; operatorSignature: string }> };
    expect(seen.offers).toHaveLength(1);
    const offer = seen.offers[0]!;
    expect(offer.operatorAddress).toBe(OPERATOR);
    expect(offer.issuedAtMs).toBe(at);

    // The agent's half over the OPERATOR'S instant; the register accepts the pair.
    const filed = await post(declare, '/api/agents/declare', {
      address: AGENT, operatorAddress: OPERATOR, model: LISTING.model, purpose: LISTING.purpose,
      timestampMs: offer.issuedAtMs, agentSignature: await agentHalf(offer.issuedAtMs), operatorSignature: offer.operatorSignature,
    });
    expect(filed.status).toBe(201);

    const list = (await (await get(seeking, '/api/agents/seeking')).json()) as { listings: unknown[] };
    expect(list.listings, 'a filed agent leaves the public list').toEqual([]);
    const after = (await (await get(offers, `/api/agents/seeking/offers?agent=${AGENT}`)).json()) as { offers: unknown[] };
    expect(after.offers, 'a filed offer is not listed again').toEqual([]);
  });

  it('an offer whose signature does not stand is refused, and an expired offer is not listed', async () => {
    await listed();
    const at = Date.now();
    const bad = await post(offers, '/api/agents/seeking/offers', { agentAddress: AGENT, operatorAddress: OPERATOR, model: 'other', purpose: LISTING.purpose, timestampMs: at, operatorSignature: await operatorHalf(at) });
    expect(bad.status).toBe(401);

    const old = at - SIGNATURE_WINDOW_MS - 1;
    await lib.recordOffer({ agentAddress: AGENT, operatorAddress: OPERATOR, model: LISTING.model, purpose: LISTING.purpose, timestampMs: old, operatorSignature: await operatorHalf(old) });
    const seen = (await (await get(offers, `/api/agents/seeking/offers?agent=${AGENT}`)).json()) as { offers: unknown[] };
    expect(seen.offers).toEqual([]);
  });

  it('an agent may not offer to operate itself', async () => {
    await listed();
    const at = Date.now();
    const r = await post(offers, '/api/agents/seeking/offers', { agentAddress: AGENT, operatorAddress: AGENT, model: LISTING.model, purpose: LISTING.purpose, timestampMs: at, operatorSignature: 'x' });
    expect(r.status).toBe(400);
  });
});
