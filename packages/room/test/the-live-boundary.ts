// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
    assert.equal(commitFrom([COMMIT_FLAG], { [COMMIT_ENV]: 'i-have-read-the-plans' }), null);
    assert.equal(commitFrom([COMMIT_FLAG], { [COMMIT_ENV]: '' }), null);
    assert.equal(commitFrom([COMMIT_FLAG], { [COMMIT_ENV]: 'true' }), null);
  });

  check('refuses a flag that is merely close', () => {
    assert.equal(commitFrom(['--commit-please'], GOOD_ENV), null);
    assert.equal(commitFrom(['commit'], GOOD_ENV), null);
  });

  check('REFUSES a token the type system was talked into producing', () => {
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
    const real = commitFrom([COMMIT_FLAG], GOOD_ENV);
    assert.notEqual(real, null);
    const effects = liveEffects(real as Commit, PORTS);
    assert.equal(effects.mode, 'live');
  });

  check('says what is required when it refuses', () => {
    try {
      liveEffects({} as unknown as Commit, PORTS);
      assert.fail('expected a refusal');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(message.includes(COMMIT_FLAG), 'the refusal does not name the flag');
      assert.ok(message.includes(COMMIT_ENV), 'the refusal does not name the environment variable');
    }
  });

  check('a dry run reports itself as one', () => {
    const printed: string[] = [];
    const effects = dryRunEffects({ line: (text: string) => printed.push(text) } as never);
    assert.equal(effects.mode, 'dry-run');
  });

  console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main();
