/**
 * The agent's own key.
 *
 * # An agent has a keypair and nothing else, and that is the whole security model
 *
 * Weir's human path is zkLogin: an OAuth identity, an ephemeral key, a proof, and a browser to
 * hold them. None of that survives contact with a headless process — zkLogin's ephemeral key is
 * bound to a session a person opened, and its proof needs a chain read to verify, which
 * `verifyAction` already does for exactly that reason.
 *
 * So an agent is a plain Ed25519 keypair. It is a first-class Sui signer and the server cannot
 * tell it apart from a hardware wallet, because there is nothing to tell apart: the same
 * `verifyPersonalMessageSignature` call with the same `{ address }` option accepts both.
 *
 * **This adds no authority.** An agent address can do precisely what any address can do — hold an
 * account, own entitlements, sign statements, spend its own coins. It holds no capability, it is
 * not privileged by any route, and there is no code path anywhere that trusts it more than it
 * trusts a stranger. That is a property worth stating because it is the property an "AI agent
 * integration" most often quietly gives up.
 *
 * # The secret is consumed and not retained
 *
 * `packages/daemon/src/adapters/signer.ts` established the pattern and this follows it: the bech32
 * string is decoded here and never stored on anything this module returns. A caller who logs an
 * {@link AgentKey} prints an address. There is no accessor on it that returns raw key bytes.
 *
 * # A failed decode never quotes its input
 *
 * The input to a key parser is a private key. Crypto libraries routinely include the offending
 * value in a parse error, so the error below is written by hand and the underlying message is
 * discarded rather than wrapped. Losing the library's detail is the point: the only fact a caller
 * needs is "that string is not a Sui Ed25519 secret", and the one fact they must never get in a
 * log aggregator is the string itself.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { type Reading } from '@projectx-social/sdk';
/**
 * A loaded agent key.
 *
 * The `keypair` is exposed because signing and `signAndExecuteTransaction` both need the object
 * itself — hiding it behind a facade would mean re-exporting every method the Sui SDK may add.
 * What is *not* exposed is any convenience that turns it back into a string.
 */
export interface AgentKey {
    /** The Sui address this key controls. Safe to log, and the only thing here that is. */
    readonly address: string;
    /** The signer. Do not serialise it; see this file's header. */
    readonly keypair: Ed25519Keypair;
}
/**
 * Load a key from a bech32 `suiprivkey1…` secret.
 *
 * This is the format `sui keytool export` produces and the one the harvest daemon already
 * consumes, so an operator moving between the two is doing the same thing twice rather than
 * learning a second encoding. Raw 32-byte hex is deliberately **not** accepted: it is
 * indistinguishable from a public key, an object id and a transaction digest by inspection, and a
 * loader that accepts every 32-byte thing is a loader that will one day be handed the wrong one.
 */
export declare function agentKeyFromSecret(secret: string): Reading<AgentKey>;
/**
 * Load a key from an environment.
 *
 * Separate from {@link agentKeyFromSecret} so the variable name appears in the failure. "The
 * signing secret is empty" sends an operator looking through code; "PROJECTX_SOCIAL_AGENT_SECRET
 * is not set" sends them to the one line that fixes it.
 */
export declare function agentKeyFromEnv(env: Record<string, string | undefined>): Reading<AgentKey>;
/**
 * Mint a fresh agent key.
 *
 * Returns the secret **once**, as the only way to persist it, and returns it as a distinct field
 * rather than on {@link AgentKey} so it cannot be carried around by accident: the caller has to
 * destructure it deliberately, and everything downstream takes the key without it.
 *
 * Nothing here writes to disk, to an environment, or to a log. Where a new key is stored is a
 * decision with consequences an SDK cannot see, and a library that picks a location for a private
 * key has picked it for every deployment that ever uses it.
 */
export declare function generateAgentKey(): {
    key: AgentKey;
    secret: string;
};
/**
 * A Sui address, in the padded 32-byte form the chain and this repo use.
 *
 * Exported because address comparison happens in three places in this package — self-payment,
 * session ownership, and the reader a route reports back — and case is not stable across them.
 * `packages/web/lib/db.ts` normalises on the way into storage; the chain returns lower case; a
 * human pastes whatever their wallet showed them. Comparing raw strings works until it does not,
 * and the failure is "you cannot pay your own vault" shown to somebody who is not the owner.
 */
export declare function normaliseAddress(address: string): string;
/** True when two addresses name the same account, whatever form each was written in. */
export declare function sameAddress(a: string, b: string): boolean;
//# sourceMappingURL=keys.d.ts.map