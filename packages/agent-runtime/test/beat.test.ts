// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// bin/beat.sh has two refusals and one spawn, and until 2026-09-05 none of the three was asserted
// by anything. Both defects the CTO's Heron v2 specification names are fixtured here, through the
// real script — not a copy of its logic:
//
//   HOLE B (§2.8a) — the stdio child's environment. v1 handed PicoClaw the whole ambient
//   environment, and a stdio MCP server is a child of PicoClaw, so on the host it would have
//   inherited the decrypted model credential. The test puts two sentinels in the parent
//   environment and asserts the child's own `env` output holds neither, and holds exactly the
//   allow-list bin/check-rules.ts publishes.
//
//   THE LOCK (§1 defect 4) — v1 read every mkdir failure as "another beat is running". On the
//   droplet the runs directory was owned by root and the container ran as another uid, so every
//   beat got EACCES, printed a phantom running beat and exited 75 for ever. The two cases are
//   fixtured separately and must exit with different codes.
//
// Run: node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { STDIO_ENV_ALLOWLIST } from '../bin/check-rules.ts';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const BEAT = path.join(PACKAGE_ROOT, 'bin', 'beat.sh');

/** The credential-shaped values that must not reach the child. */
const SENTINEL_MODEL_KEY = 'sk-or-v1-SENTINEL-DECRYPTED-MODEL-CREDENTIAL';
const SENTINEL_PLAIN = 'HERON-SENTINEL-9f2b41';

/**
 * Names the operating system adds to a process at exec, which `env -i` therefore cannot remove
 * and which are not inherited from the parent. Verified on this laptop today:
 * `env -i PATH=/usr/bin:/bin node` reports exactly two names, PATH and __CF_USER_TEXT_ENCODING —
 * macOS CoreFoundation adds the second one itself. It carries a locale id, never a credential,
 * and the sentinel assertions above cover the case where it somehow did.
 */
const PLATFORM_INJECTED: readonly string[] = ['__CF_USER_TEXT_ENCODING'];

interface Harness {
  readonly root: string;
  readonly runsDir: string;
  readonly configPath: string;
  readonly heartbeatPath: string;
  readonly picoclawPath: string;
}

/**
 * A complete, real beat: a config directory of its own (so rule 10 looks for `.security.yml`
 * there), the shipped workspace, its own runs directory, and a stand-in for the picoclaw binary
 * that reports its environment and exits 0.
 */
function makeHarness(): Harness {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-beat-'));
  const configDir = path.join(root, 'config');
  const runsDir = path.join(root, 'runs');
  const binDir = path.join(root, 'bin');
  mkdirSync(configDir);
  mkdirSync(runsDir);
  mkdirSync(binDir);

  const template = JSON.parse(
    readFileSync(path.join(PACKAGE_ROOT, 'picoclaw', 'config.template.json'), 'utf8')
  ) as Record<string, unknown>;
  const config = {
    ...template,
    agents: {
      defaults: {
        workspace: path.join(PACKAGE_ROOT, 'picoclaw', 'workspace'),
        restrict_to_workspace: true,
        model_name: 'route-critical',
      },
    },
  };
  const configPath = path.join(configDir, 'config.json');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const heartbeatPath = path.join(root, 'HEARTBEAT.md');
  writeFileSync(heartbeatPath, 'Report your state and stop.\n');

  // Stands in for the picoclaw binary: prints its own environment, one NAME=VALUE per line.
  // Deliberately not a shell script — a shell sets PWD and SHLVL itself, and the point of this
  // harness is that what the child holds is exactly what beat.sh handed it and nothing more.
  const picoclawPath = path.join(binDir, 'picoclaw');
  writeFileSync(
    picoclawPath,
    '#!/usr/bin/env node\nfor (const [k, v] of Object.entries(process.env)) console.log(`${k}=${v}`);\n'
  );
  chmodSync(picoclawPath, 0o755);

  return { root, runsDir, configPath, heartbeatPath, picoclawPath };
}

