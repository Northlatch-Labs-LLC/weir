/**
 * Intent to transaction. The model never supplies transaction bytes.
 *
 * # Why the purse builds and the container does not
 *
 * The container is the untrusted side: it runs a model that reads the internet. If it handed over
 * bytes, everything downstream — the simulation, the twelve rules, the audit line — would be
 * judging an artefact chosen by whatever text the model last read. The policy would still refuse
 * anything outside the allow-lists, but the *shape* of what is signed would be the attacker's, and
 * every unexamined corner of that shape (a second command appended after the one the policy looked
 * at; a pure input the evaluator has no rule for) would be theirs too.
 *
 * So the container sends a fact — "price this key at this much" — and this file decides what a
 * transaction expressing that fact looks like. There is exactly one shape per intent kind and it is
 * written here.
 *
 * # Gas
 *
 * `GasPort` exists because gas is the deployment's decision, not the model's and not this file's.
 * The default asks the node: it sets the budget from the policy document's own `maxGasBudgetMist`
 * — the ceiling the evaluator is going to check anyway, so the transaction is never built asking
 * for more than the policy would allow — and leaves price and coin selection to `Transaction.build`.
 *
 * A deployment that pins a gas coin passes {@link fixedGas}. That is not only a test seam: this
 * purse serves one agent with one address, and two beats that overlap (a slow node, a timer that
 * fired while the last beat was still running) would otherwise have the node select the same coin
 * twice and one of the two transactions would fail on an equivocated object. Pinning is the fix
 * where a deployment can afford to hold a dedicated gas coin.
 */
import { Transaction } from '@mysten/sui/transactions';
import type { PolicyDoc } from '@projectx-social/policy';
import type { ChainConfig } from './chain.js';
import { type Outcome } from './outcome.js';
import type { Intent } from './intent.js';
/** One fully-resolved gas coin. Same shape `Transaction.setGasPayment` takes. */
export interface GasCoinRef {
    readonly objectId: string;
    readonly version: string;
    readonly digest: string;
}
export interface GasPort {
    /** Called once on a freshly built transaction, before it is handed to the policy signer. */
    readonly apply: (tx: Transaction, policy: PolicyDoc) => void;
}
/**
 * The default: budget from the policy, everything else from the node at build time.
 *
 * The budget is taken from `maxGasBudgetMist` rather than from a constant here so that raising the
 * ceiling is a policy redeploy — visible in the audit chain's `policyHash` — and not an edit to
 * this file that no entry would record.
 */
export declare const nodeGas: GasPort;
/** A pinned gas coin and price. Nothing about the transaction then needs the network to assemble. */
export declare function fixedGas(args: {
    readonly price: bigint;
    readonly payment: readonly GasCoinRef[];
}): GasPort;
/**
 * Build the transaction an intent describes.
 *
 * # The registration-then-call pattern, and why it is not a trick
 *
 * `setContentPrice` from the SDK takes object **ids** and calls `tx.object(id)`, which would add an
 * `UnresolvedObject` input and make `build()` go to the chain. Registering the fully-resolved
 * references on the same transaction first means `tx.object(id)` finds them: `Transaction.object`
 * looks an input up by object id before adding one
 * (`@mysten/sui@2.27.1 src/transactions/Transaction.ts:394`, read on this branch).
 *
 * That is a documented behaviour of the library and not a coincidence, but it is quiet enough that
 * a refactor could lose it without anything failing loudly — the transaction would simply start
 * doing a chain read. `test/build.test.ts` asserts there is no `UnresolvedObject` input in the
 * result, which fails the moment it is lost.
 *
 * The alternative, writing the move call out here, would put a second copy of the `set_content_price`
 * argument order in the estate. When the contract's signature changes, one of the two copies is
 * updated and the other silently prices the wrong thing.
 */
export declare function buildIntent(args: {
    readonly intent: Intent;
    readonly chain: ChainConfig;
    readonly policy: PolicyDoc;
    readonly sender: string;
    readonly gas: GasPort;
}): Outcome<Transaction>;
//# sourceMappingURL=build.d.ts.map