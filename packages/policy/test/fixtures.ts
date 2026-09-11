// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { LedgerState, PolicyDoc, SimulatedEffects } from '../src/index.js';
import type { RuleId } from '../src/rules.js';

export const AGENT = '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d';

export const CREATOR = '0x00000000000000000000000000000000000000000000000000000000000000aa';

export const STRANGER = '0x00000000000000000000000000000000000000000000000000000000000000bb';

export const SUI_TYPE =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

export const USDC_TYPE =
  '0x00000000000000000000000000000000000000000000000000000000000000dd::usdc::USDC';

export const PACKAGE = '0x00000000000000000000000000000000000000000000000000000000000000c5';

export const UNLOCK = `${PACKAGE}::creator::unlock`;
export const CLAIM_EARNINGS = `${PACKAGE}::creator::claim_earnings`;

export const PLATFORM = '0x3f695b2c32714e2359c4bb9515598d8dd765b216148c5b8fa818073d52b50f36';
export const CLOCK_SHORT = '0x6';
export const CLOCK_PADDED = '0x0000000000000000000000000000000000000000000000000000000000000006';
export const ACCOUNT = '0x00000000000000000000000000000000000000000000000000000000000000e1';
export const VAULT = '0x00000000000000000000000000000000000000000000000000000000000000c0';
export const ATTACKER_VAULT = '0x00000000000000000000000000000000000000000000000000000000000000ba';

export const POLICY: PolicyDoc = {
  version: 1,
  agentAddress: AGENT,
  outflowCeilings: [{ coinType: '0x2::sui::SUI', maxPerPeriod: '10000000', periodMs: 86_400_000 }],
  allowedTargets: [UNLOCK],
  allowedTypeArguments: ['0x2::sui::SUI'],
  allowedRecipients: [AGENT],
  allowedObjects: [PLATFORM, VAULT, ACCOUNT, CLOCK_SHORT],
  maxGasBudgetMist: '20000000',
  allowedCommandKinds: ['MoveCall', 'SplitCoins', 'TransferObjects'],
};

export const POLICY_WITH_APPROVAL_BAR: PolicyDoc = {
  ...POLICY,
  approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '500000' }],
};

export const NOW = 1_788_000_000_000;
export const LEDGER: LedgerState = { nowMs: NOW, spend: [] };

export const BASELINE: SimulatedEffects = {
  sender: AGENT,
  gasBudgetMist: '1188000',
  balanceChanges: [
    { coinType: SUI_TYPE, address: AGENT, amount: '-1088000' },
    { coinType: SUI_TYPE, address: CREATOR, amount: '1000000' },
  ],
  balanceChangesObserved: true,
  moveCalls: [{ index: 1, target: UNLOCK, typeArguments: [SUI_TYPE] }],
  transfers: [{ index: 2, recipient: AGENT }],
  commandKinds: ['SplitCoins', 'MoveCall', 'TransferObjects'],
  objectInputs: [
    { index: 0, objectId: PLATFORM, ownership: 'shared', commandIndexes: [1] },
    { index: 2, objectId: VAULT, ownership: 'shared', commandIndexes: [1] },
    { index: 3, objectId: ACCOUNT, ownership: 'imm-or-owned', commandIndexes: [1] },
    { index: 5, objectId: CLOCK_PADDED, ownership: 'shared', commandIndexes: [1] },
  ],
  observedAtMs: NOW,
};

export interface Violation {
  readonly ruleId: RuleId;
  readonly what: string;
  readonly effects: SimulatedEffects;
  readonly policy: PolicyDoc;
  readonly ledger: LedgerState;
}

export const VIOLATIONS: readonly Violation[] = [
  {
    ruleId: 'policy-version',
    what: 'a policy document from a schema this evaluator does not understand',
    effects: BASELINE,
    policy: { ...POLICY, version: 2 as unknown as 1 },
    ledger: LEDGER,
  },
  {
    ruleId: 'sender-mismatch',
    what: 'a simulation belonging to a different address than the policy governs',
    effects: { ...BASELINE, sender: STRANGER },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'command-kind',
    what: 'a Publish command, which has no target and no recipient to check',
    effects: { ...BASELINE, commandKinds: ['SplitCoins', 'MoveCall', 'TransferObjects', 'Publish'] },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'move-call-target',
    what: 'claim_earnings called by an agent authorised only to buy',
    effects: {
      ...BASELINE,
      moveCalls: [{ index: 1, target: CLAIM_EARNINGS, typeArguments: [SUI_TYPE] }],
    },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'type-argument',
    what: 'an allowed function instantiated at a coin type the policy never permitted',
    effects: {
      ...BASELINE,
      moveCalls: [{ index: 1, target: UNLOCK, typeArguments: [USDC_TYPE] }],
    },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'transfer-recipient',
    what: 'the purchased object transferred to a stranger instead of home',
    effects: { ...BASELINE, transfers: [{ index: 2, recipient: STRANGER }] },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'object-input',
    what: "an attacker's vault substituted for the one the principal authorised",
    effects: {
      ...BASELINE,
      objectInputs: [
        { index: 0, objectId: PLATFORM, ownership: 'shared', commandIndexes: [1] },
        { index: 2, objectId: ATTACKER_VAULT, ownership: 'shared', commandIndexes: [1] },
        { index: 3, objectId: ACCOUNT, ownership: 'imm-or-owned', commandIndexes: [1] },
        { index: 5, objectId: CLOCK_PADDED, ownership: 'shared', commandIndexes: [1] },
      ],
    },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'gas-budget',
    what: 'a gas budget above the ceiling',
    effects: { ...BASELINE, gasBudgetMist: '20000001' },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'balance-evidence',
    what: 'a simulation whose balance changes were never requested',
    effects: { ...BASELINE, balanceChanges: [], balanceChangesObserved: false },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'amount-wellformed',
    what: 'an amount that BigInt would read as zero',
    effects: {
      ...BASELINE,
      balanceChanges: [{ coinType: SUI_TYPE, address: AGENT, amount: '' }],
    },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'coin-type-unlisted',
    what: 'an outflow in a coin type the policy configures no ceiling for',
    effects: {
      ...BASELINE,
      balanceChanges: [{ coinType: USDC_TYPE, address: AGENT, amount: '-1' }],
    },
    policy: POLICY,
    ledger: LEDGER,
  },
  {
    ruleId: 'outflow-ceiling',
    what: 'a spend that is inside the per-transaction figure but over the rolling window total',
    effects: BASELINE,
    policy: POLICY,
    ledger: {
      nowMs: NOW,
      spend: [{ coinType: '0x2::sui::SUI', amountOut: '9000000', atMs: NOW - 1000 }],
    },
  },
  {
    ruleId: 'approval-threshold',
    what: 'a spend inside the ceiling but above what the agent may spend unattended, with no approval',
    effects: BASELINE,
    policy: POLICY_WITH_APPROVAL_BAR,
    ledger: LEDGER,
  },
];
