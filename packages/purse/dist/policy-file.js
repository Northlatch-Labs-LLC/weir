// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalPolicyJson } from '@projectx-social/policy';
import { allow, refuse } from './outcome.js';
const u64 = z.string().regex(/^(0|[1-9][0-9]{0,19})$/, 'not a u64 written as a decimal string');
/**
 * The document's shape, checked rather than cast.
 *
 * `PolicyDoc` is an interface; `JSON.parse` produces `any`. Casting one to the other is how a
 * policy with `allowedTargets` misspelled becomes a policy with **no** allowed targets — which the
 * evaluator would read as an empty allow-list and refuse everything, so it fails closed, but the
 * operator would be told "move-call-target" for a document they believe permits the call. Checked
 * here, the answer is "your document has no allowedTargets", at start, once.
 */
export const policyDocSchema = z.strictObject({
    version: z.literal(1),
    agentAddress: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'not a Sui address'),
    outflowCeilings: z.array(z.strictObject({ coinType: z.string().min(1), maxPerPeriod: u64, periodMs: z.number().int().positive() })),
    allowedTargets: z.array(z.string().min(1)),
    allowedTypeArguments: z.array(z.string().min(1)),
    allowedRecipients: z.array(z.string().min(1)),
    allowedObjects: z.array(z.string().min(1)),
    maxGasBudgetMist: u64,
    allowedCommandKinds: z.array(z.string().min(1)),
});
export async function loadPinnedPolicy(args) {
    if (!/^[0-9a-f]{64}$/.test(args.expectedSha256)) {
        return refuse('request-malformed', `--policy-sha256 must be 64 lowercase hex characters; it is not. The purse will not start ` +
            `without a pin: an unpinned policy is a policy anyone who can write the file can widen.`);
    }
    let bytes;
    try {
        bytes = await readFile(args.path);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return refuse('request-malformed', `the policy document at ${args.path} could not be read: ${detail}`);
    }
    const fileSha256 = createHash('sha256').update(bytes).digest('hex');
    if (fileSha256 !== args.expectedSha256) {
        return refuse('request-malformed', `the policy document at ${args.path} hashes to ${fileSha256}, and the unit pins ` +
            `${args.expectedSha256}. The purse refuses to start. Either the document was edited without ` +
            `the pin being updated — which is the case this check exists for — or a redeploy was left ` +
            `half done. Changing the policy is a redeploy, not a reload.`);
    }
    let value;
    try {
        value = JSON.parse(bytes.toString('utf8'));
    }
    catch {
        return refuse('request-malformed', `the policy document at ${args.path} is not valid JSON.`);
    }
    const parsed = policyDocSchema.safeParse(value);
    if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        return refuse('request-malformed', `the policy document at ${args.path} is not a policy: ${problems.join('; ')}.`);
    }
    const doc = parsed.data;
    return allow({ doc, fileSha256, policyHash: createHash('sha256').update(canonicalPolicyJson(doc), 'utf8').digest('hex') });
}
//# sourceMappingURL=policy-file.js.map