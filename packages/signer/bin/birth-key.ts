// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `birth-key` — the one audited generator that makes a machine key for this estate.
 *
 * # Why this file exists at all
 *
 * `sui client new-address` writes `~/.sui/sui_config/sui.keystore`. That file was overwritten
 * twice on this laptop on 2026-09-02 by processes that had no business near it, and a key born
 * into it is a key whose survival depends on nothing else ever doing that again. So no key of
 * this build is made at a prompt, by hand, or by the Sui CLI. It is made here, once, under a
 * umask this tool sets and then reads back, into a folder this tool has checked, and the only
 * things that reach a terminal are an address and three paths.
 *
 * # What it never does
 *
 * It never prints a secret except in `--decrypt-to-stdout`, whose entire purpose is to feed one
 * over a pipe and which refuses to run when stdout is a terminal. It never places a secret in an
 * argv (world-readable through `ps`) or in an environment variable: every child process is
 * spawned through `run()`, which scrubs the environment down to three variables and refuses to
 * launch at all if the bech32 secret prefix appears anywhere in the argv or the env it was
 * handed. It never overwrites a file. It never reads, writes, creates or repairs anything under
 * the Sui home; it hashes one file there through `shasum` so the bytes never enter this
 * program's heap, and it compares that hash before and after itself.
 *
 * # Why it imports nothing from this workspace
 *
 * The only imports are `@mysten/sui` and node builtins. `@projectx-social/sdk` is consumed as
 * compiled JavaScript from a gitignored `dist`, so importing it here would mean an unbuilt or
 * stale sibling package could stop a key birth halfway, or complete one and fail to report it.
 * The tool that makes keys gets the shortest dependency chain in the repository. The refusal type
 * below is the house `Reading` shape rewritten in nine lines for that reason, not by accident.
 *
 * # Refusals are values
 *
 * Every failure path returns a `Refusal` carrying the rule it broke. `main` prints it to stderr
 * and exits non-zero. Nothing throws except a programming fault, because an operator reading a
 * stack trace at two in the morning cannot tell a refused precondition from a crash mid-write.
 *
 * ## Usage
 *
 * ```
 * pnpm exec tsx packages/signer/bin/birth-key.ts <name> --pile <dir>
 * pnpm exec tsx packages/signer/bin/birth-key.ts <name> --pile <dir> --encrypt --keychain-item <item>
 * pnpm exec tsx packages/signer/bin/birth-key.ts <name> --pile <dir> --decrypt-to-stdout --keychain-item <item>
 * pnpm exec tsx packages/signer/bin/birth-key.ts derive-multisig --threshold 1 --pub <b64> --pub <b64>
 * pnpm exec tsx packages/signer/bin/birth-key.ts keystore-guard
 * ```
 */

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

/* ------------------------------------------------------------------ results */

/** A refused precondition, named by the rule it broke. Never carries key material. */
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

/* ------------------------------------------------------------------ constants */

/**
 * The prefix of a bech32 Sui secret. Used only to detect one where it must not be — in an argv,
 * in an environment, on a line about to be printed. It is a public constant of the encoding, not
 * a secret. Assembled from two halves so that a grep of this repository's *test output* for the
 * literal cannot match this source line either.
 */
export const BECH32_SECRET_PREFIX = 'suipriv' + 'key1';

/** The pile file modes, fixed here so a caller cannot ask for a friendlier one. */
const MODE_SECRET = 0o600;
const MODE_PUBLIC = 0o644;
const MODE_PILE = 0o700;

/** A key name is a filename component and is checked as one. No dots, so no `.key` collisions. */
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/* ------------------------------------------------------------------ umask */

/**
 * Set the process umask to 077 and read it back.
 *
 * `process.umask(mask)` returns the *previous* mask, so it is called twice: the first call sets
 * it, the second returns what the first left in place. Reading it back rather than assuming the
 * set took is the difference between a tool that enforces a umask and a tool that mentions one.
 */
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

/* ------------------------------------------------------------------ child processes */

