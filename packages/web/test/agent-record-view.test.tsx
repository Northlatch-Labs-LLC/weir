// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatorVaultState, Reading } from '@projectx-social/sdk';
import { AgentRecordView } from '../components/design/AgentRecord';
import { buildAgentRecord } from '../lib/agent-record';
import type { AgentAccount } from '../lib/agents';
import type { Profile } from '../lib/content';

afterEach(cleanup);

const hex = (c: string) => `0x${c.repeat(64)}`;
const SUI = '0x2::sui::SUI';
const ok = <T,>(value: T): Reading<T> => ({ ok: true, value, observedAtMs: 1 });
const failed = <T,>(detail: string): Reading<T> => ({ ok: false, failure: { kind: 'transport', source: 'test', detail } });

const profile: Profile = { handle: 'kaela_ai', displayName: 'Kaela', bio: '', owner: hex('1'), vaultId: hex('2'), coinType: SUI };
const account: AgentAccount = {
  address: hex('1'), operatorAddress: hex('9'), agentSignature: 'SIG-AGENT', operatorSignature: 'SIG-OPERATOR',
  model: 'claude', purpose: 'audit', declaredAtMs: 1_756_700_000_000, revokedAtMs: null,
};
const vault = {
  vaultId: hex('2'), owner: hex('1'), contentPricesTableId: hex('3'), feeBpsSnapshot: 290n, referralShareBpsSnapshot: 500n,
  tiers: [{ index: 0, name: 'Notes', price: 500_000_000n, periodMs: 30n * 86_400_000n, active: true }],
  minTip: 100_000_000n, accepting: true, earnings: 1_500_000_000n, platformFees: 43_500_000n,
} as CreatorVaultState;

function recordWith(over: Partial<Parameters<typeof buildAgentRecord>[0]> = {}) {
  return buildAgentRecord({
    profile, account,
    recovery: { agentKey: 'single', operatorCanRecover: false, line: 'operator cannot recover this agent: its address is a single key, held by the agent alone' },
    statements: { agent: 'weir.social\naction: declare agent', operator: 'weir.social\naction: declare operator' },
    vault: ok(vault), decimals: ok(9), posts: [], postsLimit: 20,
    purchases: ok({ unlocks: [], subscriptions: [], truncated: false }), purchaseDecimals: new Map(),
    ...over,
  });
}

describe('AgentRecordView', () => {
  it('shows the declaration, both signatures, the recovery line and the measured figures', () => {
    const { container } = render(<AgentRecordView record={recordWith()} />);
    const text = container.textContent ?? '';
    expect(text).toContain('SIG-AGENT');
    expect(text).toContain('SIG-OPERATOR');
    expect(text).toContain('action: declare operator');
    expect(text).toContain('operator cannot recover this agent');
    expect(text).toContain('1.5 SUI');
    expect(text).toContain('0.5 SUI per month');
    expect(text).toContain(`/api/agents/${hex('1')}`);
    expect(container.querySelectorAll('[data-unavailable="true"]')).toHaveLength(0);
  });

  it('renders a failed read as its sentence in the figure’s place, and no figure', () => {
    const { container } = render(<AgentRecordView record={recordWith({ vault: failed('node away') })} />);
    const text = container.textContent ?? '';
    expect(text).toContain('not measured: transport — node away');
    expect(text).not.toContain('1.5 SUI');
    expect(text).not.toContain('0 SUI');
    expect(container.querySelectorAll('[data-unavailable="true"]').length).toBeGreaterThanOrEqual(5);
  });

  it('marks a revoked declaration as revoked rather than hiding it', () => {
    const { container } = render(<AgentRecordView record={recordWith({ account: { ...account, revokedAtMs: 1_756_800_000_000 } })} />);
    expect(container.textContent).toContain('revoked');
  });
});
