// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The typed intent: everything the model is allowed to ask for, and nothing else.
 *
 * # The arm this covers, and the three things deliberately absent
 *
 * Heron v2 runs the **content arm** only. Three kinds of intent exist:
 *
 *  - `post` — a body has just been sealed off-chain; put its content key up for sale at a price.
 *    Carries the sha256 of the sealed body, so the audit line ties the signature to exactly one
 *    body and a later reader can prove which one.
 *  - `price` — reprice a content key that already exists. Same call, different fact recorded:
 *    nothing new was sealed.
 *  - `settle_epoch` — close the soul's epoch. Held here rather than in a second package because a
 *    settlement signer is this same program with a different key and a different policy document;
 *    see the note on `settle_epoch` below.
 *
 * **There is no `buy`, no `subscribe` and no transfer to a free-form address.** Not "denied by
 * policy" — absent from the type, so no request can name one. The one place an address appears in
 * a built transaction is as the sender, which is the purse's own address; every recipient the
 * evaluator will see comes from the policy document's `allowedRecipients`, never from an intent.
 * A prompt-injected model can therefore produce a bad *price on its own vault* and nothing else.
 *
 * # Every schema is `.strict()`, and that is the load-bearing part
 *
 * An unknown key is a refusal, not a field that is ignored. A permissive parser is how a field
 * named `recipient` reaches a builder that grew support for it in a later commit while the
 * deployed policy document still says nothing about recipients. `z.strictObject` refuses first.
 *
 * # Why object references and not object ids
 *
 * Every object arrives as a **fully-resolved reference** — a shared object with its
 * `initialSharedVersion`, an owned object with its version and digest. Handing the builder a bare
 * id would make `Transaction.build()` resolve it against a fullnode, and that resolution is a
 * second observation of the chain: the purse would evaluate a policy against one reading of the
 * world and sign bytes assembled from another. `test/build.test.ts` asserts the built transaction
 * contains **no** `UnresolvedObject` input, which is that property stated as a test rather than as
 * a comment.
 *
 * The versions come from the container, which is the untrusted side. That is safe and it is worth
 * saying why: a wrong version makes the transaction fail on chain and costs gas; it cannot make it
 * do something else. The *ids* are what decide who is paid, and the ids are checked by the policy's
 * `object-input` rule against a list the operator wrote.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
/** `0x` and one to sixty-four hex digits, which is what every Sui id and address is. */
const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;
/** A u64 as a decimal string. JSON has no integer type that survives 2^53; a string does. */
const U64_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** `0x…::module::name`, the only shape a Move type or target ever has. */
const MOVE_TYPE = /^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]{0,127}::[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const suiId = z.string().regex(HEX_ID, 'not a Sui object id or address');
const u64 = z.string().regex(U64_DECIMAL, 'not a u64 written as a decimal string');
const sha256Hex = z.string().regex(SHA256_HEX, 'not a lowercase hex sha256 digest');
const moveType = z.string().regex(MOVE_TYPE, 'not a fully-qualified Move type');
/**
 * A base58 object digest. Length is bounded rather than decoded: a wrong digest is a transaction
 * that fails on chain, and a decoder here would be a second implementation of one.
 */
const objectDigest = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/, 'not a base58 object digest');
export const sharedObjectRef = z.strictObject({
    objectId: suiId,
    initialSharedVersion: u64,
    mutable: z.boolean(),
});
export const ownedObjectRef = z.strictObject({
    objectId: suiId,
    version: u64,
    digest: objectDigest,
});
/**
 * A content key as the contract sees it: a byte string, at most 256 bytes once encoded as UTF-8.
 *
 * Bounded because it becomes a `vector<u8>` pure input, and an unbounded pure input is an
 * unbounded transaction — the gas budget would refuse it eventually, but "eventually, by accident"
 * is not a bound.
 */