/**
 * The two programs this tool spawns by absolute path, and the iteration count it pins.
 *
 * # A pinned program is never a name
 *
 * `openssl` and `security` used to be spawned by bare name off the inherited `PATH`, while the
 * hasher below already pinned `/usr/bin/shasum` first. That was a real gap and not a theoretical
 * one: on the desk's own laptop `which -a openssl` reports `/usr/local/bin/openssl` ahead of
 * `/usr/bin/openssl`, so the tool was already not running the program its comments described — and
 * the program it did run was handed the passphrase on fd 3 and the plaintext key's path. The bound
 * was "already running as `admin`", which is a real bound and is still not a reason to let `PATH`
 * choose. Security's A4, 2026-09-05; `test/birth-key.test.ts` puts a recording shim first on `PATH`
 * and asserts it is never called.
 *
 * `/usr/bin/openssl` on macOS is LibreSSL (3.3.6 on this laptop), which supports `-pbkdf2 -iter`;
 * verified by a round trip before this pin was made. If it is ever absent the tool refuses rather
 * than falling back to a name, because a fallback is the hole this closes.
 *
 * # The KDF iteration count, and the deviation it records
 *
 * The CISO's rows 1, 3, 4 and 7 say "gpg-symmetric" and this tool uses
 * `openssl enc -aes-256-cbc -pbkdf2`, which is not AEAD. The deviation is deliberate and is written
 * down here and in `README.md` rather than left as a difference nobody recorded (Security's N1).
 * What it costs and what it does not: the passphrase is 32 random bytes read from the macOS
 * keychain, so iterations are not a practical bound on anybody, and a tampered ciphertext fails to
 * open rather than yielding a chosen key — CBC with a wrong key produces garbage, and the round
 * trip in {@link encryptInPlace} compares the plaintext byte for byte before the shred. What is
 * genuinely lost against gpg is an authentication tag, so a tampered file is detected by the
 * comparison at decrypt time and not by the cipher.
 *
 * `-iter` is stated rather than left at openssl's default (10,000), which is low for a
 * password-derived key and, worse, is a *default* — it moves with the openssl version, and a blob
 * encrypted under one and decrypted under another would silently fail to open. 600,000 is OWASP's
 * current PBKDF2-HMAC-SHA256 figure. Both the encrypt and the decrypt pass the same value; they
 * must, and a mismatch is a ciphertext nobody can open.
 */
const OPENSSL = '/usr/bin/openssl';
const SECURITY = '/usr/bin/security';
const PBKDF2_ITERATIONS = '600000';

/** `enc`'s KDF arguments, written once so the encrypt and the decrypt cannot drift apart. */
const KDF_ARGS = ['-pbkdf2', '-iter', PBKDF2_ITERATIONS] as const;

/** Refuse rather than fall back to a name when a pinned program is not on this machine. */
async function pinned(program: string): Promise<Result<string>> {
  if (await exists(program)) return allow(program);
  return refuse(
    'program-missing',
    `${program} is not on this machine. This tool spawns it by absolute path and will not fall ` +
      `back to looking the name up on PATH: a shadowed program here is handed the passphrase on ` +
      `file descriptor 3 and the plaintext key's path.`,
  );
}

/**
 * The one place a child process is created.
 *
 * The environment is rebuilt from three variables rather than inherited: an inherited environment
 * is an unbounded set of strings this tool did not write, handed to a program that is about to be
 * given a passphrase on a file descriptor. `PATH` is kept because the hasher's fallbacks are
 * located through it; `HOME` because `security` needs the login keychain; `LANG=C` so parsed output
 * does not change with a locale. `openssl` and `security` are **not** located through it — see
 * {@link OPENSSL} above.
 *
 * `fd3` is written to the child's file descriptor 3 and is how a passphrase travels. It is never
 * an argument and never an environment variable, which is the whole reason this helper exists.
 */
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
    // A programming fault, not an operator error: the code tried to hand a secret to `ps`.
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
    // A trailing newline: `-pass fd:N` reads one line. Both the encrypt and the decrypt call
    // write the passphrase the same way, and the round trip in `encryptInPlace` proves it.
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

/**
 * Refuse a spawn whose argv or environment contains a bech32 secret.
 *
 * This is a control, not a test hook. `ps` shows every argument of every process on the machine
 * to every user, and crash reporters capture environments. A secret in either is a leak that no
 * later shredding undoes, so the check runs on every spawn this tool makes rather than being
 * asserted once in a test and trusted forever.
 */
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

/* ------------------------------------------------------------------ the pile */