function runBeat(h: Harness, extraEnv: Readonly<Record<string, string>> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.PICOCLAW_CONFIG = h.configPath;
  env.WEIR_AGENT_HEARTBEAT_FILE = h.heartbeatPath;
  env.WEIR_AGENT_RUNS_DIR = h.runsDir;
  env.PICOCLAW_BIN = h.picoclawPath;
  Object.assign(env, extraEnv);
  return spawnSync('bash', [BEAT], { env, encoding: 'utf8' });
}

function readOnlyLog(h: Harness): string {
  const logs = readdirSync(h.runsDir).filter((f) => f.endsWith('.log'));
  assert.equal(logs.length, 1, `expected exactly one log in ${h.runsDir}, found ${logs.join(', ')}`);
  return readFileSync(path.join(h.runsDir, logs[0] as string), 'utf8');
}

// ---------------------------------------------------------------------------------------------
// Hole B — the child's environment
// ---------------------------------------------------------------------------------------------

test('hole B (CTO §2.8a): a credential in the parent environment does not reach the child', () => {
  const h = makeHarness();
  const result = runBeat(h, {
    OPENROUTER_API_KEY: SENTINEL_MODEL_KEY,
    HERON_TEST_SENTINEL: SENTINEL_PLAIN,
  });

  assert.equal(result.status, 0, `beat.sh exited ${String(result.status)}: ${result.stderr}`);
  const childEnv = readOnlyLog(h);

  // Asserted as booleans, never with assert.doesNotMatch: a failure there prints the whole input,
  // which is the child's entire environment, into the test log. Seen for real while proving this
  // fixture fires on the v1 shape — the failure output carried a live session token off this
  // laptop's own environment. A test that proves a leak must not be one.
  assert.ok(!childEnv.includes(SENTINEL_MODEL_KEY), 'the decrypted model credential reached the child');
  assert.ok(!childEnv.includes(SENTINEL_PLAIN), 'the plain sentinel reached the child');
  assert.ok(!childEnv.includes('OPENROUTER_API_KEY'), 'the credential variable name reached the child');

  rmSync(h.root, { recursive: true, force: true });
});

test('hole B: the child receives exactly the allow-list and nothing else', () => {
  const h = makeHarness();
  const result = runBeat(h, { HERON_TEST_SENTINEL: SENTINEL_PLAIN, EDITOR: 'vi', AWS_SECRET_ACCESS_KEY: 'x' });
  assert.equal(result.status, 0, `beat.sh exited ${String(result.status)}: ${result.stderr}`);

  const names = readOnlyLog(h)
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')))
    .filter((name) => name !== '');

  const allowed = new Set([...STDIO_ENV_ALLOWLIST, ...PLATFORM_INJECTED]);
  const unexpected = names.filter((name) => !allowed.has(name));
  assert.deepEqual(unexpected, [], `the child saw variables outside the allow-list: ${unexpected.join(', ')}`);

  rmSync(h.root, { recursive: true, force: true });
});

test('hole B: PICOCLAW_CONFIG the child sees is this beat\'s config, not an inherited one', () => {
  const h = makeHarness();
  const result = runBeat(h, { PICOCLAW_CONFIG: h.configPath });
  assert.equal(result.status, 0, `beat.sh exited ${String(result.status)}: ${result.stderr}`);
  const lines = readOnlyLog(h).split('\n');
  assert.ok(lines.includes(`PICOCLAW_CONFIG=${h.configPath}`), "the child's PICOCLAW_CONFIG is not this beat's config");
  rmSync(h.root, { recursive: true, force: true });
});

