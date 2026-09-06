// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
 * A ceiling on how much of one coin type may leave the agent's address in a rolling window.
 *
 * # Rolling, not calendar
 *
 * The window is `[nowMs - periodMs, nowMs]` and it moves with every evaluation. A calendar period
 * — "per day", resetting at midnight — has a boundary an attacker can wait for and then spend two
 * full allowances back to back across it. A rolling window has no such moment.
 */
export interface OutflowCeiling {
  /** Fully-qualified coin type. Normalised at comparison time, so `0x2::sui::SUI` is fine here. */
  readonly coinType: string;
  /** Unsigned decimal string, in the coin's smallest unit. Never a `number`; see `amounts.ts`. */
  readonly maxPerPeriod: string;
  /** Window width in milliseconds. Must be a positive integer. */
  readonly periodMs: number;
}

/**
 * The amount of one coin type that may leave in a window **before the operator has to be asked**.
 *
 * # This is a second bar under the ceiling, not a second ceiling
 *
 * {@link OutflowCeiling} answers "may this ever happen?". A threshold answers a different
 * question — "may this happen *unattended*?" — and it is the only place in this package where the
 * answer to a refusal is a person rather than an edit to the policy document. Above the bar the
 * agent is not forbidden; it is required to carry an approval the operator granted, which arrives
 * on {@link LedgerState.approvals} the same way prior spend does.
 *
 * # The window is the ceiling's window, and there is no second one to configure
 *
 * A threshold is compared against the **same rolling total** the ceiling for that coin type is
 * compared against, over that ceiling's `periodMs`. That is why there is no `periodMs` here.
 *
 * Two windows would be two chances to get a window wrong, and the failure would be silent: a
 * threshold with a shorter window than its ceiling is a bar an agent walks under once per short
 * window, which is a per-transaction limit wearing a rolling window's clothes and is defeated by
 * exactly the loop this package's ceilings exist to stop. Borrowing the ceiling's window means an
 * approval cannot be replayed either — the total it was granted against keeps climbing.
 *
 * A threshold naming a coin type with no ceiling is refused rather than ignored: there is no
 * window to measure it over, and a bar that cannot be measured is a bar that never fires.
 */
export interface ApprovalThreshold {
  /** Fully-qualified coin type. Normalised at comparison time, so `0x2::sui::SUI` is fine here. */
  readonly coinType: string;
  /**
   * Unsigned decimal string, in the coin's smallest unit. A windowed total **above** this — not
   * equal to it — requires a live approval. Equal is still unattended, so a bar of `0` means
   * every non-zero outflow of this coin type must be approved.
   */
  readonly maxWithoutApproval: string;
}

