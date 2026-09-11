// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { Transaction } from '@mysten/sui/transactions';
import { tx as builders } from '@projectx-social/sdk';
import type { PolicyDoc } from '@projectx-social/policy';
import type { ChainConfig } from './chain.js';
import { allow, refuse, type Outcome } from './outcome.js';
import type { Intent, OwnedObjectRef, SharedObjectRef } from './intent.js';

export interface GasCoinRef {
  readonly objectId: string;
  readonly version: string;
  readonly digest: string;
}

export interface GasPort {
  readonly apply: (tx: Transaction, policy: PolicyDoc) => void;
}

export const nodeGas: GasPort = {
  apply: (tx, policy) => {
    tx.setGasBudget(BigInt(policy.maxGasBudgetMist));
  },
};

export function fixedGas(args: {
  readonly price: bigint;
  readonly payment: readonly GasCoinRef[];
}): GasPort {
  return {
    apply: (tx, policy) => {
      tx.setGasBudget(BigInt(policy.maxGasBudgetMist));
      tx.setGasPrice(args.price);
      tx.setGasPayment([...args.payment]);
    },
  };
}

function shared(tx: Transaction, ref: SharedObjectRef): void {
  tx.sharedObjectRef({
    objectId: ref.objectId,
    initialSharedVersion: ref.initialSharedVersion,
    mutable: ref.mutable,
  });
}

function owned(tx: Transaction, ref: OwnedObjectRef): void {
  tx.objectRef({ objectId: ref.objectId, version: ref.version, digest: ref.digest });
}

export function buildIntent(args: {
  readonly intent: Intent;
  readonly chain: ChainConfig;
  readonly policy: PolicyDoc;
  readonly sender: string;
  readonly gas: GasPort;
}): Outcome<Transaction> {
  const { intent, chain, policy, sender, gas } = args;
  const tx = new Transaction();
  tx.setSender(sender);

  try {
    switch (intent.kind) {
      case 'post':
      case 'price': {
        shared(tx, intent.vault);
        owned(tx, intent.cap);
        builders.setContentPrice(
          { config: chain, tx },
          {
            coinType: intent.coinType,
            vaultId: intent.vault.objectId,
            capId: intent.cap.objectId,
            contentKey: new Uint8Array(Buffer.from(intent.contentKey, 'utf8')),
            price: BigInt(intent.priceMist),
          },
        );
        break;
      }

      case 'settle_epoch': {
        owned(tx, intent.ledgerCap);
        shared(tx, intent.registry);
        shared(tx, intent.soul);
        shared(tx, intent.clock);
        tx.moveCall({
          target: `${intent.packageId}::soul::settle_epoch`,
          arguments: [
            tx.object(intent.ledgerCap.objectId),
            tx.object(intent.registry.objectId),
            tx.object(intent.soul.objectId),
            tx.pure.u64(BigInt(intent.vaultSui)),
            tx.pure.bool(intent.epochNetNonneg),
            tx.object(intent.clock.objectId),
          ],
        });
        break;
      }

      case 'record_spend': {
        shared(tx, intent.soul);
        tx.moveCall({
          target: `${intent.packageId}::soul::record_spend`,
          arguments: [tx.object(intent.soul.objectId), tx.pure.u64(BigInt(intent.amountMist))],
        });
        break;
      }

      case 'book_earned':
      case 'book_burned': {
        owned(tx, intent.ledgerCap);
        shared(tx, intent.soul);
        tx.moveCall({
          target: `${intent.packageId}::soul::${intent.kind}`,
          arguments: [
            tx.object(intent.ledgerCap.objectId),
            tx.object(intent.soul.objectId),
            tx.pure.u64(BigInt(intent.amountMist)),
          ],
        });
        break;
      }

      case 'statement': {
        return refuse('intent-unbuildable', 'a statement intent builds no transaction.');
      }

      default: {
        const exhaustive: never = intent;
        return refuse('intent-unbuildable', `no builder for ${JSON.stringify(exhaustive)}.`);
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse(
      'intent-unbuildable',
      `the intent passed the schema and could still not be assembled into a transaction: ${detail}. ` +
        `Nothing was simulated and nothing was signed.`,
    );
  }

  gas.apply(tx, policy);
  return allow(tx);
}
