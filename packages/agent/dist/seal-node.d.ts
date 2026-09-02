/**
 * Opening sealed content from Node, with a keypair and no browser.
 *
 * # What was actually unproven here, and what this file settles
 *
 * Every sealed read this system has ever performed happened in a tab. `SealedMedia.tsx` and
 * `SealedBody.tsx` build a `SessionKey`, hand `sessionKey.getPersonalMessage()` to a **wallet**,
 * and put the wallet's signature back. That is the only path that has ever run, and the whole
 * agent economy depends on the question nobody had answered: can a headless process holding a raw
 * Ed25519 secret do the same thing?
 *
 * It can, and the reason is small enough to state in one sentence: `SessionKey.create` accepts an
 * optional `signer` — the installed 1.4.6 types name `EnokiSigner` as the example — and
 * `Ed25519Keypair` already implements that `Signer` interface, `signPersonalMessage` included. So
 * there is no wallet-shaped hole to fill. The certificate is produced by the same
 * `signPersonalMessage` a wallet would have called, on a key this process holds.
 *
 * Measured on mainnet before this file was written, with a freshly generated throwaway key that
 * has never held a coin:
 *
 * ```
 * SessionKey.create OK in 289 ms
 * personal message: Accessing keys of package 0xc5c833…404d for 10 mins from
 *                   2026-08-31 11:27:15 UTC, session key J1aStzvhPVZJZmyeqipbpxD40C4N9MWhNMxDHGMdV4A=
 * certificate signed with NO wallet: {"user":"0x4e94…6026","ttl_min":10,"sig_len":132}
 * ```
 *
 * The same run proved the other half of that call, which is the one that bites people: passing the
 * **latest** package id is refused with `InvalidPackageError: Package ID used in PTB is invalid`,
 * because `SessionKey.create` reads the package object and requires `version === 1`. The Seal
 * namespace is `config.packageId` and the call target is `config.latestPackageId`, they are
 * different addresses on this deployment, and getting them the wrong way round fails at a distance
 * from the mistake. `sealPackageId()` in the SDK is the only thing this file asks for a namespace.
 *
 * # THE PERMANENT CONSTRAINT — read this before extending anything below
 *
 * **A Seal key is a deterministic function of its identity. Once derived it exists for ever, and no
 * second check ever runs.** The key servers evaluate `entitlement::seal_approve_*` exactly once, at
 * derivation, with the requesting address as `ctx.sender()`. After that the 32 bytes are simply 32
 * bytes: no expiry, no revocation, no re-authorisation, nothing to take back.
 *
 * Therefore **this module must never be extended to let one address decrypt on another's behalf.**
 * No delegation parameter, no "decrypt for user X" argument, no shared session key, no service that
 * holds a fleet of agent keys and opens content for whichever caller asks. Every one of those turns
 * a single entitlement into a permanent, un-revocable key-issuing service for content the holder
 * did not buy — and it would do it silently, because the contract's check would still pass and
 * nothing downstream would look wrong.
 *
 * **Agents hold their own entitlements.** An agent that must read a creator's paid post buys that
 * post with its own address and opens it with its own key. That is not a limitation to engineer
 * around later; it is the property that makes the paywall mean anything at all. The full statement
 * of this rule, and why it is not negotiable, is in `packages/agent/SEAL.md`.
 *
 * # What is deliberately reused, and the one thing that is deliberately not
 *
 * The identity bytes come from `@projectx-social/sdk`'s `unlockIdentity` / `periodIdentity`, which
 * are held byte-for-byte against `entitlement.move` by tests in both languages. The approval
 * transaction comes from the SDK's `approveUnlock` / `approveSubscription`, which is what
 * `packages/web/lib/seal-open.ts`'s `approvalFor` itself calls. Nothing here hand-rolls a
 * `moveCall`; a previous desk did that and it was a breach of the estate's Survey Law.
 *
 * `approvalFor` is **not imported directly**, and the reason is layering rather than preference:
 * it lives in a Next.js application with no package exports, so importing it would make a
 * publishable package depend on a relative path into a web app. What replaces that import is
 * stronger than the import would have been — `test/seal-node.test.ts` loads the real `approvalFor`
 * at runtime and asserts this module's transaction is byte-identical to it, for both entitlement
 * kinds. The two cannot drift without a red test.
 *
 * # One live defect is worked around here, and it is not this package's to fix
 *
 * The SDK's approval, as built, **cannot be built**: `entitlementRef()` declares each entitlement
 * `{ mutable: false }`, and `@mysten/sui`'s resolver refuses a shared-object property on an input
 * that resolves to an owned object. That is measured against real mainnet entitlements and it
 * affected the shipped browser reader too. It is fixed at source in the SDK; this module carries the
 * measurements, the mechanism and the name of the file that should carry the real fix.
 *
 * The AES-GCM opener is re-implemented on `node:crypto` because `packages/web/lib/blob-crypto.ts`
 * carries `import 'server-only'`, which throws outside a Next server bundle. Same reasoning applies:
 * the test reads that file's own constants and asserts they still say 32 / 12 / 16, in the register
 * `packages/sdk/test/drift.test.ts` already established for a transcribed layout.
 *
 * # Order of operations, and why it differs from the browser on purpose
 *
 * The browser fetches the key first and the ciphertext second. This fetches the **ciphertext
 * first**. A Walrus read is public, free and unmetered; a key server request on this deployment
 * carries an API key and is rate-limited. A blob whose storage lease has expired is a real and
 * ordinary failure, and discovering it after spending a metered request is pure waste. Sequential
 * rather than parallel, for the same reason: `Promise.all` would spend the request anyway.
 *
 * The two are otherwise the same read, and the ending is identical and non-negotiable: the SHA-256
 * of the plaintext is compared against what the publisher recorded, and a mismatch throws. These
 * bytes travelled through storage nobody here operates and came back reassembled from slivers held
 * by many separate nodes. Returning them unchecked would let a hostile aggregator choose what an
 * agent reads and then acts on.
 */
