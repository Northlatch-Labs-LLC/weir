/**
 * `audit.jsonl` — every decision the purse made, chained.
 *
 * # Why this is not `AuditLog` from the signer package
 *
 * It is the same construction and deliberately so: length-prefixed fields, sha256, each entry
 * committing to the one before it, the policy hash inside the hash. What differs is what an entry
 * *is about*. The signer's entry is about a transaction — an address and a digest. The purse's
 * entry is about a **request**: which intent came in, what it hashed to, and what the purse
 * answered. A refusal that never reached the signer — a malformed request, an intent the schema
 * rejected — produces no signer entry at all, and those are exactly the lines that show somebody
 * probing. `AuditLog` is also in-memory by design and says so; persistence is this file's job.
 *
 * Both chains are written. The signer's lives inside the process; the purse's is the one on disk.
 * The purse's line carries the signer's `policyHash`, so the two line up entry for entry where they
 * overlap.
 *
 * # The encoding is injective, and that is not decoration
 *
 * `reason` carries arbitrary text — including, on a refusal, text that came from a model that reads
 * the internet. A plain concatenation of separated fields is forgeable from inside such a field: a
 * reason containing the separator can impersonate a field boundary and make two different entries
 * hash alike. Every field is therefore length-prefixed as `<len>:<value>`, which cannot be forged
 * from inside a field's own content. This is `packages/signer/src/audit.ts`'s reasoning and its
 * shape; it is repeated here rather than imported because the field tuple is different, and a
 * shared preimage function over two different tuples would be the actual hazard.
 *
 * # What the chain detects and what it does not
 *
 * Editing, reordering or deleting any line breaks verification from that line onward, and
 * `verifyAuditLines` reports the **first** break, because that is where a reader starts. It does
 * not detect an attacker who rewrites the whole file: they can recompute every hash after their
 * edit. A hash chain is tamper-evident against partial edits, not tamper-proof. Closing that needs
 * an anchor the attacker does not control — the head hash pulled to the laptop by the state pull,
 * which is a deployment decision and is named in the README rather than assumed here.
 *
 * The file is 0600 and owned by the purse's user. That is the only reason the attacker in the
 * paragraph above has to be root or the purse itself.
 */
export declare const GENESIS_HASH: string;
export type PurseOutcomeName = 'signed' | 'refused';
export interface PurseAuditFields {
    /** Epoch milliseconds. */
    readonly ts: number;
    /** The address that signed, or would have. */
    readonly address: string;
    /** sha256 of `canonicalPolicyJson(doc)` — the same value the signer's own entries carry. */
    readonly policyHash: string;
    /** sha256 of the policy file's bytes — what the unit pinned. */
    readonly policyFileSha256: string;
    /** `post`, `price`, `settle_epoch`, or `unparsed` when the request never became an intent. */
    readonly intentKind: string;
    /** sha256 of the intent's canonical encoding, or the empty string when there was no intent. */
    readonly intentHash: string;
    readonly outcome: PurseOutcomeName;
    /** The rule id on a refusal; the empty string on a signature. */
    readonly ruleId: string;
    /** The full sentence on a refusal; the empty string on a signature. */
    readonly reason: string;
    /** The simulated digest when there was one; the empty string otherwise. Never fabricated. */
    readonly txDigest: string;
}
export interface PurseAuditLine extends PurseAuditFields {
    readonly seq: number;
    readonly prevHash: string;
    readonly hash: string;
}
export declare function entryPreimage(fields: PurseAuditFields, seq: number, prevHash: string): string;
export declare function hashEntry(fields: PurseAuditFields, seq: number, prevHash: string): string;
export type ChainVerdict = {
    readonly intact: true;
    readonly length: number;
    readonly headHash: string;
} | {
    readonly intact: false;
    readonly line: number;
    readonly reason: string;
};
/**
 * Walk the chain and report the first line that does not hold.
 *
 * `line` is one-based, because the reader's next move is to open the file in an editor and go to
 * that line.
 */
export declare function verifyAuditLines(lines: readonly PurseAuditLine[]): ChainVerdict;
export type ReadAuditResult = {
    readonly ok: true;
    readonly lines: readonly PurseAuditLine[];
} | {
    readonly ok: false;
    readonly line: number;
    readonly reason: string;
};
/**
 * Read the file into lines.
 *
 * A line that is not JSON, or is missing a field, is reported as a break at that line rather than
 * skipped. A verifier that skips what it cannot read reports "intact" on a file somebody has been
 * editing, which is worse than no verifier.
 */
export declare function readAuditFile(path: string): Promise<ReadAuditResult>;
/**
 * The append-only file.
 *
 * Opened once and held open, `'a'`, so every write is an atomic append at the end of the file
 * whatever else has the file open. Created 0600; the mode is then read back and enforced, because
 * `open`'s mode argument is masked by the process umask and a file created 0644 by an inherited
 * umask would be an audit log the whole host can read.
 */
export declare class AuditFile {
    #private;
    private constructor();
    get path(): string;
    get headHash(): string;
    get length(): number;
    /**
     * Open, recovering the sequence number and head hash from what is already there.
     *
     * A file whose existing chain is broken is **not** appended to. Continuing past a break would
     * chain new, honest entries onto a hash the file cannot justify, and every line after the break
     * would then verify — hiding the break under the purse's own signature of good faith.
     */
    static open(path: string): Promise<{
        ok: true;
        file: AuditFile;
    } | {
        ok: false;
        reason: string;
    }>;
    append(fields: PurseAuditFields): Promise<PurseAuditLine>;
    close(): Promise<void>;
}
//# sourceMappingURL=audit-file.d.ts.map