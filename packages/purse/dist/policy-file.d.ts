/**
 * The policy document, pinned by hash.
 *
 * # Changing the policy is a redeploy, not a reload
 *
 * There is no reload call on the socket and there is no file watcher here. The document is read
 * once, at start, and its sha256 must equal the digest passed on the command line — which comes
 * from the unit file, which is on disk under root and not writable by the purse's own user.
 *
 * The property that buys: a person who can write the policy file cannot widen the policy. They can
 * make the purse **refuse to start**, which is loud, recorded, and refuses everything rather than
 * permitting something. Widening needs the unit changed too, which needs root, and root's edit is
 * in the deploy record.
 *
 * # Two hashes, and they answer different questions
 *
 * `fileSha256` is over the bytes as they sit on disk. It is what the unit pins and what a person
 * can reproduce with `sha256sum`.
 *
 * `policyHash` is over `canonicalPolicyJson(doc)` — key order fixed, so reformatting the file does
 * not change it. It is what `policySigner` writes into every audit entry, and what makes a widening
 * visible at the exact entry where it took effect. Both go in the purse's own audit lines, because
 * a reader with only the canonical hash cannot check the file they were handed, and a reader with
 * only the file hash cannot line the purse's log up against the signer's.
 */
import { z } from 'zod';
import { type PolicyDoc } from '@projectx-social/policy';
import { type Outcome } from './outcome.js';
/**
 * The document's shape, checked rather than cast.
 *
 * `PolicyDoc` is an interface; `JSON.parse` produces `any`. Casting one to the other is how a
 * policy with `allowedTargets` misspelled becomes a policy with **no** allowed targets — which the
 * evaluator would read as an empty allow-list and refuse everything, so it fails closed, but the
 * operator would be told "move-call-target" for a document they believe permits the call. Checked
 * here, the answer is "your document has no allowedTargets", at start, once.
 */
export declare const policyDocSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    agentAddress: z.ZodString;
    outflowCeilings: z.ZodArray<z.ZodObject<{
        coinType: z.ZodString;
        maxPerPeriod: z.ZodString;
        periodMs: z.ZodNumber;
    }, z.core.$strict>>;
    allowedTargets: z.ZodArray<z.ZodString>;
    allowedTypeArguments: z.ZodArray<z.ZodString>;
    allowedRecipients: z.ZodArray<z.ZodString>;
    allowedObjects: z.ZodArray<z.ZodString>;
    maxGasBudgetMist: z.ZodString;
    allowedCommandKinds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export interface PinnedPolicy {
    readonly doc: PolicyDoc;
    /** sha256 of the file's bytes, hex. What the unit pins. */
    readonly fileSha256: string;
    /** sha256 of `canonicalPolicyJson(doc)`, hex. What the signer's audit entries carry. */
    readonly policyHash: string;
}
export declare function loadPinnedPolicy(args: {
    readonly path: string;
    readonly expectedSha256: string;
}): Promise<Outcome<PinnedPolicy>>;
//# sourceMappingURL=policy-file.d.ts.map