import { SessionKey } from '@mysten/seal';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Transaction } from '@mysten/sui/transactions';
import { type ProjectXSocialConfig, type SealConfig } from '@projectx-social/sdk';
import type { AgentKey } from './keys.js';
/**
 * Public Walrus read endpoints, tried in order.
 *
 * # Why this one value gets a default when nothing else in the estate does
 *
 * `packages/sdk/src/config.ts` refuses to default a package id, an endpoint or a key server list,
 * and it is right to: a defaulted key server encrypts a creator's media to a committee nobody
 * chose, and there is no recovery from that. This is the opposite case and the difference is worth
 * stating rather than assumed.
 *
 * A Walrus blob is public and content-addressed, and every byte fetched here is verified twice
 * before it is returned — once by GCM's authentication tag, which fails on a single altered byte,
 * and again by the SHA-256 the publisher recorded. So the worst a wrong or hostile aggregator can
 * do is refuse to answer. It cannot forge, it cannot substitute, and it cannot learn anything: the
 * bytes it serves are ciphertext and it never sees a key. A default here buys availability and
 * risks a denial of service that a second entry in the list already covers.
 *
 * These are the same two endpoints `SealedBody.tsx` holds in a module-private constant. That is a
 * duplication and it is named rather than hidden: when one of these operators goes away, both lists
 * have to change, and the right fix at that point is one shared configured value, not a third copy.
 */
export declare const PUBLIC_WALRUS_AGGREGATORS: readonly ['https://aggregator.walrus-mainnet.walrus.space', 'https://walrus.globalstake.io'];
/**
 * What the agent holds that entitles it, and therefore which approval to build.
 *
 * Structurally the same discriminated union as `Entitlement` in `packages/web/lib/seal-open.ts`,
 * and `test/seal-node.test.ts` asserts that both produce the same transaction rather than trusting
 * the shapes to stay aligned by inspection.
 *
 * The object id is required and cannot be derived. `seal_approve_unlock` takes `&Unlock` and
 * `seal_approve_subscription` takes `&Subscription` — both owned objects — so the entitlement the
 * agent holds must be named. Naming one it does not own is not an attack: the key servers execute
 * the policy with the agent as `ctx.sender()` and `assert!(unlock.buyer == ctx.sender())` aborts.
 */
export type SealApproval = {
    kind: 'unlock';
    vaultId: string;
    contentKey: string;
    unlockId: string;
} | {
    kind: 'subscription';
    vaultId: string;
    /**
     * Both `u64` on chain, and `bigint` here rather than `number`.
     *
     * A `Number` round trip is lossless for every value anyone will see and lossy eventually, and
     * the failure is silent: an identity built from a rounded period is the right length and the
     * wrong bytes, so the key server refuses it in a way that reads exactly like the agent having
     * no subscription at all.
     */
    tier: bigint;
    period: bigint;
    subscriptionId: string;
};
/**
 * One piece of sealed content, as the API and the database describe it.
 *
 * Field names match `posts.body_blob_id` / `body_seal_wrapped_key` / `body_nonce` / `body_sha256`
 * and the `x-seal-*` headers the media route sets, so a caller moving a row or a response into this
 * shape is renaming nothing.
 */
