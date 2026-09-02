/**
 * Turning what a node said into what the evaluator will look at.
 *
 * # This file is the one place a client-library rename may break, and it must break loudly
 *
 * `@projectx-social/policy` has no dependencies and defines its own `SimulatedEffects`. Everything
 * that knows the shape of `@mysten/sui`'s simulation response lives here. That is deliberate: the
 * SDK has already been bitten once by exactly this boundary — `packages/sdk/src/client.ts` carries
 * a long comment about `transaction.effects.status` silently becoming `Transaction.status`, which
 * made every simulation report failure for weeks while the daemon exited 0 looking healthy.
 *
 * Every shape below was **measured against mainnet on `@mysten/sui` 2.27.1 on 2026-08-31**, not
 * read from documentation. The four findings that a reasonable implementation would have got
 * wrong are marked FINDING and each one changed the code.
 *
 * # FINDING 1 — a failed simulation is not at `Transaction`, it is at `FailedTransaction`
 *
 * `@mysten/sui`'s gRPC parser ends with a two-line ternary (`src/grpc/core.ts:1597-1605`):
 *
 * ```ts
 * return status.success
 *   ? { $kind: 'Transaction',       Transaction: result }
 *   : { $kind: 'FailedTransaction', FailedTransaction: result };
 * ```
 *
 * On failure the `Transaction` key is **absent**. `packages/sdk/src/client.ts`'s `simulate()`
 * reads only `Transaction?.status` and the JSON-RPC fallback `transaction?.effects?.status`, so a
 * genuinely aborting transaction produces neither — and `simulate()` returns
 * `fail('malformed', …)` with the text *"This is a client/server shape mismatch, not a rejected
 * transaction."* For a real abort that sentence is exactly backwards.
 *
 * The SDK still fails **closed**, which is the property that matters and is why this is a
 * reporting defect rather than a spending one. But the decoded abort the operator needs is
 * unreachable through it. So this file reads `FailedTransaction` itself. `PolicySigner` runs this
 * reader **before** the SDK gate, so an abort is reported as an abort.
 *
 * # FINDING 2 — `TransferObjects.address` is an argument reference, not an address
 *
 * Measured live. A `TransferObjects` command's recipient came back as:
 *
 * ```json
 * "address": { "$kind": "Input", "Input": 1 }
 * ```
 *
 * and input 1 was `{ "$kind": "Pure", "Pure": { "bytes": "2nhLbCDFmV9rcZogom7d7l7Jccjs7IkOYci0Y03RcV0=" } }`
 * — **base64**, which decodes to the 32 raw address bytes. A translator that read `.address`
 * directly would hand the recipient rule an object; the rule would refuse it as "not an address",
 * every transfer would be denied, and the allow-list would look strict while testing nothing.
 * So the reference is resolved against the input list here. A recipient that is a command
 * *result* rather than an input cannot be known before execution, and is reported as an explicit
 * unresolved marker that no allow-list can match — refusing, by construction.
 *
 * # FINDING 3 — the digest is on the effects, not on the transaction
 *
 * `Transaction.digest` was `undefined` in every measurement. `effects.transactionDigest` carried
 * `2Wm1kXwYxPjkjVqT1rvHi9oqmvSZY3md6eirK8WheHbR`. The audit entry records the digest, so this
 * reader asks for `effects` and reads it from there. When it is genuinely absent the entry gets an
 * empty string rather than a fabricated one.
 *
 * # FINDING 4 — an object input is a two-level enum, and only the inner level names the shape
 *
 * Read from the installed package rather than from documentation:
 * `@mysten/sui` 2.27.1 `src/transactions/data/internal.ts:309-325` defines a transaction input as
 * `CallArgSchema`, a five-variant enum — `Object`, `Pure`, `UnresolvedPure`, `UnresolvedObject`,
 * `FundsWithdrawal` — and `Object` wraps a **second** enum, `ObjectArgSchema` (`:270-279`), whose
 * three variants are `ImmOrOwnedObject`, `SharedObject` and `Receiving`. So a shared object
 * arrives as:
 *
 * ```json
 * { "$kind": "Object",
 *   "Object": { "$kind": "SharedObject",
 *               "SharedObject": { "objectId": "0x…", "initialSharedVersion": "…", "mutable": true } } }
 * ```
 *
 * The object id is two levels down and under a key whose name changes with the variant. A reader
 * that looked for `input.objectId` finds nothing, and finding nothing is not an error here — it is
 * an input that quietly does not appear in the list. Rule `object-input` would then have nothing
 * to refuse and would report a clean pass on a transaction paying a stranger's vault.
 *
 * So every input this reader cannot reduce to one of those three variants is emitted as
 * `ownership: 'unclassified'`, which the rule refuses on sight. **Nothing is ever skipped for
 * being unreadable.** `Pure` and `UnresolvedPure` are the only two inputs that are legitimately
 * not objects, and they are the only two omitted.
 *
 * The same applies to a command argument pointing at an input index that does not exist — a
 * response whose `inputs` was not an array, or was shorter than the commands expect. That
 * reference is emitted as an unclassified input at the index it named, rather than resolving to
 * nothing.
 *
 * # Absence is never emptiness
 *
 * `include: { balanceChanges: true }` is passed unconditionally, and whether the response actually
 * carried the array is recorded in `balanceChangesObserved`. The policy rule `balance-evidence`
 * refuses when it is false. A node that stops returning the field must produce a refusal, never a
 * transaction that appears to move no money.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Transaction } from '@mysten/sui/transactions';
import { type DecodedAbort, type Reading } from '@projectx-social/sdk';
import type { SimulatedEffects } from '@projectx-social/policy';
/**
 * What one simulation observed: the verdict, and the effects the policy will judge.
 *
 * The verdict is carried alongside the effects rather than being a separate call, because they
 * must describe the *same* simulation. Two round trips can straddle a change in chain state, and a
 * policy decision made against effects from one observation and a verdict from another is a
 * decision about a transaction that never existed.
 */
