/**
 * What this agent has already spent, on disk.
 *
 * # Why this file exists rather than an empty ledger
 *
 * `policySigner` takes `ledger: () => LedgerState` and the `outflow-ceiling` rule reads it. Hand it
 * a function that always returns no prior spend and the ceiling stops being a rolling window: it
 * becomes a per-transaction size check, and an unattended loop defeats it by asking twice. The
 * rule's own text says so — "a window that is zero ... would apply to this transaction alone and a
 * loop would defeat it".
 *
 * The purse is the only process that can sign for this address, so it is the only place that can
 * know the spend. It records one line per **signed** transaction: the coin type, the outflow
 * magnitude, and when. A refusal spends nothing and writes nothing here.
 *
 * # Recorded from the simulation, not from the chain
 *
 * The amount comes from the effects the policy judged. That is deliberately conservative in the
 * one direction that matters: a transaction that was signed and then never landed still counts
 * against the window. The alternative — confirm on chain first — leaves a gap between signing and
 * confirmation in which a second beat sees no prior spend, and that gap is exactly when a loop
 * being steered would ask again. Over-counting costs a delayed post; under-counting costs the
 * ceiling.
 *
 * # Pruning
 *
 * Entries older than the longest period in the policy are dropped on load, not deleted eagerly:
 * the file is rewritten at open, once, so an unbounded log does not accumulate on a 10 GB disk.
 * The dropped entries are outside every window the policy can ask about, so nothing that could
 * change a decision is lost. The audit chain, which is the record of what happened, is never
 * pruned.
 */
import type { LedgerEntry, LedgerState, PolicyDoc, SimulatedEffects } from '@projectx-social/policy';
/** The outflows this transaction puts out, by coin type, as positive magnitudes. */
export declare function outflowsOf(effects: SimulatedEffects, agentAddress: string): LedgerEntry[];
/** The spend ledger, held open for appends. */
export declare class SpendLedger {
    #private;
    private constructor();
    /**
     * Open, keeping only what any ceiling in this policy could still ask about.
     *
     * A line that does not parse is **kept** rather than dropped, and it is kept in the form the
     * evaluator will refuse: `outflow-ceiling` returns a denial for a ledger entry it cannot read,
     * with the words "an unreadable record of past spending must not be counted as zero". Dropping
     * it here would turn that refusal into a silent zero, which is the whole hazard.
     */
    static open(args: {
        readonly path: string;
        readonly policy: PolicyDoc;
        readonly now?: () => number;
    }): Promise<{
        ok: true;
        ledger: SpendLedger;
    } | {
        ok: false;
        reason: string;
    }>;
    /** What `policySigner` calls before every evaluation. */
    state(): LedgerState;
    record(entries: readonly LedgerEntry[]): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=ledger-file.d.ts.map