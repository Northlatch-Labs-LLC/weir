// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `@projectx-social/purse` — the one process on Heron's host that holds the hot key.
 *
 * Heron's address is a **1-of-2 multisig** (the Master's ruling, 2026-09-05): the hot key signs
 * alone behind the policy, and the second member is the brake, held by his hand and never on this
 * laptop or on the host. So there is no co-signing purse and there is no second host. The bound on
 * a leaked hot key is one epoch's allowance until it is swept, and that cost was accepted on the
 * page rather than engineered away.
 *
 * Everything that makes that acceptable lives here: the container never holds a key and never
 * produces bytes; the purse builds the transaction from a typed intent; `policySigner` runs its
 * five steps; every decision, including the refusals that never reached the signer, lands in a
 * hash-chained file.
 */
export { AuditFile, GENESIS_HASH, entryPreimage, hashEntry, readAuditFile, verifyAuditLines, } from './audit-file.js';
export { buildIntent, fixedGas, nodeGas } from './build.js';
export { chainConfigSchema, loadChainConfig } from './chain.js';
export { askPurse } from './client.js';
export { INTENT_FILE, runPhaseTwo, } from './beat.js';
export { canonicalJson, intentHash, intentSchema, ownedObjectRef, parseIntent, postIntent, priceIntent, settleEpochIntent, sharedObjectRef, } from './intent.js';
export { CREDENTIAL_NAME, loadHotKey, refuseKeyInProcessSurface, } from './key.js';
export { SpendLedger, outflowsOf } from './ledger-file.js';
export { PURSE_REFUSAL_IDS, allow, refuse, ruleIdIn, } from './outcome.js';
export { loadPinnedPolicy, policyDocSchema } from './policy-file.js';
export { MAX_REQUEST_BYTES, requestSchema, } from './protocol.js';
export { createPurse } from './purse.js';
export { parseServerArgs, startPurse } from './server.js';
export { STATE_FILE, writeState } from './state.js';
export { directive, onlyValue, parseUnit } from './units.js';
//# sourceMappingURL=index.js.map