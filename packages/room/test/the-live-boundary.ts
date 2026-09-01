// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The one thing in this package that must never be wrong: whether a run is a dry run.
 *
 * # Why this file exists at all
 *
 * `packages/room` had no test script. Not failing tests — NO SCRIPT, so `pnpm -r test` ran the
 * seven packages that had one and said nothing about the eighth. Every "full gate" reported
 * tonight passed over 1,937 lines that publish under a creator's handle, and both desks read the
 * result as complete coverage.
 *
 * This is the first test in the package, and it is aimed at the boundary rather than at the
 * publishing logic, because the boundary is the part where being wrong is unrecoverable: a dry run
 * that turns out to have posted cannot be un-posted.
 *
 * # The design being pinned
 *
 * Acting requires a `Commit` token, and the token is branded so the type system cannot mint one.
 * `commitFrom` is the only constructor, and it demands BOTH `--commit` on the command line and
 * `WEIR_ROOM_COMMIT=i-have-read-the-plan` in the environment of the same invocation. Then
 * `liveEffects` RE-RUNS `commitFrom` over the argv and env the token recorded — so a token forged
 * by talking the type system out of the way dies one line later.
 *
 * Both halves are asserted. The constructor alone would leave the re-check untested, and the
 * re-check is the half that survives somebody writing `{} as unknown as Commit`.
 */

import assert from 'node:assert/strict';
import {
  COMMIT_ENV,
  COMMIT_ENV_VALUE,
  COMMIT_FLAG,
  commitFrom,
  dryRunEffects,
  liveEffects,
  type Commit,
} from '../src/index.js';

let checks = 0;
let failures = 0;
function check(what: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`  ok  ${what}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${what}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

const GOOD_ENV = { [COMMIT_ENV]: COMMIT_ENV_VALUE };
const PORTS = {
  signer: { sign: async () => 'signature-not-used-in-these-cases' },
  http: { post: async () => ({ ok: true, status: 200, body: '{}' }) },
} as unknown as Parameters<typeof liveEffects>[1];

function main(): void {
  // ---- the constructor: both halves required, neither sufficient ----------------------------
  check('mints a token when the flag and the environment agree', () => {
    assert.notEqual(commitFrom([COMMIT_FLAG], GOOD_ENV), null);
  });

  check('refuses without the flag, however the environment is set', () => {
    assert.equal(commitFrom([], GOOD_ENV), null);
  });

  check('refuses without the environment, however the flag is passed', () => {
    assert.equal(commitFrom([COMMIT_FLAG], {}), null);
  });

  check('refuses an environment value that is merely close', () => {
    // The value is a sentence somebody has to type. A near miss is not a confirmation.
    assert.equal(commitFrom([COMMIT_FLAG], { [COMMIT_ENV]: 'i-have-read-the-plans' }), null);
    assert.equal(commitFrom([COMMIT_FLAG], { [COMMIT_ENV]: '' }), null);
    assert.equal(commitFrom([COMMIT_FLAG], { [COMMIT_ENV]: 'true' }), null);
  });

  check('refuses a flag that is merely close', () => {
    assert.equal(commitFrom(['--commit-please'], GOOD_ENV), null);
    assert.equal(commitFrom(['commit'], GOOD_ENV), null);
  });

  // ---- the re-check: the half that survives a forged token -----------------------------------
  check('REFUSES a token the type system was talked into producing', () => {
    /*
      The assertion the whole design exists for. `{} as unknown as Commit` satisfies the compiler
      and carries no argv, so the re-check finds no flag and dies. Without this, a single cast
      anywhere in the codebase would buy a live run.
    */
    assert.throws(() => liveEffects({} as unknown as Commit, PORTS), /does not re-validate/);
  });

  check('refuses a forged token that carries the environment but not the flag', () => {
    const forged = { argv: [], env: GOOD_ENV, reason: 'looks plausible' } as unknown as Commit;
    assert.throws(() => liveEffects(forged, PORTS), /does not re-validate/);
  });

  check('refuses a forged token that carries the flag but not the environment', () => {
    const forged = { argv: [COMMIT_FLAG], env: {}, reason: 'looks plausible' } as unknown as Commit;
    assert.throws(() => liveEffects(forged, PORTS), /does not re-validate/);
  });

  check('accepts a token that was minted honestly', () => {
    // The converse. A re-check that refused everything would pass every assertion above while
    // making a live run impossible, which is a different defect and not an improvement.
    const real = commitFrom([COMMIT_FLAG], GOOD_ENV);
    assert.notEqual(real, null);
    const effects = liveEffects(real as Commit, PORTS);
    assert.equal(effects.mode, 'live');
  });

  check('says what is required when it refuses', () => {
    // An operator meeting this needs to know which of the two halves they are missing.
    try {
      liveEffects({} as unknown as Commit, PORTS);
      assert.fail('expected a refusal');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(message.includes(COMMIT_FLAG), 'the refusal does not name the flag');
      assert.ok(message.includes(COMMIT_ENV), 'the refusal does not name the environment variable');
    }
  });

  // ---- the default is a dry run --------------------------------------------------------------
  check('a dry run reports itself as one', () => {
    const printed: string[] = [];
    const effects = dryRunEffects({ line: (text: string) => printed.push(text) } as never);
    assert.equal(effects.mode, 'dry-run');
  });

  console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main();
