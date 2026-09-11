// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { simulate } from '../src/client.js';
import { approveSubscription, approveUnlock, periodIdentity, unlockIdentity } from '../src/seal.js';

const CONFIG = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  packageId: '0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d',
  latestPackageId: '0xfa7eb18bbb29b047ec86434e8a8f4cfba35615bde9680eebd781a187ca3a3694',
  platformId: '0x3f695b2c32714e2359c4bb9515598d8dd765b216148c5b8fa818073d52b50f36',
  registryId: '0x1a3fb4ac25458d7524be064a2b7e1586ccd9ed09c0d5b351621e3b101e1203a0',
} as const;

const SENDER = `0x${'da'.repeat(32)}`;
const VAULT = '0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d';
const UNLOCK = '0x405bbf4ac0334bf325aa53992356be4e1fb138c99cc0580bb0e819a50f5af4e5';
const SUBSCRIPTION = '0x5524552c2c39000000000000000000000000000000000000000000000000ffff';

function unresolvedInputs(tx: { getData(): { inputs: readonly unknown[] } }) {
  return tx
    .getData()
    .inputs.filter(
      (i): i is { UnresolvedObject: Record<string, unknown> } =>
        typeof i === 'object' && i !== null && 'UnresolvedObject' in i,
    )
    .map((i) => i.UnresolvedObject);
}

describe('an entitlement is named as an owned object', () => {
  it('does not put `mutable` on an Unlock', () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, new TextEncoder().encode('sealed-on-walrus-001')),
      unlockId: UNLOCK,
    });
    const refs = unresolvedInputs(tx);
    expect(refs).toHaveLength(1);
    expect(refs[0]).not.toHaveProperty('mutable');
    expect(refs[0]).toHaveProperty('objectId');
  });

  it('does not put `mutable` on a Subscription', () => {
    const tx = approveSubscription(CONFIG, {
      identity: periodIdentity(VAULT, 0n, 690n),
      tier: 0n,
      period: 690n,
      subscriptionId: SUBSCRIPTION,
      vaultId: VAULT,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    });
    const refs = unresolvedInputs(tx);
    expect(refs).toHaveLength(2);
    expect(refs[1]).not.toHaveProperty('mutable');
    expect(refs[0]).not.toHaveProperty('mutable');
  });

  it('targets the LATEST package, since the approve functions live in the newest bytecode', () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, new TextEncoder().encode('k')),
      unlockId: UNLOCK,
    });
    expect(JSON.stringify(tx.getData())).toContain(CONFIG.latestPackageId);
  });
});

describe('simulate() reads the envelope the node actually sends', () => {
  const simulateWith = async (response: unknown) => {
    const client = {
      simulateTransaction: async () => response,
      core: { getMoveFunction: async () => ({ function: { parameters: [] } }) },
    } as never;
    const tx = new Transaction();
    tx.setSender(SENDER);
    tx.setGasBudget(1_000_000n);
    tx.setGasPrice(1000n);
    tx.setGasPayment([{ objectId: `0x${'11'.repeat(32)}`, version: '1', digest: '11111111111111111111111111111111' }]);
    return simulate(client, tx, SENDER);
  };

  it('accepts the success envelope', async () => {
    const r = await simulateWith({ Transaction: { status: { success: true, error: null } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.wouldSucceed).toBe(true);
  });

  it('reads a real abort out of FailedTransaction rather than calling it a shape mismatch', async () => {
    const r = await simulateWith({
      FailedTransaction: { status: { success: false, error: 'MoveAbort in 2nd command, abort code: 4' } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.wouldSucceed).toBe(false);
      expect(r.value.status).toContain('abort code: 4');
      expect(r.value.abort).not.toBeUndefined();
    }
  });

  it('serialises a structured error instead of stringifying it to [object Object]', async () => {
    const r = await simulateWith({
      FailedTransaction: { status: { success: false, error: { kind: 'MoveAbort', code: 4 } } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).not.toContain('[object Object]');
      expect(r.value.status).toContain('MoveAbort');
    }
  });

  it('refuses null, and every other unrecognised envelope, as permanent', async () => {
    for (const bad of [null, {}, 'a string', { Transaction: null }]) {
      const r = await simulateWith(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure.kind).toBe('malformed');
    }
  });
});
