// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ENVIRONMENT, agentEnvironment } from '../src/transport.js';
import { AGENT_ENV } from '../../agent/src/manifest.js';
import { KEY_REGISTRY_ENV, REQUIRED_ENV } from '../../sdk/src/config.js';

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

const here = join(import.meta.dirname, '..');
const id = (c: string) => `0x${c.repeat(64)}`;

const SIX: Record<string, string> = {
  PROJECTX_SOCIAL_NETWORK: 'mainnet',
  PROJECTX_SOCIAL_GRPC_URL: 'https://fullnode.example:443',
  PROJECTX_SOCIAL_PACKAGE_ID: id('1'),
  PROJECTX_SOCIAL_LATEST_PACKAGE_ID: id('2'),
  PROJECTX_SOCIAL_PLATFORM_ID: id('3'),
  PROJECTX_SOCIAL_REGISTRY_ID: id('4'),
};
const COIN = { PROJECTX_SOCIAL_AGENT_COIN_TYPE: `${id('5')}::usdc::USDC` };
const BASE = { PROJECTX_SOCIAL_AGENT_BASE_URL: 'https://weir.social' };

const MISSING_SIX = 'missing required environment variables';
const MISSING_COIN = 'PROJECTX_SOCIAL_AGENT_COIN_TYPE is not set';
const MISSING_BASE = 'PROJECTX_SOCIAL_AGENT_BASE_URL is not set';
const STOPS_ON_KEY = "Cannot read properties of null (reading 'address')";

/** The marker the server prints once it is actually serving. */
const READY = 'listening on';
/** tsx from the workspace root — one process, not `pnpm exec tsx`, which is three. */
const TSX = join(here, '..', '..', 'node_modules', '.bin', 'tsx');

/*
  Start the server, take what it says, and stop it.

  # Why this is not `spawnSync(..., { timeout })` any more

  It was, and it hung. The old form ran the server through `pnpm exec tsx` — three processes deep —
  and a `spawnSync` timeout signals only the process it launched. `pnpm` died on the timer; the node
  server underneath kept the stderr pipe open, and `spawnSync` waits on the PIPE, not on the child
  it killed. So the eight-variable start, which is SUPPOSED to keep running because a server that
  starts does not exit, hung this file far past its own 30-second limit — measured at sixteen
  minutes on 2026-09-11 with no output at all — and left an orphan holding port 8497 that made the
  NEXT run fail with EADDRINUSE, which then read as a different bug entirely.

  So: `tsx` directly, `detached` so the child leads its own process group, and the whole group is
  killed by negative pid. And it resolves on what the server SAYS — it exited with a refusal, or it
  printed `listening on` — rather than on a clock. A refusal now takes as long as the refusal takes.

  The 15-second cap is the last resort for a server that neither refuses nor serves. It is not the
  normal path and a run that hits it is a finding, not a wait.
*/
function start(vars: Record<string, string>): Promise<{ stderr: string; status: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(TSX, ['src/index.ts', '--http'], {
      cwd: here,
      env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', WEIR_MCP_HTTP_PORT: '8497', ...vars },
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    let settled = false;

    const finish = (status: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      // Negative pid: the group, not just the leader. `detached` is what makes that legal.
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone — the refusal path exits on its own, and that is the common case.
      }
      resolve({ stderr, status });
    };

    const cap = setTimeout(() => finish(null), 15_000);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      // A server that is serving will never exit, so readiness is the end of the story.
      if (stderr.includes(READY)) finish(null);
    });
    child.on('error', () => finish(null));
    child.on('exit', (code) => finish(code));
  });
}

console.log('=== the list matches its sources ===');
check('every name the SDK requires is in AGENT_ENVIRONMENT', () => {
  for (const name of REQUIRED_ENV) assert.ok(AGENT_ENVIRONMENT.includes(name), name);
});
check("the agent's coin type and base URL are in AGENT_ENVIRONMENT", () => {
  assert.ok(AGENT_ENVIRONMENT.includes(AGENT_ENV.coinType));
  assert.ok(AGENT_ENVIRONMENT.includes(AGENT_ENV.baseUrl));
});
check('the optional key registry is in AGENT_ENVIRONMENT, and nothing else is', () => {
  const expected = new Set<string>([...REQUIRED_ENV, AGENT_ENV.coinType, AGENT_ENV.baseUrl, KEY_REGISTRY_ENV]);
  assert.deepEqual(new Set(AGENT_ENVIRONMENT), expected);
});
check("the agent's SECRET is not in the projection — keys travel as `keypair`, never as environment", () => {
  assert.ok(!(AGENT_ENVIRONMENT as readonly string[]).includes(AGENT_ENV.secret));
  const projected = agentEnvironment({ ...SIX, [AGENT_ENV.secret]: 'suiprivkey1notreal', UNRELATED: 'x', PROJECTX_SOCIAL_AGENT_COIN_TYPE: '  ' });
  assert.deepEqual(Object.keys(projected).sort(), Object.keys(SIX).sort());
});
check('the README documents every name in the projection', () => {
  const readme = readFileSync(join(here, 'README.md'), 'utf8');
  for (const name of AGENT_ENVIRONMENT) assert.ok(readme.includes(`\`${name}\``), name);
});

console.log('=== the agent sees what the operator exported ===');
const six = await start(SIX);
check('with the six chain variables set, the refusal is no longer "missing required environment variables"', () => {
  assert.ok(!six.stderr.includes(MISSING_SIX), six.stderr);
});
check('…it is the coin type, the seventh, which the placeholder used to hide', () => {
  assert.ok(six.stderr.includes(MISSING_COIN), six.stderr);
  assert.equal(six.status, 78);
});
const seven = await start({ ...SIX, ...COIN });
check('with the coin type set too, the refusal is the base URL, the eighth', () => {
  assert.ok(!seven.stderr.includes(MISSING_COIN), seven.stderr);
  assert.ok(seven.stderr.includes(MISSING_BASE), seven.stderr);
  assert.equal(seven.status, 78);
});
const eight = await start({ ...SIX, ...COIN, ...BASE });
check('with all eight set, none of the three configuration refusals appears', () => {
  for (const sentence of [MISSING_SIX, MISSING_COIN, MISSING_BASE]) assert.ok(!eight.stderr.includes(sentence), eight.stderr);
});
check(`…and the keyless server LISTENS — the agent library's key requirement no longer stops it`, () => {
  assert.ok(eight.stderr.includes('listening on'), eight.stderr);
  assert.ok(eight.stderr.includes('(stateless, keyless)'), eight.stderr);
  assert.ok(!eight.stderr.includes(STOPS_ON_KEY), eight.stderr);
  assert.notEqual(eight.status, 78, 'a configuration refusal is not a start');
  assert.notEqual(eight.status, 1, 'the key requirement is not a start');
});

console.log(`${checks - failures}/${checks} checks passed, ${failures} failed`);
if (failures > 0) process.exitCode = 1;
