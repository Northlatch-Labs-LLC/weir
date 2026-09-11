// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import type { LedgerState, PolicyDoc } from '@projectx-social/policy';
import { policySigner, readOnlySigner, type SimulationPort } from '../src/index.js';
import {
  CLAIM_EARNINGS,
  SUI_TYPE,
  mainnetSuccessResponse,
  policyFor,
  signerFor,
} from './helpers.js';

const KEYPAIR = Ed25519Keypair.generate();
const AGENT = KEYPAIR.toSuiAddress();
const EMPTY: () => LedgerState = () => ({ nowMs: 1_788_000_000_000, spend: [] });

function localTransaction(): Transaction {
  const tx = new Transaction();
  tx.setSender(AGENT);
  tx.setGasPrice(1000n);
  tx.setGasBudget(1_188_000n);
  tx.setGasPayment([
    {
      objectId: `0x${'7'.repeat(64)}`,
      version: '1',
      digest: '11111111111111111111111111111111',
    },
  ]);
  const [coin] = tx.splitCoins(tx.gas, [1n]);
  tx.transferObjects([coin!], AGENT);
  return tx;
}

function stubClient(response: unknown): SuiGrpcClient {
  return { simulateTransaction: async () => response } as unknown as SuiGrpcClient;
}

function stubPort(response: unknown, sender: string = AGENT): SimulationPort {
  return {
    observe: async ({ transactionBytes }) => {
      expect(transactionBytes.byteLength).toBeGreaterThan(0);
      const { readSimulation } = await import('../src/evidence.js');
      return readSimulation(response, sender);
    },
  };
}

function makeSigner(overrides: {
  policy?: PolicyDoc;
  response?: unknown;
  ledger?: () => LedgerState;
  inner?: ReturnType<typeof signerFor>;
}) {
  const response = overrides.response ?? mainnetSuccessResponse(AGENT);
  return policySigner({
    inner: overrides.inner ?? signerFor(KEYPAIR),
    policy: overrides.policy ?? policyFor(AGENT),
    client: stubClient(response),
    ledger: overrides.ledger ?? EMPTY,
    simulation: stubPort(response),
  });
}

describe('a permitted transaction', () => {
  it('is signed, and the signature verifies over the exact bytes that were simulated', async () => {
    const signer = makeSigner({});
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const publicKey = await verifyTransactionSignature(result.value.bytes, result.value.signature, {
      address: AGENT,
    });
    expect(publicKey.toSuiAddress()).toBe(AGENT);
    expect(result.value.txDigest).toBe('2Wm1kXwYxPjkjVqT1rvHi9oqmvSZY3md6eirK8WheHbR');
  });

  it('records the allow entry, and the chain verifies', async () => {
    const signer = makeSigner({});
    await signer.signTransaction(localTransaction());
    const entries = signer.audit.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.decision).toBe('allow');
    expect(entries[0]!.policyHash).toBe(signer.policyHash);
    expect(signer.audit.verify().intact).toBe(true);
  });

  it('returns the effects, so the caller can record the spend against its own ledger', async () => {
    const signer = makeSigner({});
    const result = await signer.signTransaction(localTransaction());
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.effects.balanceChanges[0]!.amount).toBe('-1088000');
  });
});