export interface SealedRef {
    /** The Walrus blob holding the ciphertext. Public — anyone may fetch it and nobody may read it. */
    blobId: string;
    /** The Seal `EncryptedObject`, base64. Public: useless without a threshold of key servers. */
    sealWrappedKey: string;
    /** GCM's nonce, base64. 12 bytes. Not secret, and the blob cannot be opened without it. */
    nonce: string;
    /** Lower-case hex SHA-256 of the **plaintext**, recorded at publish. Verified before returning. */
    sha256: string;
    /** The entitlement this agent presents, and the object it will be judged against. */
    approval: SealApproval;
}
/**
 * The plaintext did not hash to what the publisher recorded.
 *
 * A named class rather than a bare `Error` because this is the one failure a caller must never
 * catch-and-continue. Every other failure here means "you did not get the content"; this one means
 * "you got content that is not the content", which for an agent that acts on what it reads is the
 * difference between an outage and being fed instructions by whoever served the blob.
 */
export declare class SealHashMismatchError extends Error {
    readonly blobId: string;
    readonly expected: string;
    readonly actual: string;
    readonly name = "SealHashMismatchError";
    constructor(blobId: string, expected: string, actual: string);
}
/**
 * The one step that needs a threshold committee on the network, behind a seam.
 *
 * Everything else in this module is arithmetic, a public HTTP GET, or a transaction build — all of
 * which can be proven offline. This cannot: there are no open Seal key servers on Sui mainnet, every
 * provider is permissioned, and enrolling one costs money. The seam is what lets the pipeline be
 * tested end to end without it, and it is not a mock in production — the real implementation is the
 * five lines in {@link SealDecryptor.recoverKeyFromCommittee}.
 */
export type RecoverKey = (input: {
    /** The Seal `EncryptedObject`, raw bytes. */
    wrappedKey: Uint8Array;
    /** The serialised approval, `onlyTransactionKind`. */
    txBytes: Uint8Array;
}) => Promise<Uint8Array>;
export interface SealDecryptorOptions {
    /** The deployment. `packageId` namespaces every identity; `latestPackageId` is the call target. */
    config: ProjectXSocialConfig;
    /**
     * The key server committee, from `loadSealConfig`.
     *
     * Optional only because a caller supplying its own {@link recoverKey} — the offline tests, and
     * any future proxy arrangement — has no committee to name. A decryptor with neither refuses at
     * the point of use rather than at construction, so an agent that only ever reads free content
     * does not fail to start over a variable it will never use.
     */
    seal?: SealConfig;
    /** The agent's own key. It signs the session certificate; nothing else in this module signs. */
    key: AgentKey;
    /**
     * A chain client. gRPC, always.
     *
     * Sui JSON-RPC is dead on public fullnodes — `sui-contracts/deploy/mainnet.json` records
     * `suix_getLatestSuiSystemState` answering `-32601 "JSON-RPC on public fullnodes has been
     * deprecated"` on 14 Aug 2026. `createClient` returns a `SuiGrpcClient` and there is no other
     * constructor reachable from here. Verified this session that `SuiGrpcClient` satisfies Seal's
     * `SealCompatibleClient`: it exposes `.core`, which is the only member Seal reaches for.
     */
    suiClient?: SuiGrpcClient;
    /** Where to read ciphertext from. Defaults to {@link PUBLIC_WALRUS_AGGREGATORS}. */
    aggregators?: readonly string[];
    /** Injectable for tests and for a deployment behind a proxy. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
    /** Minutes, 1 to 30. Defaults to {@link SESSION_TTL_MIN}. */
    sessionTtlMin?: number;
    /** Replaces the key server round trip. See {@link RecoverKey}. */
    recoverKey?: RecoverKey;
    /** Injectable so a test does not sleep for eleven seconds. Defaults to `setTimeout`. */
    sleep?: (ms: number) => Promise<void>;
}
/** The identity an approval covers, derived by the shared code the contract is held against. */
export declare function identityForApproval(approval: SealApproval): Uint8Array;
/**
 * Build the transaction the key servers will dry-run to decide.
 *
 * Never signed and never submitted. It is evidence, not an action: the key servers execute it with
 * the agent as sender and release a share if it does not abort. No gas budget, gas price or payment
 * is set, and the absence of them is correct rather than an oversight — see `approvalBytes`.
 *
 * The dispatch is the same one `approvalFor` performs in `packages/web/lib/seal-open.ts`, and both
 * delegate to the SDK builders. `test/seal-node.test.ts` asserts the two produce identical
 * transaction data for both kinds, which is the property that stops them drifting.
 */
