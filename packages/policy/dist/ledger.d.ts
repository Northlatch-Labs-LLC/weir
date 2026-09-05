/**
 * What the agent has already spent, and what the operator has already approved.
 *
 * Both are records the caller keeps and hands in; neither is read or remembered here. They sit in
 * one type because they are answers to the same question at two bars — how much has gone out in
 * this window, and how much of it the operator said yes to.
 *
 * # A ceiling without a memory is not a ceiling
 *
 * A per-transaction limit stops one large payment and does nothing at all about a thousand small
 * ones. An agent driven by text somebody else wrote is not limited to a single attempt, and the
 * cheapest attack on a per-transaction cap is a loop. So the ceilings in this package are
 * *cumulative over a window*, which means an evaluation needs to know what came before it.
 *
 * # This package does not remember anything, and that is on purpose
 *
 * `LedgerState` is an **input**. This package performs no I/O, holds no state between calls and
 * reads no clock — `nowMs` is passed in. Three things follow, and each is worth the awkwardness:
 *
 *  1. An evaluation is a pure function of its arguments, so a decision recorded in an audit trail
 *     can be replayed years later and must reach the same verdict. A rule that read
 *     `Date.now()` internally could not be replayed at all.
 *  2. Where spend is persisted — a file, Postgres, a Sui object — is a decision with consequences
 *     this package cannot see. A library that picked one would have picked it for every
 *     deployment that ever used it.
 *  3. Tests set time exactly, so window-boundary behaviour is asserted rather than hoped for.
 *
 * # The honest limitation, stated here rather than in a release note
 *
 * The ledger is only as good as the caller's record-keeping. If a caller signs a transaction and
 * fails to record the spend, the next evaluation sees a smaller total and permits more than the
 * ceiling. **The chain-level bound described in `README.md` — funding the input coin at the
 * ceiling so `creator::take_price` physically cannot take more — does not depend on this ledger
 * and does not fail with it.** That is the whole reason there are two bounds and why they must
 * stay independent.
 */
/** One recorded outflow. Written by the caller after a signature is produced. */
export interface LedgerEntry {
    /** Fully-qualified coin type. Normalised at comparison time. */
    readonly coinType: string;
    /** Positive magnitude of what left the agent, as an unsigned decimal string. */
    readonly amountOut: string;
    /** When it left, in epoch milliseconds. */
    readonly atMs: number;
}
/**
 * One approval the operator granted, already authenticated by whoever is passing it in.
 *
 * # What this package can check, and the one thing it cannot
 *
 * It checks scope: the coin type, the amount covered, and whether the grant is still live at
 * `nowMs`. It **cannot check that the operator granted it**, because verifying a signature means
 * a cryptographic dependency and this package has none — that is the property that makes it the
 * last thing that says no, and it is not being traded for this.
 *
 * So an approval is a fact the caller asserts, exactly as a ledger entry is. `@projectx-social/signer`
 * is the caller that matters and it is where the operator's signature is verified; a caller that
 * passes an approval it did not authenticate has not been permitted anything by this package — it
 * has lied to it, in the same way a caller that signs and forgets to record the spend has.
 *
 * # An approval is not a coupon, and cannot be replayed
 *
 * There is no "uses" count here and none is needed. An approval is compared against the same
 * cumulative windowed total the ceiling is compared against, so approving 5 SUI approves 5 SUI in
 * that window and not one transaction of 5 SUI, repeatable. A per-transaction approval would be
 * defeated by the same loop a per-transaction ceiling is.
 */
export interface OperatorApproval {
    /** Fully-qualified coin type. Normalised at comparison time. */
    readonly coinType: string;
    /**
     * The windowed total this approval covers, as an unsigned decimal string in the smallest unit.
     *
     * Compared against **prior spend plus this transaction**, not against this transaction alone.
     */
    readonly maxAmount: string;
    /**
     * When the grant stops being live, in epoch milliseconds. Exclusive: at exactly this instant it
     * is expired.
     *
     * The ceiling's window is inclusive at both ends and this bound is exclusive, which is not an
     * inconsistency — both are the strict edge of what they do. The window is a bound that
     * *refuses*, so including the boundary closes a one-millisecond hole a loop could be timed
     * against. An approval *permits*, so excluding the boundary closes the same millisecond from the
     * other side.
     */
    readonly expiresAtMs: number;
}
export interface LedgerState {
    /**
     * The current time, supplied by the caller.
     *
     * An input rather than a read, so an evaluation is reproducible. See this file's header.
     */
    readonly nowMs: number;
    /**
     * Approvals the operator has granted and the caller has authenticated. Absent means none.
     *
     * Absence here is read strictly — an approval nobody passed is an approval nobody granted — and
     * it is the opposite reading to `PolicyDoc.approvalThresholds`, whose absence means no bar was
     * configured. The two are opposite because one is authority and the other is a bar on authority:
     * an ungranted approval must never permit, and an unconfigured bar must never refuse a policy
     * written before bars existed.
     */
    readonly approvals?: readonly OperatorApproval[];
    /**
     * Prior outflows. Order does not matter; entries outside every window are simply ignored.
     *
     * A caller may prune old entries freely — anything older than the widest configured period can
     * no longer affect a decision.
     */
    readonly spend: readonly LedgerEntry[];
}
/** An empty ledger. Named, so a test or a first run says what it means. */
export declare const EMPTY_LEDGER: LedgerState;
//# sourceMappingURL=ledger.d.ts.map