describe('the policy gate', () => {
  it('refuses claim_earnings for an agent authorised only to buy', async () => {
    const response = mainnetSuccessResponse(AGENT);
    response.Transaction.transaction.commands[1] = {
      $kind: 'MoveCall',
      MoveCall: {
        package: CLAIM_EARNINGS.split('::')[0]!,
        module: 'creator',
        function: 'claim_earnings',
        typeArguments: [SUI_TYPE],
        arguments: [],
      },
    } as (typeof response)['Transaction']['transaction']['commands'][number];

    const signer = makeSigner({ response });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure.detail).toContain('move-call-target');
    expect(result.failure.detail).toContain('claim_earnings');
  });

  it('refuses a spend over the rolling ceiling, counting prior spend', async () => {
    const signer = makeSigner({
      ledger: () => ({
        nowMs: 1_788_000_000_000,
        spend: [{ coinType: SUI_TYPE, amountOut: '9500000', atMs: 1_788_000_000_000 - 5 }],
      }),
    });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure.detail).toContain('outflow-ceiling');
  });

  it('records the refusal with its full reason — a denial is evidence, not noise', async () => {
    const signer = makeSigner({
      ledger: () => ({
        nowMs: 1_788_000_000_000,
        spend: [{ coinType: SUI_TYPE, amountOut: '9500000', atMs: 1_788_000_000_000 - 5 }],
      }),
    });
    await signer.signTransaction(localTransaction());
    const entries = signer.audit.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.decision).toBe('deny');
    expect(entries[0]!.reason).toContain('outflow-ceiling');
    expect(signer.audit.verify().intact).toBe(true);
  });

  it('never signs when it refuses', async () => {
    const inner = signerFor(KEYPAIR);
    const spy = vi.spyOn(inner, 'signTransaction');
    const signer = policySigner({
      inner,
      policy: policyFor(AGENT),
      client: stubClient(mainnetSuccessResponse(AGENT)),
      ledger: () => ({
        nowMs: 1_788_000_000_000,
        spend: [{ coinType: SUI_TYPE, amountOut: '99999999', atMs: 1_788_000_000_000 }],
      }),
      simulation: stubPort(mainnetSuccessResponse(AGENT)),
    });
    await signer.signTransaction(localTransaction());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the approval threshold at the signing boundary', () => {
  const BARRED: PolicyDoc = {
    ...policyFor(AGENT),
    approvalThresholds: [{ coinType: SUI_TYPE, maxWithoutApproval: '500000' }],
  };

  it('refuses, records the rule by name, and never reaches the inner signer', async () => {
    const inner = signerFor(KEYPAIR);
    const spy = vi.spyOn(inner, 'signTransaction');
    const signer = makeSigner({ policy: BARRED, inner });

    const result = await signer.signTransaction(localTransaction());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure.detail).toContain('approval-threshold');
    expect(spy).not.toHaveBeenCalled();
    expect(signer.audit.entries[0]!.decision).toBe('deny');
    expect(signer.audit.verify().intact).toBe(true);
  });

  it('signs once the operator has approved, and the audit still verifies', async () => {
    const signer = makeSigner({
      policy: BARRED,
      ledger: () => ({
        nowMs: 1_788_000_000_000,
        spend: [],
        approvals: [
          { coinType: SUI_TYPE, maxAmount: '1088000', expiresAtMs: 1_788_000_000_001 },
        ],
      }),
    });

    const result = await signer.signTransaction(localTransaction());

    expect(result.ok).toBe(true);
    expect(signer.audit.entries[0]!.decision).toBe('allow');
    expect(signer.audit.verify().intact).toBe(true);
  });
});

describe('the simulation gate', () => {
  it('refuses an aborting transaction and reports the decoded abort, not a shape mismatch', async () => {
    const failed = {
      $kind: 'FailedTransaction',
      FailedTransaction: {
        status: {
          success: false,
          error: {
            message:
              "MoveAbort in 2nd command, abort code: 12, in '0xc5c8::creator::unlock' (instruction 55)",
          },
        },
        balanceChanges: [],
        effects: { transactionDigest: 'abc' },
        transaction: {
          sender: AGENT,
          gasData: { budget: '1188000', payment: [], price: '100' },
          inputs: [],
          commands: [],
        },
      },
    };
    const signer = makeSigner({ response: failed });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure.detail).toContain('would abort');
    expect(result.failure.detail).toContain('This content is not for sale.');
    expect(result.failure.detail).not.toContain('shape mismatch');
  });

  it('refuses when the SDK gate cannot confirm success, even though the effects reader could', async () => {
    const good = mainnetSuccessResponse(AGENT);
    const signer = policySigner({
      inner: signerFor(KEYPAIR),
      policy: policyFor(AGENT),
      client: stubClient({ somethingElse: true }),
      ledger: EMPTY,
      simulation: stubPort(good),
    });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure.detail).toContain('SDK simulation gate did not confirm success');
  });

  it('refuses when the simulation could not be read at all', async () => {
    const signer = makeSigner({ response: { $kind: 'Transaction' } });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure.detail).toContain('nothing was signed');
  });
});

