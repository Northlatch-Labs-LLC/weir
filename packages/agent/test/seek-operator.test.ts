// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The reversed declaration: list, read offers, accept over the operator's instant. Wire-exact.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { describe, expect, it } from 'vitest';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { statementFor } from '@projectx-social/sdk';
import { createAgent, generateAgentKey, MAINNET_RECORD } from '../src/index.js';

const FULL_ENV = {
  PROJECTX_SOCIAL_NETWORK: 'mainnet',
  PROJECTX_SOCIAL_GRPC_URL: 'https://fullnode.mainnet.sui.io:443',
  PROJECTX_SOCIAL_PACKAGE_ID: MAINNET_RECORD.packageId,
  PROJECTX_SOCIAL_LATEST_PACKAGE_ID: MAINNET_RECORD.latestPackageId,
  PROJECTX_SOCIAL_PLATFORM_ID: MAINNET_RECORD.platformId,
  PROJECTX_SOCIAL_REGISTRY_ID: MAINNET_RECORD.registryId,
  PROJECTX_SOCIAL_AGENT_COIN_TYPE: MAINNET_RECORD.usdcType,
  PROJECTX_SOCIAL_AGENT_BASE_URL: 'https://weir.social',
};
type Call = { url: string; method: string; body: Record<string, unknown> | null };
const OPERATOR = `0x${'b'.repeat(64)}`;

function deployment(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? null : JSON.parse(init.body) });
    if (url.endsWith('/api/session')) return { ok: true, status: 200, json: async () => ({ address: 'x', expiresAtMs: Date.now() + 86_400_000, token: 't' }) };
    const key = Object.keys(answers).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => (key ? answers[key] : {}) };
  }) as unknown as NonNullable<Parameters<typeof createAgent>[0]['fetchImpl']>;
  return { fetchImpl, calls };
}
function keyed(fetchImpl: NonNullable<Parameters<typeof createAgent>[0]['fetchImpl']>) {
  const { key } = generateAgentKey();
  const made = createAgent({ keypair: key, config: FULL_ENV, client: {} as SuiGrpcClient, fetchImpl });
  if (!made.ok) throw new Error(made.failure.detail);
  return made.value;
}
const LISTING = { handle: 'wanderer', model: 'claude', purpose: 'proves the list', words: 'I read contracts. Claim me.' };

describe('seekOperator', () => {
  it('posts the listing the route parses and signs the seek-operator statement over the same fields', async () => {
    const { fetchImpl, calls } = deployment({ '/api/agents/seeking': { listing: {}, expiresAtMs: 123, offers: '/api/agents/seeking/offers?agent=x' } });
    const agent = keyed(fetchImpl);
    const r = await agent.seekOperator(LISTING);
    expect(r.ok).toBe(true);
    const call = calls.find((c) => c.url.endsWith('/api/agents/seeking'))!;
    expect(Object.keys(call.body ?? {}).sort()).toEqual(['address', 'handle', 'model', 'purpose', 'signature', 'timestampMs', 'words'].sort());
    const body = call.body as { timestampMs: number; signature: string };
    const statement = statementFor({ kind: 'seek-operator', ...LISTING }, agent.address, body.timestampMs, 'https://weir.social');
    const pk = await verifyPersonalMessageSignature(new TextEncoder().encode(statement), body.signature);
    expect(pk.toSuiAddress()).toBe(agent.address);
  });

  it('refuses words on two lines before signing anything', async () => {
    const { fetchImpl, calls } = deployment({});
    const r = await keyed(fetchImpl).seekOperator({ ...LISTING, words: 'two\nlines' });
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/api/agents/seeking'))).toBe(false);
  });
});

describe('operatorOffers and acceptOffer', () => {
  it('reads the offers naming this agent and accepts one over the OPERATOR\'S instant', async () => {
    const at = Date.now();
    const { fetchImpl, calls } = deployment({
      '/api/agents/seeking/offers': { offers: [{ operatorAddress: OPERATOR, model: 'claude', purpose: 'proves the list', issuedAtMs: at, expiresAtMs: at + 600_000, operatorSignature: 'OP-SIG' }] },
      '/api/agents/declare': { agent: { address: 'x' } },
    });
    const agent = keyed(fetchImpl);
    const offers = await agent.operatorOffers();
    expect(offers.ok).toBe(true);
    if (!offers.ok) return;
    expect(offers.value[0]!.operatorAddress).toBe(OPERATOR);

    const accepted = await agent.acceptOffer(offers.value[0]!);
    expect(accepted.ok).toBe(true);
    const filed = calls.find((c) => c.url.endsWith('/api/agents/declare'))!;
    const body = filed.body as { timestampMs: number; agentSignature: string; operatorSignature: string; operatorAddress: string };
    expect(body.timestampMs, 'the agent half repeats the operator\'s instant').toBe(at);
    expect(body.operatorSignature).toBe('OP-SIG');
    const statement = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: 'claude', purpose: 'proves the list' }, agent.address, at, 'https://weir.social');
    const pk = await verifyPersonalMessageSignature(new TextEncoder().encode(statement), body.agentSignature);
    expect(pk.toSuiAddress()).toBe(agent.address);
  });

  it('refuses an expired offer as a precondition, without filing', async () => {
    const { fetchImpl, calls } = deployment({});
    const r = await keyed(fetchImpl).acceptOffer({ operatorAddress: OPERATOR, model: 'm', purpose: 'p', issuedAtMs: 1, expiresAtMs: 2, operatorSignature: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('precondition');
    expect(calls.some((c) => c.url.endsWith('/api/agents/declare'))).toBe(false);
  });
});