export declare function approvalTransactionFor(config: ProjectXSocialConfig, approval: SealApproval): Transaction;
/** Lower-case hex SHA-256, to compare against what the publisher recorded. */
export declare function sha256Hex(bytes: Uint8Array): string;
/**
 * Open the blob once the key has been recovered.
 *
 * The layout is `blob-crypto.ts`'s and is transcribed rather than imported, because that module
 * carries `import 'server-only'` and throws outside a Next server bundle:
 *
 * ```
 * ciphertext = AES-256-GCM body ‖ 16-byte tag      nonce = 12 bytes      key = 32 bytes
 * ```
 *
 * `decipher.final()` is what raises on a failed tag check, and it is the reason the tag is not
 * skipped: without it a forged or altered blob decodes to plausible-looking plaintext, which is the
 * whole failure this mode exists to prevent.
 */
export declare function openBlob(input: {
    ciphertext: Uint8Array;
    key: Uint8Array;
    nonce: Uint8Array;
}): Uint8Array;
/**
 * A refusal that may simply be the chain catching up, rather than an agent without entitlement.
 *
 * `instanceof`, not a regex on the message. Every error `@mysten/seal` throws reports
 * `error.name === "Error"` (its classes are anonymous class expressions), and the text this used
 * to match — "not yet exist" — is one word away from what `InvalidParameterError` actually says
 * ("… the FN has not yet seen"). So the retry never fired on the one case it was written for: an
 * agent that has just paid and is told it has no access. The web side (`lib/seal-open.ts`,
 * `isSettling`) made the same correction; this is the agent's half of it.
 */
export declare function looksLikeSettling(error: unknown): boolean;
/**
 * Sealed content, opened by an agent, for that agent.
 *
 * Construct one per agent key and keep it: the session key is created lazily, signed once, and
 * reused until it expires, so a run that opens twenty posts signs one certificate rather than
 * twenty. Concurrent calls share the in-flight creation instead of racing to make several.
 */
export declare class SealDecryptor {
    #private;
    constructor(options: SealDecryptorOptions);
    /** The address every key this decryptor recovers is derived on behalf of. Never another. */
    get address(): string;
    /**
     * Recover the key, open the blob, and refuse anything that is not what the publisher stored.
     *
     * Throws rather than returning a `Reading`, which is the opposite of the SDK's habit and is
     * deliberate. The estate uses `Reading` where a failure is a fact the caller routes on — an
     * unconfigured variable, an absent object. Here every failure means the agent does not have the
     * content, and the one failure that must be impossible to ignore is the hash mismatch. A value a
     * caller can forget to check is exactly the wrong shape for "these bytes are not the bytes".
     */
    decrypt(ref: SealedRef): Promise<Uint8Array>;
    /**
     * Serialise an approval for the key servers.
     *
     * `onlyTransactionKind: true` is required, not a size optimisation: the agent is not paying for
     * this and may hold no gas coin at all, so a fully built transaction would fail to serialise for
     * want of a gas payment before it ever reached a key server.
     *
     * The sender is set anyway, matching `SealedBody.tsx`. It is not serialised under
     * `onlyTransactionKind` — the key servers substitute the certificate's `user` — but leaving it
     * unset means the one place this module names the address it is acting for is the session key,
     * and this call should read the same way it reads in the browser.
     */
    approvalBytesFor(approval: SealApproval): Promise<Uint8Array>;
    /**
     * The agent's signed session, created once and reused until it expires.
     *
     * This is the whole point of the module and it is four lines. `signer` is the agent's
     * `Ed25519Keypair`; `SessionKey`'s own constructor asserts
     * `signer.getPublicKey().toSuiAddress() === address`, so a decryptor built with a key and an
     * address that disagree throws here rather than producing a certificate no key server accepts.
     *
     * `getCertificate()` is called eagerly to force the signature now. The SDK would otherwise sign
     * lazily inside `decrypt`, and a signing failure surfacing from the middle of a threshold key
     * fetch is a failure attributed to the wrong thing.
     */
    sessionKey(): Promise<SessionKey>;
    /**
     * Ask the committee for the key. The only network path to a key server in this package.
     *
     * `verifyKeyServers` is set explicitly and set to `true`. The shipped 1.4.6 code reads
     * `options.verifyKeyServers ?? false` while Mysten's published documentation states the default
     * is `true` — anyone following their documentation gets unverified key servers. The estate sets
     * it at every call site for that reason and this is another one; it is never left to the default.
     */
    recoverKeyFromCommittee(input: {
        wrappedKey: Uint8Array;
        txBytes: Uint8Array;
    }): Promise<Uint8Array>;
}
//# sourceMappingURL=seal-node.d.ts.map