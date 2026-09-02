/**
 * `LocalKeypairSigner` — a private key in this process's memory.
 *
 * # This is the tier with no protection, and it must be labelled as such
 *
 * The key is in the heap. It is in a core dump, in a heap snapshot, in whatever a debugger
 * attached to this process can read, and in the file it was loaded from. Because a weir account
 * is soulbound (see `signer.ts`), theft of that key is permanent and unrecoverable: no rotation,
 * handle lost, entitlements lost. This adapter is correct for a funded-at-the-ceiling agent
 * carrying pocket money and wrong for anything else. `MultiSigSigner` is the floor for an agent
 * holding a handle worth keeping.
 *
 * # Two loaders, because the two encodings fail differently
 *
 * `sui keytool export` produces a bech32 `suiprivkey1…` string that names its own scheme.
 * `~/.sui/sui_config/sui.keystore` is a JSON array of base64 `flag || 32 bytes`. Both are read
 * here, and neither is guessed at: a raw 32-byte hex string is **refused**, because it is
 * indistinguishable by inspection from a public key, an object id and a transaction digest, and a
 * loader that accepts every 32-byte thing will one day be handed the wrong one. That rule is
 * `packages/agent/src/keys.ts`'s and it is kept.
 *
 * # A failed decode never quotes its input
 *
 * The input to a key parser is a private key. Crypto libraries routinely include the offending
 * value in a parse error, so every failure message below is written by hand and the underlying
 * message is **discarded** rather than wrapped. Losing the library's detail is the point: the one
 * fact a caller must never get in a log aggregator is the string itself.
 */
import { type Reading } from '@projectx-social/sdk';
import type { Signer } from './signer.js';
/**
 * Load from a bech32 `suiprivkey1…` secret.
 *
 * The scheme comes from the encoding itself rather than from a parameter, so a secp256r1 key
 * cannot be loaded as Ed25519 and silently produce a signer for an address nobody controls.
 */
export declare function localKeypairSignerFromSecret(secret: string): Reading<Signer>;
/**
 * Load one key from a Sui CLI keystore by the address it controls.
 *
 * # Why the address is required rather than an index
 *
 * A keystore is an ordered JSON array and the order changes whenever a key is added or removed.
 * An index selects a different key after any such edit, silently, and the first evidence would be
 * a transaction signed by the wrong address. The address is the stable name and it is the one an
 * operator can check against the policy document, so it is the only selector offered.
 *
 * Nothing about the file's other entries is reported. A failure says the address was not found,
 * never how many keys were present or what they were — that is a keystore inventory, and it does
 * not belong in a log.
 */
export declare function localKeypairSignerFromKeystore(args: {
    readonly path: string;
    readonly address: string;
}): Promise<Reading<Signer>>;
//# sourceMappingURL=local.d.ts.map