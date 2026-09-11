// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { chmod, open, readdir, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { publicKeyFromSuiBytes } from '@mysten/sui/verify';
import type { PublicKey } from '@mysten/sui/cryptography';

export interface Refusal {
  readonly refused: true;
  readonly rule: string;
  readonly detail: string;
}

export type Result<T> = { readonly refused: false; readonly value: T } | Refusal;

export function refuse(rule: string, detail: string): Refusal {
  return { refused: true, rule, detail };
}

export function allow<T>(value: T): Result<T> {
  return { refused: false, value };
}

export const BECH32_SECRET_PREFIX = 'suipriv' + 'key1';

const MODE_SECRET = 0o600;
const MODE_PUBLIC = 0o644;
const MODE_PILE = 0o700;

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function enforceUmask(): Result<number> {
  process.umask(0o077);
  const readBack = process.umask(0o077);
  if (readBack !== 0o077) {
    return refuse(
      'umask',
      `the process umask is ${readBack.toString(8).padStart(4, '0')} after being set to 0077. ` +
        `Every file below would be created at a mode this tool did not choose.`,
    );
  }
  return allow(readBack);
}

const OPENSSL = '/usr/bin/openssl';
const SECURITY = '/usr/bin/security';
const PBKDF2_ITERATIONS = '600000';

const KDF_ARGS = ['-pbkdf2', '-iter', PBKDF2_ITERATIONS] as const;

async function pinned(program: string): Promise<Result<string>> {
  if (await exists(program)) return allow(program);
  return refuse(
    'program-missing',
    `${program} is not on this machine. This tool spawns it by absolute path and will not fall ` +
      `back to looking the name up on PATH: a shadowed program here is handed the passphrase on ` +
      `file descriptor 3 and the plaintext key's path.`,
  );
}

