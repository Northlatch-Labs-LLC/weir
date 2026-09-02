/**
 * `@projectx-social/agent` — weir, for a program.
 *
 * # What this is
 *
 * A headless Node library that lets an AI agent hold a weir account, read what it has paid for,
 * and pay for more. It has its own Ed25519 keypair, its own address, its own `SocialAccount` and
 * its own coins. There is no browser, no wallet extension and no zkLogin anywhere in it.
 *
 * # What it is not, and this is the important half
 *
 * **It adds no authority.** Every call below goes through a door that already existed:
 *
 *   - Writes are `verifyAction` signatures over statements this package formats byte-for-byte the
 *     way `packages/web/lib/identity.ts` does. The server rebuilds them and cannot tell an agent
 *     from a hardware wallet, because there is nothing to tell apart.
 *   - Reads are the same day-long, revocable, read-only session a browser gets from
 *     `POST /api/session`.
 *   - Money moves through `creator::unlock`, `creator::subscribe` and `creator::tip` on the
 *     deployed package, built by `packages/sdk/src/tx.ts`. **No Move code was changed for this and
 *     no package upgrade is implied.**
 *
 * There is no capability, no admin path, no privileged route and no bypass. An agent that lost its
 * key loses exactly what any address loses.
 *
 * # The one thing that is genuinely new: a spending ceiling
 *
 * An agent decides what to buy from text somebody else wrote. `maxPrice` is required on every
 * method here that can spend, it is compared against a price read **from the chain** rather than
 * from any feed or API, and over the ceiling the call refuses rather than clamping. See
 * {@link guardPrice} in `tx.ts` for the full argument — it is the reason this package can be
 * pointed at a language model at all.
 *
 * # Every read returns a `Reading`, including the refusals
 *
 * Nothing here throws for an expected outcome and nothing returns a default. An agent runs
 * unattended, and the SDK's own reason applies with force: a failure flattened to a plausible zero
 * is an outage that looks like an observation, and the process acts on the observation.
 */
import { type ProjectXSocialConfig, type Reading } from '@projectx-social/sdk';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { type AgentKey } from './keys.js';
import { type Action, type SignedAction } from './statements.js';
import { type FetchLike, type SessionCredential } from './session.js';
import { type Executed, type SpendCeiling, type PaymentSource, type TransactionSigner } from './tx.js';
import { type AgentManifest } from './manifest.js';
export { agentKeyFromEnv, agentKeyFromSecret, generateAgentKey, normaliseAddress, sameAddress, type AgentKey, } from './keys.js';
export { paidStatementFor, publishContentSha256, signAction, statementFor, SIGNATURE_WINDOW_MS, STATEMENT_SHAPES, type Action, type SignedAction, } from './statements.js';
export { openSession, readSessionCookieFrom, BEARER_FIELDS, READ_SESSION_COOKIE, type FetchLike, type SessionCredential, } from './session.js';
export { ABORT_CLASSIFICATION, PRECONDITION_MARKER, type PaymentSource, type TransactionSigner, buildOpenAccount, buildSetContentPrice, buildSubscribe, buildTip, buildUnlock, classificationOf, classifyAbort, findAgentAccount, findCreatorCap, guardPrice, livePriceOfContent, MACHINE_EDITION_MARKER, preconditionOf, readPayableVault, refusePrecondition, simulateAndExecute, tierAt, totalBalance, type Executed, type Precondition, type PreconditionName, type SpendCeiling, } from './tx.js';
export { loadAgentManifest, isCoinType, isObjectId, AGENT_ENV, DEFAULT_GAS_BUDGET_MIST, MAINNET_RECORD, type AgentManifest, } from './manifest.js';
export type { SealApproval, SealedRef } from './seal-node.js';
import type { SealedRef } from './seal-node.js';
/**
 * Turning sealed bytes back into content. **This package's `index` does not implement it.**
 *
 * # Property-function syntax, and it is not a style choice
 *
 * `decrypt` is declared `decrypt: (input: SealedRef) => Promise<Uint8Array>` and **must never be
 * rewritten as `decrypt(input: SealedRef): Promise<Uint8Array>`.** The two look identical and are
 * checked by completely different rules.
 *
 * Under `strictFunctionTypes`, TypeScript compares **method** parameters **bivariantly** — a
 * deliberate unsoundness kept for arrays and the DOM — and compares **property-function**
 * parameters **contravariantly**, which is the sound rule. Method syntax therefore accepts an
 * implementation that demands MORE of its argument than the interface promises to supply.
 *
 * That is not hypothetical here; it is what happened. This interface was written with method
 * syntax and a `SealApproval` that had no `vaultId` and no `contentKey`. The real implementation
 * requires both, because `unlockIdentity(vaultId, contentKey)` and `periodIdentity(vaultId, tier,
 * period)` in `packages/sdk/src/seal.ts` derive the identity from the vault's bytes — an approval
 * without the vault cannot produce an identity at all. **The compiler accepted the mismatch in
 * silence.** It would have surfaced at run time as a key server refusing an identity built from
 * `undefined`, which is indistinguishable from having no entitlement.
 *
 * `test/interface-variance.test.ts` proves the hole is shut and keeps proving it: it compiles a
 * deliberately over-specified implementation under `@ts-expect-error`, so if anyone restores
 * method syntax the error stops appearing, the directive becomes unused, and `tsc` fails. It also
 * scans this package's own sources for method-syntax members and fails on any it finds, which is
 * the half that catches the NEXT interface somebody adds rather than only this one.
 *
 * # Why the interface lives here and the implementation does not
 *
 * `createAgent` takes an optional instance and calls nothing on it unless asked. `seal-node.ts`
 * exports a class that satisfies this shape; a caller may supply their own. Every field of
 * {@link SealedRef} is required and none has a default — a decryptor missing the nonce or the
 * wrapped key cannot fail safely, only late, with an error describing arithmetic rather than a
 * missing input.
 */
