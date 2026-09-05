#!/usr/bin/env -S npx tsx
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
}

const FLAGS = ['--runs', '--state', '--socket', '--chain', '--beat-id'] as const;

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
    if (!values.has(flag)) return refuse('request-malformed', `${flag} is required.`);
  }

  return allow({
    runs: values.get('--runs')!,
    state: values.get('--state')!,
    socket: values.get('--socket')!,
    chain: values.get('--chain')!,
    beatId: values.get('--beat-id')!,
    dryRun,
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

const { state, statePath } = await runPhaseTwo({
  runsDir: args.runs,
  stateDir: args.state,
  beatId: args.beatId,
  ask: { ask: (intent) => askPurse({ socketPath: args.socket, intent }) },
  ...(args.dryRun ? {} : { submit: chainSubmit(chain.value) }),
});

process.stderr.write(
  `heron-beat: ${state.beatId} ${state.outcome}` +
    (state.ruleId === undefined ? '' : ` rule=${state.ruleId}`) +
    (state.digest === undefined ? '' : ` digest=${state.digest}`) +
    ` state=${statePath}\n`,
);

process.exit(state.outcome === 'refused' ? 3 : state.outcome === 'error' ? 1 : 0);
