/**
 * Asking the purse, over the unix socket.
 *
 * One connection, one request, one response, then the connection closes. No pipelining and no
 * keep-alive: the purse serves one agent whose beat fires every thirty minutes, so a connection
 * pool would buy nothing and would make "one request is being handled at a time" a property of the
 * server's bookkeeping rather than of the protocol.
 *
 * Every failure here is a value. The caller is the beat, and the beat's job on a failure is to
 * write `state/latest.json` and stop — not to retry against a socket that may be refusing on
 * purpose.
 */
import { type PurseResponse } from './protocol.js';
import { type Outcome } from './outcome.js';
export interface AskOptions {
    readonly socketPath: string;
    readonly intent: unknown;
    /** Milliseconds. The purse simulates against a fullnode, so this is a network timeout, not a local one. */
    readonly timeoutMs?: number;
}
export declare function askPurse(options: AskOptions): Promise<Outcome<PurseResponse>>;
//# sourceMappingURL=client.d.ts.map