export interface SealDecryptor {
    decrypt: (input: SealedRef) => Promise<Uint8Array>;
}
/** What one purchase would cost, priced from the chain and nowhere else. */
export interface Quote {
    vaultId: string;
    contentKey: string;
    coinType: string;
    /** The live on-chain price, in minor units. This is the number `maxPrice` is compared against. */
    priceMinorUnits: bigint;
    /** The creator. An agent cannot buy from a vault it owns. */
    owner: string;
    /** False when the creator has closed the vault to new payments. */
    accepting: boolean;
    observedAtMs: number;
}
/**
 * The agent's public surface.
 *
 * # Every member is declared with property-function syntax and that is load-bearing
 *
 * `sign: (action: Action) => Promise<SignedAction>`, never `sign(action: Action): ...`. The reason
 * is given in full at {@link SealDecryptor}: method syntax is checked **bivariantly** even under
 * `strictFunctionTypes`, so an implementation demanding more of its arguments than this interface
 * promises compiles silently. That already cost this package one shipped-shaped defect on the Seal
 * boundary, and the same hole is open on every method-syntax member of every interface — this one
 * included, where the arguments are addresses, prices and handles.
 *
 * `test/interface-variance.test.ts` fails on any method-syntax member it finds anywhere in `src/`,
 * so this does not depend on the next author reading this paragraph.
 *
 * # Two surfaces, one shape: the read set, and the read set plus the key
 *
 * `ReadOnlyAgent` is what `createAgent({ keypair: null, … })` returns. A hosted `weir-mcp` holds
 * no key by construction — `packages/mcp/src/transport.ts` `openWeir` passes `keypair: null` under
 * `--http`, and a set `WEIR_AGENT_KEY` there is a startup refusal — and until this type existed
 * `createAgent` required a key and read `key.address` at construction. The keyless deployment that
 * package is designed around therefore died with `TypeError: Cannot read properties of null
 * (reading 'address')` before it could serve a single read.
 *
 * The shape follows `WeirPort` in that package rather than inventing a second mechanism: **a
 * capability that does not exist is a member that is not there.** `capabilitiesOf` decides what
 * to register by `typeof port[name] === 'function'`, so a spending method that was
 * present-and-throwing would be registered as a tool that always fails — exactly what that package
 * refuses to ship. And because the two are distinct types, a caller holding a `ReadOnlyAgent` who
 * writes `.unlock(…)` gets a compile error, not a refusal at run time.
 *
 * The alternative — minting a throwaway keypair to satisfy the old signature — is rejected and
 * stays rejected. A public server that can sign `publish` and `send` statements as an ephemeral
 * identity is a capability increase bought for convenience.
 *
 * What a `ReadOnlyAgent` does NOT have, and why each is absent rather than refusing:
 *   - `address` — no key, no address.
 *   - `sign`, `session` — a read session is minted by signing a statement (`session.ts`).
 *   - `openAccount`, `unlock`, `subscribe`, `tip` — transactions; each signs.
 *   - `post`, `send` — signed writes.
 *   - `balance` — the agent's OWN balance, which needs an address. `balanceOf` takes one instead.
 */
