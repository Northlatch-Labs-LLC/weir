// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The signing interface. **This is the only shape in the repository that produces a signature.**
 *
 * # Why a custody boundary exists at all, stated plainly
 *
 * `sui-contracts/sources/account.move` declares `public struct SocialAccount has key` — `key`
 * only, no `store` — and the module's own header says only that module can move one and offers no
 * function that does. `Subscription` and `Unlock` in `entitlement.move` are the same. **A weir
 * account is soulbound and cannot be transferred.**
 *
 * The consequence is the reason this package exists: **a leaked agent key is unrecoverable.**
 * There is no rotation. The handle is lost, and every entitlement ever bought with it is lost,
 * because none of them can move to a new address. This desk previously wrote that an agent has
 * "no long-lived credential, nothing to leak"; that was false. The Ed25519 private key **is** the
 * long-lived credential. Per-request signatures stop replay; they do nothing whatsoever about key
 * theft.
 *
 * Custody tiers are therefore damage limitation, not a fix, and `README.md` says so in those words.
 *
 * # Property-function syntax, on every member, without exception
 *
 * `signTransaction: (bytes: Uint8Array) => Promise<…>` — not `signTransaction(bytes): Promise<…>`.
 *
 * TypeScript compares **method** parameters bivariantly and **property-function** parameters
 * contravariantly. Under the method form, an implementation whose parameter is narrower than the
 * interface promises is accepted silently; it then receives values it never agreed to handle. On
 * this branch that hole already let an under-specified implementation through once. Every member
 * of every interface in this package and in `@projectx-social/policy` is written as a property
 * function, and `test/variance.test.ts` pins the behaviour so a future edit back to the method
 * form fails a test rather than passing review.
 *
 * # Nothing here throws for an expected outcome
 *
 * Every signing call returns a `Reading`. A signer that is not configured, a member key that is
 * absent, a below-threshold multisig — all of these are ordinary, expected conditions in an
 * unattended process, and a thrown exception in an agent loop is caught by something generic
 * three frames up and turned into a retry. `Reading` makes the refusal a value the caller must
 * look at.
 */
export {};
//# sourceMappingURL=signer.js.map