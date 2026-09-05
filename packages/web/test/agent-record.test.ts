// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The agent's record: every number is a fact or the sentence that says why there is none.

  Mutations predicted: format an amount without decimals → "amounts are withheld when decimals
  were not read" red; turn a failed vault read into zeros → "a vault that could not be read is not
  a vault that earned nothing" red; drop the crumb rule → "the record page has a place in the
  map" red; point the explore card back at the API → "explore links to the record page" red.
*/
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CreatorVaultState, Reading } from '@projectx-social/sdk';
import { NOT_MEASURED, buildAgentRecord, coinLabel, factOf } from '../lib/agent-record';
import type { AgentAccount } from '../lib/agents';
import type { Recovery } from '../lib/agent-recovery';
import type { Post, Profile } from '../lib/content';
import type { Purchases } from '../lib/purchases';
import { crumbsFor, titleFor } from '../lib/site-map';
import { agentIdentityFor } from '../lib/agent-identity';

const hex = (c: string) => `0x${c.repeat(64)}`;
const SUI = '0x2::sui::SUI';
const USDC = `${hex('a')}::usdc::USDC`;

const profile: Profile = { handle: 'kaela_ai', displayName: 'Kaela', bio: 'audits contracts', owner: hex('1'), vaultId: hex('2'), coinType: SUI };
const account: AgentAccount = {
  address: hex('1'), operatorAddress: hex('9'), agentSignature: 'sig-a', operatorSignature: 'sig-o',
  model: 'claude', purpose: 'audit', declaredAtMs: 1_756_700_000_000, revokedAtMs: null,
};
const recovery: Recovery = { agentKey: 'single', operatorCanRecover: false, line: 'operator cannot recover this agent: its address is a single key, held by the agent alone' };
const statements = { agent: 'A', operator: 'O' };
const ok = <T,>(value: T): Reading<T> => ({ ok: true, value, observedAtMs: 1 });
const failed = <T,>(detail: string): Reading<T> => ({ ok: false, failure: { kind: 'transport', source: 'test', detail } });

const vault: CreatorVaultState = {
  vaultId: hex('2'), owner: hex('1'), contentPricesTableId: hex('3'), feeBpsSnapshot: 290n, referralShareBpsSnapshot: 500n,
  tiers: [{ index: 0, name: 'Notes', price: 500_000_000n, periodMs: 30n * 86_400_000n, active: true }],
  minTip: 100_000_000n, accepting: true, earnings: 1_500_000_000n, platformFees: 43_500_000n,
} as CreatorVaultState;

const post = (id: string, access: Post['access']): Post =>
  ({ id, vaultId: hex('2'), authorHandle: 'kaela_ai', createdAtMs: 1, title: `Post ${id}`, preview: '', body: '', access }) as Post;

const purchases: Purchases = {
  unlocks: [{ coinType: USDC, objectId: hex('5'), vaultId: hex('6'), handle: 'alice', contentKey: 'k#machine', title: 'Sold twice', edition: 'machine', pricePaid: 1_500_000n, purchasedAtMs: 5 }],
  subscriptions: [{ coinType: null, objectId: hex('7'), vaultId: hex('8'), handle: null, tier: 1, pricePaid: 10n, startedAtMs: 3, expiresAtMs: 9, renewals: 0, active: true }],
  truncated: false,
};

function build(over: Partial<Parameters<typeof buildAgentRecord>[0]> = {}) {
  return buildAgentRecord({
    profile, account, recovery, statements,
    vault: ok(vault), decimals: ok(9),
    posts: [post('p1', { kind: 'paid', price: '500000000', contentKey: 'k' }), post('p2', { kind: 'public' })],
    postsLimit: 20,
    purchases: ok(purchases),
    purchaseDecimals: new Map([[USDC, ok(6)]]),
    ...over,
  });
}

describe('factOf', () => {
  it('keeps "absent" and "failed" apart', () => {
    expect(factOf(null, String, 'no vault yet')).toEqual({ value: null, unavailable: 'no vault yet' });
    expect(factOf(failed<number>('node away'), String, 'no vault yet').unavailable).toContain(`${NOT_MEASURED}: transport — node away`);
    expect(factOf(ok(3), String, 'no vault yet')).toEqual({ value: '3', unavailable: null });
  });
  it('names a coin by its own type', () => {
    expect(coinLabel(SUI)).toBe('SUI');
    expect(coinLabel(USDC)).toBe('USDC');
  });
});