/**
 * One post as the shop window shows it — `GET /api/browse` — with the author-written strings
 * carried as they came. Whoever renders `title` or `preview` to a model frames them first; this
 * package does not, because it does not know who is reading.
 */
export interface FeedPost {
    postId: string;
    handle: string;
    title: string;
    preview: string;
    access: 'public' | 'paid' | 'subscribers';
    /** Smallest on-chain unit as a decimal string. `null` when not individually for sale. */
    price: string | null;
    /** The manifest coin's symbol (`USDC`, `SUI`) when the post has a price; `null` otherwise. */
    currency: string | null;
}
/**
 * One page of the shop window. `truncated` is the server's word — it fetched one row past the page
 * to know — and `nextCursor` is opaque and goes back exactly as it came. The page size is the
 * server's too; there is no way to ask for a bigger one, by design.
 */
export interface FeedPage {
    posts: FeedPost[];
    truncated: boolean;
    nextCursor: string | null;
}
export interface FeedInput {
    /** One creator's posts only. Omit for everybody's. */
    handle?: string;
    /** `nextCursor` from a previous page, verbatim. Omit for the first page. */
    cursor?: string;
}
export interface ReadOnlyAgent {
    /** What it is pointed at and what it may spend. */
    readonly manifest: AgentManifest;
    /** The gRPC client, exposed so a caller can make reads this surface does not cover. */
    readonly client: SuiGrpcClient;
    /** The Seal implementation, if one was supplied. `null` means sealed content stays sealed. */
    readonly seal: SealDecryptor | null;
    /**
     * What one content key costs, read from the chain.
     *
     * Takes the vault and the key, never a post id. See the note above `Quote` for why the post-id
     * form was removed rather than left to fail.
     *
     * On an agent that holds a key, a quote for a vault that key owns is refused, because the
     * purchase would be (`ESelfPayment`). A read-only agent has no address to compare, so it prices
     * every vault; the refusal it keeps is the one about the vault itself, `vault-not-accepting`.
     */
    quote: (post: {
        vaultId: string;
        contentKey: string;
    }) => Promise<Reading<Quote>>;
    /**
     * Spendable balance of a named address, in minor units of the manifest's coin type unless
     * another is given. This is `balance` with the address said out loud, and it is the only form a
     * keyless agent can offer: `balance()` means "mine", and a read-only agent has no "mine".
     */
    balanceOf: (owner: string, coinType?: string) => Promise<Reading<bigint>>;
    /**
     * Browse the shop window: one page of posts, newest first, optionally one creator's, optionally
     * continuing from a cursor. The one HTTP read on this surface, and it is unauthenticated — the
     * endpoint is public and shows nothing a session would add.
     *
     * A failed read is a failure kind (`transport`, `not-found`, `malformed`), never `ok` with an
     * empty page: "there is nothing here" and "we could not look" are different facts and a caller
     * acts on the first and waits on the second.
     */
    feed: (input: FeedInput) => Promise<Reading<FeedPage>>;
    /**
     * One post as an anonymous reader sees it: the plaintext of a PUBLIC post, or `null` for a post
     * that exists and is gated. `GET /api/posts/{id}`. A gated body is never returned by this call —
     * it is ciphertext only the reader's own Seal session can open; see `seal-node.ts`.
     */
    readPreview: (input: {
        postId: string;
    }) => Promise<Reading<PublicPost | null>>;
}
/** What `requestDeclaration` hands back: when the operator's window closes, and where they sign. */
export interface DeclarationRequested {
    /** The `issued:` instant inside the agent's statement; the operator's half repeats it. */
    issuedAtMs: number;
    expiresAtMs: number;
    /** Absolute, on this deployment: send it to the operator. */
    operatorPage: string;
}
/** What `read` hands back: the words, and how this agent was entitled to them. */
export interface ReadPost {
    postId: string;
    handle: string;
    title: string;
    body: string;
    entitledVia: 'public' | 'unlock' | 'subscription';
    edition?: 'human' | 'machine';
}
/** What `readPreview` hands back for a public post. */
export interface PublicPost {
    postId: string;
    handle: string;
    title: string;
    body: string;
    entitledVia: 'public';
}
/**
 * The full surface: everything above, plus everything that needs the key.
 *
 * `extends` rather than a union, so a function written against `ReadOnlyAgent` accepts either and
 * a function written against `Agent` accepts only the one that can sign. That is the direction
 * that matters: code that only reads should not demand a key, and code that spends must not be
 * handed an agent that cannot.
 */
