// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Phase two of the beat: outside the container, with the state sink written on every path.
 *
 * # The two phases, and what the split buys
 *
 * Phase one runs the container. It reads and writes exactly one file: `<runs>/<beat-id>/intent.json`.
 * It has no key, no socket that reaches a key, and no way to produce transaction bytes.
 *
 * Phase two is this file. It reads that intent, validates it against the same schema the purse
 * uses, asks the purse, and submits what comes back. A prompt-injected model can therefore write a
 * bad intent and nothing else — the CISO's §2, in his words.
 *
 * The schema is checked **twice**, here and in the purse, and that is not redundancy to delete. The
 * purse's copy is the authority: it is the one that runs next to the key. This copy exists so that
 * a malformed intent is refused before it is put on a socket at all, which keeps the purse's audit
 * chain a record of decisions rather than of the beat's own bugs, and gives the state file a rule
 * id for a failure that never left this host.
 *
 * # `state/latest.json` is written on every path
 *
 * Signed, refused, no intent at all, and an exception. That is the whole point of the file: a sink
 * that only records success cannot detect failure. The `finally` below is the mechanism and
 * `test/beat.test.ts` asserts it on a forced refusal and on a thrown submit.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIntent } from './intent.js';
import type { PurseResponse } from './protocol.js';
import { writeState, type BeatOutcome, type BeatState } from './state.js';
import type { Outcome } from './outcome.js';

/** How the intent reaches the purse. The socket client in production; a direct purse in tests. */
export interface AskPort {
  readonly ask: (intent: unknown) => Promise<Outcome<PurseResponse>>;
}

/** How a signed transaction reaches the chain. Absent under `--dry-run`. */
export interface SubmitPort {
  readonly submit: (args: {
    readonly txBytesB64: string;
    readonly signature: string;
  }) => Promise<string>;
}

export interface PhaseTwoOptions {
  readonly runsDir: string;
  readonly stateDir: string;
  readonly beatId: string;
  readonly ask: AskPort;
  /** Omitted, or `--dry-run`: nothing is submitted and the outcome is still `signed`. */
  readonly submit?: SubmitPort | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface PhaseTwoResult {
  readonly state: BeatState;
  readonly statePath: string;
}

export const INTENT_FILE = 'intent.json';

/**
 * Run phase two.
 *
 * Never throws. The one thing this function guarantees is that `state/latest.json` exists and
 * describes what happened when it returns — so the return value is the state, and the caller's only
 * job is to turn it into an exit code.
 */
export async function runPhaseTwo(options: PhaseTwoOptions): Promise<PhaseTwoResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const intentPath = join(options.runsDir, options.beatId, INTENT_FILE);

  let outcome: BeatOutcome = 'error';
  let ruleId: string | undefined;
  let digest: string | undefined;
  let submittedDigest: string | undefined;
  let error: string | undefined;

  /*
    The work is an inner function and the write is after it, rather than a `return finish()` inside
    the try. With the write inside, a `finish()` that itself threw would land in the same catch and
    be called a second time — and the second call would throw again, out of a function whose entire
    contract is that it does not. Here there is exactly one call to `writeState`, on exactly one
    path, and the outcome variables above are the only thing the attempt communicates.
  */
  const attempt = async (): Promise<void> => {
    let text: string;
    try {
      text = await readFile(intentPath, 'utf8');
    } catch (readError) {
      const code = (readError as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Not an error. The container ran and decided there was nothing to do, or it failed before
        // writing. Either way nothing was asked of the purse, and `no-intent` says exactly that —
        // a different fact from "the purse refused" and from "the beat broke".
        outcome = 'no-intent';
        error = `no intent at ${intentPath}`;
        return;
      }
      outcome = 'error';
      error = `${intentPath} could not be read: ${String(code ?? readError)}`;
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      outcome = 'refused';
      ruleId = 'intent-invalid-locally';
      error = `${intentPath} is not valid JSON. Nothing was sent to the purse.`;
      return;
    }

    const parsed = parseIntent(value);
    if (!parsed.ok) {
      outcome = 'refused';
      ruleId = 'intent-invalid-locally';
      error = parsed.reason;
      return;
    }

    const answered = await options.ask.ask(parsed.intent);
    if (!answered.ok) {
      // The purse could not be reached, or did not answer with a response. A no-answer, not a
      // refusal — the CISO's alerting list keeps them apart because only one of them means "stop".
      outcome = 'error';
      ruleId = answered.refused.ruleId;
      error = answered.refused.reason;
      return;
    }

    const response = answered.value;
    if (!response.ok) {
      outcome = 'refused';
      ruleId = response.refused.ruleId;
      error = response.refused.reason;
      return;
    }

    digest = response.digest;
    if (options.submit === undefined) {
      outcome = 'signed';
      return;
    }

    submittedDigest = await options.submit.submit({
      txBytesB64: response.txBytesB64,
      signature: response.signature,
    });
    outcome = 'signed';
  };

  try {
    await attempt();
  } catch (thrown) {
    /*
      A throw from anywhere above — the submit port, a node that hung up mid-response, a bug here.

      `outcome` is left at whatever the attempt had reached. In particular a throw from `submit`
      leaves `digest` set, so the state file records that a signature exists for that digest and
      that submitting it threw. "It may well have landed" is the honest reading and the operator
      needs the digest to check; a state file that reported only `error` would send them looking
      for a transaction they cannot name.
    */
    outcome = 'error';
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  const state: BeatState = {
    beatId: options.beatId,
    startedAt,
    finishedAt: now().toISOString(),
    outcome,
    ...(ruleId === undefined ? {} : { ruleId }),
    ...(digest === undefined ? {} : { digest }),
    ...(submittedDigest === undefined ? {} : { submittedDigest }),
    ...(error === undefined ? {} : { error }),
  };
  const statePath = await writeState(options.stateDir, state);
  return { state, statePath };
}
