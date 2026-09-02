// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The policy document: what an agent is permitted to do, written down.
 *
 * # Everything is an allow-list, and there is no wildcard
 *
 * There is no `"*"`, no `allowAll`, and no way to express "any target" or "any recipient". That is
 * the single most important decision in this file and it is worth the inconvenience it causes.
 *
 * The scenario this package exists for is an agent choosing what to buy from text somebody else
 * wrote. Prompt injection does not need a new capability — it only needs one the operator left
 * open because narrowing it was tedious. A deny-list asks the author to enumerate the attacks; an
 * allow-list asks them to enumerate the job. Only one of those is a list the author can finish.
 *
 * The concrete case on this protocol: an agent authorised to *buy* must not be able to call
 * `creator::claim_earnings`. Both live in the same module of the same package, both are `public
 * fun`, and both are reachable by any address holding the right object. Nothing on chain
 * distinguishes them. `allowedTargets` is where that distinction is made, and a wildcard would
 * erase it in one character.
 *
 * # The document is data, and it is hashed
 *
 * A `PolicyDoc` is plain JSON-shaped data with no functions and no classes, so it can be written
 * by an operator, transmitted, stored, and — through {@link canonicalPolicyJson} — hashed into
 * every audit entry. An audit trail that recorded a decision without recording *which policy made
 * it* proves nothing: the policy could have been widened afterwards and every past entry would
 * still read "allow". The hash is what makes the trail evidence rather than a log.
 */
/**
 * A deterministic JSON encoding of a policy document, for hashing.
 *
 * # Why this is not `JSON.stringify(doc)`
 *
 * `JSON.stringify` preserves **insertion order** of object keys. Two policy documents with
 * identical content, one written by hand and one round-tripped through a parser that reordered
 * fields, produce different strings and therefore different hashes. Every audit entry made before
 * the reordering would then appear to reference a different policy than every entry made after,
 * and a reviewer would be hunting a change that never happened.
 *
 * So keys are emitted in a fixed order that this function owns, arrays keep their order because in
 * a policy an array's order is content, and no field is omitted even when empty — an absent
 * `allowedRecipients` and an empty one must not hash alike, since one is a document that forgot
 * the field and the other is a document that forbids all transfers.
 *
 * The same applies to `allowedObjects`, and more sharply: an empty one forbids every object input,
 * which refuses every `creator::unlock` there is, while an absent one is a document written before
 * this evaluator bounded objects at all — a document that could pay any vault on the platform.
 * Those two must never produce the same bytes, so the key is emitted unconditionally.
 *
 * # Adding a key changes every hash, and that is the correct outcome
 *
 * Inserting `allowedObjects` moves the hash of every policy document that existed before it, so
 * audit entries written earlier reference a hash no current document reproduces. That is not
 * drift to be papered over: those documents genuinely did not bound which vault got paid, and a
 * reviewer comparing an old entry to a new one **should** see a different policy, because it is
 * one.
 *
 * # This does not hash
 *
 * There is no `sha256` here and there will not be, because a cryptographic hash means either a
 * dependency or `node:crypto`, and this package has neither. It emits the bytes; the caller — in
 * practice `@projectx-social/signer` — hashes them. Splitting it that way is also what lets the
 * evaluator run in a browser.
 */
export function canonicalPolicyJson(doc) {
    const ceilings = doc.outflowCeilings.map((c) => ({
        coinType: c.coinType,
        maxPerPeriod: c.maxPerPeriod,
        periodMs: c.periodMs,
    }));
    return JSON.stringify({
        version: doc.version,
        agentAddress: doc.agentAddress,
        allowedCommandKinds: [...doc.allowedCommandKinds],
        // Not `[...doc.allowedObjects]`, and this is the one field encoded defensively.
        //
        // `allowedObjects` is the only key in this document that a real, previously-valid policy file
        // can lack: every document written before this evaluator bounded object inputs has no such
        // key, and a policy arrives as JSON from disk or from an operator, where TypeScript is not
        // present — the same reason `policy-version` is enforced by a rule rather than by the type.
        // Spreading `undefined` would throw, and a hash function that throws cannot record the
        // document that caused it.
        //
        // `null` is emitted rather than `[]` because the distinction is the whole point of the
        // paragraph above: `[]` is a document that permits no object at all, `null` is a document that
        // never bounded objects and could pay any vault on the platform. They are different policies
        // and they must not produce the same bytes. The other five keys get no such treatment because
        // no document this evaluator has ever accepted could be missing one.
        allowedObjects: Array.isArray(doc.allowedObjects) ? [...doc.allowedObjects] : null,
        allowedRecipients: [...doc.allowedRecipients],
        allowedTargets: [...doc.allowedTargets],
        allowedTypeArguments: [...doc.allowedTypeArguments],
        maxGasBudgetMist: doc.maxGasBudgetMist,
        outflowCeilings: ceilings,
    });
}
//# sourceMappingURL=policy.js.map