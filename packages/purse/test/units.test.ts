// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The unit files, read back.
 *
 * v1 shipped an SSH hardening file that sorted after cloud-init's and lost every keyword it set,
 * and nobody noticed because nothing read it back. A directive that is only in a file nobody parses
 * is a directive that is only in a comment.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { directive, onlyValue, parseUnit, type ParsedUnit } from '../src/units.js';

const SYSTEMD = join(dirname(fileURLToPath(import.meta.url)), '..', 'systemd');

async function unit(name: string): Promise<ParsedUnit> {
  return parseUnit(await readFile(join(SYSTEMD, name), 'utf8'));
}

/** The unit's raw text, comments included — where the uid ruling is written. */
async function text(name: string): Promise<string> {
  return readFile(join(SYSTEMD, name), 'utf8');
}

describe('heron-purse.service', () => {
  it('runs as the purse user and takes the key as an encrypted systemd credential', async () => {
    const purse = await unit('heron-purse.service');
    expect(onlyValue(purse, 'Service', 'User')).toBe('purse');
    expect(directive(purse, 'Service', 'LoadCredentialEncrypted')).toContain(
      'heron-hot:/etc/heron/creds/heron-hot.cred',
    );
  });

  /*
    A5 from Security's review of 2026-09-05: `User=purse` named no uid, and v1's defect 3 was a
    dynamically allocated uid colliding with a platform account. The ruling the build log records is
    `heron` 10001 and `purse` 10002, both asserted free before they are created.

    systemd has no directive that carries a uid alongside a user name, so the ruling lives in the
    unit's header comment — which is precisely the kind of text this test file exists to stop being
    decorative. The numbers are asserted here and in the README so the deploy has one place to copy
    from and drift fails a test rather than a droplet.
  */
  it('runs as purse:purse and names the uid the deploy must create', async () => {
    const purse = await unit('heron-purse.service');
    expect(onlyValue(purse, 'Service', 'User')).toBe('purse');
    expect(onlyValue(purse, 'Service', 'Group')).toBe('purse');

    const raw = await text('heron-purse.service');
    expect(raw).toContain('--uid 10002');
    expect(raw).toContain('getent passwd 10002');
    expect(raw).toContain('10001');
  });

  it('carries the hardening set the CISO named', async () => {
    const purse = await unit('heron-purse.service');
    expect(onlyValue(purse, 'Service', 'NoNewPrivileges')).toBe('yes');
    expect(onlyValue(purse, 'Service', 'ProtectSystem')).toBe('strict');
    expect(onlyValue(purse, 'Service', 'ProtectHome')).toBe('yes');
    expect(onlyValue(purse, 'Service', 'PrivateTmp')).toBe('yes');
    expect(onlyValue(purse, 'Service', 'PrivateDevices')).toBe('yes');
    expect(onlyValue(purse, 'Service', 'MemoryDenyWriteExecute')).toBe('yes');
    expect(onlyValue(purse, 'Service', 'RestrictAddressFamilies')).toBe('AF_UNIX AF_INET AF_INET6');
  });

  it('pairs MemoryDenyWriteExecute with --jitless, or one of the two is not doing its job', async () => {
    /*
      MemoryDenyWriteExecute refuses mappings that are both writable and executable and refuses
      mprotect adding PROT_EXEC. V8's optimising compiler needs exactly that, so a plain `node` under
      this directive dies at start. Keeping the directive without the flag means the unit does not
      run at all; keeping the flag without the directive means the hardening line is decoration.
      Neither is allowed to happen quietly.
    */
    const purse = await unit('heron-purse.service');
    const denies = onlyValue(purse, 'Service', 'MemoryDenyWriteExecute') === 'yes';
    const exec = directive(purse, 'Service', 'ExecStart').join(' ');
    expect(denies).toBe(true);
    expect(exec).toContain('--jitless');
  });

  it('passes the policy path and a pin, and never a key path in argv', async () => {
    const purse = await unit('heron-purse.service');
    const exec = directive(purse, 'Service', 'ExecStart').join(' ');
    expect(exec).toContain('--policy ');
    expect(exec).toContain('--policy-sha256 ');
    expect(exec).toContain('--socket /run/heron/purse.sock');
    // No --key-file: the key comes from the credential directory, which the unit declares above.
    expect(exec).not.toContain('--key-file');
  });

  it('is Type=notify, so After=heron-purse.service means the socket exists', async () => {
    const purse = await unit('heron-purse.service');
    expect(onlyValue(purse, 'Service', 'Type')).toBe('notify');
    expect(onlyValue(purse, 'Service', 'NotifyAccess')).toBe('all');
  });
});

describe('heron-beat.service', () => {
  it('is a root-owned oneshot with an explicit timeout and an alert on failure', async () => {
    const beat = await unit('heron-beat.service');
    expect(onlyValue(beat, 'Service', 'Type')).toBe('oneshot');
    expect(onlyValue(beat, 'Service', 'User')).toBe('root');
    expect(onlyValue(beat, 'Service', 'TimeoutStartSec')).toBe('600');
    expect(onlyValue(beat, 'Unit', 'OnFailure')).toBe('heron-alert@%n.service');
  });

  it('starts after the purse, so the first beat after a reboot does not race the socket', async () => {
    const beat = await unit('heron-beat.service');
    expect(directive(beat, 'Unit', 'After').join(' ')).toContain('heron-purse.service');
  });

  it('can write only the runs and state directories', async () => {
    const beat = await unit('heron-beat.service');
    expect(onlyValue(beat, 'Service', 'ReadWritePaths')).toBe('/srv/heron/runs /srv/heron/state');
  });
});

describe('the uid ruling', () => {
  it('is the same in the unit and in the README, so the deploy has one source', async () => {
    const raw = await text('heron-purse.service');
    const readme = await readFile(join(SYSTEMD, '..', 'README.md'), 'utf8');
    for (const fact of ['10001', '10002', 'getent passwd 10002', '--uid 10002']) {
      expect(raw).toContain(fact);
      expect(readme).toContain(fact);
    }
  });
});

describe('heron-beat.timer', () => {
  it('fires every thirty minutes and catches up after a reboot', async () => {
    const timer = await unit('heron-beat.timer');
    expect(onlyValue(timer, 'Timer', 'OnUnitActiveSec')).toBe('30min');
    expect(onlyValue(timer, 'Timer', 'Persistent')).toBe('true');
  });
});

describe('the parser', () => {
  it('joins continued lines, so a wrapped ExecStart is one value', () => {
    const parsed = parseUnit('[Service]\nExecStart=/usr/bin/node \\\n  --jitless \\\n  server.js\n');
    expect(onlyValue(parsed, 'Service', 'ExecStart')).toBe('/usr/bin/node --jitless server.js');
  });

  it('ignores comments and keeps repeated directives as a list', () => {
    const parsed = parseUnit('[Service]\n# a comment\nSystemCallFilter=@system-service\nSystemCallFilter=~@privileged\n');
    expect(directive(parsed, 'Service', 'SystemCallFilter')).toEqual(['@system-service', '~@privileged']);
    expect(onlyValue(parsed, 'Service', 'SystemCallFilter')).toBeNull();
  });
});
