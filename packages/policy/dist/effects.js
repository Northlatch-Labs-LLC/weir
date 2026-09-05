// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * What a simulation observed, in the only shape this evaluator will look at.
 *
 * # Why this package defines the shape instead of importing the node's
 *
 * `@projectx-social/policy` has no dependencies, so it cannot import `@mysten/sui`'s
 * `SimulateTransactionResult`. That is deliberate and it buys something: the evaluator is
 * insulated from a client-library rename. The SDK has already been bitten once by exactly that —
 * `packages/sdk/src/client.ts` carries a long comment about `transaction.effects.status` silently
 * becoming `Transaction.status`, which made every simulation report failure for weeks. A rename
 * on that boundary must break a **translation** in one file, loudly, rather than quietly empty an
 * array the ceiling rules iterate over.
 *
 * The translation lives in `@projectx-social/signer` (`src/evidence.ts`) and is tested against
 * shapes captured from a live mainnet simulation.
 *
 * # Absence and emptiness are different, and the type says so
 *
 * `balanceChanges: []` means the node was asked for balance changes and reported none. It does
 * **not** mean the node was not asked. Those two states must never share a representation, because
 * one is "this transaction moves no money" and the other is "we do not know what this transaction
 * moves", and only the first is safe to sign against a spending ceiling.
 *
 * So `balanceChangesObserved` is a required, separate boolean, and rule `balance-evidence` denies
 * whenever it is false. A caller cannot forget it: leaving it out is a type error.
 */
export {};
//# sourceMappingURL=effects.js.map