export interface SimulationEvidence {
    readonly wouldSucceed: boolean;
    /** Raw status text, unmodified, whatever it was. */
    readonly status: string;
    /** Present only on failure. Decoded through the SDK's own `decodeAbort`. */
    readonly abort?: DecodedAbort;
    /** From `effects.transactionDigest`; empty string when the node reported none. See FINDING 3. */
    readonly txDigest: string;
    readonly effects: SimulatedEffects;
}
/**
 * The port `PolicySigner` simulates through.
 *
 * An interface rather than a direct call, so a test can supply a recorded mainnet response and
 * exercise the whole gate — build, verdict, policy, audit, sign — with no network. Property
 * functions, for the variance reason in `signer.ts`.
 */
export interface SimulationPort {
    readonly observe: (args: {
        readonly transactionBytes: Uint8Array;
        readonly sender: string;
    }) => Promise<Reading<SimulationEvidence>>;
}
/** The unresolvable-recipient marker. Deliberately not an address, so no allow-list can hold it. */
export declare const UNRESOLVED_RECIPIENT = "unresolved-at-build-time";
/**
 * A simulation port backed by a live gRPC client.
 *
 * `include` asks for all three of `balanceChanges`, `effects` and `transaction`, because each one
 * carries something a rule needs: the money, the digest, and the commands. Omitting any of them
 * does not weaken a rule — it makes the corresponding rule refuse.
 */
export declare function grpcSimulation(client: SuiGrpcClient): SimulationPort;
/**
 * Translate a simulation response. Exported so tests can feed it captured mainnet JSON.
 *
 * Every level is checked for being an object before it is indexed. Optional chaining guards
 * `undefined` and not `null`, and a node that answered `{"Transaction": null}` would otherwise
 * throw a `TypeError` inside a `try` and be reported as a transport fault — a permanent condition
 * wearing a transient's name, which is the reasoning `packages/sdk/src/client.ts` already records.
 */
export declare function readSimulation(response: unknown, sender: string): Reading<SimulationEvidence>;
/** Build a transaction to bytes, reporting a build-time abort as what it is. */
export declare function buildBytes(client: SuiGrpcClient, transaction: Transaction, sender: string): Promise<Reading<Uint8Array>>;
//# sourceMappingURL=evidence.d.ts.map