const contentKey = z
    .string()
    .min(1, 'a content key cannot be empty')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 256, 'a content key is at most 256 bytes');
/** A price of zero is not "free"; on this protocol it means "not for sale" and aborts `EZeroPrice`. */
const positiveU64 = u64.refine((value) => value !== '0', 'a price of zero is not a price');
export const postIntent = z.strictObject({
    kind: z.literal('post'),
    coinType: moveType,
    vault: sharedObjectRef,
    cap: ownedObjectRef,
    contentKey,
    /** sha256 of the sealed body this price is being set for. Recorded; never sent to the chain. */
    bodyDigestSha256: sha256Hex,
    priceMist: positiveU64,
});
export const priceIntent = z.strictObject({
    kind: z.literal('price'),
    coinType: moveType,
    vault: sharedObjectRef,
    cap: ownedObjectRef,
    contentKey,
    priceMist: positiveU64,
});
/**
 * Close the soul's epoch.
 *
 * `northlatch_soul::settle_epoch` is `[LedgerCap]` — a different capability on a different key
 * from the one that prices content (executive decision 6). It is in this schema because the
 * settlement signer **is this program**: the same binary, one systemd user over, with its own
 * credential and its own policy document, exactly as the CISO's §2 describes ("the same shape, one
 * user over"). One signer per money path, so a settlement can never consume the content ceiling.
 * Which of the three kinds a given purse will actually sign is decided by its policy document's
 * `allowedTargets`, not by this file.
 *
 * There is no TypeScript client for the soul package anywhere in the estate — the CTO's finding F1,
 * verified again on this branch. The move call is therefore assembled here from the Move signature
 * (`northlatch/contracts/soul/sources/soul.move:1182-1190`), and `test/build.test.ts` pins the
 * argument order against that signature. When the soul client of F1 exists this builder is replaced
 * by it and the test moves with it.
 */
export const settleEpochIntent = z.strictObject({
    kind: z.literal('settle_epoch'),
    /** The published soul package. Named per intent so a republish is not a code change. */
    packageId: suiId,
    ledgerCap: ownedObjectRef,
    registry: sharedObjectRef,
    soul: sharedObjectRef,
    clock: sharedObjectRef,
    /** The vault's SUI balance, read by the caller in the same beat. Decides the tier. */
    vaultSui: u64,
    epochNetNonneg: z.boolean(),
});
export const intentSchema = z.discriminatedUnion('kind', [
    postIntent,
    priceIntent,
    settleEpochIntent,
]);
/**
 * Parse an unknown value as an intent, refusing as a value.
 *
 * The failure message names the paths that were wrong and nothing else. It does **not** quote the
 * offending value: an intent is written by a model that reads the internet, and a refusal that
 * echoes its input into a log is a way to write chosen text into the one file that is supposed to
 * be evidence.
 */
export function parseIntent(value) {
    const parsed = intentSchema.safeParse(value);
    if (parsed.success)
        return { ok: true, intent: parsed.data };
    const problems = parsed.error.issues
        .map((issue) => {
        const path = issue.path.length === 0 ? '(root)' : issue.path.join('.');
        return `${path}: ${issue.message}`;
    })
        .slice(0, 12);
    return {
        ok: false,
        reason: `the intent does not satisfy the schema — ${problems.join('; ')}. The offending values are ` +
            `deliberately not quoted: an intent is written by a model that reads the internet, and a ` +
            `refusal that echoed it would let that text choose what appears in the audit log.`,
    };
}
/**
 * sha256 of the intent's canonical encoding.
 *
 * Canonical means keys in sorted order at every depth, so the same intent hashes the same however
 * the container happened to serialise it. The hash is what the audit line commits to; two beats
 * that produced the same signature for different intents would otherwise be indistinguishable.
 */
export function intentHash(intent) {
    return createHash('sha256').update(canonicalJson(intent), 'utf8').digest('hex');
}
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
//# sourceMappingURL=intent.js.map