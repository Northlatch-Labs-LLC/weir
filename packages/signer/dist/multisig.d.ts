/**
 * `MultiSigSigner` — the custody floor, and the only tier that survives a compromised agent.
 *
 * # What it buys, precisely, given that the account cannot move
 *
 * A weir `SocialAccount` is soulbound: `key` only, no `store`, no transfer function anywhere in
 * `account.move`. So nothing in this file rotates a key or moves a handle, and nothing can.
 *
 * What a multisig of **(agent hot key, operator cold key) at threshold 1** does buy is this: the
 * operator can sign for the address **without ever holding the agent's key**, which means that
 * when the agent key leaks, the operator can *sweep the coins* out of that address immediately
 * rather than waiting to see what the attacker does with them. The address is still fixed. The
 * handle is still lost. The entitlements are still lost. The money need not be.
 *
 * That is damage limitation and this file will not call it anything else.
 *
 * # Threshold 1 is not a weaker multisig; it is a different tool
 *
 * At threshold 1 either party can act alone, so the agent is not slowed down and the operator
 * needs no coordination in an emergency. It does **not** stop an attacker spending — they hold a
 * key that satisfies the threshold. Raising the threshold to 2 stops that, and also stops the
 * agent operating unattended, which is the whole point of an agent. The design accepts the first
 * cost and refuses the second, and an operator who wants the other trade sets the weights.
 *
 * # Members may be missing, and a below-threshold combination is refused HERE
 *
 * In production the cold key is not in the process. This signer accepts whichever members are
 * available, combines their partial signatures, and then **verifies the result against the
 * multisig public key before returning it**. `combinePartialSignatures` performs no threshold
 * check of its own — verified by reading `@mysten/sui` 2.27.1's `multisig/publickey.ts`, where
 * the threshold is compared only inside `verify()`. Without the local verification below, a
 * signer missing a required member would return a well-formed signature that every node rejects,
 * and the operator would be reading node errors instead of a sentence naming the missing key.
 */
import type { PublicKey } from '@mysten/sui/cryptography';
import { type Reading } from '@projectx-social/sdk';
import type { Signer } from './signer.js';
export interface MultiSigMember {
    /** The member's public key, as Sui's flag-prefixed bytes or their base64. */
    readonly publicKey: PublicKey | string | Uint8Array;
    /** This member's weight toward the threshold. */
    readonly weight: number;
}
export interface MultiSigSignerOptions {
    readonly threshold: number;
    readonly members: readonly MultiSigMember[];
    /**
     * The members whose keys this process actually holds.
     *
     * Usually one: the agent's hot key. The operator's cold key is a member of the public key above
     * and is deliberately not here.
     */
    readonly available: readonly Signer[];
}
/**
 * Build a multisig signer.
 *
 * Returns a `Reading` rather than throwing, because every way this can fail — a malformed member
 * key, a threshold nothing can reach, an available signer that is not a member — is a
 * configuration fact an unattended process must report rather than crash on.
 */
export declare function multiSigSigner(options: MultiSigSignerOptions): Reading<Signer>;
//# sourceMappingURL=multisig.d.ts.map