// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { ENV, openWeir, StartupRefusal } from '../src/transport.js';

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

function optionsWith(secretKey: string | null): Parameters<typeof openWeir>[0] {
  return {
    mode: 'stdio',
    baseUrl: 'https://weir.social',
    secretKey,
    policyPath: null,
    httpHost: '127.0.0.1',
    httpPort: 0,
    allowedOrigins: [],
    allowedHosts: [],
    agentEnvironment: {}, discoveryTools: [],
  };
}

async function messageFrom(secretKey: string): Promise<{ thrown: unknown; message: string }> {
  try {
    await openWeir(optionsWith(secretKey));
    return { thrown: null, message: '' };
  } catch (error) {
    return { thrown: error, message: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const undecodable = `suiprivkey1${'q'.repeat(59)}`;

  const bad = await messageFrom(undecodable);

  check('an undecodable key is refused', () => {
    assert.ok(bad.thrown !== null, 'openWeir returned instead of refusing');
  });

  check('the refusal came from the key decode, not an earlier gate', () => {
    assert.ok(
      !bad.message.includes('could not be loaded'),
      'the agent package failed to load, so this test never reached the key decode',
    );
    assert.ok(
      bad.message.includes(ENV.key),
      'the refusal does not name the key variable, so it is not the decode refusal',
    );
  });

  check('the refusal is a StartupRefusal', () => {
    assert.ok(bad.thrown instanceof StartupRefusal, 'refused, but not with the startup type');
  });

  check('the refusal does not contain the key', () => {
    assert.ok(!bad.message.includes(undecodable), 'the whole key appears in the refusal');
  });

  check('the refusal contains no 16-character run of the key', () => {
    const runs: string[] = [];
    for (let i = 0; i + 16 <= undecodable.length; i += 1) runs.push(undecodable.slice(i, i + 16));
    const leaked = runs.filter((run) => bad.message.includes(run));
    assert.equal(leaked.length, 0, `${leaked.length} run(s) of the key appear in the refusal`);
  });

  const valid = new Ed25519Keypair().getSecretKey();
  const good = await messageFrom(valid);

  check('a valid key is not refused by the decode', () => {
    assert.ok(
      !good.message.includes('could not be decoded'),
      'a well-formed key was rejected as undecodable',
    );
  });

  check('a valid key never appears in any refusal either', () => {
    assert.ok(!good.message.includes(valid), 'a valid key appears in an error message');
  });

  console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('harness crashed:', error);
  process.exitCode = 1;
});
