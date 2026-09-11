// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localKeypairSignerFromSecret, type Signer } from '@projectx-social/signer';
import { allow, refuse, type Outcome } from './outcome.js';

const SECRET_PREFIX = 'suipriv' + 'key1';

export const CREDENTIAL_NAME = 'heron-hot';

function envPrefixOf(credentialName: string): string {
  return credentialName.split('-')[0]!.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export function forbiddenEnvNames(credentialName: string = CREDENTIAL_NAME): readonly string[] {
  const prefix = envPrefixOf(credentialName);
  return [
    `${prefix}_HOT`,
    `${prefix}_HOT_KEY`,
    `${prefix}_KEY`,
    `${prefix}_SECRET`,
    'PURSE_KEY',
    'SUI_PRIVATE_KEY',
    'SUI_SECRET_KEY',
  ];
}

export interface KeySource {
  readonly keyFile?: string | undefined;
  readonly credentialName?: string | undefined;
  readonly credentialsDirectory?: string | undefined;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface LoadedKey {
  readonly signer: Signer;
  readonly path: string;
}

export function refuseKeyInProcessSurface(source: {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly credentialName?: string | undefined;
}): Outcome<null> {
  const credentialName = source.credentialName ?? CREDENTIAL_NAME;
  for (const [index, arg] of source.argv.entries()) {
    if (arg.includes(SECRET_PREFIX)) {
      return refuse(
        'request-malformed',
        `argv[${index}] contains a Sui private key. A key in argv is visible in \`ps\` to every ` +
          `user on this host. The purse refuses to start; nothing was loaded and no socket was ` +
          `created. Pass a path with --key-file, or let systemd place the credential.`,
      );
    }
  }

  for (const name of forbiddenEnvNames(credentialName)) {
    if (source.env[name] !== undefined) {
      return refuse(
        'request-malformed',
        `the environment variable ${name} is set. The purse takes its key from a file and from ` +
          `nothing else: an environment is inherited by every child process — the keyed MCP is ` +
          `one — and is copied into crash reports verbatim. Unset it and pass --key-file, or let ` +
          `systemd place the credential at $CREDENTIALS_DIRECTORY/${credentialName}.`,
      );
    }
  }

  for (const [name, value] of Object.entries(source.env)) {
    if (typeof value === 'string' && value.includes(SECRET_PREFIX)) {
      return refuse(
        'request-malformed',
        `the environment variable ${name} contains a Sui private key. The purse refuses to start. ` +
          `Its value is deliberately not shown, and it should be considered leaked: an ` +
          `environment is readable from /proc and inherited by every child.`,
      );
    }
  }

  return allow(null);
}

export async function loadHotKey(source: KeySource): Promise<Outcome<LoadedKey>> {
  const surface = refuseKeyInProcessSurface(source);
  if (!surface.ok) return surface;
  const credentialName = source.credentialName ?? CREDENTIAL_NAME;

  const path =
    source.keyFile !== undefined && source.keyFile !== ''
      ? source.keyFile
      : source.credentialsDirectory !== undefined && source.credentialsDirectory !== ''
        ? join(source.credentialsDirectory, credentialName)
        : null;

  if (path === null) {
    return refuse(
      'request-malformed',
      `no key file. Pass --key-file <path>, or run under a unit with ` +
        `LoadCredentialEncrypted=${credentialName}:… so systemd sets $CREDENTIALS_DIRECTORY. ` +
        `There is no third way and there is no default path to fall back to.`,
    );
  }

  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the key file ${path} could not be read: ${detail}`);
  }

  if (info.isSymbolicLink()) {
    return refuse(
      'request-malformed',
      `${path} is a symbolic link. The purse never follows one to a key: a link means the key ` +
        `also exists somewhere this process did not check the permissions of, and v1 shipped four ` +
        `such copies.`,
    );
  }
  if (!info.isFile()) {
    return refuse('request-malformed', `${path} is not a regular file.`);
  }

  const mode = info.mode & 0o777;
  const viaCredentials =
    source.credentialsDirectory !== undefined &&
    source.credentialsDirectory !== '' &&
    path.startsWith(`${source.credentialsDirectory}/`);
  const forbidden = viaCredentials ? 0o027 : 0o077;
  if ((mode & forbidden) !== 0) {
    return refuse(
      'request-malformed',
      `${path} is mode ${mode.toString(8).padStart(4, '0')}. A key file ` +
        (viaCredentials
          ? `writable by its group or readable by others is not a credential systemd placed ` +
            `for this unit alone. Expected 0400 or 0440 under $CREDENTIALS_DIRECTORY.`
          : `readable by its group or by others is a key this process cannot claim to hold ` +
            `alone. Expected 0600 for a --key-file.`),
    );
  }

  let secret: string;
  try {
    secret = (await readFile(path, 'utf8')).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the key file ${path} could not be read: ${detail}`);
  }

  if (secret === '') {
    return refuse('request-malformed', `the key file ${path} is empty.`);
  }

  const loaded = localKeypairSignerFromSecret(secret);
  if (!loaded.ok) {
    return refuse('request-malformed', `${path} does not hold a key: ${loaded.failure.detail}`);
  }

  return allow({ signer: loaded.value, path });
}
