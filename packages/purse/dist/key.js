// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Loading Heron's hot key, and refusing every other way of being handed it.
 *
 * # One door
 *
 * The key arrives as a file, at a path named on the command line (`--key-file`) or, with no flag,
 * at `$CREDENTIALS_DIRECTORY/heron-hot` — where systemd decrypts `LoadCredentialEncrypted=` into a
 * per-unit tmpfs at 0400 owned by the service user, unmounted when the unit stops. Those are the
 * only two, and the second is the one the deploy uses.
 *
 * # Three refusals that are the point of this file
 *
 * **A key in an environment variable.** The environment of a process is readable by anything that
 * can read `/proc/<pid>/environ` as that user, is inherited by every child — and the keyed MCP is a
 * child process (the CTO's 2.8a) — and is copied verbatim into most crash reporters. This loader
 * refuses to start if any environment value contains the bech32 prefix, and refuses if any of the
 * obvious names is set at all, whatever it holds. Refusing the *name* matters as much as refusing
 * the value: `HERON_HOT_KEY=/path/to/key` is somebody already halfway to putting the key there.
 *
 * **A key in argv.** `ps` shows it to every user on the box. Same check, over `process.argv`.
 *
 * **A key file anyone else can read.** `mode & 0o077` must be zero: no group bit, no other bit.
 * 0400 (systemd's credential) and 0600 (the pile's own mode) both pass; 0640 does not. A symlink is
 * refused before it is followed — v1 had a hard link, a symlink, a scratchpad copy and an `scp`
 * staging file, and the CISO's §1 rules them all out by name.
 *
 * # Nothing here ever reports what it read
 *
 * No failure message contains the file's contents, its length, or the library's own parse error.
 * `localKeypairSignerFromSecret` already discards the underlying error for that reason and says so
 * in its own header; this file keeps the property at its own boundary rather than assuming it.
 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localKeypairSignerFromSecret } from '@projectx-social/signer';
import { allow, refuse } from './outcome.js';
/** The bech32 human-readable part every Sui private key carries. Searched for, never printed. */
const SECRET_PREFIX = 'suipriv' + 'key1';
/** The credential name the unit declares, and the file systemd writes it to. */
export const CREDENTIAL_NAME = 'heron-hot';
/**
 * Environment names that must not be set at all.
 *
 * Not a blocklist of every possible name — that is unwinnable — but of the names somebody reaching
 * for the wrong door would actually use. The value scan below is the general check; this is the
 * specific one that catches the mistake before it becomes a habit.
 */
const FORBIDDEN_ENV_NAMES = [
    'HERON_HOT',
    'HERON_HOT_KEY',
    'HERON_KEY',
    'HERON_SECRET',
    'PURSE_KEY',
    'SUI_PRIVATE_KEY',
    'SUI_SECRET_KEY',
];
/**
 * Check that no key was handed to this process through a channel that leaks.
 *
 * Exported separately from {@link loadHotKey} because the server calls it **before** anything else
 * — before the policy is read, before the socket is bound. A process that was started wrongly
 * should die at the first instruction, not after it has created a socket other things can connect
 * to.
 */
export function refuseKeyInProcessSurface(source) {
    for (const [index, arg] of source.argv.entries()) {
        if (arg.includes(SECRET_PREFIX)) {
            return refuse('request-malformed', `argv[${index}] contains a Sui private key. A key in argv is visible in \`ps\` to every ` +
                `user on this host. The purse refuses to start; nothing was loaded and no socket was ` +
                `created. Pass a path with --key-file, or let systemd place the credential.`);
        }
    }
    for (const name of FORBIDDEN_ENV_NAMES) {
        if (source.env[name] !== undefined) {
            return refuse('request-malformed', `the environment variable ${name} is set. The purse takes its key from a file and from ` +
                `nothing else: an environment is inherited by every child process — the keyed MCP is ` +
                `one — and is copied into crash reports verbatim. Unset it and pass --key-file, or let ` +
                `systemd place the credential at $CREDENTIALS_DIRECTORY/${CREDENTIAL_NAME}.`);
        }
    }
    for (const [name, value] of Object.entries(source.env)) {
        if (typeof value === 'string' && value.includes(SECRET_PREFIX)) {
            return refuse('request-malformed', `the environment variable ${name} contains a Sui private key. The purse refuses to start. ` +
                `Its value is deliberately not shown, and it should be considered leaked: an ` +
                `environment is readable from /proc and inherited by every child.`);
        }
    }
    return allow(null);
}
export async function loadHotKey(source) {
    const surface = refuseKeyInProcessSurface(source);
    if (!surface.ok)
        return surface;
    const path = source.keyFile !== undefined && source.keyFile !== ''
        ? source.keyFile
        : source.credentialsDirectory !== undefined && source.credentialsDirectory !== ''
            ? join(source.credentialsDirectory, CREDENTIAL_NAME)
            : null;
    if (path === null) {
        return refuse('request-malformed', `no key file. Pass --key-file <path>, or run under a unit with ` +
            `LoadCredentialEncrypted=${CREDENTIAL_NAME}:… so systemd sets $CREDENTIALS_DIRECTORY. ` +
            `There is no third way and there is no default path to fall back to.`);
    }
    let info;
    try {
        info = await lstat(path);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return refuse('request-malformed', `the key file ${path} could not be read: ${detail}`);
    }
    if (info.isSymbolicLink()) {
        return refuse('request-malformed', `${path} is a symbolic link. The purse never follows one to a key: a link means the key ` +
            `also exists somewhere this process did not check the permissions of, and v1 shipped four ` +
            `such copies.`);
    }
    if (!info.isFile()) {
        return refuse('request-malformed', `${path} is not a regular file.`);
    }
    const mode = info.mode & 0o777;
    if ((mode & 0o077) !== 0) {
        return refuse('request-malformed', `${path} is mode ${mode.toString(8).padStart(4, '0')}. A key file readable by its group or ` +
            `by others is a key this process cannot claim to hold alone. Expected 0400 (the systemd ` +
            `credential) or 0600.`);
    }
    let secret;
    try {
        secret = (await readFile(path, 'utf8')).trim();
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return refuse('request-malformed', `the key file ${path} could not be read: ${detail}`);
    }
    if (secret === '') {
        return refuse('request-malformed', `the key file ${path} is empty.`);
    }
    const loaded = localKeypairSignerFromSecret(secret);
    if (!loaded.ok) {
        // The SDK failure's detail is written by `local.ts`, which discards the library's message for
        // exactly this reason. Passed through as it stands; it names no value.
        return refuse('request-malformed', `${path} does not hold a key: ${loaded.failure.detail}`);
    }
    return allow({ signer: loaded.value, path });
}
//# sourceMappingURL=key.js.map