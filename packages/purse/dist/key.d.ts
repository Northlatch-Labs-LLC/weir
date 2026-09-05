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
import { type Signer } from '@projectx-social/signer';
import { type Outcome } from './outcome.js';
/** The credential name the unit declares, and the file systemd writes it to. */
export declare const CREDENTIAL_NAME = "heron-hot";
export interface KeySource {
    /** `--key-file`, when given. */
    readonly keyFile?: string | undefined;
    /** `$CREDENTIALS_DIRECTORY`, when systemd set it. */
    readonly credentialsDirectory?: string | undefined;
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string | undefined>>;
}
export interface LoadedKey {
    readonly signer: Signer;
    /** Where it came from, for the one startup line. A path, never a value. */
    readonly path: string;
}
/**
 * Check that no key was handed to this process through a channel that leaks.
 *
 * Exported separately from {@link loadHotKey} because the server calls it **before** anything else
 * — before the policy is read, before the socket is bound. A process that was started wrongly
 * should die at the first instruction, not after it has created a socket other things can connect
 * to.
 */
export declare function refuseKeyInProcessSurface(source: {
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string | undefined>>;
}): Outcome<null>;
export declare function loadHotKey(source: KeySource): Promise<Outcome<LoadedKey>>;
//# sourceMappingURL=key.d.ts.map