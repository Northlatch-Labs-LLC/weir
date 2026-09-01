// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Signing: build a harvest, simulate it, and submit only if the simulation passed.
 *
 * # Simulate is not optional here, and the API makes that hard to skip
 *
 * There is one exported function and it does both halves. A separate `submit()` would eventually
 * be called on its own — that is not a hypothetical, it is what happens to every "remember to
 * simulate first" convention. The `EnginePorts` method is named `simulateAndHarvest` for the same
 * reason: an implementation that only submits satisfies the type and is wrong, so the name is the
 * last line of defence and it should be loud.
 *
 * On a chain the cost of skipping is asymmetric. A doomed transaction still spends gas, and across
 * many vaults ticking continuously that spend is unbounded and invisible — it shows up as a gas
 * balance draining, not as an error.
 *
 * # The key here is deliberately powerless
 *
 * `harvest` takes no capability. This signer can harvest and pay gas; it cannot set a fee, claim a
 * balance, or touch principal. Keep it that way — see `config.ts`.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { classify, fail, ok, type Reading,
  simulationStatus,
} from '@projectx-social/sdk';

/** The Sui framework `SuiSystemState`, required by `harvest`. */
const SUI_SYSTEM_STATE_ID = '0x5';

export interface HarvestSigner {
  /** The address that will pay gas. Exposed so a startup check can confirm it is funded. */
  address: string;
  simulateAndHarvest(vaultId: string): Promise<Reading<string>>;
}

/**
 * Build a signer from a bech32 `suiprivkey1...` secret.
 *
 * The secret is consumed here and not retained on the returned object — only the keypair is, and
 * it exposes no accessor that returns the raw bytes to ordinary code. A caller that logs the
 * returned `HarvestSigner` prints an address, not a key.
 */
export function createSigner(
  client: SuiGrpcClient,
  secret: string,
  gasBudgetMist: bigint,
  /** The LATEST package. `harvest` must execute the newest bytecode, not the original. */
  latestPackageId: string,
): Reading<HarvestSigner> {
  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(secret);
  } catch (error) {
    // Deliberately does not include the underlying message. A malformed-key error from a crypto
    // library can quote the input, and that input is the private key.
    void error;
    return fail(
      'unconfigured',
      'harvest signer',
      'the signing secret could not be decoded as an Ed25519 Sui private key. ' +
        'Its value is deliberately not shown.',
    );
  }

  const address = keypair.toSuiAddress();

  return ok({
    address,
    async simulateAndHarvest(vaultId: string): Promise<Reading<string>> {
      const source = `harvest ${vaultId}`;
      try {
        const tx = new Transaction();
        tx.moveCall({
          // public fun harvest(vault: &mut StakeVault, state: &mut SuiSystemState, ctx: &mut TxContext)
          target: `${latestPackageId}::stake_vault::harvest`,
          arguments: [tx.object(vaultId), tx.object(SUI_SYSTEM_STATE_ID)],
        });
        tx.setSender(address);
        tx.setGasBudget(gasBudgetMist);

        const bytes = await tx.build({ client });

        // --- Simulate. Nothing is signed above this line. ---
        const simulation = await client.simulateTransaction({ transaction: bytes });

        /*
          Decoded by the SDK, not here.

          This function carried its own copy of the envelope read, and the copy was wrong in a way
          the original is not: it looked under `Transaction` and the legacy
          `transaction.effects.status`, and NOT under `FailedTransaction` — which is where a node
          puts a simulation that ABORTED. So a successful simulation decoded correctly and a genuine
          Move abort found no status at all, and was reported as "a client/server shape mismatch,
          not a rejected transaction". Exactly backwards: the transaction had been rejected, and the
          daemon wrote down that it could not tell.

          It failed closed, which is why this was a reporting defect rather than an incident. It
          still wrote the wrong reason into `daemon_harvests.error`, on every abort, for ever.

          One decoder now, in the package that already had the correct one.
        */
        const status = simulationStatus(simulation);

        if (status === undefined) {
          return fail(
            'malformed',
            source,
            'the simulation response carried no status field, so it could not be shown to have ' +
              'succeeded. Nothing was submitted. This is a client/server shape mismatch, not a ' +
              'rejected transaction.',
          );
        }

        if (status.success !== true) {
          // Raw text, unmodified. A confident wrong explanation is worse than an opaque one,
          // because an opaque one can be searched for.
          return fail(
            'malformed',
            source,
            `simulation failed, not submitted: ${status?.error ?? JSON.stringify(status ?? {})}`,
          );
        }

        // --- Simulation passed. Only now do we sign. ---
        const result = await client.signAndExecuteTransaction({
          transaction: bytes,
          signer: keypair,
        });

        /*
          Same envelope problem as the status above, and it cost a real harvest.

          The gRPC client wraps its payload in a `$kind`-discriminated object — `{ $kind:
          'Transaction', Transaction: { … } }` — so `result.transaction.digest` (lower case, no
          envelope) was `undefined`. The transaction had already been signed and submitted by then,
          and it landed: the vault went from one tranche to two and its idle SUI was staked. The
          daemon recorded that success as a failure.

          Read through every envelope this client has been observed to use rather than the one that
          happens to be current, because the shape has already changed underneath this code once.
        */
        const executed = result as {
          Transaction?: { digest?: unknown };
          transaction?: { digest?: unknown };
          digest?: unknown;
        };
        const digest = executed.Transaction?.digest ?? executed.transaction?.digest ?? executed.digest;

        if (typeof digest !== 'string' || digest === '') {
          // Submitted, but we cannot name what we submitted. Reported as a failure so a caller
          // does not record a harvest it cannot point at — the transaction may well have landed.
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
  });
}