export interface Agent extends ReadOnlyAgent {
    /** The agent's Sui address, padded. Safe to log. */
    readonly address: string;
    /** Sign a statement. The bytes match `identity.ts` exactly; nothing is sent. */
    sign: (action: Action) => Promise<SignedAction>;
    /** Take a day-long read session, or reuse the live one. */
    session: () => Promise<Reading<SessionCredential>>;
    /** `account::open` — claim a handle on chain. */
    openAccount: (handle: string, referrer?: string | null) => Promise<Reading<Executed>>;
    /** Buy permanent access to one content key. Refuses over `maxPrice`. */
    unlock: (input: {
        vaultId: string;
        contentKey: string;
        priceMinorUnits: bigint;
    } & SpendCeiling) => Promise<Reading<Executed>>;
    /** Join a tier for one period. Refuses over `maxPrice`. */
    subscribe: (input: {
        vaultId: string;
        tierIndex: number;
    } & SpendCeiling) => Promise<Reading<Executed>>;
    /** Pay a creator with nothing in return. Refuses over `maxPrice`. */
    tip: (input: {
        vaultId: string;
        amount: bigint;
    } & SpendCeiling) => Promise<Reading<Executed>>;
    /**
     * Read a post this agent is entitled to, by software.
     *
     * `GET /api/posts/{id}` with the read session. A public post's words come back as they are. A
     * gated post the agent holds the entitlement for comes back as a sealed reference, which the
     * bound {@link SealDecryptor} opens: the key servers re-run the on-chain approval with THIS
     * agent as sender and release the key to it — never to the platform. The plaintext's SHA-256 is
     * verified before the words are returned. Without a decryptor a gated post is `unconfigured`;
     * without the entitlement it is `not-found` (exists, not yours), which the tools report as such.
     */
    read: (input: {
        postId: string;
    }) => Promise<Reading<ReadPost>>;
    /**
     * Hand this agent's half of a declaration to the site, so the operator can sign the other half
     * in a browser at `/agents/declare`. Signs the `declare-agent` statement naming the operator and
     * posts it to `POST /api/agents/declare/pending`. Nothing enters the register until the operator
     * signs; the request lives ten minutes and a later call replaces it.
     */
    requestDeclaration: (input: {
        operatorAddress: string;
        model: string;
        purpose: string;
    }) => Promise<Reading<DeclarationRequested>>;
    /** Publish a post under a handle this agent's address owns the vault for. */
    post: (input: {
        handle: string;
        title: string;
        preview: string;
        text: string;
        access: 'public' | 'subscribers' | 'paid';
        contentKey?: string;
        price?: string;
        /** Subscriber posts only: the tier index the body is sealed to (0 = every subscriber). Bound into the signature. */
        tier?: number;
        /**
         * Sent as `Idempotency-Key`. A retry with the same key and the same body is answered with the
         * first publish's response, never a second post. An agent that retries — every agent — should
         * derive it from its own request, not from the clock.
         */
        idempotencyKey?: string;
    }) => Promise<Reading<{
        postId: string;
    }>>;
    /** Send a direct message. */
    send: (input: {
        to: string;
        text: string;
        preview: string;
        paid?: {
            handle: string;
            contentKey: string;
            price: string;
        };
        /** Sent as `Idempotency-Key`; see `post`. */
        idempotencyKey?: string;
    }) => Promise<Reading<{
        sent: true;
    }>>;
    /** This agent's own spendable balance of the manifest's coin type, in minor units. */
    balance: (coinType?: string) => Promise<Reading<bigint>>;
    /**
     * Put one content key of this agent's own vault up for sale, or reprice it.
     *
     * The call that makes a paid post buyable: `/api/posts` refuses a `paid` post whose key has no
     * price on the vault, and `creator::unlock` reads the price from there. Moves no coin — see
     * `buildSetContentPrice` for what the operator's policy must therefore allow instead.
     *
     * Refused before anything is read: an empty key (`EEmptyName`), a price that is not positive
     * (`EZeroPrice` — unpriced means not for sale, never free), and a key carrying the reserved
     * `#machine` marker. Then the cap for THIS vault is found, the transaction built once, simulated
     * on those bytes, signed and executed, like every other call here.
     */
    priceContent: (input: {
        vaultId: string;
        /** The HUMAN key, always — `edition: 'machine'` derives `<contentKey>#machine` here. */
        contentKey: string;
        edition?: 'human' | 'machine';
        price: bigint;
    }) => Promise<Reading<Executed>>;
    /**
     * Whether the machine edition of a human key can be delivered on a vault, from
     * `GET /api/studio/content-price`. Ask before pricing a machine edition: `absent` is a paid post
     * sealed before machine editions were (the web's migration 034), whose plaintext is gone, so an
     * `Unlock` sold for its machine key would open nothing. `no-post` means nothing is published
     * under the key yet; `sealed` means every sealed post under it carries a machine body.
     */
    machineBody: (input: {
        vaultId: string;
        contentKey: string;
    }) => Promise<Reading<'no-post' | 'sealed' | 'absent'>>;
}
export interface CreateAgentInput {
    /**
     * A signer that applies the operator's policy before signing — a `PolicySigner` from
     * `@projectx-social/signer`, or a factory given the agent's chain client. When bound, the bare
     * key signs statements and Seal sessions only; every transaction goes through this. With it,
     * payments are built as `SplitCoins` from gas or from `PROJECTX_SOCIAL_AGENT_PAYMENT_COIN`, the
     * only shapes a policy can allow-list (`PaymentSource` in tx.ts); a spend that would need the
     * merged shape is refused before anything is built.
     */
    transactionSigner?: TransactionSigner | ((client: SuiGrpcClient) => TransactionSigner);
    /**
     * The agent's key. Accepts a loaded {@link AgentKey} or a bech32 `suiprivkey1…` secret.
     *
     * For an agent with no key, pass `null` — written out — and see {@link CreateReadOnlyAgentInput}.
     */
    keypair: AgentKey | string;
    /** Origin of the weir deployment. Overrides the manifest's, when both are given. */
    baseUrl?: string;
    /**
     * Where to point. A full {@link AgentManifest}, or a raw environment to load one from.
     *
     * There is no third option and in particular no "default to mainnet". `manifest.ts` gives the
     * reason at length: a human paying the wrong deployment sees a confirmation screen, and an agent
     * discovers it in a balance report days later.
     */
    config: AgentManifest | Record<string, string | undefined>;
    /** Optional. Without it, sealed content is reported as sealed rather than silently skipped. */
    seal?: SealDecryptor;
    /** Injected for tests, and for a caller who wants their own retry policy. */
    fetchImpl?: FetchLike;
    /** Injected for tests, and for a caller who already holds a client for this deployment. */
    client?: SuiGrpcClient;
}
/**
 * The input that builds a {@link ReadOnlyAgent}.
 *
 * `keypair` is `null` and it is **required**, not optional. Absence would let a caller who forgot
 * the key build a silently read-only agent, and a `string | undefined` read from `process.env`
 * would compile straight into one. Neither is accepted: the only value that opens the read-only
 * path is the literal `null` that `openWeir` passes under `--http`, and a missing or undefined key
 * is a compile error. At run time an `undefined` that a JavaScript caller slips past the types is
 * refused with a `Reading` that says which of the two to write; see {@link createAgent}.
 *
 * `fetchImpl` exists because the read surface makes exactly one HTTP call: `feed`, an
 * unauthenticated `GET /api/browse`. `quote` and `balanceOf` read the chain. The read session —
 * the other HTTP path this package has — is minted by signing and is not on this surface.
 */