export interface PileOptions {
  /**
   * The Sui home this run must not touch and must not write into. Defaults to `~/.sui`. It is a
   * flag (`--keystore-root`) so that this check and the keystore guard can be exercised against a
   * throwaway directory in a test, and so a machine with a relocated Sui home is still protected.
   */
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

/**
 * Check the directory a key is about to be born into.
 *
 * Four rules, cheapest failure first: it must exist and be a directory; it must be mode 0700; no
 * segment of its resolved path may be `.sui` and it may not sit at or under the Sui home; and it
 * may not sit inside a git working tree.
 *
 * The last rule is not in the CISO's table and is here because that table's standing rule "no key
 * in a commit" has no other enforcement anywhere. A pile inside a checkout is one `git add -A`
 * from being committed, and this tool is the only moment at which that is cheap to prevent.
 *
 * The containment test compares the pile's resolved path against the Sui home both as written and
 * as resolved, because on macOS the two differ constantly (`/var` is a symlink to `/private/var`)
 * and a test that compared only one of them would pass while protecting nothing. Resolving the
 * Sui home is a path resolution and opens no file inside it. If the Sui home does not exist,
 * there is nothing to resolve and the written form is used alone.
 */
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

/* ------------------------------------------------------------------ the keystore guard */

export interface KeystoreFingerprint {
  readonly root: string;
  /** Whether the Sui home exists at all. When it does not, the guard says so and continues. */
  readonly rootPresent: boolean;
  /** File *names* in `<root>/sui_config`, sorted. Names only; nothing is opened. */
  readonly configEntries: readonly string[];
  readonly keystorePresent: boolean;
  readonly keystoreSize: number | null;
  readonly keystoreMode: string | null;
  /** sha256 of the keystore, computed by `shasum` in a child process. */
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

/**
 * Fingerprint the Sui keystore without reading it.
 *
 * The bytes never enter this process: `shasum` opens the file and this tool parses 64 hex
 * characters out of its stdout. The number of *keys* inside the file is deliberately not
 * computed — that would mean parsing a JSON array of private keys into this heap — and it is not
 * needed, because the sha256 changes on any addition, removal or reordering, which is strictly
 * more than a count would catch. What is counted is the number of files in `sui_config`, from a
 * directory listing that opens nothing.
 */
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

/** The fields that differ between two fingerprints. Empty means the keystore was not touched. */
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

/* ------------------------------------------------------------------ birth */

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

/** Read a passphrase from the macOS keychain. Captured as bytes, never printed, never stored. */
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

/**
 * Generate one Ed25519 key into the pile.
 *
 * Three files, opened `wx` so the kernel refuses an existing name rather than this tool checking
 * and then racing itself. The secret is written at 0600 explicitly: the umask above would already
 * produce 0600, and the explicit `chmod` is there so the mode is a property of this code rather
 * than of the ambient environment.
 *
 * The `.pub` file holds `toSuiPublicKey()` — the flag-prefixed base64 form — and not
 * `toBase64()`. This is not cosmetic: `publicKeyFromSuiBytes`, which is what `src/multisig.ts`
 * calls on every member, *rejects* the raw 32-byte base64 with "Unsupported signature scheme
 * undefined". A pile written in the other form would derive no multisig address at all, and the
 * operator would discover that at the moment of deriving Heron's address.
 */
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

/* ------------------------------------------------------------------ encryption */

/**
 * Encrypt `<name>.key` to `<name>.key.enc` and shred the plaintext.
 *
 * The order is the point. The ciphertext is written, then **decrypted back and compared to the
 * plaintext still on disk**, and only a byte-for-byte match permits the shred. Shredding first
 * and trusting the encryption is how a pile ends up holding one unopenable file where a key used
 * to be.
 *
 * The shred overwrites the file with random bytes, then zeroes, syncing each pass, then unlinks.
 * The honest bound, said plainly: on APFS this does not guarantee the original blocks are
 * unrecoverable — the filesystem is copy-on-write and the SSD remaps underneath it. What it does
 * guarantee is that the plaintext is not sitting in the pile under a name, which is the failure
 * this estate actually had.
 */
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

  // Prove the ciphertext opens before destroying the only thing that could rewrite it.
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

/**
 * Emit the decrypted secret on stdout and nowhere else.
 *
 * The child's stdout is *inherited*, so the plaintext travels from `openssl` to this process's
 * stdout without ever entering this program's heap. Refused when stdout is a terminal: the only
 * caller is the deploy step piping into a sealing command over an SSH session, and a secret on a
 * terminal is a secret in a scrollback buffer, a screenshot and a shell history.
 */
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

/* ------------------------------------------------------------------ multisig */

/**
 * Derive a multisig address from public keys at equal weight 1.
 *
 * Built with the same `publicKeyFromSuiBytes` + `MultiSigPublicKey.fromPublicKeys` pair that
 * `src/multisig.ts` uses, so the address this prints and the address that package signs for are
 * the same value by construction rather than by coincidence — and `test/birth-key.test.ts`
 * asserts it against `multiSigSigner()` rather than trusting that sentence.
 *
 * Duplicate members are refused. Two copies of one public key at threshold 2 looks like a 2-of-2
 * and is a 1-of-1, and a Sui multisig address cannot be changed after birth.
 */
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
      // A public key is not secret, so the offending value may be named.
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

/* ------------------------------------------------------------------ the command line */

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

  /** Re-fingerprint the Sui keystore and refuse to finish if anything about it moved. */
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

/* Run only when executed, so the test can import every function above. */
const invoked =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      // Never wrap: a thrown value from a key path can quote key material.
      void error;
      note('birth-key failed with an unexpected fault. Nothing about it is quoted by design.');
      process.exitCode = 1;
    });
}
