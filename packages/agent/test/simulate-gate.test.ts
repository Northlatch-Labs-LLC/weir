// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { describe, expect, it } from 'vitest';

import { classificationOf, preconditionOf, simulateAndExecute } from '../src/index.js';
import type { AgentKey } from '../src/index.js';

const KEY: AgentKey = (() => {
  const keypair = Ed25519Keypair.generate();
  return { address: keypair.toSuiAddress(), keypair };
})();

const GAS_BUDGET = 500_000_000n;

function offlineTransaction(): Transaction {
  const tx = new Transaction();
  tx.setSender(KEY.address);
  tx.setGasPrice(1000n);
  tx.setGasPayment([
    { objectId: `0x${'2'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' },
  ]);
  tx.moveCall({ target: `0x${'a'.repeat(64)}::creator::unlock`, arguments: [tx.pure.u64(1n)] });
  return tx;
}

interface Recorded {
  simulated: number;
  signed: number;
}

function client(envelope: unknown): { client: SuiGrpcClient; calls: Recorded } {
  const calls: Recorded = { simulated: 0, signed: 0 };
  const fake = {
    simulateTransaction: async () => {
      calls.simulated += 1;
      return envelope;
    },
    signAndExecuteTransaction: async () => {
      calls.signed += 1;
      return { Transaction: { digest: 'DiGeSt1111111111111111111111111111111111111' } };
    },
  };
  return { client: fake as unknown as SuiGrpcClient, calls };
}

async function run(envelope: unknown) {
  const { client: c, calls } = client(envelope);
  const reading = await simulateAndExecute({
    client: c,
    transaction: offlineTransaction(),
    key: KEY,
    gasBudgetMist: GAS_BUDGET,
    what: 'creator::unlock "k"',
  });
  return { reading, calls };
}

const MAINNET_SUCCESS = { Transaction: { status: { success: true, error: null } } };

describe('the simulate branch is reached, and it is the only gate', () => {
  it('setting a gas budget means build() never dry-runs — so this branch always runs', async () => {
    const { calls } = await run(MAINNET_SUCCESS);
    expect(calls.simulated).toBe(1);
  });

  it('signs only after a simulation that was shown to succeed', async () => {
    const { reading, calls } = await run(MAINNET_SUCCESS);
    expect(reading.ok).toBe(true);
    expect(calls.signed).toBe(1);
    if (reading.ok) {
      expect(reading.value.digest).toBe('DiGeSt1111111111111111111111111111111111111');
      expect(reading.value.simulation.wouldSucceed).toBe(true);
    }
  });
});

describe('an unrecognised simulation envelope REFUSES', () => {
  it.each([
    ['an empty object', {}],
    ['a string', 'ok'],
    ['a plausible-looking envelope with no status', { Transaction: { effects: {} } }],
    ['the JSON-RPC path this transport does not use', { transaction: { status: { success: true } } }],
  ])('refuses %s and signs nothing', async (_name, envelope) => {
    const { reading, calls } = await run(envelope);
    expect(reading.ok).toBe(false);
    expect(calls.signed).toBe(0);
    if (!reading.ok) {
      expect(reading.failure.detail).toContain('no status field');
      expect(reading.failure.kind).toBe('malformed');
      expect(classificationOf(reading.failure)).toBe('permanent');
    }
  });

  it('refuses null the same way as any other unrecognised envelope', async () => {
    const { reading, calls } = await run(null);
    expect(reading.ok).toBe(false);
    expect(calls.signed).toBe(0);
    if (!reading.ok) {
      expect(reading.failure.detail).toContain('no status field');
      expect(reading.failure.kind).toBe('malformed');
      expect(classificationOf(reading.failure)).toBe('permanent');
    }
  });

  it('refuses the envelope the DELETED second reader used to accept', async () => {
    const { reading, calls } = await run({ Transaction: { effects: { status: { success: true } } } });
    expect(reading.ok).toBe(false);
    expect(calls.signed).toBe(0);
  });
});

describe('a failed simulation refuses, and says whether it can clear', () => {
  const abortEnvelope = (code: number, fn: string) => ({
    Transaction: {
      status: {
        success: false,
        error: `MoveAbort in 1st command, abort code: ${code}, in '0x${'c'.repeat(64)}::${fn}' (instruction 12)`,
      },
    },
  });

  it('a paused platform is a PRECONDITION, not a permanent refusal', async () => {
    const { reading, calls } = await run(abortEnvelope(4, 'platform::assert_can_create'));
    expect(reading.ok).toBe(false);
    expect(calls.signed).toBe(0);
    if (!reading.ok) {
      expect(classificationOf(reading.failure)).toBe('precondition');
      expect(preconditionOf(reading.failure)?.name).toBe('creation-paused');
      expect(preconditionOf(reading.failure)?.mayClear).toBe(true);
      expect(reading.failure.detail).toContain('set_creation_paused(false)');
    }
  });

  it('the SAME abort code in `account` is permanent — the module half is load-bearing', async () => {
    const { reading } = await run(abortEnvelope(4, 'account::open'));
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(classificationOf(reading.failure)).toBe('permanent');
      expect(preconditionOf(reading.failure)).toBeNull();
      expect(reading.failure.detail).toContain('This address already has an account');
    }
  });

  it('a creator not accepting payments is a precondition', async () => {
    const { reading } = await run(abortEnvelope(4, 'creator::settle'));
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(preconditionOf(reading.failure)?.name).toBe('vault-not-accepting');
    }
  });

  it('an insufficient payment is a precondition — it clears when the wallet is funded', async () => {
    const { reading } = await run(abortEnvelope(5, 'creator::settle'));
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(preconditionOf(reading.failure)?.name).toBe('insufficient-balance');
    }
  });

  it('a self-payment is permanent', async () => {
    const { reading } = await run(abortEnvelope(13, 'creator::settle'));
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(classificationOf(reading.failure)).toBe('permanent');
  });

  it('an unlisted abort code is NOT assumed to be a precondition', async () => {
    const { reading } = await run(abortEnvelope(99, 'creator::settle'));
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(classificationOf(reading.failure)).toBe('permanent');
      expect(reading.failure.detail).toContain('abort code: 99');
    }
  });

  it('a failure with no abort in it passes the node text through unmodified', async () => {
    const { reading, calls } = await run({
      Transaction: { status: { success: false, error: 'InsufficientGas' } },
    });
    expect(reading.ok).toBe(false);
    expect(calls.signed).toBe(0);
    if (!reading.ok) expect(reading.failure.detail).toContain('InsufficientGas');
  });
});

describe('the bytes simulated are the bytes signed', () => {
  it('a transaction survives the BCS round trip byte-for-byte, with no client', async () => {
    const tx = offlineTransaction();
    tx.setGasBudget(GAS_BUDGET);
    const bytes = await tx.build();
    const rebuilt = await Transaction.from(bytes).build();
    expect(Array.from(rebuilt)).toEqual(Array.from(bytes));
  });
});
