// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { classify, fail, ok, type Reading } from '@projectx-social/sdk';
import { type LedgerState, type PolicyDoc } from '@projectx-social/policy';
import {
  AuditLog,
  GENESIS_HASH,
  localKeypairSignerFromSecret,
  policySigner,
  type Signer,
} from '@projectx-social/signer';

const SUI_SYSTEM_STATE_ID = '0x5';
const SUI_TYPE = '0x2::sui::SUI';

export interface AuditHead {
  headHash: string;
  entries: number;
  intact: boolean;
}

export interface HarvestSigner {
  address: string;
  simulateAndHarvest(vaultId: string): Promise<Reading<string>>;
  auditHead(): AuditHead;
}

export function harvestPolicy(input: {
  address: string;
  latestPackageId: string;
  vaultId: string;
  gasBudgetMist: bigint;
}): PolicyDoc {
  return {
    version: 1,
    agentAddress: input.address,
    outflowCeilings: [{ coinType: SUI_TYPE, maxPerPeriod: input.gasBudgetMist.toString(), periodMs: 60_000 }],
    allowedTargets: [`${input.latestPackageId}::stake_vault::harvest`],
    allowedTypeArguments: [],
    allowedRecipients: [],
    allowedObjects: [input.vaultId, SUI_SYSTEM_STATE_ID],
    maxGasBudgetMist: input.gasBudgetMist.toString(),
    allowedCommandKinds: ['MoveCall'],
  };
}

export function harvestTransaction(latestPackageId: string, vaultId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${latestPackageId}::stake_vault::harvest`,
    arguments: [tx.object(vaultId), tx.object(SUI_SYSTEM_STATE_ID)],
  });
  return tx;
}

const noLedger = (): LedgerState => ({ nowMs: Date.now(), spend: [] });

export function createSigner(
  client: SuiGrpcClient,
  secret: string,
  gasBudgetMist: bigint,
  latestPackageId: string,
): Reading<HarvestSigner> {
  const inner = localKeypairSignerFromSecret(secret);
  if (!inner.ok) {
    return fail(
      'unconfigured',
      'harvest signer',
      'the signing secret could not be decoded as a Sui private key. Its value is deliberately not shown.',
    );
  }
  return ok(harvestSignerOver(inner.value, client, gasBudgetMist, latestPackageId));
}

export function harvestSignerOver(
  inner: Signer,
  client: SuiGrpcClient,
  gasBudgetMist: bigint,
  latestPackageId: string,
  options: {
    simulation?: Parameters<typeof policySigner>[0]['simulation'];
    transaction?: (vaultId: string) => Transaction;
  } = {},
): HarvestSigner {
  const address = inner.address;
  const audit = new AuditLog();

  return {
    address,
    auditHead: () => ({ headHash: audit.headHash, entries: audit.entries.length, intact: audit.verify().intact }),
    async simulateAndHarvest(vaultId: string): Promise<Reading<string>> {
      const source = `harvest ${vaultId}`;
      try {
        const tx = options.transaction === undefined ? harvestTransaction(latestPackageId, vaultId) : options.transaction(vaultId);
        tx.setSender(address);
        tx.setGasBudget(gasBudgetMist);

        const gate = policySigner({
          inner,
          policy: harvestPolicy({ address, latestPackageId, vaultId, gasBudgetMist }),
          client,
          ledger: noLedger,
          audit,
          ...(options.simulation === undefined ? {} : { simulation: options.simulation }),
        });

        const signed = await gate.signTransaction(tx);
        if (!signed.ok) return fail(signed.failure.kind, source, signed.failure.detail);

        const result = await client.executeTransaction({
          transaction: signed.value.bytes,
          signatures: [signed.value.signature],
        });
        const executed = result as {
          Transaction?: { digest?: unknown };
          transaction?: { digest?: unknown };
          digest?: unknown;
        };
        const digest = executed.Transaction?.digest ?? executed.transaction?.digest ?? executed.digest;
        if (typeof digest !== 'string' || digest === '') {
          return fail(
            'malformed',
            source,
            'the transaction was submitted but the node returned no digest; ' +
              'check the chain before retrying, as it may have succeeded',
          );
        }
        return ok(digest);
      } catch (error) {
        const failure = classify(error, source);
        return fail(failure.kind, source, failure.detail);
      }
    },
  };
}

export const EMPTY_AUDIT_HEAD: AuditHead = { headHash: GENESIS_HASH, entries: 0, intact: true };
