#!/usr/bin/env -S npx tsx
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `heron-beat` phase two: the part that runs outside the container, as root, holding no key.
 *
 * ```
 * beat-phase2.ts --runs /srv/heron/runs --state /srv/heron/state --socket /run/heron/purse.sock \
 *                --chain /srv/heron/chain.json --beat-id 20260905T120000Z [--dry-run]
 * ```
 *
 * Exit codes: 0 signed, 0 no intent (nothing to do is not a failure), 3 refused, 1 error. The
 * refusal gets its own code because `OnFailure=heron-alert@%n.service` fires on a non-zero exit and
 * a policy denial is a thing the desk wants to see — but it is not the same alert as "the beat
 * broke", and the state file's `outcome` is what the puller reads to tell them apart.
 *
 * The exit code is written last. `state/latest.json` is already on disk by then, on every path,
 * including the ones that threw.
 */

import { createClient, type ProjectXSocialConfig } from '@projectx-social/sdk';
import { loadChainConfig } from '../src/chain.js';
import { askPurse } from '../src/client.js';
import { runPhaseTwo, type SubmitPort } from '../src/beat.js';
import { allow, refuse, type Outcome } from '../src/outcome.js';

interface BeatArgs {
  readonly runs: string;
  readonly state: string;
  readonly socket: string;
  readonly chain: string;
  readonly beatId: string;
  readonly dryRun: boolean;
  /** Both or neither: with them a publish plan runs; without them it is refused locally. */
  readonly apiOrigin: string | null;
  readonly address: string | null;
}

const FLAGS = ['--runs', '--state', '--socket', '--chain', '--beat-id', '--api-origin', '--address'] as const;
const OPTIONAL = new Set<string>(['--api-origin', '--address']);

export function parseBeatArgs(argv: readonly string[]): Outcome<BeatArgs> {
  const values = new Map<string, string>();
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!FLAGS.includes(flag as (typeof FLAGS)[number])) {
      return refuse(
        'request-malformed',
        `${flag} is not a flag this takes. It takes: ${FLAGS.join(' ')} [--dry-run].`,
      );
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return refuse('request-malformed', `${flag} needs a value.`);
    }
    values.set(flag, value);
    i += 1;
  }

  for (const flag of FLAGS) {
    if (!OPTIONAL.has(flag) && !values.has(flag)) return refuse('request-malformed', `${flag} is required.`);
  }
  const apiOrigin = values.get('--api-origin') ?? null;
  const address = values.get('--address') ?? null;
  if ((apiOrigin === null) !== (address === null)) {
    return refuse('request-malformed', '--api-origin and --address are given together or not at all.');
  }
  if (apiOrigin !== null && !/^https:\/\/[a-z0-9.-]+$/.test(apiOrigin)) return refuse('request-malformed', '--api-origin is an https origin with no path.');
  if (address !== null && !/^0x[0-9a-f]{64}$/.test(address)) return refuse('request-malformed', '--address is a full lower-case Sui address.');

  return allow({
    runs: values.get('--runs')!,
    state: values.get('--state')!,
    socket: values.get('--socket')!,
    chain: values.get('--chain')!,
    beatId: values.get('--beat-id')!,
    dryRun,
    apiOrigin,
    address,
  });
}

/**
 * Submit the signed bytes.
 *
 * The digest the node returns is read from the envelope and, if the node returns none, this throws
 * with a sentence that says the transaction may well have landed. Reporting "no digest" as a clean
 * failure is how the harvest daemon once recorded a real, successful, money-moving transaction as a
 * failure and the operator acted on the wrong belief; `packages/agent/src/tx.ts` carries the same
 * warning for the same reason.
 */
function chainSubmit(config: ProjectXSocialConfig): SubmitPort {
  const client = createClient(config);
  return {
    submit: async ({ txBytesB64, signature }) => {
      const result = (await client.executeTransaction({
        transaction: Uint8Array.from(Buffer.from(txBytesB64, 'base64')),
        signatures: [signature],
      })) as { transaction?: { digest?: string }; digest?: string };
      const digest = result.transaction?.digest ?? result.digest;
      if (typeof digest !== 'string' || digest === '') {
        throw new Error(
          'the transaction was submitted and the node returned no digest in any envelope this ' +
            'client knows. Check the chain before retrying — it may well have succeeded.',
        );
      }
      return digest;
    },
  };
}

const parsed = parseBeatArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`heron-beat: ${parsed.refused.ruleId} — ${parsed.refused.reason}\n`);
  process.exit(1);
}
const args = parsed.value;

const chain = await loadChainConfig(args.chain);
if (!chain.ok) {
  process.stderr.write(`heron-beat: ${chain.refused.ruleId} — ${chain.refused.reason}\n`);
  process.exit(1);
}

/*
  The ports a publish plan needs: the API over HTTPS, the two object references from the node the
  purse's own chain document names, and the same submit the transaction path uses.
*/
const client = createClient(chain.value);
const publish =
  args.apiOrigin === null || args.address === null
    ? {}
    : {
        publish: {
          origin: args.apiOrigin,
          address: args.address,
          profile: {
            name: 'Heron',
            bio: 'A Northlatch Labs agent. It reads the network, writes what it sees, and prices its own writing; every signature it produces is bounded by a policy under a human operator.',
          },
          ports: {
            http: {
              request: async (input: { method: 'GET' | 'POST'; url: string; body?: unknown; headers?: Record<string, string> }) => {
                const response = await fetch(input.url, {
                  method: input.method,
                  headers: { 'content-type': 'application/json', 'user-agent': 'heron-beat/2 (Heron host)', ...(input.headers ?? {}) },
                  ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
                  signal: AbortSignal.timeout(60_000),
                });
                const text = await response.text();
                let json: unknown = null;
                try { json = JSON.parse(text); } catch { json = null; }
                return { status: response.status, json };
              },
            },
            chain: {
              sharedRef: async (objectId: string) => {
                const { object } = await client.core.getObject({ objectId });
                const owner = object.owner as { $kind?: string; Shared?: { initialSharedVersion: string } };
                if (owner.$kind !== 'Shared' || owner.Shared === undefined) throw new Error(`${objectId} is not a shared object`);
                return { objectId, initialSharedVersion: owner.Shared.initialSharedVersion, mutable: true as const };
              },
              ownedRef: async (objectId: string) => {
                const { object } = await client.core.getObject({ objectId });
                return { objectId, version: object.version, digest: object.digest };
              },
            },
            submit: async (signed: { txBytesB64: string; signature: string }) => chainSubmit(chain.value).submit(signed),
          },
        },
      };

const { state, statePath } = await runPhaseTwo({
  runsDir: args.runs,
  stateDir: args.state,
  beatId: args.beatId,
  ask: { ask: (intent) => askPurse({ socketPath: args.socket, intent }) },
  ...(args.dryRun ? {} : { submit: chainSubmit(chain.value) }),
  ...(args.dryRun ? {} : publish),
});

process.stderr.write(
  `heron-beat: ${state.beatId} ${state.outcome}` +
    (state.ruleId === undefined ? '' : ` rule=${state.ruleId}`) +
    (state.digest === undefined ? '' : ` digest=${state.digest}`) +
    (state.submittedDigest === undefined ? '' : ` submitted=${state.submittedDigest}`) +
    (state.postId === undefined ? '' : ` post=${state.postId}`) +
    ` state=${statePath}\n`,
);

process.exit(state.outcome === 'refused' ? 3 : state.outcome === 'error' ? 1 : 0);