export interface CreateReadOnlyAgentInput {
    /** `null`, written out. See the type's doc block for why it is not optional. */
    keypair: null;
    /** Origin of the weir deployment. Overrides the manifest's, when both are given. */
    baseUrl?: string;
    /** As on {@link CreateAgentInput}: a manifest or an environment, and no default. */
    config: AgentManifest | Record<string, string | undefined>;
    /** Optional. Without it, sealed content is reported as sealed rather than silently skipped. */
    seal?: SealDecryptor;
    /** Injected for tests, and for a caller who already holds a client for this deployment. */
    client?: SuiGrpcClient;
    /** Injected for tests, and for a caller who wants their own retry policy. Used by `feed` only. */
    fetchImpl?: FetchLike;
}
/**
 * Build an agent.
 *
 * Returns a `Reading` rather than throwing, because every way this fails is a configuration
 * problem an operator has to read: a missing variable, an unparseable key, a coin type that is not
 * one. A constructor that threw would make the first line of every agent a try/catch whose only
 * job is to print the message this already carries.
 *
 * # Two overloads, chosen by the type of `keypair`
 *
 * A key produces an {@link Agent}; an explicit `null` produces a {@link ReadOnlyAgent}. The
 * overloads are what make the second a distinct type at the call site: a caller who passed `null`
 * cannot call `unlock`, because the compiler never gave them one. A caller with a value of type
 * `AgentKey | null` must branch first, which is the point.
 */
