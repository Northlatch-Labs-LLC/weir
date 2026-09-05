/**
 * `heron-purse` — the process. One socket, one call, one key.
 *
 * Run it with `tsx src/server.ts --socket … --policy … --policy-sha256 … --chain … --audit …`.
 *
 * # The order of the checks at start is the design
 *
 *  1. Refuse if a key is in the environment or in argv. **Before anything else**, because a process
 *     started wrongly must die at its first instruction rather than after it has created a socket
 *     other things can connect to.
 *  2. Load the policy and check its pin. A purse whose policy does not match what the unit pinned
 *     never holds a key.
 *  3. Load the key.
 *  4. Open the audit chain and the spend ledger. A broken chain refuses to start; see
 *     `audit-file.ts` for why appending past a break is worse than stopping.
 *  5. Only then bind the socket, and only then tell systemd it is ready.
 *
 * # `Type=notify`
 *
 * The unit is `Type=notify` so `heron-beat.service`'s `After=` actually means the socket exists.
 * `Type=simple` would have systemd consider the purse started the instant it forked, and the first
 * beat after a reboot would race the bind and fail with `ENOENT` on a socket that appears a second
 * later. The notification is one datagram on `$NOTIFY_SOCKET`, which is the whole of the protocol
 * this needs; there is no library dependency for it.
 *
 * # What is never logged
 *
 * The key, obviously. Also: the intent's contents, and the value of anything that failed to parse.
 * The log lines are `purse: <kind> <outcome> <rule|digest> seq=<n>` and the startup line, which
 * carries the address, the two policy hashes and the socket path. An audit line has the reason in
 * full; the journal does not, because the journal goes places the audit file does not.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SimulationPort } from '@projectx-social/signer';
import type { GasPort } from './build.js';
import { type Purse } from './purse.js';
import { type Outcome } from './outcome.js';
export interface ServerArgs {
    readonly socket: string;
    readonly policy: string;
    readonly policySha256: string;
    readonly chain: string;
    readonly audit: string;
    readonly spend: string;
    readonly keyFile?: string | undefined;
}
/**
 * Parse argv.
 *
 * Written out rather than taken from a parser library for one reason: an unknown flag is a
 * refusal. A parser that ignores what it does not recognise turns `--policy-sha-256` (a typo) into
 * a purse running with no pin, and the typo is invisible in the unit file.
 */
export declare function parseServerArgs(argv: readonly string[]): Outcome<ServerArgs>;
export interface RunningPurse {
    readonly purse: Purse;
    readonly socketPath: string;
    readonly stop: () => Promise<void>;
}
/**
 * Start the purse and listen.
 *
 * Exported so the socket tests drive the real server rather than a stand-in. A test that exercised
 * a different code path from the unit would prove nothing about the unit.
 */
export declare function startPurse(args: {
    readonly server: ServerArgs;
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly log?: ((line: string) => void) | undefined;
    /**
     * Supplied by the socket test with a recorded response and a pinned gas coin, so the whole
     * server — argv, pin, key, socket, framing, purse, audit chain — runs with no network.
     *
     * The same seam `PolicySigner` offers for the same reason, and used the same way: a test that
     * drove a different code path from the unit would prove nothing about the unit. Nothing in the
     * product path passes it; the entry point below does not.
     */
    readonly recorded?: {
        readonly simulation: SimulationPort;
        readonly gas: GasPort;
        readonly client: SuiGrpcClient;
    } | undefined;
}): Promise<Outcome<RunningPurse>>;
//# sourceMappingURL=server.d.ts.map