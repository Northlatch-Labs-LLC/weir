// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { publicKeyFromSuiBytes } from '@mysten/sui/verify';
import {
  BECH32_SECRET_PREFIX,
  assertNoSecretInSpawn,
  birthKey,
  checkPile,
  decryptToStdout,
  deriveMultisigAddress,
  encryptInPlace,
  enforceUmask,
  fingerprintKeystore,
  keychainPassphrase,
  keystoreDrift,
  parseArgs,
} from '../bin/birth-key.js';
import { localKeypairSignerFromSecret } from '../src/local.js';
import { multiSigSigner } from '../src/multisig.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '..', 'bin', 'birth-key.ts');
const TSX = resolve(HERE, '..', '..', '..', 'node_modules', '.bin', 'tsx');

const TEST_PASSPHRASE = 'a-throwaway-passphrase-for-this-test-run-only';

let root: string;
let absentSuiRoot: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'birth-key-')));
  absentSuiRoot = join(root, 'no-sui-home-here');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makePile(name: string, mode = 0o700): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await chmod(path, mode);
  return path;
}

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function cli(args: readonly string[]): Promise<CliResult> {
  return await new Promise((settle) => {
    const child = spawn(TSX, [TOOL, ...args, '--keystore-root', absentSuiRoot], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      settle({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function modeOf(path: string): Promise<string> {
  return ((await stat(path)).mode & 0o777).toString(8).padStart(4, '0');
}

describe('the runner is where this test thinks it is', () => {
  it('finds tsx and the tool', async () => {
    await expect(stat(TSX)).resolves.toBeDefined();
    await expect(stat(TOOL)).resolves.toBeDefined();
  });
});

describe('preconditions', () => {
  it('sets the umask to 077 and reads it back', () => {
    const previous = process.umask();
    try {
      const result = enforceUmask();
      expect(result.refused).toBe(false);
      if (!result.refused) expect(result.value).toBe(0o077);
    } finally {
      process.umask(previous);
    }
  });

  it('refuses a pile that does not exist, and does not create it', async () => {
    const missing = join(root, 'not-made');
    const result = await checkPile(missing, { suiRoot: absentSuiRoot });
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('pile-exists');
    await expect(stat(missing)).rejects.toThrow();
  });

  it('refuses a pile that is not mode 0700', async () => {
    const loose = await makePile('loose-pile', 0o755);
    const result = await checkPile(loose, { suiRoot: absentSuiRoot });
    expect(result.refused).toBe(true);
    if (result.refused) {
      expect(result.rule).toBe('pile-mode');
      expect(result.detail).toContain('0755');
    }
  });

  it('refuses a pile at or under the Sui home', async () => {
    const suiHome = join(root, 'fake-sui');
    const inside = join(suiHome, 'pile');
    await mkdir(inside, { recursive: true });
    await chmod(inside, 0o700);
    const result = await checkPile(inside, { suiRoot: suiHome });
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('not-under-sui');
  });

  it('refuses any path with a .sui segment whatever the Sui home is set to', async () => {
    const inside = join(root, '.sui', 'pile');
    await mkdir(inside, { recursive: true });
    await chmod(inside, 0o700);
    const result = await checkPile(inside, { suiRoot: absentSuiRoot });
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('not-under-sui');
  });

  it('refuses a pile inside a git working tree', async () => {
    const checkout = join(root, 'checkout');
    const inside = join(checkout, 'pile');
    await mkdir(join(checkout, '.git'), { recursive: true });
    await mkdir(inside, { recursive: true });
    await chmod(inside, 0o700);
    const result = await checkPile(inside, { suiRoot: absentSuiRoot });
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('not-in-a-checkout');
  });

  it('accepts a pile that breaks none of the rules', async () => {
    const good = await makePile('good-pile');
    const result = await checkPile(good, { suiRoot: absentSuiRoot });
    expect(result.refused).toBe(false);
    if (!result.refused) expect(result.value.mode).toBe(0o700);
  });

  it('refuses a name that is not a plain filename component, before touching the pile', async () => {
    const pile = await makePile('named-pile');
    for (const bad of ['../escape', 'has.dot', 'Upper', 'has/slash', '']) {
      const result = await birthKey({ name: bad, pile, suiRoot: absentSuiRoot });
      expect(result.refused).toBe(true);
      if (result.refused) expect(result.rule).toBe('name');
    }
    expect(await readdir(pile)).toEqual([]);
  });
});

describe('birth', () => {
  let pile: string;
  let born: CliResult;

  beforeAll(async () => {
    pile = await makePile('birth-pile');
    born = await cli(['heron-hot', '--pile', pile]);
  });

  it('exits 0 and reports the Sui home as absent', () => {
    expect(born.code).toBe(0);
    expect(born.stderr).toContain('does not exist; continuing');
  });

  it('writes three files at the modes the specification names', async () => {
    expect(await modeOf(join(pile, 'heron-hot.key'))).toBe('0600');
    expect(await modeOf(join(pile, 'heron-hot.pub'))).toBe('0644');
    expect(await modeOf(join(pile, 'heron-hot.address'))).toBe('0644');
  });

  it('prints an address that is the key’s own address', async () => {
    const secret = (await readFile(join(pile, 'heron-hot.key'), 'utf8')).trim();
    const signer = localKeypairSignerFromSecret(secret);
    expect(signer.ok).toBe(true);
    if (!signer.ok) return;

    const written = (await readFile(join(pile, 'heron-hot.address'), 'utf8')).trim();
    expect(written).toBe(signer.value.address);
    expect(born.stdout).toContain(signer.value.address);
  });

  it('writes a public key the rest of this package can actually read', async () => {
    const pub = (await readFile(join(pile, 'heron-hot.pub'), 'utf8')).trim();
    const address = (await readFile(join(pile, 'heron-hot.address'), 'utf8')).trim();
    expect(publicKeyFromSuiBytes(pub).toSuiAddress()).toBe(address);
  });

  it('refuses to overwrite a key that already exists', async () => {
    const again = await cli(['heron-hot', '--pile', pile]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('never-overwrite');
  });

  it('refuses a pile under the Sui home from the command line too', async () => {
    const suiHome = join(root, 'cli-sui');
    const inside = join(suiHome, 'pile');
    await mkdir(inside, { recursive: true });
    await chmod(inside, 0o700);
    const result = await new Promise<CliResult>((settle) => {
      const child = spawn(
        TSX,
        [TOOL, 'somekey', '--pile', inside, '--keystore-root', suiHome],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
      child.on('close', (code) => settle({ code: code ?? 1, stdout, stderr }));
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not-under-sui');
  });
});

describe('nothing the tool prints is a secret', () => {
  it('keeps the bech32 prefix out of every line of every ordinary mode', async () => {
    const pile = await makePile('quiet-pile');
    const runs = [
      await cli(['quiet-one', '--pile', pile]),
      await cli(['quiet-one', '--pile', pile]),
      await cli(['keystore-guard']),
      await cli(['--nonsense']),
    ];
    const pub = (await readFile(join(pile, 'quiet-one.pub'), 'utf8')).trim();
    const secret = (await readFile(join(pile, 'quiet-one.key'), 'utf8')).trim();

    for (const run of runs) {
      expect(run.stdout).not.toContain(BECH32_SECRET_PREFIX);
      expect(run.stderr).not.toContain(BECH32_SECRET_PREFIX);
      expect(run.stdout).not.toContain(secret);
      expect(run.stderr).not.toContain(secret);
    }
    expect(runs[0]?.stdout).not.toContain(pub);
  }, 120_000);

  it('refuses to spawn a child carrying a secret in its argv or its environment', () => {
    const fake = `${BECH32_SECRET_PREFIX}qqqqqqqq`;
    expect(assertNoSecretInSpawn(['openssl', 'enc', fake], {})?.rule).toBe('no-secret-in-argv');
    expect(assertNoSecretInSpawn(['openssl'], { KEY: fake })?.rule).toBe('no-secret-in-env');
    expect(assertNoSecretInSpawn(['openssl', 'enc', '-in', '/tmp/x'], { PATH: '/usr/bin' })).toBe(
      null,
    );
  });
});

describe('encryption', () => {
  let pile: string;
  let keyPath: string;
  let secret: string;

  beforeAll(async () => {
    pile = await makePile('crypt-pile');
    const born = await cli(['sealed', '--pile', pile]);
    expect(born.code).toBe(0);
    keyPath = join(pile, 'sealed.key');
    secret = await readFile(keyPath, 'utf8');
  });

  it('encrypts, verifies the round trip, and shreds the plaintext', async () => {
    const result = await encryptInPlace({
      keyPath,
      passphrase: Buffer.from(TEST_PASSPHRASE, 'utf8'),
    });
    expect(result.refused).toBe(false);
    if (result.refused) return;

    expect(result.value).toBe(`${keyPath}.enc`);
    await expect(stat(keyPath)).rejects.toThrow();
    expect(await modeOf(result.value)).toBe('0600');

    const ciphertext = await readFile(result.value);
    expect(ciphertext.length).toBeGreaterThan(16);
    expect(ciphertext.toString('utf8')).not.toContain(BECH32_SECRET_PREFIX);
  });

  it('refuses to encrypt over an existing ciphertext', async () => {
    const result = await encryptInPlace({
      keyPath: `${keyPath}`,
      passphrase: Buffer.from(TEST_PASSPHRASE, 'utf8'),
    });
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('never-overwrite');
  });

  it('refuses to write a secret to a terminal', async () => {
    const result = await decryptToStdout({
      encPath: `${keyPath}.enc`,
      passphrase: Buffer.from(TEST_PASSPHRASE, 'utf8'),
      stdoutIsTty: true,
    });
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('not-to-a-terminal');
  });

  it('emits exactly the original secret on a piped stdout and writes no file', async () => {
    const script = join(root, 'emit-decrypt.mts');
    await writeFile(
      script,
      [
        `import { decryptToStdout } from ${JSON.stringify(TOOL)};`,
        `const result = await decryptToStdout({`,
        `  encPath: ${JSON.stringify(`${keyPath}.enc`)},`,
        `  passphrase: Buffer.from(${JSON.stringify(TEST_PASSPHRASE)}, 'utf8'),`,
        `  stdoutIsTty: false,`,
        `});`,
        `if (result.refused) { process.stderr.write(result.detail); process.exitCode = 1; }`,
      ].join('\n'),
      'utf8',
    );

    const emitted = await new Promise<CliResult>((settle) => {
      const child = spawn(TSX, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
      child.on('close', (code) => settle({ code: code ?? 1, stdout, stderr }));
    });

    expect(emitted.code).toBe(0);
    expect(emitted.stdout).toBe(secret);
    await expect(stat(keyPath)).rejects.toThrow();
  });
});

describe('the multisig derivation', () => {
  let pubs: string[];
  let secrets: string[];

  beforeAll(async () => {
    const pile = await makePile('multisig-pile');
    pubs = [];
    secrets = [];
    for (const name of ['hot', 'brake']) {
      const born = await cli([name, '--pile', pile]);
      expect(born.code).toBe(0);
      pubs.push((await readFile(join(pile, `${name}.pub`), 'utf8')).trim());
      secrets.push((await readFile(join(pile, `${name}.key`), 'utf8')).trim());
    }
  });

  it('derives a different address at threshold 1 and at threshold 2 over the same two keys', () => {
    const one = deriveMultisigAddress(1, pubs);
    const two = deriveMultisigAddress(2, pubs);
    expect(one.refused).toBe(false);
    expect(two.refused).toBe(false);
    if (one.refused || two.refused) return;
    expect(one.value).not.toBe(two.value);
  });

  it('agrees with the address src/multisig.ts signs for', () => {
    const derived = deriveMultisigAddress(1, pubs);
    expect(derived.refused).toBe(false);
    if (derived.refused) return;

    const hot = localKeypairSignerFromSecret(secrets[0] ?? '');
    expect(hot.ok).toBe(true);
    if (!hot.ok) return;

    const signer = multiSigSigner({
      threshold: 1,
      members: [
        { publicKey: pubs[0] ?? '', weight: 1 },
        { publicKey: pubs[1] ?? '', weight: 1 },
      ],
      available: [hot.value],
    });
    expect(signer.ok).toBe(true);
    if (!signer.ok) return;
    expect(signer.value.address).toBe(derived.value);
  });

  it('prints the same address from the command line', async () => {
    const derived = deriveMultisigAddress(1, pubs);
    if (derived.refused) throw new Error('derivation refused');
    const result = await cli([
      'derive-multisig',
      '--threshold',
      '1',
      '--pub',
      pubs[0] ?? '',
      '--pub',
      pubs[1] ?? '',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(derived.value);
    expect(result.stdout).toContain('1 of 2');
  });

  it('refuses the same member twice', () => {
    const result = deriveMultisigAddress(2, [pubs[0] ?? '', pubs[0] ?? '']);
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('duplicate-member');
  });

  it('refuses a threshold no set of weight-1 members could reach', () => {
    const result = deriveMultisigAddress(3, pubs);
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('threshold');
  });

  it('refuses a member that is not a Sui public key', () => {
    const raw = Ed25519Keypair.generate().getPublicKey().toBase64();
    const result = deriveMultisigAddress(1, [raw, pubs[1] ?? '']);
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('member-key');
  });
});

describe('the keystore guard', () => {
  it('says so and continues when the Sui home does not exist', async () => {
    const result = await fingerprintKeystore(absentSuiRoot);
    expect(result.refused).toBe(false);
    if (result.refused) return;
    expect(result.value.rootPresent).toBe(false);
    expect(result.value.keystoreSha256).toBe(null);
  });

  it('fingerprints a keystore by hash and by the file count beside it', async () => {
    const fake = join(root, 'guarded-sui');
    const config = join(fake, 'sui_config');
    await mkdir(config, { recursive: true });
    await writeFile(join(config, 'sui.keystore'), '["not-a-key"]\n', 'utf8');
    await writeFile(join(config, 'client.yaml'), 'ignored\n', 'utf8');

    const first = await fingerprintKeystore(fake);
    expect(first.refused).toBe(false);
    if (first.refused) return;
    expect(first.value.rootPresent).toBe(true);
    expect(first.value.keystorePresent).toBe(true);
    expect(first.value.keystoreSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.value.configEntries).toEqual(['client.yaml', 'sui.keystore']);

    const unchanged = await fingerprintKeystore(fake);
    if (unchanged.refused) return;
    expect(keystoreDrift(first.value, unchanged.value)).toEqual([]);

    await writeFile(join(config, 'sui.keystore'), '["not-a-key","another"]\n', 'utf8');
    const changed = await fingerprintKeystore(fake);
    if (changed.refused) return;
    const drift = keystoreDrift(first.value, changed.value);
    expect(drift.length).toBeGreaterThan(0);
    expect(drift.join('; ')).toContain('sha256');
  });

  it('notices a file appearing beside the keystore', async () => {
    const fake = join(root, 'counted-sui');
    const config = join(fake, 'sui_config');
    await mkdir(config, { recursive: true });
    await writeFile(join(config, 'sui.keystore'), '[]\n', 'utf8');

    const before = await fingerprintKeystore(fake);
    if (before.refused) return;
    await writeFile(join(config, 'sui.aliases'), '[]\n', 'utf8');
    const after = await fingerprintKeystore(fake);
    if (after.refused) return;
    expect(keystoreDrift(before.value, after.value).join('; ')).toContain('sui_config changed');
  });
});

describe('the command line surface', () => {
  it('refuses an unknown flag rather than ignoring it', () => {
    const result = parseArgs(['name', '--pile', '/tmp', '--unknown']);
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.rule).toBe('usage');
  });

  it('requires a keychain item to encrypt or decrypt', () => {
    for (const flag of ['--encrypt', '--decrypt-to-stdout']) {
      const result = parseArgs(['name', '--pile', '/tmp', flag]);
      expect(result.refused).toBe(true);
      if (result.refused) expect(result.detail).toContain('--keychain-item');
    }
  });

  it('refuses to encrypt and decrypt in one run', () => {
    const result = parseArgs([
      'name',
      '--pile',
      '/tmp',
      '--encrypt',
      '--decrypt-to-stdout',
      '--keychain-item',
      'x',
    ]);
    expect(result.refused).toBe(true);
    if (result.refused) expect(result.detail).toContain('opposites');
  });

  it('reads the two subcommands', () => {
    const guard = parseArgs(['keystore-guard']);
    expect(guard.refused).toBe(false);
    if (!guard.refused) expect(guard.value.mode).toBe('keystore-guard');

    const derive = parseArgs(['derive-multisig', '--threshold', '1', '--pub', 'a', '--pub', 'b']);
    expect(derive.refused).toBe(false);
    if (!derive.refused) {
      expect(derive.value.mode).toBe('derive-multisig');
      expect(derive.value.threshold).toBe(1);
      expect(derive.value.pubs).toEqual(['a', 'b']);
    }
  });
});

describe('the pinned programs', () => {
  let shimDir: string;
  let marker: string;
  let originalPath: string | undefined;

  beforeAll(async () => {
    shimDir = join(root, 'shadowed-bin');
    await mkdir(shimDir, { recursive: true });
    marker = join(root, 'shim-was-called');
    for (const program of ['openssl', 'security']) {
      const shim = join(shimDir, program);
      await writeFile(
        shim,
        `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\nexit 0\n`,
        { mode: 0o755 },
      );
      await chmod(shim, 0o755);
    }
    originalPath = process.env['PATH'];
    process.env['PATH'] = `${shimDir}:${originalPath ?? ''}`;
  });

  afterAll(() => {
    if (originalPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = originalPath;
  });

  it('does not call a shadowing openssl, and still encrypts with the real one', async () => {
    const pile = await makePile('pinned-pile');
    const born = await cli(['pinned', '--pile', pile]);
    expect(born.code).toBe(0);
    const keyPath = join(pile, 'pinned.key');
    const plaintext = await readFile(keyPath, 'utf8');

    const result = await encryptInPlace({
      keyPath,
      passphrase: Buffer.from(TEST_PASSPHRASE, 'utf8'),
    });

    expect(result.refused).toBe(false);
    if (result.refused) return;

    await expect(stat(marker)).rejects.toThrow();
    await expect(stat(keyPath)).rejects.toThrow();
    const ciphertext = await readFile(result.value);
    expect(ciphertext.length).toBeGreaterThan(16);
    expect(ciphertext.toString('utf8')).not.toContain(BECH32_SECRET_PREFIX);

    const back = await decryptToStdout({
      encPath: result.value,
      passphrase: Buffer.from(TEST_PASSPHRASE, 'utf8'),
      stdoutIsTty: true,
    });
    expect(back.refused).toBe(true);
    expect(plaintext.startsWith(BECH32_SECRET_PREFIX)).toBe(true);
  });

  it('does not call a shadowing security when reading the keychain', async () => {
    const item = `heron-birth-key-absent-${String(process.pid)}-${String(Date.now())}`;
    const result = await keychainPassphrase(item)();

    expect(result.refused).toBe(true);
    if (result.refused) {
      expect(result.rule).toBe('keychain');
      expect(result.detail).toContain('could not be read');
    }
    await expect(stat(marker)).rejects.toThrow();
  });
});
