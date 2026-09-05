// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Phase two, and the one property the whole state sink exists for: it is written on every path.
 *
 * A sink that only records success cannot detect failure. So there are four outcomes and a test for
 * each, and two of the four are the ones that would be missing from a naive implementation — a
 * refusal, and an exception thrown from the submit.
 */

import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPhaseTwo, type AskPort, type SubmitPort } from '../src/beat.js';
import { STATE_FILE, type BeatState } from '../src/state.js';
import { priceIntentFor, temporaryDirectory } from './helpers.js';

const BEAT_ID = '20260905T120000Z';

async function stage(intent: unknown | undefined): Promise<{ runs: string; state: string }> {
  const dir = await temporaryDirectory();
  const runs = join(dir, 'runs');
  const state = join(dir, 'state');
  if (intent !== undefined) {
    await mkdir(join(runs, BEAT_ID), { recursive: true });
    await writeFile(join(runs, BEAT_ID, 'intent.json'), JSON.stringify(intent), 'utf8');
  }
  return { runs, state };
}

async function readState(stateDir: string): Promise<BeatState> {
  return JSON.parse(await readFile(join(stateDir, STATE_FILE), 'utf8')) as BeatState;
}

const signingPurse: AskPort = {
  ask: async () => ({
    ok: true,
    value: { ok: true, digest: 'DiGeSt', txBytesB64: 'AAAA', signature: 'AQID' },
  }),
};

const refusingPurse: AskPort = {
  ask: async () => ({
    ok: true,
    value: {
      ok: false,
      refused: { ruleId: 'object-input', reason: '[object-input] the vault is not in the allow-list.' },
    },
  }),
};

describe('the state file is written on every path', () => {
  it('signed — with the digest', async () => {
    const { runs, state } = await stage(priceIntentFor());
    const result = await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: signingPurse });

    expect(result.state.outcome).toBe('signed');
    const written = await readState(state);
    expect(written.outcome).toBe('signed');
    expect(written.digest).toBe('DiGeSt');
    expect(written.beatId).toBe(BEAT_ID);
    // Nothing submitted: no submit port was given, which is what --dry-run does.
    expect(written.submittedDigest).toBeUndefined();
  });

  it('signed and submitted — with both digests', async () => {
    const { runs, state } = await stage(priceIntentFor());
    const submit: SubmitPort = { submit: async () => 'OnChainDigest' };
    await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: signingPurse, submit });

    const written = await readState(state);
    expect(written.outcome).toBe('signed');
    expect(written.submittedDigest).toBe('OnChainDigest');
  });

  it('refused — with the rule id, on a forced refusal', async () => {
    const { runs, state } = await stage(priceIntentFor());
    const result = await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: refusingPurse });

    expect(result.state.outcome).toBe('refused');
    const written = await readState(state);
    expect(written.outcome).toBe('refused');
    expect(written.ruleId).toBe('object-input');
    expect(written.error).toContain('allow-list');
  });

  it('error — on a thrown submit, keeping the digest so the operator can check the chain', async () => {
    const { runs, state } = await stage(priceIntentFor());
    const submit: SubmitPort = {
      submit: async () => {
        throw new Error('the node hung up mid-response');
      },
    };
    const result = await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: signingPurse, submit });

    expect(result.state.outcome).toBe('error');
    const written = await readState(state);
    expect(written.outcome).toBe('error');
    expect(written.error).toContain('hung up');
    // A signature exists for this digest. Reporting only `error` would send whoever is on call
    // looking for a transaction they cannot name.
    expect(written.digest).toBe('DiGeSt');
  });

  it('error — when the ask port itself throws', async () => {
    const { runs, state } = await stage(priceIntentFor());
    const exploding: AskPort = {
      ask: async () => {
        throw new Error('socket exploded');
      },
    };
    await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: exploding });

    const written = await readState(state);
    expect(written.outcome).toBe('error');
    expect(written.error).toContain('socket exploded');
  });

  it('no-intent — when the container wrote nothing', async () => {
    const { runs, state } = await stage(undefined);
    await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: signingPurse });

    const written = await readState(state);
    expect(written.outcome).toBe('no-intent');
    expect(written.error).toContain('intent.json');
  });

  it('error — when the purse could not be reached, which is a no-answer and not a refusal', async () => {
    const { runs, state } = await stage(priceIntentFor());
    const unreachable: AskPort = {
      ask: async () => ({
        ok: false,
        refused: { ruleId: 'purse-unreachable', reason: 'the purse did not answer within 120000ms.' },
      }),
    };
    await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: unreachable });

    const written = await readState(state);
    expect(written.outcome).toBe('error');
    expect(written.ruleId).toBe('purse-unreachable');
  });
});

describe('the beat checks the schema before it opens the socket', () => {
  it('refuses a malformed intent locally, and never asks the purse', async () => {
    const { runs, state } = await stage({ kind: 'buy', to: `0x${'b'.repeat(64)}` });
    let asked = false;
    const watching: AskPort = {
      ask: async () => {
        asked = true;
        return { ok: true, value: { ok: true, digest: '', txBytesB64: '', signature: '' } };
      },
    };
    await runPhaseTwo({ runsDir: runs, stateDir: state, beatId: BEAT_ID, ask: watching });

    expect(asked).toBe(false);
    const written = await readState(state);
    expect(written.outcome).toBe('refused');
    expect(written.ruleId).toBe('intent-invalid-locally');
  });

  it('refuses an intent file that is not JSON', async () => {
    const dir = await temporaryDirectory();
    const runs = join(dir, 'runs');
    await mkdir(join(runs, BEAT_ID), { recursive: true });
    await writeFile(join(runs, BEAT_ID, 'intent.json'), '{ not json', 'utf8');

    await runPhaseTwo({ runsDir: runs, stateDir: join(dir, 'state'), beatId: BEAT_ID, ask: signingPurse });
    const written = await readState(join(dir, 'state'));
    expect(written.outcome).toBe('refused');
    expect(written.ruleId).toBe('intent-invalid-locally');
  });
});
