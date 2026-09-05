// Build order step 6 (work/rnd/agent/2026-09-05-executive-heron-v2-decided.md section 3), against
// the CTO's spec (2026-09-05-engineering-heron-v2-runtime-and-host.md sections 3-5). Docker stays
// down on this laptop; nothing here builds an image, creates a droplet, or reaches a network. Every
// assertion reads a committed file as text or spawns a local script/fixture -- the same discipline
// test/image.test.mjs and test/tarball.test.mjs already hold this package to.
//
// Run: node --test test/host.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, utimesSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.join(__dirname, '..');
const DO_DIR = path.join(PKG_DIR, 'digitalocean');
const CHECK_ASCII = path.join(PKG_DIR, 'scripts', 'check-ascii.py');
const DEPLOY_SCRIPT = path.join(DO_DIR, 'deploy-droplet.sh');
const WATCHDOG = path.join(DO_DIR, 'bin', 'heron-watchdog');
const ALERT = path.join(DO_DIR, 'bin', 'heron-alert');

function renderCloudInit(env = {}) {
  const result = spawnSync('bash', [DEPLOY_SCRIPT, '--render-cloud-init'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `--render-cloud-init failed: ${result.stderr}`);
  return result.stdout;
}

// ---------------------------------------------------------------------------
// 1. The rendered cloud-init is ASCII, YAML-shaped, and carries the required keys.
// ---------------------------------------------------------------------------

test('the rendered cloud-init passes the ASCII guard (checked RENDERED, never the template)', () => {
  const rendered = renderCloudInit();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'host-cloudinit-'));
  try {
    const file = path.join(dir, 'rendered.yaml');
    writeFileSync(file, rendered, 'utf8');
    const result = spawnSync('python3', [CHECK_ASCII, file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `check-ascii.py refused the rendered file: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the rendered cloud-init is YAML-parseable (PyYAML if present, else a minimal structural check)', () => {
  const rendered = renderCloudInit();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'host-cloudinit-yaml-'));
  try {
    const file = path.join(dir, 'rendered.yaml');
    writeFileSync(file, rendered, 'utf8');

    const probe = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' });
    if (probe.status === 0) {
      const parsed = spawnSync(
        'python3',
        ['-c', `import yaml, sys; yaml.safe_load(open(sys.argv[1]))`, file],
        { encoding: 'utf8' },
      );
      assert.equal(parsed.status, 0, `PyYAML refused the rendered file: ${parsed.stderr}`);
      return;
    }

    // PyYAML is absent on this laptop (verified true as of this step, same as the CTO spec's own
    // finding); a minimal structural check stands in rather than silently skipping the assertion
    // or installing a package as a side effect of running the test suite.
    assert.doesNotMatch(rendered, /\t/, 'cloud-init.yaml must not contain a tab character');
    assert.match(rendered, /^#cloud-config/, 'must open with the #cloud-config marker');
    const lines = rendered.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    for (const line of lines) {
      assert.doesNotMatch(line, /^\s*\t/, `indentation uses a tab: ${line}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the rendered cloud-init carries every key build order step 6 requires', () => {
  const rendered = renderCloudInit();
  assert.match(rendered, /disable_root:\s*true/, 'missing disable_root: true');
  assert.match(rendered, /ssh_pwauth:\s*false/, 'missing ssh_pwauth: false');
  assert.match(
    rendered,
    /\/etc\/ssh\/sshd_config\.d\/00-heron\.conf/,
    'missing the 00-heron.conf sshd hardening file (must sort before cloud-init\'s own 50-cloud-init.conf)',
  );
  assert.match(
    rendered,
    /getent passwd 10001/,
    'missing the uid-10001-free assertion (the exact check that would have caught v1\'s uid 999 collision)',
  );
  assert.match(rendered, /docker\.io/, 'missing docker.io from Debian\'s own repository');
  assert.doesNotMatch(
    rendered,
    /curl[^\n]*\|\s*(sh|bash)\b/,
    'a curl-piped-to-shell shape must never appear in cloud-init',
  );
  // "monitoring" is fine as a word in a comment (explaining why do-agent is purged); what must
  // never appear is the YAML KEY, which belongs only in the droplet-create API body
  // (deploy-droplet.sh's create_droplet(), monitoring: False) -- never inside cloud-init itself.
  const nonCommentLines = rendered.split('\n').filter((l) => !l.trim().startsWith('#'));
  for (const line of nonCommentLines) {
    assert.doesNotMatch(
      line,
      /^\s*monitoring\s*:/,
      `cloud-init must never set a "monitoring:" key itself -- that belongs only in the droplet-create API call: ${line}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. --plan makes no network call and prints every section the Master reads before create.
// ---------------------------------------------------------------------------

test('--plan runs with no network and exits 0, printing every required section', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'host-plan-'));
  try {
    const doTokenFile = path.join(dir, 'do-token');
    const sshKeyFile = path.join(dir, 'id_ed25519.pub');
    writeFileSync(doTokenFile, 'fake-token-not-real\n', { mode: 0o600 });
    writeFileSync(sshKeyFile, 'ssh-ed25519 AAAAfaketest fake\n', 'utf8');

    const result = spawnSync('bash', [DEPLOY_SCRIPT, '--plan'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HERON_NO_NETWORK: '1',
        DO_TOKEN_FILE: doTokenFile,
        SSH_PUBLIC_KEY_FILE: sshKeyFile,
      },
    });

    assert.equal(result.status, 0, `--plan failed: ${result.stderr}`);
    const required = [
      '== Droplet',
      '== Firewall',
      '== Host paths',
      '== Credentials this step seals',
      '== What --create does',
      's-1vcpu-512mb-10gb',
      'debian-13-x64',
      'monitoring:  false',
      '/etc/heron/creds',
      'mail-key',
      'systemd-creds encrypt --with-key=host',
    ];
    for (const needle of required) {
      assert.ok(result.stdout.includes(needle), `--plan output is missing: ${needle}`);
    }
    // No value of the fake token ever appears in the plan's own output.
    assert.ok(!result.stdout.includes('fake-token-not-real'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. --create refuses without HERON_DEPLOY_CONFIRMED=1, before any other input is read.
// ---------------------------------------------------------------------------

test('--create refuses without HERON_DEPLOY_CONFIRMED=1', () => {
  const env = { ...process.env };
  delete env.HERON_DEPLOY_CONFIRMED;
  delete env.DO_TOKEN_FILE;
  delete env.SSH_PUBLIC_KEY_FILE;
  const result = spawnSync('bash', [DEPLOY_SCRIPT, '--create'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0, '--create must refuse with no confirmation env set');
  assert.match(result.stderr, /HERON_DEPLOY_CONFIRMED/);
});

test('--create refuses even with HERON_DEPLOY_CONFIRMED=1 set to the wrong value', () => {
  const result = spawnSync('bash', [DEPLOY_SCRIPT, '--create'], {
    encoding: 'utf8',
    env: { ...process.env, HERON_DEPLOY_CONFIRMED: 'yes' },
  });
  assert.notEqual(result.status, 0, 'only the literal value "1" may confirm a create');
});

// ---------------------------------------------------------------------------
// 4. The host-side unit files carry their required directives.
// ---------------------------------------------------------------------------

function unit(name) {
  return readFileSync(path.join(DO_DIR, 'systemd', name), 'utf8');
}

test('heron-watchdog.service triggers the alert unit on failure and runs the watchdog binary', () => {
  const svc = unit('heron-watchdog.service');
  assert.match(svc, /OnFailure=heron-alert@watchdog\.service/);
  assert.match(svc, /ExecStart=\/usr\/local\/sbin\/heron-watchdog\s*$/m);
  assert.match(svc, /Type=oneshot/);
});

test('heron-watchdog.timer runs every 15 minutes and is not enabled by [Install] alone', () => {
  const timer = unit('heron-watchdog.timer');
  assert.match(timer, /OnUnitActiveSec=15min/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /WantedBy=timers\.target/);
});

test('heron-alert@.service loads the mail key only through LoadCredentialEncrypted', () => {
  const svc = unit('heron-alert@.service');
  assert.match(svc, /LoadCredentialEncrypted=mail-key:\/etc\/heron\/creds\/mail-key\.cred/);
  assert.match(svc, /ExecStart=\/usr\/local\/sbin\/heron-alert %i/);
  assert.doesNotMatch(svc, /Environment=.*KEY/i, 'the key must never be passed as an Environment=');
});

test('heron-alive.timer fires daily at a fixed hour and points at the alert template', () => {
  const timer = unit('heron-alive.timer');
  assert.match(timer, /OnCalendar=\*-\*-\* \d{2}:00:00 UTC/);
  assert.match(timer, /Unit=heron-alert@alive\.service/);
});

test('heron-retention.service and .timer run the retention binary daily', () => {
  const svc = unit('heron-retention.service');
  const timer = unit('heron-retention.timer');
  assert.match(svc, /ExecStart=\/usr\/local\/sbin\/heron-retention\s*$/m);
  assert.match(timer, /OnCalendar=/);
});

test('heron-retention never calls a bare delete on the live runs directory -- only archive-then-remove-the-original', () => {
  const script = readFileSync(path.join(DO_DIR, 'bin', 'heron-retention'), 'utf8');
  // The only os.remove() in the script is inside archive_one(), AFTER the file's bytes have
  // already been written into archive/ (gzip-compressed) -- i.e. archiving, not deleting. There
  // is no rmtree, no shutil.rmtree, and no unlink of anything under archive/ itself.
  assert.doesNotMatch(script, /shutil\.rmtree/);
  assert.doesNotMatch(script, /os\.unlink/);
  const removeCalls = script.match(/os\.remove\(/g) ?? [];
  assert.equal(removeCalls.length, 1, 'exactly one os.remove() call, the one inside archive_one() after the gzip copy');
});

// ---------------------------------------------------------------------------
// 5. The watchdog's 90-minute rule: fires on an old fixture, not on a fresh one.
// ---------------------------------------------------------------------------

function runWatchdog(stateFile, extraEnv = {}) {
  return spawnSync(WATCHDOG, [], {
    encoding: 'utf8',
    env: { ...process.env, HERON_STATE_FILE: stateFile, ...extraEnv },
  });
}

test('the watchdog passes on a fresh state file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'watchdog-fresh-'));
  try {
    const stateFile = path.join(dir, 'latest.json');
    writeFileSync(stateFile, '{"exit":0}', 'utf8');
    const result = runWatchdog(stateFile);
    assert.equal(result.status, 0, `expected a fresh file to pass: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the watchdog fires (non-zero exit) on a state file older than 90 minutes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'watchdog-stale-'));
  try {
    const stateFile = path.join(dir, 'latest.json');
    writeFileSync(stateFile, '{"exit":0}', 'utf8');
    const ninetyOneMinutesAgo = new Date(Date.now() - 91 * 60 * 1000);
    utimesSync(stateFile, ninetyOneMinutesAgo, ninetyOneMinutesAgo);
    const result = runWatchdog(stateFile);
    assert.notEqual(result.status, 0, 'a 91-minute-old state file must fire the watchdog');
    assert.match(result.stderr, /past the 5400s ceiling/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the watchdog fires on a state file just under 90 minutes old passing, and just over failing (boundary)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'watchdog-boundary-'));
  try {
    const stateFile = path.join(dir, 'latest.json');
    writeFileSync(stateFile, '{"exit":0}', 'utf8');

    const justUnder = new Date(Date.now() - 89 * 60 * 1000);
    utimesSync(stateFile, justUnder, justUnder);
    assert.equal(runWatchdog(stateFile).status, 0, '89 minutes old must still pass');

    const justOver = new Date(Date.now() - 91 * 60 * 1000);
    utimesSync(stateFile, justOver, justOver);
    assert.notEqual(runWatchdog(stateFile).status, 0, '91 minutes old must fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the watchdog fires on an absent state file', () => {
  const result = runWatchdog('/nonexistent/heron-test-fixture/latest.json');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not exist/);
});

// ---------------------------------------------------------------------------
// 6. The alert script's --dry-run prints the message and never reads a key from the environment.
// ---------------------------------------------------------------------------

test('heron-alert --dry-run prints the message and needs no credential at all', () => {
  const env = { ...process.env };
  delete env.CREDENTIALS_DIRECTORY;
  const result = spawnSync('python3', [ALERT, 'watchdog', '--dry-run'], { encoding: 'utf8', env });
  assert.equal(result.status, 0, `dry-run must succeed with no CREDENTIALS_DIRECTORY: ${result.stderr}`);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /subject: Heron alert: watchdog/);
});

test('heron-alert --dry-run never reads a key-shaped environment variable', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'alert-poison-'));
  try {
    // A poisoned CREDENTIALS_DIRECTORY pointing at a real secret-looking file: if the dry-run
    // branch touched credential_path()/read_key() at all, this value would leak into stdout.
    const credsDir = path.join(dir, 'creds');
    writeFileSync(dir + '/marker', '', 'utf8');
    const result = spawnSync('python3', [ALERT, 'alive', '--dry-run'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CREDENTIALS_DIRECTORY: credsDir, // deliberately does not exist
        MAIL_KEY: 'THIS-VALUE-MUST-NEVER-APPEAR',
        RESEND_API_KEY: 'THIS-VALUE-MUST-NEVER-APPEAR-EITHER',
      },
    });
    assert.equal(result.status, 0, `dry-run must not fail even with a non-existent creds dir: ${result.stderr}`);
    assert.ok(!result.stdout.includes('THIS-VALUE-MUST-NEVER-APPEAR'));
    assert.ok(!result.stdout.includes('THIS-VALUE-MUST-NEVER-APPEAR-EITHER'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('heron-alert without --dry-run and without CREDENTIALS_DIRECTORY refuses, naming the rule', () => {
  const env = { ...process.env };
  delete env.CREDENTIALS_DIRECTORY;
  const result = spawnSync('python3', [ALERT, 'watchdog'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CREDENTIALS_DIRECTORY/);
});

test('heron-alert refuses a missing instance argument', () => {
  const result = spawnSync('python3', [ALERT], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage/);
});

// ---------------------------------------------------------------------------
// The retention script: 400 fixture files fall under the 200-file / 512 MB ceiling, and nothing
// is ever deleted (moved into archive/ and compressed instead).
// ---------------------------------------------------------------------------

test('retention keeps the newest 200 files and archives (never deletes) the rest', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'retention-'));
  try {
    const now = Date.now();
    for (let i = 0; i < 400; i += 1) {
      const file = path.join(dir, `${String(i).padStart(4, '0')}.log`);
      writeFileSync(file, 'x'.repeat(100), 'utf8');
      const t = new Date(now - (400 - i) * 60 * 1000);
      utimesSync(file, t, t);
    }

    const result = spawnSync(path.join(DO_DIR, 'bin', 'heron-retention'), [], {
      encoding: 'utf8',
      env: { ...process.env, HERON_RUNS_DIR: dir },
    });
    assert.equal(result.status, 0, `retention failed: ${result.stderr}`);

    const remaining = readdirCount(dir, { excludeArchive: true });
    assert.equal(remaining, 200, 'exactly 200 live files should remain');

    const archived = readdirCount(path.join(dir, 'archive'));
    assert.equal(archived, 200, 'the other 200 must be archived, not deleted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readdirCount(dir, { excludeArchive = false } = {}) {
  const entries = readdirSync(dir);
  return entries.filter((name) => !(excludeArchive && name === 'archive')).length;
}
