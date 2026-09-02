// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `@projectx-social/signer` — the custody boundary.
 *
 * Four adapters that hold a key at four different distances from this process, one wrapper that
 * refuses to let any of them sign a transaction that has not been simulated and judged, and a
 * hash-chained record of every decision either way.
 *
 * The fact that makes this package necessary rather than nice: **a weir account is soulbound**.
 * `account.move` declares `SocialAccount` with `key` and no `store`, and offers no transfer
 * function; `Subscription` and `Unlock` are the same. There is no rotation. A leaked agent key
 * loses the handle and every entitlement ever bought with it, permanently. See `README.md`.
 */
export {} from './signer.js';
export { localKeypairSignerFromKeystore, localKeypairSignerFromSecret } from './local.js';
export { multiSigSigner, } from './multisig.js';
export { readOnlySigner } from './readonly.js';
export { kmsSigner } from './kms.js';
export { AuditLog, GENESIS_HASH, entryPreimage, policyHash, verifyChain, } from './audit.js';
export { UNRESOLVED_RECIPIENT, buildBytes, grpcSimulation, readSimulation, } from './evidence.js';
export { policySigner, } from './policy-signer.js';
export { MAX_U64, boundedPayment } from './bound-coin.js';
//# sourceMappingURL=index.js.map