describe('buildAgentRecord', () => {
  it('formats every amount against decimals that were read', () => {
    const r = build();
    expect(r.vault.earnings.value).toBe('1.5 SUI');
    expect(r.vault.platformFees.value).toBe('0.0435 SUI');
    expect(r.vault.tiers?.[0]).toMatchObject({ name: 'Notes', period: 'per month', active: true });
    expect(r.vault.tiers?.[0]?.price.value).toBe('0.5 SUI');
    expect(r.work.rows[0]?.price?.value).toBe('0.5 SUI');
    expect(r.work.rows[1]?.price).toBeNull();
    expect(r.purchases.rows.find((p) => p.kind === 'unlock')?.paid.value).toBe('1.5 USDC');
  });

  it('amounts are withheld when decimals were not read, and the sentence says which read is missing', () => {
    const r = build({ decimals: failed<number>('metadata unreadable') });
    expect(r.vault.earnings.value).toBeNull();
    expect(r.vault.earnings.unavailable).toContain('metadata unreadable');
    expect(r.work.rows[0]?.price?.value).toBeNull();
    // A purchase paid in a coin this deployment does not know is withheld too, never guessed at nine decimals.
    const sub = r.purchases.rows.find((p) => p.kind === 'subscription');
    expect(sub?.paid.value).toBeNull();
    expect(sub?.paid.unavailable).toContain("does not know the seller's coin");
  });

  it('a vault that could not be read is not a vault that earned nothing', () => {
    const r = build({ vault: failed<CreatorVaultState>('node away') });
    expect(r.vault.earnings.value).toBeNull();
    expect(r.vault.earnings.unavailable).toContain(NOT_MEASURED);
    expect(r.vault.tiers).toBeNull();
    // No figure anywhere in the vault block: every fact carries its sentence and no value.
    for (const fact of [r.vault.accepting, r.vault.earnings, r.vault.platformFees, r.vault.minTip]) {
      expect(fact.value).toBeNull();
      expect(fact.unavailable).toContain('node away');
    }
  });

  it('no vault is an ordinary absence, said in its own words', () => {
    const r = build({ profile: { ...profile, vaultId: null, coinType: null }, vault: null, decimals: null });
    expect(r.vault.id).toBeNull();
    expect(r.vault.earnings.unavailable).toMatch(/no vault yet/);
    expect(r.vault.earnings.unavailable).not.toContain(NOT_MEASURED);
  });

  it('purchases that could not be read are not zero purchases', () => {
    const r = build({ purchases: failed<Purchases>('walk failed') });
    expect(r.purchases.unlocks.value).toBeNull();
    expect(r.purchases.unlocks.unavailable).toContain('walk failed');
    expect(r.purchases.rows).toEqual([]);
  });

  it('says when the work list is the recent tail rather than the archive', () => {
    const many = Array.from({ length: 20 }, (_, i) => post(`p${i}`, { kind: 'public' }));
    expect(build({ posts: many, postsLimit: 20 }).work.truncated).toBe(true);
    expect(build({ posts: many.slice(0, 19), postsLimit: 20 }).work.truncated).toBe(false);
  });

  it('carries the declaration verbatim: both statements, both signatures, the API path', () => {
    const r = build();
    expect(r.statements).toEqual(statements);
    expect(r.signatures).toEqual({ agent: 'sig-a', operator: 'sig-o' });
    expect(r.apiPath).toBe(`/api/agents/${hex('1')}`);
    expect(r.recovery.line).toContain('operator cannot recover this agent');
  });
});

describe('the record page has a place in the map', () => {
  it('is titled by the handle and sits under the agents explore', () => {
    expect(titleFor('/agents/kaela_ai')).toBe('@kaela_ai record');
    expect(crumbsFor('/agents/kaela_ai').map((c) => c.href)).toContain('/explore/agents');
  });
  it('explore links to the record page when the agent has a handle, and to the API entry when it does not', () => {
    const page = readFileSync(new URL('../app/explore/agents/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('`/agents/${encodeURIComponent(profile.handle)}`');
    expect(page).toContain('`/api/agents/${agent.address}`');
  });
  it('the page answers 404 for a handle that is not a declared agent, never an empty record', () => {
    const page = readFileSync(new URL('../app/agents/[handle]/page.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/const account = await agentAccount\(profile\.owner\);\s*if \(account === null\) notFound\(\);/);
  });
  it('the identity line on a creator page points at the record page when the handle is known', () => {
    const declared = agentIdentityFor(account, 'kaela_ai');
    expect(declared.state).toBe('declared');
    if (declared.state === 'declared') expect(declared.recordPath).toBe('/agents/kaela_ai');
    const bare = agentIdentityFor(account);
    if (bare.state === 'declared') expect(bare.recordPath).toBe(`/api/agents/${hex('1')}`);
    const page = readFileSync(new URL('../app/c/[handle]/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain("agentIdentityFor(await agentAccountOrUnread(profile.owner, 'creator'), profile.handle)");
  });
});
