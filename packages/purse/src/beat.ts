// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIntent } from './intent.js';
import { looksLikePlan, parsePublishPlan, runPublishPlan, type PublishPorts } from './publish.js';
import type { PurseResponse } from './protocol.js';
import { writeState, type BeatOutcome, type BeatState } from './state.js';
import type { Outcome } from './outcome.js';

export interface AskPort {
  readonly ask: (intent: unknown) => Promise<Outcome<PurseResponse>>;
}

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
  readonly submit?: SubmitPort | undefined;
  readonly now?: (() => Date) | undefined;
  readonly publish?:
    | { readonly origin: string; readonly address: string; readonly profile: { name: string; bio: string }; readonly ports: Omit<PublishPorts, 'ask' | 'now'> }
    | undefined;
}

export interface PhaseTwoResult {
  readonly state: BeatState;
  readonly statePath: string;
}

export const INTENT_FILE = 'intent.json';

export async function runPhaseTwo(options: PhaseTwoOptions): Promise<PhaseTwoResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const intentPath = join(options.runsDir, options.beatId, INTENT_FILE);

  let outcome: BeatOutcome = 'error';
  let ruleId: string | undefined;
  let digest: string | undefined;
  let submittedDigest: string | undefined;
  let error: string | undefined;
  let postId: string | undefined;
  let handle: string | undefined;
  let named: boolean | undefined;

  const attempt = async (): Promise<void> => {
    let text: string;
    try {
      text = await readFile(intentPath, 'utf8');
    } catch (readError) {
      const code = (readError as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
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

    if (looksLikePlan(value)) {
      const plan = parsePublishPlan(value);
      if (!plan.ok) {
        outcome = 'refused';
        ruleId = 'intent-invalid-locally';
        error = plan.reason;
        return;
      }
      if (options.publish === undefined) {
        outcome = 'refused';
        ruleId = 'intent-invalid-locally';
        error = 'a publish plan was written but this beat runs without an API origin and address; nothing was sent';
        return;
      }
      const result = await runPublishPlan({
        plan: plan.plan,
        address: options.publish.address,
        origin: options.publish.origin,
        beatId: options.beatId,
        profile: options.publish.profile,
        ports: {
          ...options.publish.ports,
          ask: (intent) => options.ask.ask(intent),
          now: () => now().getTime(),
        },
      });
      if (result.priceDigest !== undefined) submittedDigest = result.priceDigest;
      if (result.outcome === 'published') {
        outcome = 'published';
        postId = result.postId;
        handle = result.handle;
        named = result.named;
        return;
      }
      outcome = result.outcome;
      error = result.error;
      if (result.outcome === 'refused') ruleId = result.ruleId;
      return;
    }

    const parsed = parseIntent(value);
    if (parsed.ok && parsed.intent.kind === 'statement') {
      outcome = 'refused';
      ruleId = 'intent-invalid-locally';
      error = 'a statement intent was written to the intent file. Statements are built only by the publish plan from a validated plan; nothing was sent to the purse.';
      return;
    }
    if (!parsed.ok) {
      outcome = 'refused';
      ruleId = 'intent-invalid-locally';
      error = parsed.reason;
      return;
    }

    const answered = await options.ask.ask(parsed.intent);
    if (!answered.ok) {
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

    if (!('digest' in response)) {
      outcome = 'error';
      error = 'the purse answered a transaction intent with a statement';
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
    ...(postId === undefined ? {} : { postId }),
    ...(handle === undefined ? {} : { handle }),
    ...(named === undefined ? {} : { named }),
  };
  const statePath = await writeState(options.stateDir, state);
  return { state, statePath };
}
