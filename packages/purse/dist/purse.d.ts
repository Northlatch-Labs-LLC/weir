/**
 * The purse itself: one request in, one decision out, one audit line either way.
 *
 * # The order of the five steps is not this file's to change
 *
 * Build, observe, gate, evaluate, record-then-sign belong to `policySigner`, and its header
 * explains why step 5 must never be swapped. This file adds exactly one thing before them —
 * turning an intent into a transaction, because the model must never supply bytes — and exactly one
 * thing around them: a line in `audit.jsonl` on **every** path, including the paths that never
 * reach the signer at all.
 *
 * Those paths are the reason the purse keeps its own chain. A malformed request and an intent the
 * schema rejected produce no signer entry, because no transaction was ever built. They are also the
 * two lines that show somebody probing the socket, and a log that only records what got as far as
 * the evaluator would not have them.
 *
 * # Every way out of `handle` is a value
 *
 * There is no `throw` on any path, including the unexpected ones: the whole body is wrapped, and an
 * exception becomes a recorded refusal. The caller is an unattended beat. An exception three frames
 * up becomes a retry, and a retry against a policy denial is a loop hammering a wall — the sentence
 * is `policySigner`'s and the hazard is the same one at this boundary.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { PolicyDoc } from '@projectx-social/policy';
import { type Signer, type SimulationPort } from '@projectx-social/signer';
import { AuditFile } from './audit-file.js';
import { type GasPort } from './build.js';
import type { ChainConfig } from './chain.js';
import { SpendLedger } from './ledger-file.js';
import { type PurseResponse } from './protocol.js';
export interface PurseOptions {
    readonly signer: Signer;
    readonly policy: PolicyDoc;
    /** sha256 of `canonicalPolicyJson(policy)`. Recorded in every line. */
    readonly policyHash: string;
    /** sha256 of the policy file's bytes, as pinned by the unit. Recorded in every line. */
    readonly policyFileSha256: string;
    readonly chain: ChainConfig;
    readonly client: SuiGrpcClient;
    readonly audit: AuditFile;
    readonly ledger: SpendLedger;
    /** Defaults to {@link nodeGas}. A deployment with a pinned gas coin passes `fixedGas`. */
    readonly gas?: GasPort | undefined;
    /** Supplied by tests with a recorded response, exactly as `policySigner` allows. */
    readonly simulation?: SimulationPort | undefined;
    /** One line per decision. Defaults to stderr. Never called with key material. */
    readonly log?: ((line: string) => void) | undefined;
}
export interface Purse {
    /** The address every signature comes from. */
    readonly address: string;
    readonly policyHash: string;
    /** Answer one request. Never throws. */
    readonly handle: (request: unknown) => Promise<PurseResponse>;
    /** The head of the audit chain, for anchoring outside this host. */
    readonly auditHead: () => string;
}
export declare function createPurse(options: PurseOptions): Purse;
//# sourceMappingURL=purse.d.ts.map