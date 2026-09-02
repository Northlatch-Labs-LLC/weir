/**
 * A hash-chained record of every decision, including the refusals.
 *
 * # Why the denials are recorded, and why that is not padding
 *
 * A log of allowed spends tells you what an agent bought. A log that also records what it *tried*
 * and was refused tells you when someone started steering it. A run of `move-call-target`
 * denials on `claim_earnings` is the signature of a prompt-injection attempt, and it is invisible
 * in a log that only writes successes. Every decision goes in.
 *
 * # Why the policy hash is in every entry
 *
 * An entry that recorded a decision without recording *which policy made it* proves nothing: the
 * policy could have been widened afterwards and every past "allow" would still read as compliant.
 * The hash of the canonical policy document is therefore part of the entry and part of the
 * chained hash, so a widening shows up at the exact entry where it first took effect.
 *
 * # What the chain detects, and — stated plainly — what it does not
 *
 * Each entry commits to the one before it, so **editing, reordering, or deleting any entry breaks
 * verification from that point onward**, which `test/audit.test.ts` proves by mutating one field.
 *
 * It does **not** detect an attacker who rewrites the whole file, because they can recompute every
 * subsequent hash. A hash chain is tamper-*evident* against partial edits, not tamper-*proof*.
 * Closing that gap needs an anchor outside the file — the head hash written somewhere the attacker
 * does not control, or each entry signed. {@link AuditLog.headHash} is exposed for exactly that,
 * and nothing in this package publishes it, because where an anchor lives is a deployment
 * decision. This limitation is in `README.md` too; it is not a footnote.
 */
/** The hash the first entry chains from: 64 zeros. A chain that starts anywhere else is not ours. */
export declare const GENESIS_HASH: string;
export interface AuditFields {
    /** When the decision was made, epoch milliseconds. */
    readonly ts: number;
    /** The address that would have signed. */
    readonly address: string;
    /**
     * The transaction digest the simulation reported.
     *
     * Read from `effects.transactionDigest` — measured on mainnet 2026-08-31, where the top-level
     * `Transaction.digest` was `undefined` and only the effects carried it. When no digest could be
     * observed this is the empty string rather than a fabricated one, and an empty digest in an
     * entry is itself a fact worth seeing.
     */
    readonly txDigest: string;
    /** sha256 of `canonicalPolicyJson(policy)`. See {@link policyHash}. */
    readonly policyHash: string;
    readonly decision: 'allow' | 'deny';
    /** Empty for an allow; the evaluator's full sentence for a deny. */
    readonly reason: string;
}
export interface AuditEntry extends AuditFields {
    /** Position in the chain, from 0. Part of the hash, so entries cannot be reordered. */
    readonly seq: number;
    readonly prevHash: string;
    readonly hash: string;
}
/** sha256 of a policy document's canonical encoding, hex. */
export declare function policyHash(canonicalJson: string): string;
/**
 * The exact bytes an entry's hash is taken over.
 *
 * # Why this is not `JSON.stringify(entry)`
 *
 * Two reasons, and both have bitten real systems. `JSON.stringify` preserves insertion order, so
 * an entry rebuilt with its fields in a different order hashes differently and a verifier reports
 * tampering that never happened. And a plain concatenation of user-influenced strings is
 * ambiguous for hashing: `reason` carries arbitrary text from the evaluator, so a separator alone
 * is not enough — a crafted reason could impersonate a field boundary and make two different
 * entries hash alike.
 *
 * So every field is **length-prefixed** as well as separated. A length prefix cannot be forged
 * from inside a field's own content, which is what makes the encoding injective: distinct field
 * tuples produce distinct preimages, always.
 */
export declare function entryPreimage(fields: AuditFields, seq: number, prevHash: string): string;
export type ChainVerdict = {
    readonly intact: true;
    readonly length: number;
    readonly headHash: string;
} | {
    readonly intact: false;
    readonly index: number;
    readonly reason: string;
};
/**
 * Recompute every hash and confirm the chain.
 *
 * Reports the **index of the first entry that does not hold**, because that is where a reviewer
 * has to start reading. A boolean would send them to the beginning of the file.
 */
export declare function verifyChain(entries: readonly AuditEntry[]): ChainVerdict;
/**
 * An append-only chain held in memory.
 *
 * Deliberately not persistent. Where an audit trail is stored — a file, Postgres, an append-only
 * bucket — is a decision with consequences this package cannot see, and a library that picked one
 * would have picked it for every deployment that ever used it. {@link entries} hands out a copy
 * for the caller to write wherever they have decided; {@link headHash} is the value to anchor
 * externally if the whole-file rewrite in this file's header matters to them.
 */
export declare class AuditLog {
    #private;
    /**
     * A defensive copy. The internal array is never handed out — an audit log a caller can splice
     * is not an audit log.
     */
    get entries(): readonly AuditEntry[];
    get headHash(): string;
    append(fields: AuditFields): AuditEntry;
    verify(): ChainVerdict;
}
//# sourceMappingURL=audit.d.ts.map