test('hole B: the shape that leaked — passing the ambient environment through — is what changed', () => {
  // The v1 line was `PICOCLAW_CONFIG="$CONFIG_PATH" "$PICOCLAW_BIN" ...`, which inherits
  // everything. Asserted here on the script's own text so a later edit that drops `env -i` fails
  // this file rather than silently restoring the hole.
  const beat = readFileSync(BEAT, 'utf8');
  assert.match(beat, /env -i "\$\{ENV_ASSIGNMENTS\[@\]\}"/);
  assert.match(beat, /--print-stdio-env-allowlist/);
  assert.doesNotMatch(beat, /^\s*PICOCLAW_CONFIG="\$CONFIG_PATH" "\$PICOCLAW_BIN"/m);
});

// ---------------------------------------------------------------------------------------------
// The lock — EEXIST and everything else
// ---------------------------------------------------------------------------------------------

test('lock: a lock directory that already exists is a busy beat, exit 75', () => {
  const h = makeHarness();
  mkdirSync(path.join(h.runsDir, '.lock'));
  const result = runBeat(h);
  assert.equal(result.status, 75, `expected EX_TEMPFAIL 75, got ${String(result.status)}: ${result.stderr}`);
  assert.match(result.stderr, /another beat is already running/);
  rmSync(h.root, { recursive: true, force: true });
});

test('lock (CTO §1 defect 4): a runs directory that cannot be written is NOT reported as busy', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    // root ignores the mode bits, so the fixture cannot fire. Say so rather than pass silently.
    assert.fail('this fixture must not be run as root: root can create the lock in a 0555 directory');
  }
  const h = makeHarness();
  chmodSync(h.runsDir, 0o555);
  const result = runBeat(h);
  chmodSync(h.runsDir, 0o755);

  assert.notEqual(result.status, 75, 'EACCES was reported as a busy beat — the v1 defect');
  assert.equal(result.status, 74, `expected EX_IOERR 74, got ${String(result.status)}: ${result.stderr}`);
  assert.match(result.stderr, /could not be created and does not exist/);
  assert.match(result.stderr, /this is not a busy beat/);

  rmSync(h.root, { recursive: true, force: true });
});

test('lock: a completed beat releases the lock', () => {
  const h = makeHarness();
  const result = runBeat(h);
  assert.equal(result.status, 0, `beat.sh exited ${String(result.status)}: ${result.stderr}`);
  assert.deepEqual(
    readdirSync(h.runsDir).filter((f) => f === '.lock'),
    []
  );
  rmSync(h.root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// The other two refusals in beat.sh
// ---------------------------------------------------------------------------------------------

test('beat.sh: a missing heartbeat file is refused', () => {
  const h = makeHarness();
  rmSync(h.heartbeatPath);
  const result = runBeat(h);
  assert.equal(result.status, 1, `expected 1, got ${String(result.status)}: ${result.stderr}`);
  assert.match(result.stderr, /heartbeat file not found/);
  rmSync(h.root, { recursive: true, force: true });
});

test('beat.sh: a picoclaw binary that is not on PATH is refused before any spawn', () => {
  const h = makeHarness();
  const result = runBeat(h, { PICOCLAW_BIN: path.join(h.root, 'bin', 'no-such-picoclaw') });
  assert.equal(result.status, 1, `expected 1, got ${String(result.status)}: ${result.stderr}`);
  assert.match(result.stderr, /is not on PATH/);
  rmSync(h.root, { recursive: true, force: true });
});

test('beat.sh: a config that violates a rule stops the beat before picoclaw runs', () => {
  const h = makeHarness();
  const config = JSON.parse(readFileSync(h.configPath, 'utf8')) as Record<string, unknown>;
  config.evolution = { enabled: true, mode: 'apply' };
  writeFileSync(h.configPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = runBeat(h);
  assert.equal(result.status, 1, `expected 1, got ${String(result.status)}: ${result.stderr}`);
  assert.match(result.stderr, /check-rules: refused — rule 1/);
  assert.deepEqual(
    readdirSync(h.runsDir).filter((f) => f.endsWith('.log')),
    []
  );
  rmSync(h.root, { recursive: true, force: true });
});
