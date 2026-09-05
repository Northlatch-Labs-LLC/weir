/**
 * Phase two of the beat: outside the container, with the state sink written on every path.
 *
 * # The two phases, and what the split buys
 *
 * Phase one runs the container. It reads and writes exactly one file: `<runs>/<beat-id>/intent.json`.
 * It has no key, no socket that reaches a key, and no way to produce transaction bytes.
 *
 * Phase two is this file. It reads that intent, validates it against the same schema the purse
 * uses, asks the purse, and submits what comes back. A prompt-injected model can therefore write a
 * bad intent and nothing else — the CISO's §2, in his words.
 *
 * The schema is checked **twice**, here and in the purse, and that is not redundancy to delete. The
 * purse's copy is the authority: it is the one that runs next to the key. This copy exists so that
 * a malformed intent is refused before it is put on a socket at all, which keeps the purse's audit
 * chain a record of decisions rather than of the beat's own bugs, and gives the state file a rule
 * id for a failure that never left this host.
 *
 * # `state/latest.json` is written on every path
 *
 * Signed, refused, no intent at all, and an exception. That is the whole point of the file: a sink
 * that only records success cannot detect failure. The `finally` below is the mechanism and
 * `test/beat.test.ts` asserts it on a forced refusal and on a thrown submit.
 */
import type { PurseResponse } from './protocol.js';
import { type BeatState } from './state.js';
import type { Outcome } from './outcome.js';
/** How the intent reaches the purse. The socket client in production; a direct purse in tests. */
export interface AskPort {
    readonly ask: (intent: unknown) => Promise<Outcome<PurseResponse>>;
}
/** How a signed transaction reaches the chain. Absent under `--dry-run`. */
export interface SubmitPort {
    readonly submit: (args: {
        readonly txBytesB64: string;
        readonly signature: string;
    }) => Promise<string>;
}
export interface PhaseTwoOptions {
    readonly runsDir: string;
    readonly stateDir: string;
    readonly beatId: string;
    readonly ask: AskPort;
    /** Omitted, or `--dry-run`: nothing is submitted and the outcome is still `signed`. */
    readonly submit?: SubmitPort | undefined;
    readonly now?: (() => Date) | undefined;
}
export interface PhaseTwoResult {
    readonly state: BeatState;
    readonly statePath: string;
}
export declare const INTENT_FILE = "intent.json";
/**
 * Run phase two.
 *
 * Never throws. The one thing this function guarantees is that `state/latest.json` exists and
 * describes what happened when it returns — so the return value is the state, and the caller's only
 * job is to turn it into an exit code.
 */
export declare function runPhaseTwo(options: PhaseTwoOptions): Promise<PhaseTwoResult>;
//# sourceMappingURL=beat.d.ts.map