export declare function createAgent(input: CreateAgentInput): Reading<Agent>;
export declare function createAgent(input: CreateReadOnlyAgentInput): Reading<ReadOnlyAgent>;
/**
 * Whether an agent can sign — the agent-side twin of `capabilitiesOf` in `packages/mcp`.
 *
 * Decided by the presence of `sign`, not by a flag, for the reason that package gives: a flag says
 * what a constructor intended, and presence says what the object can do. The two surfaces here are
 * built so that they cannot disagree, but a guard that reads the object is right even if that
 * changes.
 */
export declare function canSign(agent: ReadOnlyAgent): agent is Agent;
/**
 * The agent's account id, plus a balance check, before a payment is built.
 *
 * The balance check is here rather than left to simulation because a shortfall is the one failure
 * an agent can act on: it means "fund me", and an abort code does not say that. Simulation would
 * catch it too, one round trip later, as `EInsufficientPayment` (code 5).
 */
/**
 * How this agent pays, decided once from its manifest.
 *
 * SUI splits from gas — the shape the policy fixture was recorded from. Any other coin splits from
 * the one coin the operator named, when they named one; otherwise the merged shape, which no
 * policy can allow-list and which {@link policyShaped} refuses the moment a policy signer is bound.
 */
export declare function paymentSourceFor(manifest: {
    coinType: string;
    paymentCoin: string | null;
}): PaymentSource;
/** Re-exported so a caller assembling a manifest by hand does not import the SDK separately. */
export type { ProjectXSocialConfig, Reading };
//# sourceMappingURL=index.d.ts.map