async function run(
  program: string,
  args: readonly string[],
  options: { readonly fd3?: Buffer; readonly stdout?: 'capture' | 'inherit' } = {},
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env['HOME'] ?? homedir(),
    LANG: 'C',
  };

  const dirty = assertNoSecretInSpawn([program, ...args], env);
  if (dirty !== null) {
    throw new Error(`birth-key refused to spawn a child: ${dirty.detail}`);
  }

  const wantStdout = options.stdout ?? 'capture';
  const child = spawn(program, [...args], {
    env,
    stdio: [
      'ignore',
      wantStdout === 'inherit' ? 'inherit' : 'pipe',
      'pipe',
      options.fd3 === undefined ? 'ignore' : 'pipe',
    ],
  });

  if (options.fd3 !== undefined) {
    const passFd = child.stdio[3];
    if (passFd === null || passFd === undefined || !('write' in passFd)) {
      child.kill();
      throw new Error('birth-key could not open file descriptor 3 on the child.');
    }
    passFd.end(Buffer.concat([options.fd3, Buffer.from('\n')]));
  }

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  return await new Promise((settle) => {
    child.on('error', (error) => {
      settle({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      settle({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function assertNoSecretInSpawn(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Refusal | null {
  for (const arg of args) {
    if (arg.includes(BECH32_SECRET_PREFIX)) {
      return refuse(
        'no-secret-in-argv',
        'an argument carried a bech32 Sui secret. Arguments are world-readable through `ps`. ' +
          'The value is deliberately not shown.',
      );
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.includes(BECH32_SECRET_PREFIX)) {
      return refuse(
        'no-secret-in-env',
        `the environment variable ${key} carried a bech32 Sui secret. Its value is deliberately ` +
          `not shown.`,
      );
    }
  }
  return null;
}

export interface PileOptions {
  readonly suiRoot?: string;
}

export interface CheckedPile {
  readonly path: string;
  readonly mode: number;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function checkPile(
  pile: string,
  options: PileOptions = {},
): Promise<Result<CheckedPile>> {
  const asked = isAbsolute(pile) ? pile : resolve(process.cwd(), pile);

  let real: string;
  try {
    real = await realpath(asked);
  } catch {
    return refuse(
      'pile-exists',
      `${asked} does not exist. This tool never creates the pile: a pile made in passing is a ` +
        `pile nobody wrote a recovery row for.`,
    );
  }

  const info = await stat(real);
  if (!info.isDirectory()) {
    return refuse('pile-is-a-directory', `${real} is not a directory.`);
  }

  const mode = info.mode & 0o777;
  if (mode !== MODE_PILE) {
    return refuse(
      'pile-mode',
      `${real} is mode ${mode.toString(8).padStart(4, '0')}, not 0700. Fix it with ` +
        `\`chmod 700\` and run again; this tool does not change the modes of directories it did ` +
        `not make.`,
    );
  }

  const suiRoot = options.suiRoot ?? join(homedir(), '.sui');
  const suiWritten = isAbsolute(suiRoot) ? suiRoot : resolve(process.cwd(), suiRoot);
  const suiForms = new Set([suiWritten]);
  try {
    suiForms.add(await realpath(suiWritten));
  } catch {
    // The Sui home does not exist. Nothing to resolve; the written form stands alone.
  }
  for (const form of suiForms) {
    if (real === form || real.startsWith(form + sep)) {
      return refuse(
        'not-under-sui',
        `${real} is at or under ${form}. No key of this build is written into the Sui home, ` +
          `which is overwritten by tools this estate does not control.`,
      );
    }
  }
  if (real.split(sep).includes('.sui')) {
    return refuse(
      'not-under-sui',
      `${real} has a path segment named .sui. Refused whatever the Sui home is set to.`,
    );
  }

  for (let dir = real; ; dir = dirname(dir)) {
    if (await exists(join(dir, '.git'))) {
      return refuse(
        'not-in-a-checkout',
        `${real} is inside the git working tree at ${dir}. A key there is one \`git add -A\` ` +
          `from a commit.`,
      );
    }
    if (dirname(dir) === dir) break;
  }

  return allow({ path: real, mode });
}

export interface KeystoreFingerprint {
  readonly root: string;
  readonly rootPresent: boolean;
  readonly configEntries: readonly string[];
  readonly keystorePresent: boolean;
  readonly keystoreSize: number | null;
  readonly keystoreMode: string | null;
  readonly keystoreSha256: string | null;
}

async function hasher(): Promise<Result<{ program: string; args: readonly string[] }>> {
  const candidates: readonly { program: string; args: readonly string[] }[] = [
    { program: '/usr/bin/shasum', args: ['-a', '256'] },
    { program: 'shasum', args: ['-a', '256'] },
    { program: 'sha256sum', args: [] },
  ];
  for (const candidate of candidates) {
    const probe = await run(candidate.program, [...candidate.args, '/dev/null']);
    if (probe.code === 0) return allow(candidate);
  }
  return refuse(
    'hasher',
    'neither shasum nor sha256sum could be run, so the Sui keystore cannot be fingerprinted ' +
      'without reading it. This tool will not read it instead.',
  );
}

export async function fingerprintKeystore(root?: string): Promise<Result<KeystoreFingerprint>> {
  const suiRoot = root ?? join(homedir(), '.sui');

  if (!(await exists(suiRoot))) {
    return allow({
      root: suiRoot,
      rootPresent: false,
      configEntries: [],
      keystorePresent: false,
      keystoreSize: null,
      keystoreMode: null,
      keystoreSha256: null,
    });
  }

  const configDir = join(suiRoot, 'sui_config');
  let configEntries: string[] = [];
  if (await exists(configDir)) {
    configEntries = (await readdir(configDir)).sort();
  }

  const keystore = join(configDir, 'sui.keystore');
  if (!(await exists(keystore))) {
    return allow({
      root: suiRoot,
      rootPresent: true,
      configEntries,
      keystorePresent: false,
      keystoreSize: null,
      keystoreMode: null,
      keystoreSha256: null,
    });
  }

  const info = await stat(keystore);
  const tool = await hasher();
  if (tool.refused) return tool;

  const result = await run(tool.value.program, [...tool.value.args, keystore]);
  if (result.code !== 0) {
    return refuse(
      'hasher',
      `${tool.value.program} failed on the Sui keystore: ${result.stderr.trim()}`,
    );
  }
  const digest = /^([0-9a-f]{64})\b/.exec(result.stdout.trim());
  if (digest === null) {
    return refuse('hasher', `${tool.value.program} did not print a sha256 for the Sui keystore.`);
  }

  return allow({
    root: suiRoot,
    rootPresent: true,
    configEntries,
    keystorePresent: true,
    keystoreSize: info.size,
    keystoreMode: (info.mode & 0o777).toString(8).padStart(4, '0'),
    keystoreSha256: digest[1] ?? null,
  });
}

export function keystoreDrift(
  before: KeystoreFingerprint,
  after: KeystoreFingerprint,
): readonly string[] {
  const changed: string[] = [];
  if (before.rootPresent !== after.rootPresent) changed.push('the Sui home appeared or vanished');
  if (before.configEntries.join(' ') !== after.configEntries.join(' ')) {
    changed.push(
      `the files in sui_config changed (${before.configEntries.length} before, ` +
        `${after.configEntries.length} after)`,
    );
  }
  if (before.keystorePresent !== after.keystorePresent) {
    changed.push('the keystore file appeared or vanished');
  }
  if (before.keystoreSize !== after.keystoreSize) changed.push('the keystore size changed');
  if (before.keystoreMode !== after.keystoreMode) changed.push('the keystore mode changed');
  if (before.keystoreSha256 !== after.keystoreSha256) changed.push('the keystore sha256 changed');
  return changed;
}

function describeFingerprint(f: KeystoreFingerprint): string {
  if (!f.rootPresent) return `keystore-guard  ${f.root} does not exist; continuing.`;
  if (!f.keystorePresent) {
    return (
      `keystore-guard  ${f.root} exists, no sui.keystore, ` +
      `${f.configEntries.length} file(s) in sui_config.`
    );
  }
  return (
    `keystore-guard  sha256 ${f.keystoreSha256 ?? '?'} · ${String(f.keystoreSize)} bytes · ` +
    `mode ${f.keystoreMode ?? '?'} · ${f.configEntries.length} file(s) in sui_config`
  );
}

export interface BirthOptions {
  readonly name: string;
  readonly pile: string;
  readonly suiRoot?: string;
}

export interface BirthResult {
  readonly address: string;
  readonly keyPath: string;
  readonly pubPath: string;
  readonly addressPath: string;
}

export function keychainPassphrase(item: string): () => Promise<Result<Buffer>> {
  return async () => {
    const program = await pinned(SECURITY);
    if (program.refused) return program;
    const result = await run(program.value, ['find-generic-password', '-w', '-s', item]);
    if (result.code !== 0) {
      return refuse(
        'keychain',
        `the keychain item ${JSON.stringify(item)} could not be read; \`security\` exited ` +
          `${result.code}. Create it with ` +
          `\`security add-generic-password -s <item> -a <account> -w\` and run again.`,
      );
    }
    const value = Buffer.from(result.stdout.replace(/\r?\n$/, ''), 'utf8');
    if (value.length === 0) {
      return refuse('keychain', `the keychain item ${JSON.stringify(item)} is empty.`);
    }
    return allow(value);
  };
}

export async function birthKey(options: BirthOptions): Promise<Result<BirthResult>> {
  if (!NAME.test(options.name)) {
    return refuse(
      'name',
      `${JSON.stringify(options.name)} is not a key name. Lowercase letters, digits and hyphens, ` +
        `starting with a letter or digit, at most 63 characters, no dots and no slashes.`,
    );
  }

  const pile = await checkPile(
    options.pile,
    options.suiRoot === undefined ? {} : { suiRoot: options.suiRoot },
  );
  if (pile.refused) return pile;

  const keyPath = join(pile.value.path, `${options.name}.key`);
  const encPath = `${keyPath}.enc`;
  const pubPath = join(pile.value.path, `${options.name}.pub`);
  const addressPath = join(pile.value.path, `${options.name}.address`);

  for (const target of [keyPath, encPath, pubPath, addressPath]) {
    if (await exists(target)) {
      return refuse(
        'never-overwrite',
        `${target} already exists. This tool never overwrites and never archives on your behalf: ` +
          `a key born over another key is a key whose recovery row now points at nothing.`,
      );
    }
  }

  const keypair = Ed25519Keypair.generate();
  const secret = keypair.getSecretKey();
  const address = keypair.toSuiAddress();
  const publicKey = keypair.getPublicKey().toSuiPublicKey();

  await writeExclusive(keyPath, `${secret}\n`, MODE_SECRET);
  await writeExclusive(pubPath, `${publicKey}\n`, MODE_PUBLIC);
  await writeExclusive(addressPath, `${address}\n`, MODE_PUBLIC);

  return allow({ address, keyPath, pubPath, addressPath });
}

async function writeExclusive(target: string, contents: string, mode: number): Promise<void> {
  const handle = await open(target, 'wx', mode);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(target, mode);
}

export async function encryptInPlace(args: {
  readonly keyPath: string;
  readonly passphrase: Buffer;
}): Promise<Result<string>> {
  const encPath = `${args.keyPath}.enc`;
  if (await exists(encPath)) {
    return refuse('never-overwrite', `${encPath} already exists.`);
  }
  if (!(await exists(args.keyPath))) {
    return refuse('no-plaintext', `${args.keyPath} does not exist, so there is nothing to encrypt.`);
  }

  const openssl = await pinned(OPENSSL);
  if (openssl.refused) return openssl;

  const encrypted = await run(
    openssl.value,
    [
      'enc',
      '-aes-256-cbc',
      ...KDF_ARGS,
      '-salt',
      '-in',
      args.keyPath,
      '-out',
      encPath,
      '-pass',
      'fd:3',
    ],
    { fd3: args.passphrase },
  );
  if (encrypted.code !== 0) {
    return refuse('openssl', `openssl exited ${encrypted.code}: ${encrypted.stderr.trim()}`);
  }
  await chmod(encPath, MODE_SECRET);

  const roundTrip = await run(
    openssl.value,
    ['enc', '-d', '-aes-256-cbc', ...KDF_ARGS, '-in', encPath, '-pass', 'fd:3'],
    { fd3: args.passphrase },
  );
  if (roundTrip.code !== 0) {
    return refuse(
      'round-trip',
      `the ciphertext at ${encPath} could not be decrypted with the same passphrase (openssl ` +
        `exited ${roundTrip.code}). The plaintext has NOT been shredded.`,
    );
  }
  const plaintext = await readFile(args.keyPath, 'utf8');
  if (roundTrip.stdout !== plaintext) {
    return refuse(
      'round-trip',
      `the ciphertext at ${encPath} decrypts to something other than the key file. The plaintext ` +
        `has NOT been shredded. Neither value is shown.`,
    );
  }

  await shredFile(args.keyPath);
  return allow(encPath);
}

async function shredFile(target: string): Promise<void> {
  const info = await stat(target);
  if (info.size > 0) {
    const handle = await open(target, 'r+');
    try {
      for (const filler of [randomBytes(info.size), Buffer.alloc(info.size, 0)]) {
        await handle.write(filler, 0, info.size, 0);
        await handle.sync();
      }
    } finally {
      await handle.close();
    }
  }
  await unlink(target);
}

export async function decryptToStdout(args: {
  readonly encPath: string;
  readonly passphrase: Buffer;
  readonly stdoutIsTty: boolean;
}): Promise<Result<null>> {
  if (args.stdoutIsTty) {
    return refuse(
      'not-to-a-terminal',
      'stdout is a terminal. This mode exists to pipe a secret into a sealing command; it will ' +
        'not print one where a person can read it. Pipe it, or do not run it.',
    );
  }
  if (!(await exists(args.encPath))) {
    return refuse('no-ciphertext', `${args.encPath} does not exist.`);
  }
  const openssl = await pinned(OPENSSL);
  if (openssl.refused) return openssl;

  const result = await run(
    openssl.value,
    ['enc', '-d', '-aes-256-cbc', ...KDF_ARGS, '-in', args.encPath, '-pass', 'fd:3'],
    { fd3: args.passphrase, stdout: 'inherit' },
  );
  if (result.code !== 0) {
    return refuse('openssl', `openssl exited ${result.code}: ${result.stderr.trim()}`);
  }
  return allow(null);
}

export function deriveMultisigAddress(threshold: number, pubs: readonly string[]): Result<string> {
  if (!Number.isInteger(threshold) || threshold <= 0) {
    return refuse('threshold', `${String(threshold)} is not a positive integer threshold.`);
  }
  if (pubs.length < 2) {
    return refuse('members', `a multisig needs at least two members; ${pubs.length} were given.`);
  }

  const publicKeys: { publicKey: PublicKey; weight: number }[] = [];
  for (const pub of pubs) {
    try {
      publicKeys.push({ publicKey: publicKeyFromSuiBytes(pub.trim()), weight: 1 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return refuse(
        'member-key',
        `${JSON.stringify(pub.trim())} is not a Sui public key: ${detail}`,
      );
    }
  }

  const addresses = publicKeys.map((entry) => entry.publicKey.toSuiAddress());
  if (new Set(addresses).size !== addresses.length) {
    return refuse(
      'duplicate-member',
      'the same public key was given twice. A multisig with a repeated member has a lower real ' +
        'threshold than it declares, and the address cannot be changed after birth.',
    );
  }
  if (threshold > publicKeys.length) {
    return refuse(
      'threshold',
      `a threshold of ${threshold} over ${publicKeys.length} members of weight 1 can never be ` +
        `reached. This address could not be signed for by anyone.`,
    );
  }

  try {
    return allow(MultiSigPublicKey.fromPublicKeys({ threshold, publicKeys }).toSuiAddress());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('multisig', `the multisig public key could not be built: ${detail}`);
  }
}

export interface Parsed {
  readonly mode: 'birth' | 'decrypt' | 'derive-multisig' | 'keystore-guard';
  readonly name: string | null;
  readonly pile: string | null;
  readonly encrypt: boolean;
  readonly keychainItem: string | null;
  readonly threshold: number | null;
  readonly pubs: readonly string[];
  readonly suiRoot: string | null;
}

export function parseArgs(argv: readonly string[]): Result<Parsed> {
  let mode: Parsed['mode'] = 'birth';
  let name: string | null = null;
  let pile: string | null = null;
  let encrypt = false;
  let decrypt = false;
  let keychainItem: string | null = null;
  let threshold: number | null = null;
  let suiRoot: string | null = null;
  const pubs: string[] = [];

  const rest = [...argv];
  const first = rest[0];
  if (first === 'derive-multisig' || first === 'keystore-guard') {
    mode = first;
    rest.shift();
  }

  const need = (flag: string, index: number): Result<string> => {
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return refuse('usage', `${flag} needs a value.`);
    }
    return allow(value);
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token === '--encrypt') {
      encrypt = true;
      continue;
    }
    if (token === '--decrypt-to-stdout') {
      decrypt = true;
      continue;
    }
    if (token === '--pile' || token === '--keychain-item' || token === '--keystore-root' || token === '--pub') {
      const value = need(token, i);
      if (value.refused) return value;
      if (token === '--pile') pile = value.value;
      if (token === '--keychain-item') keychainItem = value.value;
      if (token === '--keystore-root') suiRoot = value.value;
      if (token === '--pub') pubs.push(value.value);
      i += 1;
      continue;
    }
    if (token === '--threshold') {
      const value = need(token, i);
      if (value.refused) return value;
      const parsedNumber = Number(value.value);
      if (!Number.isInteger(parsedNumber)) {
        return refuse('usage', `--threshold ${JSON.stringify(value.value)} is not an integer.`);
      }
      threshold = parsedNumber;
      i += 1;
      continue;
    }
    if (token.startsWith('-')) {
      return refuse('usage', `${JSON.stringify(token)} is not a flag this tool has.`);
    }
    if (name !== null) {
      return refuse(
        'usage',
        `two names were given: ${JSON.stringify(name)} and ${JSON.stringify(token)}.`,
      );
    }
    name = token;
  }

  if (decrypt) {
    if (encrypt) return refuse('usage', '--encrypt and --decrypt-to-stdout are opposites.');
    mode = 'decrypt';
  }

  if (mode === 'birth' || mode === 'decrypt') {
    if (name === null) return refuse('usage', 'a key name is required.');
    if (pile === null) return refuse('usage', '--pile <dir> is required.');
    if ((encrypt || mode === 'decrypt') && keychainItem === null) {
      return refuse('usage', '--keychain-item <item> is required to encrypt or decrypt.');
    }
  }
  if (mode === 'derive-multisig' && threshold === null) {
    return refuse('usage', 'derive-multisig needs --threshold <n>.');
  }

  return allow({ mode, name, pile, encrypt, keychainItem, threshold, pubs, suiRoot });
}

const USAGE = `birth-key — the company's key-birth tool

  birth-key <name> --pile <dir>
  birth-key <name> --pile <dir> --encrypt --keychain-item <item>
  birth-key <name> --pile <dir> --decrypt-to-stdout --keychain-item <item>   (stdout must be a pipe)
  birth-key derive-multisig --threshold <n> --pub <b64> --pub <b64>
  birth-key keystore-guard

  --keystore-root <dir>   the Sui home this run must not touch (default ~/.sui)

It prints an address and paths. It never prints a secret except in --decrypt-to-stdout, and it
never writes into the Sui home.`;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function note(line: string): void {
  process.stderr.write(`${line}\n`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.refused) {
    note(`refused (${parsed.rule}): ${parsed.detail}`);
    note('');
    note(USAGE);
    return 2;
  }
  const args = parsed.value;

  const umask = enforceUmask();
  if (umask.refused) {
    note(`refused (${umask.rule}): ${umask.detail}`);
    return 1;
  }

  const before = await fingerprintKeystore(args.suiRoot ?? undefined);
  if (before.refused) {
    note(`refused (${before.rule}): ${before.detail}`);
    return 1;
  }
  note(describeFingerprint(before.value));

  const finish = async (code: number): Promise<number> => {
    const after = await fingerprintKeystore(args.suiRoot ?? undefined);
    if (after.refused) {
      note(`refused (${after.rule}): ${after.detail}`);
      return 1;
    }
    note(describeFingerprint(after.value));
    const drift = keystoreDrift(before.value, after.value);
    if (drift.length > 0) {
      note(
        `refused (keystore-guard): the Sui keystore changed while this tool ran — ` +
          `${drift.join('; ')}. Nothing here writes there, so something else on this machine ` +
          `did. Stop and check before relying on any key.`,
      );
      return 1;
    }
    return code;
  };

  if (args.mode === 'keystore-guard') {
    return await finish(0);
  }

  if (args.mode === 'derive-multisig') {
    const address = deriveMultisigAddress(args.threshold ?? 0, args.pubs);
    if (address.refused) {
      note(`refused (${address.rule}): ${address.detail}`);
      return await finish(1);
    }
    out(`threshold   ${String(args.threshold)} of ${args.pubs.length} (weight 1 each)`);
    out(`address     ${address.value}`);
    return await finish(0);
  }

  if (args.mode === 'decrypt') {
    const pass = await keychainPassphrase(args.keychainItem ?? '')();
    if (pass.refused) {
      note(`refused (${pass.rule}): ${pass.detail}`);
      return await finish(1);
    }
    const encPath = join(resolve(args.pile ?? '.'), `${args.name ?? ''}.key.enc`);
    const emitted = await decryptToStdout({
      encPath,
      passphrase: pass.value,
      stdoutIsTty: process.stdout.isTTY === true,
    });
    if (emitted.refused) {
      note(`refused (${emitted.rule}): ${emitted.detail}`);
      return await finish(1);
    }
    note(`decrypted   ${encPath} to stdout; nothing was written to disk.`);
    return await finish(0);
  }

  const born = await birthKey({
    name: args.name ?? '',
    pile: args.pile ?? '.',
    ...(args.suiRoot === null ? {} : { suiRoot: args.suiRoot }),
  });
  if (born.refused) {
    note(`refused (${born.rule}): ${born.detail}`);
    return await finish(1);
  }

  let secretLine = born.value.keyPath;
  if (args.encrypt) {
    const pass = await keychainPassphrase(args.keychainItem ?? '')();
    if (pass.refused) {
      note(`refused (${pass.rule}): ${pass.detail}`);
      note(`the plaintext key is still at ${born.value.keyPath}. Encrypt it or archive it now.`);
      return await finish(1);
    }
    const encrypted = await encryptInPlace({
      keyPath: born.value.keyPath,
      passphrase: pass.value,
    });
    if (encrypted.refused) {
      note(`refused (${encrypted.rule}): ${encrypted.detail}`);
      return await finish(1);
    }
    secretLine = encrypted.value;
  }

  out(`address     ${born.value.address}`);
  out(`secret      ${secretLine}`);
  out(`public      ${born.value.pubPath}`);
  out(`address     ${born.value.addressPath}`);
  return await finish(0);
}

const invoked =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      void error;
      note('birth-key failed with an unexpected fault. Nothing about it is quoted by design.');
      process.exitCode = 1;
    });
}
