import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
/** JSON-RPC ids are strings or numbers. Kept local so this module imports no SDK value. */
export type RequestId = string | number;
/**
 * How long a completed result is remembered.
 *
 * Twenty-four hours, matching `IDEMPOTENCY_TTL_MS` in `packages/web/lib/idempotency.ts`, and for
 * the reason that file gives: a machine's backoff is measured in minutes, and a ten-minute memory
 * expires underneath a retry that is still legitimately in progress — returning the caller to the
 * ambiguity this exists to remove, at the one moment it is hardest to notice.
 */
export declare const RESULT_TTL_MS: number;
/**
 * The most results held at once.
 *
 * A bound rather than a tuning knob. This ledger is keyed by values a caller chooses, so an
 * unbounded map is an unbounded allocation driven by the caller — which in a long-lived stdio
 * process is a slow memory leak with an agent's name on it. Five hundred and twelve spending calls
 * inside one TTL is far beyond any real session, and eviction is oldest-first so the entries lost
 * are the ones least likely to still be retried.
 */
export declare const MAX_ENTRIES = 512;
/** Everything the key is derived from. Every field participates; see the note above for each. */
export interface KeyInput {
    requestId: RequestId;
    tool: string;
    args: unknown;
    /** The signer's address. `null` in a deployment that cannot spend — where nothing calls this. */
    principal: string | null;
}
/**
 * The idempotency key for one tool call.
 *
 * Returned as hex rather than as the raw parts so that it is a fixed width, is safe to log, and
 * carries none of the arguments — a key printed in a diagnostic should not reveal which post an
 * agent was buying.
 *
 * The parts are joined with a NUL byte. `JSON.stringify` always escapes NUL as the six characters
 * \u0000, so it can never appear inside the canonicalised arguments, which makes the
 * concatenation unambiguous: no combination of tool name and arguments can be re-cut into a
 * different combination that hashes the same. Joining with a space, a colon or a slash would
 * leave exactly that ambiguity, because all three occur freely in the parts.
 */
export declare function idempotencyKeyFor(input: KeyInput): string;
/**
 * Run a spending call at most once per key.
 *
 * # Why the map holds a promise and not a finished result
 *
 * The dangerous retry is the *concurrent* one. A client whose call is still in flight when its
 * timeout fires sends the second attempt while the first transaction is still being simulated and
 * signed — so a ledger that only recorded finished calls would find nothing, let the second one
 * through, and produce the double-buy it exists to prevent. Recording the in-flight promise makes
 * the second caller **join** the first rather than race it, and both receive the one result.
 *
 * This is the same reasoning `claimIdempotencyKey` gives for claiming with an insert rather than a
 * lookup-then-insert: the window between checking and acting is not a smaller version of the
 * problem, it is the same problem rewritten as a race.
 *
 * # A failure is not remembered
 *
 * If the work rejects, the entry is dropped, so the next attempt runs for real. A retry after a
 * genuine failure is the behaviour the caller wants and the one thing this must not block — and a
 * rejection here means the agent layer refused before signing, or the transaction did not execute,
 * both of which are states a retry can legitimately improve.
 *
 * A *refusal* is different from a rejection and is deliberately remembered: a handler that returns
 * an `isError` result has completed, and returning the same refusal to a retry is correct.
 */
export declare class CallLedger {
    private readonly nowMs;
    private readonly entries;
    constructor(nowMs?: () => number);
    /** Entries currently held. For diagnostics and for the harness; not part of the tool surface. */
    get size(): number;
    once(key: string, work: () => Promise<CallToolResult>): Promise<CallToolResult>;
    /**
     * Drop what has aged out, then what is oldest if the map is still over its bound.
     *
     * # Work in flight is never evicted, by either rule
     *
     * `once` evicts BEFORE it looks the key up, and both rules used to delete by age and by
     * insertion order without asking whether the call had finished. An in-flight entry is the only
     * record that a spending call is already running — so evicting one deletes the guard itself, and
     * the concurrent retry that arrives next finds nothing, runs the work a second time, and
     * produces the double-buy this class exists to prevent. The ledger removed its own protection at
     * the exact moment it was under load.
     *
     * The capacity rule is the reachable one. `RESULT_TTL_MS` is twenty-four hours and no call is in
     * flight that long, but `MAX_ENTRIES` is 512 and the oldest entry under concurrent load is very
     * plausibly still running.
     *
     * # The bound yields to correctness, deliberately
     *
     * If every entry held is in flight, the loop stops and the map is allowed over its bound. That
     * bound exists to stop unbounded memory growth in a long-lived process; it does not exist to be
     * enforced against the one invariant this class has. Growth past it is self-limiting — the
     * entries settle and become evictable on the next call — while a double-buy is not.
     */
    private evict;
}
//# sourceMappingURL=idempotency.d.ts.map