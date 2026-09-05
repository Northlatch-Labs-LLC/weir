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
import { z } from 'zod';
export declare const sharedObjectRef: z.ZodObject<{
    objectId: z.ZodString;
    initialSharedVersion: z.ZodString;
    mutable: z.ZodBoolean;
}, z.core.$strict>;
export declare const ownedObjectRef: z.ZodObject<{
    objectId: z.ZodString;
    version: z.ZodString;
    digest: z.ZodString;
}, z.core.$strict>;
export type SharedObjectRef = z.infer<typeof sharedObjectRef>;
export type OwnedObjectRef = z.infer<typeof ownedObjectRef>;
export declare const postIntent: z.ZodObject<{
    kind: z.ZodLiteral<"post">;
    coinType: z.ZodString;
    vault: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    cap: z.ZodObject<{
        objectId: z.ZodString;
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    contentKey: z.ZodString;
    bodyDigestSha256: z.ZodString;
    priceMist: z.ZodString;
}, z.core.$strict>;
export declare const priceIntent: z.ZodObject<{
    kind: z.ZodLiteral<"price">;
    coinType: z.ZodString;
    vault: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    cap: z.ZodObject<{
        objectId: z.ZodString;
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    contentKey: z.ZodString;
    priceMist: z.ZodString;
}, z.core.$strict>;
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
export declare const settleEpochIntent: z.ZodObject<{
    kind: z.ZodLiteral<"settle_epoch">;
    packageId: z.ZodString;
    ledgerCap: z.ZodObject<{
        objectId: z.ZodString;
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    registry: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    soul: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    clock: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    vaultSui: z.ZodString;
    epochNetNonneg: z.ZodBoolean;
}, z.core.$strict>;
export declare const intentSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"post">;
    coinType: z.ZodString;
    vault: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    cap: z.ZodObject<{
        objectId: z.ZodString;
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    contentKey: z.ZodString;
    bodyDigestSha256: z.ZodString;
    priceMist: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"price">;
    coinType: z.ZodString;
    vault: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    cap: z.ZodObject<{
        objectId: z.ZodString;
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    contentKey: z.ZodString;
    priceMist: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"settle_epoch">;
    packageId: z.ZodString;
    ledgerCap: z.ZodObject<{
        objectId: z.ZodString;
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    registry: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    soul: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    clock: z.ZodObject<{
        objectId: z.ZodString;
        initialSharedVersion: z.ZodString;
        mutable: z.ZodBoolean;
    }, z.core.$strict>;
    vaultSui: z.ZodString;
    epochNetNonneg: z.ZodBoolean;
}, z.core.$strict>], "kind">;
export type Intent = z.infer<typeof intentSchema>;
export type IntentKind = Intent['kind'];
/**
 * Parse an unknown value as an intent, refusing as a value.
 *
 * The failure message names the paths that were wrong and nothing else. It does **not** quote the
 * offending value: an intent is written by a model that reads the internet, and a refusal that
 * echoes its input into a log is a way to write chosen text into the one file that is supposed to
 * be evidence.
 */
export declare function parseIntent(value: unknown): {
    ok: true;
    intent: Intent;
} | {
    ok: false;
    reason: string;
};
/**
 * sha256 of the intent's canonical encoding.
 *
 * Canonical means keys in sorted order at every depth, so the same intent hashes the same however
 * the container happened to serialise it. The hash is what the audit line commits to; two beats
 * that produced the same signature for different intents would otherwise be indistinguishable.
 */
export declare function intentHash(intent: Intent): string;
export declare function canonicalJson(value: unknown): string;
//# sourceMappingURL=intent.d.ts.map