// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { fold } from '@projectx-social/sdk';
import {
  assertJournalConfigured,
  assertSignerConfigured,
  assertSignerFunded,
  loadDaemonConfig,
  redactedConfig,
  type DaemonConfig,
} from './config.js';
import { openJournal, type Journal, type RunHandle } from './adapters/journal.js';
import {
  createBackoff,
  EXIT,
  installShutdown,
  SHUTDOWN_GRACE_MS,
  sleepUnlessShutdown,
  withDeadline,
} from './supervisor.js';
import { discoverVaults } from './adapters/discovery.js';
import { readCurrentEpoch, readStakeVault } from './adapters/vault.js';
import { createSigner, EMPTY_AUDIT_HEAD, type HarvestSigner } from './adapters/signer.js';
import { tick, type EnginePorts, type TickResult } from './engine.js';
import { classify, fail, ok, type Reading } from '@projectx-social/sdk';

export interface RunOptions {
  once: boolean;
  dryRun: boolean;
}

async function readSignerBalance(
  client: SuiGrpcClient,
  address: string,
): Promise<Reading<bigint>> {
  const source = `SUI balance of ${address}`;
  try {
    const response = await client.getBalance({ owner: address });
    const value = (response as { balance?: { balance?: unknown } }).balance?.balance;
    return ok(BigInt(String(value ?? '0')));
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export function parseArgs(argv: readonly string[]): RunOptions {
  return { once: argv.includes('--once'), dryRun: argv.includes('--dry-run') };
}

export function dryRunSigner(): HarvestSigner {
  return {
    address: '(dry-run: no signer)',
    async simulateAndHarvest(vaultId: string) {
      return fail('unconfigured', `harvest ${vaultId}`, 'dry run: would harvest, did not sign');
    },
    auditHead: () => EMPTY_AUDIT_HEAD,
  };
}

export function buildPorts(client: SuiGrpcClient, signer: HarvestSigner): EnginePorts {
  return {
    readEpoch: () => readCurrentEpoch(client),
    readVault: (vaultId) => readStakeVault(client, vaultId),
    simulateAndHarvest: (vaultId) => signer.simulateAndHarvest(vaultId),
  };
}

async function anchor(journal: Journal, run: RunHandle, signer: HarvestSigner): Promise<void> {
  const head = signer.auditHead();
  fold(
    await journal.anchorAudit(run, { signer: signer.address, ...head }),
    () => null,
    (failure) => {
      console.error(JSON.stringify({ journalAnchor: failure.detail, headHash: head.headHash, entries: head.entries }));
      return null;
    },
  );
}

export async function runOnce(
  client: SuiGrpcClient,
  config: DaemonConfig,
  signer: HarvestSigner,
): Promise<Reading<TickResult & { discoveryTruncated: boolean }>> {
  const discovery = await discoverVaults(client, config.packageId, config.maxDiscoveryPages);
  if (!discovery.ok) return discovery;

  const result = await tick(
    buildPorts(client, signer),
    discovery.value.vaults.map((v) => v.vaultId),
  );
  if (!result.ok) return result;

  return ok(
    { ...result.value, discoveryTruncated: discovery.value.truncated },
    result.observedAtMs,
  );
}

function report(result: TickResult & { discoveryTruncated: boolean }): void {
  const line = {
    epoch: result.epoch.toString(),
    harvested: result.harvested.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
    discoveryTruncated: result.discoveryTruncated,
    tickTruncated: result.truncated,
  };
  console.log(JSON.stringify(line));

  for (const outcome of result.harvested) {
    console.log(
      JSON.stringify({ vault: outcome.vaultId, reason: outcome.decision.reason, digest: outcome.digest }),
    );
  }
  for (const outcome of result.failed) {
    console.error(
      JSON.stringify({ vault: outcome.vaultId, reason: outcome.decision.reason, error: outcome.error }),
    );
  }
  // Skips are counted but not enumerated: in steady state every vault skips, and a log that
  // prints a line per vault per tick is a log nobody reads.
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const options = parseArgs(argv);

  const configReading = loadDaemonConfig(env);
  const config = fold(
    configReading,
    (value) => value,
    (failure) => {
      console.error(JSON.stringify({ configuration: failure.detail }));
      return null;
    },
  );
  if (config === null) return EXIT.misconfigured;

  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: config.grpcUrl });

  let signer: HarvestSigner;
  if (options.dryRun) {
    signer = dryRunSigner();
  } else {
    const secret = assertSignerConfigured(config);
    if (!secret.ok) {
      console.error(JSON.stringify({ signer: secret.failure.detail }));
      return EXIT.misconfigured;
    }

    const built = fold(
      createSigner(client, secret.value, config.gasBudgetMist, config.latestPackageId),
      (value) => value,
      (failure) => {
        console.error(JSON.stringify({ signer: failure.detail }));
        return null;
      },
    );
    if (built === null) return EXIT.misconfigured;
    signer = built;

    const funded = fold(
      await readSignerBalance(client, signer.address),
      (mist) => assertSignerFunded(mist, config.gasBudgetMist),
      (failure) => fail<true>(failure.kind, failure.source, failure.detail),
    );
    if (!funded.ok) {
      console.error(JSON.stringify({ signer: funded.failure.detail }));
      return EXIT.misconfigured;
    }
  }

  let journal: Journal | null = null;
  if (!options.dryRun) {
    const url = assertJournalConfigured(config);
    if (!url.ok) {
      console.error(JSON.stringify({ journal: url.failure.detail }));
      return EXIT.misconfigured;
    }
    const opened = await openJournal(url.value);
    if (!opened.ok) {
      console.error(JSON.stringify({ journal: opened.failure.detail }));
      return opened.failure.detail.includes('already holds the run lock')
        ? EXIT.alreadyRunning
        : EXIT.misconfigured;
    }
    journal = opened.value;

    fold(
      await journal.stuckRuns(config.tickIntervalSeconds * 1000 * 3),
      (stuck) => {
        for (const run of stuck) {
          console.error(
            JSON.stringify({
              stuckRun: run.id,
              startedAtMs: run.startedAtMs,
              note: 'a previous tick never finished — the daemon died mid-run',
            }),
          );
        }
        return null;
      },
      (failure) => {
        console.error(JSON.stringify({ stuckRunCheck: failure.detail }));
        return null;
      },
    );
  }

  const shutdown = installShutdown(process);
  const backoff = createBackoff({
    baseMs: config.tickIntervalSeconds * 1000,
    maxMs: config.tickIntervalSeconds * 1000 * 10,
  });

  console.log(
    JSON.stringify({
      starting: true,
      ...redactedConfig(config),
      signer: signer.address,
      mode: options.dryRun ? 'dry-run' : 'live',
      once: options.once,
      pid: process.pid,
    }),
  );

  let exitCode: number = EXIT.ok;
  try {
    for (;;) {
      const run: RunHandle | null =
        journal === null
          ? null
          : fold(
              await journal.begin({
                mode: options.dryRun ? 'dry-run' : 'live',
                signer: signer.address,
              }),
              (handle) => handle,
              (failure) => {
                console.error(JSON.stringify({ journalBegin: failure.detail }));
                return null;
              },
            );

      if (journal !== null && run === null) {
        console.error(
          JSON.stringify({
            tick: 'skipped',
            reason: 'the journal would not open a run, and an unrecorded harvest is not permitted',
          }),
        );
        backoff.fail();
        exitCode = EXIT.runFailed;
        if (options.once) break;
        if (shutdown.requested) {
          exitCode = EXIT.ok;
          break;
        }
        const wait = backoff.delayMs();
        console.error(
          JSON.stringify({ backingOff: wait, consecutiveFailures: backoff.failures() }),
        );
        await sleepUnlessShutdown(wait, shutdown);
        if (shutdown.requested) {
          exitCode = EXIT.ok;
          break;
        }
        continue;
      }

      const work = runOnce(client, config, signer);
      const raced = shutdown.requested
        ? await withDeadline(work, SHUTDOWN_GRACE_MS)
        : { finished: true as const, value: await work };

      if (!raced.finished) {
        console.error(JSON.stringify({ shutdown: 'deadline', note: 'tick did not finish in time' }));
        exitCode = EXIT.ok;
        break;
      }

      const result = raced.value;
      if (result.ok) {
        backoff.succeed();
        report(result.value);
        if (run !== null && journal !== null) {
          fold(
            await journal.finish(run, result.value),
            () => null,
            (failure) => {
              console.error(JSON.stringify({ journalFinish: failure.detail }));
              return null;
            },
          );
          await anchor(journal, run, signer);
        }
      } else {
        backoff.fail();
        console.error(
          JSON.stringify({
            tickFailed: result.failure.kind,
            detail: result.failure.detail,
            consecutiveFailures: backoff.failures(),
          }),
        );
        if (run !== null && journal !== null) {
          fold(
            await journal.abandon(run, {
              kind: result.failure.kind,
              detail: result.failure.detail,
            }),
            () => null,
            (failure) => {
              console.error(JSON.stringify({ journalAbandon: failure.detail }));
              return null;
            },
          );
          await anchor(journal, run, signer);
        }
        exitCode = EXIT.runFailed;
      }

      if (options.once) break;
      if (shutdown.requested) {
        exitCode = EXIT.ok;
        break;
      }

      const delay = backoff.delayMs();
      if (backoff.failures() > 0) {
        console.error(JSON.stringify({ backingOff: delay, consecutiveFailures: backoff.failures() }));
      }
      await sleepUnlessShutdown(delay, shutdown);
      if (shutdown.requested) {
        exitCode = EXIT.ok;
        break;
      }
      exitCode = EXIT.ok;
    }
  } finally {
    shutdown.dispose();
    if (journal !== null) await journal.close();
    console.log(JSON.stringify({ stopped: true, exitCode }));
  }

  return exitCode;
}

export {
  loadDaemonConfig,
  redactedConfig,
  assertSignerFunded,
  assertJournalConfigured,
  assertSignerConfigured,
} from './config.js';
export { openJournal, type Journal, type RunSummary } from './adapters/journal.js';
export * from './supervisor.js';
export { discoverVaults } from './adapters/discovery.js';
export { readCurrentEpoch, readStakeVault, decodeStakeVault } from './adapters/vault.js';
export { createSigner } from './adapters/signer.js';
export { tick, type EnginePorts, type TickResult } from './engine.js';
export { status } from './status.js';
export * from './domain/harvest.js';
