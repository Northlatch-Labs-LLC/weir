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

      case 'settle_atomic': {
        /*
          The three settlement calls as one block, in the only order they can go in:

            book_earned  (if there is income to book)
            book_burned  (if there is cost to book)
            settle_epoch (always — it reads the epoch counters the two above just moved)

          `settle_epoch` must come last because it closes the epoch and zeroes `epoch_earned` and
          `epoch_burned`. A booking after it would land in the NEXT epoch, which is the same class
          of quiet wrongness this intent exists to end.

          Every object is registered once, before any call. Registering a fully-resolved reference
          twice is not idempotent in the builder — it is a second input — and three calls sharing
          one capability is exactly the case where that matters.
        */
        owned(tx, intent.ledgerCap);
        shared(tx, intent.registry);
        shared(tx, intent.soul);
        shared(tx, intent.clock);

        if (intent.bookEarnedMist !== undefined) {
          tx.moveCall({
            target: `${intent.packageId}::soul::book_earned`,
            arguments: [
              tx.object(intent.ledgerCap.objectId),
              tx.object(intent.soul.objectId),
              tx.pure.u64(BigInt(intent.bookEarnedMist)),
            ],
          });
        }
        if (intent.bookBurnedMist !== undefined) {
          tx.moveCall({
            target: `${intent.packageId}::soul::book_burned`,
            arguments: [
              tx.object(intent.ledgerCap.objectId),
              tx.object(intent.soul.objectId),
              tx.pure.u64(BigInt(intent.bookBurnedMist)),
            ],
          });
        }
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
        /*
          From the deployed package, read off mainnet 2026-09-06:

            public fun record_spend(soul: &mut EmployeeSoul, amount: u64, ctx: &TxContext)

          `ctx` is supplied by the runtime and is not an argument here. No capability: the contract
          asserts `ctx.sender() == soul.agent`, so the sender is the permission.
          `test/build.test.ts` pins this order against that signature.
        */
        shared(tx, intent.soul);
        tx.moveCall({
          target: `${intent.packageId}::soul::record_spend`,
          arguments: [tx.object(intent.soul.objectId), tx.pure.u64(BigInt(intent.amountMist))],
        });
        break;
      }

      case 'book_earned':
      case 'book_burned': {
        /*
          From the deployed package, read off mainnet 2026-09-06:

            public fun book_earned(_: &LedgerCap, soul: &mut EmployeeSoul, amount: u64)
            public fun book_burned(_: &LedgerCap, soul: &mut EmployeeSoul, amount: u64)

          One shape, two targets. The two are built together because their argument order is the
          same signature; the target name is the only difference, and deriving it from the intent
          kind means the two can never drift apart into different orders.
        */
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