describe('the inner adapter', () => {
  it('refusing to sign is recorded, and the allow entry that preceded it stands', async () => {
    const inner = readOnlySigner({
      address: AGENT,
      because: 'the cold key is held offline.',
    });
    const signer = policySigner({
      inner,
      policy: policyFor(AGENT),
      client: stubClient(mainnetSuccessResponse(AGENT)),
      ledger: EMPTY,
      simulation: stubPort(mainnetSuccessResponse(AGENT)),
    });

    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure.kind).toBe('unconfigured');

    const entries = signer.audit.entries;
    expect(entries.map((e) => e.decision)).toEqual(['allow', 'deny']);
    expect(entries[1]!.reason).toContain('the policy permitted this transaction');
    expect(signer.audit.verify().intact).toBe(true);
  });
});

describe('personal messages', () => {
  it('are signed without a policy evaluation, and recorded saying so', async () => {
    const signer = makeSigner({});
    const signature = await signer.signPersonalMessage(new TextEncoder().encode('prove yourself'));
    expect(signature.ok).toBe(true);
    const entries = signer.audit.entries;
    expect(entries[0]!.reason).toContain('no effects to evaluate');
  });
});

describe('the audit chain across a whole session', () => {
  it('interleaves allows and denials and stays verifiable', async () => {
    const signer = makeSigner({});
    await signer.signTransaction(localTransaction());
    await signer.signPersonalMessage(new TextEncoder().encode('a'));
    await signer.signTransaction(localTransaction());

    const verdict = signer.audit.verify();
    expect(verdict.intact).toBe(true);
    if (!verdict.intact) throw new Error('unreachable');
    expect(verdict.length).toBe(3);

    for (const entry of signer.audit.entries) {
      expect(entry.policyHash).toBe(signer.policyHash);
    }
  });
});

describe('a fault inside the gate is a recorded refusal, not an exception', () => {
  const throwingLedger = (): LedgerState => {
    throw new Error('the ledger store is unreachable');
  };

  it('a ledger that throws yields a Reading, not a rejected promise', async () => {
    const signer = makeSigner({ ledger: throwingLedger });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
  });

  it('and it is recorded as a denial', async () => {
    const signer = makeSigner({ ledger: throwingLedger });
    await signer.signTransaction(localTransaction());
    expect(signer.audit.entries).toHaveLength(1);
    expect(signer.audit.entries[0]?.decision).toBe('deny');
  });

  it('the recorded reason names the underlying fault', async () => {
    const signer = makeSigner({ ledger: throwingLedger });
    await signer.signTransaction(localTransaction());
    expect(signer.audit.entries[0]?.reason).toContain('the ledger store is unreachable');
    expect(signer.audit.entries[0]?.reason).toContain('nothing was signed');
  });

  it('no signature escapes when the gate faults', async () => {
    const signer = makeSigner({ ledger: throwingLedger });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    expect(signer.audit.entries.some((e) => e.decision === 'allow')).toBe(false);
  });

  it('an inner signer that throws is caught too', async () => {
    const signer = makeSigner({
      inner: {
        address: AGENT,
        scheme: 'ed25519',
        signPersonalMessage: async () => { throw new Error('the device is not connected'); },
        signTransaction: async () => { throw new Error('the device is not connected'); },
      } as unknown as ReturnType<typeof signerFor>,
    });
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(false);
    expect(signer.audit.entries.map((e) => e.decision)).toEqual(['allow', 'deny']);
  });

  it('signPersonalMessage catches a throwing adapter as well', async () => {
    const signer = makeSigner({
      inner: {
        address: AGENT,
        scheme: 'ed25519',
        signPersonalMessage: async () => { throw new Error('the device is not connected'); },
        signTransaction: async () => { throw new Error('the device is not connected'); },
      } as unknown as ReturnType<typeof signerFor>,
    });
    const result = await signer.signPersonalMessage(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    expect(signer.audit.entries).toHaveLength(1);
    expect(signer.audit.entries[0]?.decision).toBe('deny');
  });

  it('a permitted transaction is still signed — the wrapper changed nothing else', async () => {
    const signer = makeSigner({});
    const result = await signer.signTransaction(localTransaction());
    expect(result.ok).toBe(true);
  });
});