export interface PolicyDoc {
  /**
   * Schema version. Only `1` is understood.
   *
   * Checked by a rule rather than by the type system alone, because a policy document arrives as
   * JSON from disk or from an operator and TypeScript is not present at that moment. A future
   * version 2 that this evaluator silently read as version 1 would apply half a policy — the
   * fields it recognised — and ignore the rest, which is the worst possible reading of a document
   * whose whole purpose is to restrict.
   */
  readonly version: 1;
  /** The address this policy governs. A simulation with any other sender is refused. */
  readonly agentAddress: string;
  /** Per-coin-type spending ceilings. A coin type absent from this list may not leave at all. */
  readonly outflowCeilings: readonly OutflowCeiling[];
  /** `address::module::function` entries. Any other Move call is refused. */
  readonly allowedTargets: readonly string[];
  /** Type arguments any allowed call may be instantiated with. */
  readonly allowedTypeArguments: readonly string[];
  /** Addresses `TransferObjects` may send to. Usually just the agent's own address. */
  readonly allowedRecipients: readonly string[];
  /**
   * Object ids any command may take as an input. Any other object is refused.
   *
   * # What goes in here, concretely
   *
   * Every object `creator::unlock` needs, and nothing else. For an agent buying content that is:
   *
   *  - **the vault ids it may buy from** — one per creator the principal has authorised. This is
   *    the entry that matters; the other three are fixed infrastructure.
   *  - **the `Platform`** — `0x3f695b2c…50f36` on mainnet, shared, passed as `&Platform`.
   *  - **the `Clock`** — `0x6`, shared, passed as `&Clock`.
   *  - **the agent's own `SocialAccount`** — owned, and its id is stable because
   *    `account.move:174` transfers it with `key` and no `store`, so it can never move.
   *
   * A list of four to six ids, written once. That is the whole cost.
   *
   * # The honest limitation, so nobody discovers it at three in the morning
   *
   * Object ids of *coins* are not stable — a `Coin<SUI>` is consumed and recreated by every split
   * and merge, so its id changes between transactions and cannot be enumerated in advance. An
   * agent that pays from a discrete owned coin object will therefore be refused here, every time,
   * naming an id that was never in the list and never could be.
   *
   * That is not a defect to work around by loosening the rule. It is a reason to build the
   * payment the way the tested path already builds it: `SplitCoins` on the gas coin, whose result
   * is a **command result** rather than an input and so is never an object input at all. The
   * baseline fixture in `test/fixtures.ts` is exactly that shape, taken from a live mainnet
   * simulation.
   */
  readonly allowedObjects: readonly string[];
  /**
   * Per-coin-type bars above which the operator must have approved. Absent means none configured.
   *
   * # Why this one field may be absent, when absence is refusal everywhere else in this document
   *
   * Every other list here **grants**: a target not in `allowedTargets` is refused, an object not in
   * `allowedObjects` is refused, a coin type with no ceiling may not leave at all. Absence there is
   * authority nobody gave, so absence is a refusal and that reading is the strict one.
   *
   * A threshold grants nothing. It **subdivides authority the operator already wrote down** into
   * "sign it" and "ask me first", and everything it governs was already inside a ceiling, an
   * allow-list and a gas bound before it was written. So the strict reading here points the other
   * way: a document with no thresholds is a document whose author chose to be asked about nothing,
   * and the bounds that refuse are all still in force. Reading an absent list as "ask me about
   * everything" would refuse every transaction of every policy written before this field existed —
   * which is not a stricter policy engine, it is an outage, and an outage is switched off within a
   * day.
   *
   * The field is optional in the type for the same reason `policy-version` is enforced by a rule:
   * a policy document arrives as JSON from disk or from an operator, TypeScript is not present at
   * that moment, and every document written before this field existed genuinely lacks it.
   *
   * `| undefined` is written out rather than left to `?` because this repository compiles under
   * `exactOptionalPropertyTypes`, where the two are different types: `?` alone accepts a document
   * with no such key and REFUSES one that carries the key holding `undefined`. A document parsed
   * from JSON by a schema that marks the field optional produces exactly the second shape, so
   * without this the field would typecheck everywhere except where policies are actually read.
   */
  readonly approvalThresholds?: readonly ApprovalThreshold[] | undefined;
  /** Ceiling on the gas budget, in MIST, as an unsigned decimal string. */
  readonly maxGasBudgetMist: string;
  /** Command kinds permitted at all. Anything else is refused unread. */
  readonly allowedCommandKinds: readonly string[];
}

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
 * `approvalThresholds` was added the same way and moves every hash again, and the same reading
 * applies: an audit entry written before it references a document under which nothing was ever
 * held back for the operator to see. A reviewer should be shown that, not shielded from it.
 *
 * # This does not hash
 *
 * There is no `sha256` here and there will not be, because a cryptographic hash means either a
 * dependency or `node:crypto`, and this package has neither. It emits the bytes; the caller — in
 * practice `@projectx-social/signer` — hashes them. Splitting it that way is also what lets the
 * evaluator run in a browser.
 */
export function canonicalPolicyJson(doc: PolicyDoc): string {
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
    // `null` when absent and an array when present, for the reason given above `allowedObjects`:
    // a document that configures no approval bar and a document written before bars existed are
    // the same policy in force and DIFFERENT documents, and the second is the one whose author
    // never considered the question. `[]` is emitted for a document that thought about it and
    // configured none. Encoding them alike would make an operator's decision indistinguishable
    // from an operator's absence, in the record that exists to show which policy made a decision.
    approvalThresholds: Array.isArray(doc.approvalThresholds)
      ? doc.approvalThresholds.map((t) => ({
          coinType: t.coinType,
          maxWithoutApproval: t.maxWithoutApproval,
        }))
      : null,
    maxGasBudgetMist: doc.maxGasBudgetMist,
    outflowCeilings: ceilings,
  });
}
