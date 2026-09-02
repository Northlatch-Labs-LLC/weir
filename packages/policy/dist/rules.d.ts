/**
 * The rules, one function each, in a table.
 *
 * # Why a table and not a single `evaluate` function full of `if`s
 *
 * A policy engine whose rules have never been shown to *do* anything is decoration, and it is
 * worse than no engine because it is trusted. The only proof that a rule works is that removing
 * it changes an outcome — so the rules are addressable, `evaluateWith` takes the list, and
 * `test/mutation.test.ts` deletes each rule in turn and asserts that a transaction the full set
 * refuses becomes one the reduced set permits.
 *
 * That test is not a nicety. It is the difference between twelve rules and twelve comments.
 *
 * # First denial wins, and the order is fixed
 *
 * Evaluation stops at the first rule that refuses. The order below is chosen so the earliest
 * refusals are the ones that make later rules meaningless: there is no point reporting a ceiling
 * breach on a document whose schema version we do not understand, or on a simulation belonging to
 * a different address entirely. A caller that wants every violation can call the rules directly;
 * the exported {@link RULES} array is the whole list, in order.
 *
 * # Every rule fails closed
 *
 * A rule that cannot decide — a malformed address, an unparseable amount, a name that does not
 * normalise — refuses. None of them return "pass" on input they did not understand. This is the
 * property that makes an unrecognised future command kind, a renamed field or a corrupted policy
 * file a refusal rather than a signature.
 */
import type { SimulatedEffects } from './effects.js';
import type { LedgerState } from './ledger.js';
import type { PolicyDoc } from './policy.js';
export type RuleId = 'policy-version' | 'sender-mismatch' | 'command-kind' | 'move-call-target' | 'type-argument' | 'transfer-recipient' | 'object-input' | 'gas-budget' | 'balance-evidence' | 'amount-wellformed' | 'coin-type-unlisted' | 'outflow-ceiling';
export interface RuleInput {
    readonly effects: SimulatedEffects;
    readonly policy: PolicyDoc;
    readonly ledger: LedgerState;
}
export interface Rule {
    readonly id: RuleId;
    /** One line, for the mutation table and for a reviewer reading the list rather than the code. */
    readonly summary: string;
    /**
     * Property-function syntax, not a method.
     *
     * `check(input: RuleInput): string | null` and `check: (input: RuleInput) => string | null`
     * differ in TypeScript: method parameters are compared **bivariantly** and property-function
     * parameters **contravariantly**. Under the method form a rule declared to take a narrower
     * input than `RuleInput` is accepted silently, and it then reads a field the caller never
     * promised. That exact hole let an under-specified implementation through on this branch once
     * already, which is why every interface member in these two packages is written this way.
     */
    readonly check: (input: RuleInput) => string | null;
}
/**
 * The rules, in evaluation order. First denial wins.
 *
 * Exported as the whole list so `evaluateWith` can be handed a subset — which is how the mutation
 * test deletes one rule at a time and proves the remaining ten no longer refuse what the eleven
 * did.
 */
export declare const RULES: readonly Rule[];
//# sourceMappingURL=rules.d.ts.map