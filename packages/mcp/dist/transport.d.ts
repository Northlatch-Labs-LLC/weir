import { type Server as HttpServer } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Reading } from '@projectx-social/agent';
/**
 * What a price is denominated in.
 *
 * A closed set on purpose. A price is never a bare number anywhere in this package, because a bare
 * number cannot be compared against a spending ceiling by anybody: `100000` under a quote in MIST
 * is 0.0001 SUI, and under a quote in USDC base units it is ten cents. The denomination is stated
 * by the caller and carried, unconverted, all the way to the layer that decides.
 */
export type Currency = 'SUI' | 'USDC';
/**
 * A spending ceiling, in transit.
 *
 * # `bigint`, and why the wire form is a string
 *
 * On-chain amounts are `u64`. `Number.MAX_SAFE_INTEGER` is `2^53 - 1`, so a JSON number cannot
 * represent the top of that range exactly — and the failure is silent and in the wrong direction,
 * because floating point rounds a limit *up* as readily as down. A ceiling that is silently rounded
 * up is a ceiling that authorises more than the principal wrote.
 *
 * So the wire form of `maxPrice` is a **string of decimal digits in the smallest on-chain unit**,
 * and it is converted to `bigint` at the tool boundary by {@link parseAmount}, which refuses
 * anything that is not exactly that. No decimals, no sign, no exponent, no separators.
 *
 * # This type carries a ceiling; nothing in this package applies one
 *
 * A `Ceiling` is *cargo*. It is parsed here, passed down through the port, and enforced by the
 * signer and by the chain. See this file's opening note for which bound is which.
 */
export interface Ceiling {
    readonly maxPrice: bigint;
    readonly currency: Currency;
}
/**
 * The largest amount that can exist on this chain: `u64::MAX`.
 *
 * Used by {@link parseAmount} for a **representability** check, which is a different thing from a
 * spending check and must not be mistaken for one. Refusing `2^64` is refusing a number the chain
 * has no way to hold; it says nothing whatever about whether a number the chain *can* hold is a
 * number the principal authorised. That question is answered two layers down.
 */
export declare const U64_MAX = 18446744073709551615n;
/**
 * Read an amount off the wire.
 *
 * Returns `null` for anything that is not a plain non-negative decimal integer within `u64`.
 *
 * # Why the grammar is this strict
 *
 * Every rejected form is one that `BigInt()` or `Number()` would otherwise accept and silently
 * reinterpret:
 *
 *  - `"0x10"` — `BigInt` reads that as 16. A hexadecimal ceiling is a ceiling nobody wrote.
 *  - `"1e9"` — `Number` reads that as a billion; `BigInt` throws. Neither is what a caller who
 *    typed it meant to happen without being told.
 *  - `"1_000"` — a numeric separator is a language feature, not a wire format.
 *  - `" 100 "` — leading and trailing space are accepted by `BigInt` and are a sign the value came
 *    from a place that was not thinking of it as a number.
 *  - `"-1"` — a negative ceiling is not a smaller ceiling, it is a nonsensical one, and a
 *    downstream comparison against it would pass everything.
 *  - `"1.0"` — a decimal point in a smallest-unit amount means the caller is thinking in whole
 *    coins, which is the exact confusion this representation exists to prevent. Refusing is
 *    correct; converting would be guessing at a factor of a billion.
 *
 * Leading zeros are accepted and normalised, because `"0100"` is unambiguous and refusing it would
 * be pedantry rather than a control.
 */
export declare function parseAmount(text: string): bigint | null;
/** A post as it appears in a search result: enough to decide whether to pay, never the paid body. */
/**
 * One page of the shop window, as `GET /api/browse` answers it.
 *
 * `truncated` is the server's word, measured by fetching one row past the page, and it is carried
 * to the caller untouched: a page that came back full is not evidence of a next one, and a tool
 * that dropped the flag would leave an agent unable to tell "that is all" from "there is more".
 * `nextCursor` is opaque; it goes back to the server as it came.
 */
export interface WeirFeed {
    posts: WeirPost[];
    truncated: boolean;
    nextCursor: string | null;
}
export interface WeirPost {
    postId: string;
    handle: string;
    /** Author-written. Framed by `untrusted.ts` before it leaves this package. */
    title: string;
    /** Author-written. Framed by `untrusted.ts` before it leaves this package. */
    preview: string;
    access: 'public' | 'paid' | 'subscribers';
    /** Smallest on-chain unit as a decimal string. `null` when not individually for sale. */
    price: string | null;
    currency: Currency | null;
}
/**
 * The live, on-chain answer to "what would this cost me right now".
 *
 * Keyed by **vault and content key**, never by post id, and that is the correction described at
 * {@link capabilitiesOf}: a post id has to be resolved to those two identifiers by an HTTP endpoint
 * that does not exist on this deployment.
 */
export interface WeirQuote {
    vaultId: string;
    contentKey: string;
    /** Smallest on-chain unit, as a decimal string. Never a JSON number; see {@link Ceiling}. */
    price: string;
    currency: Currency;
    coinType: string;
    owner: string;
    /** False when the creator has closed the vault to new payments. Buying would abort. */
    accepting: boolean;
    observedAtMs: number;
}
/** Plaintext, once entitlement is proved. The body is author-written and is framed before it leaves. */
export interface WeirBody {
    postId: string;
    handle: string;
    title: string;
    body: string;
    entitledVia: 'public' | 'unlock' | 'subscription';
}
export interface WeirUnlockReceipt {
    txDigest: string;
    /** `null` when the executor reports no created object ids — the agent library reads no effects; the Unlock is on chain under `txDigest`. */
    unlockObjectId: string | null;
    /** Smallest on-chain unit, as a decimal string. */
    pricePaid: string;
    currency: Currency;
}
export interface WeirSubscribeReceipt {
    txDigest: string;
    /** `null` when the executor reports no created object ids; see {@link WeirUnlockReceipt}. */
    subscriptionObjectId: string | null;
    /** `null` when the tier price was not read back — never a guess. */
    pricePaid: string | null;
    currency: Currency;
}
export interface WeirBalance {
    address: string;
    /** Smallest on-chain unit, as a decimal string, of the manifest's coin type. */
    spendable: string;
    currency: Currency;
}
/**
 * Everything this package knows how to ask weir for.
 *
 * # Every member is optional, and that is the mechanism rather than laxity
 *
 * A method that is absent is a capability that does not exist, and {@link capabilitiesOf} turns
 * absence into a tool that is never registered. Declaring them required would force the binding to
 * fabricate a method in order to satisfy the type — and a fabricated method is exactly the
 * "registered tool that always fails" this package now refuses to ship.
 *
 * # Property-function syntax, not method syntax, and it is load-bearing
 *
 * `feed?: (input: …) => …`, never `feed?(input: …): …`. TypeScript checks method-syntax members
 * **bivariantly** even under `strictFunctionTypes`, so an implementation that demands *more* of its
 * arguments than this port promises compiles silently. `packages/agent` records that this already
 * cost it one shipped-shaped defect on its Seal boundary. The arguments here are addresses, prices
 * and ceilings; the same hole would be worth more.
 */
/** What {@link WeirPort.authorship} answers. Mirrors `Authorship` in `@projectx-social/agent`. */
export type WeirAuthorship = {
    proof: null;
    reason: string;
} | {
    proof: {
        address: string;
        signature: string;
        statement: string;
        origin: string;
        contentSha256: string;
        issuedAtMs: number;
    };
    handleStillResolvesToSigner: boolean | null;
};
/** Mirrors `DeclaredAgent` in `@projectx-social/agent`. */
export interface WeirDeclaredAgent {
    address: string;
    operatorAddress: string;
    model: string;
    purpose: string;
    declaredAtMs: number;
    operatorFootprint: {
        state: 'seen' | 'unseen' | 'not-measured';
        observedAtMs: number;
    } | null;
}
/** Mirrors `SeekingAgent` in `@projectx-social/agent`. `words` is the agent's own pitch. */
export interface WeirSeekingAgent {
    address: string;
    handle: string;
    model: string;
    purpose: string;
    words: string;
    expiresAtMs: number | null;
}
export interface WeirPort {
    /** Browse or search. Absent today — see {@link capabilitiesOf}. */
    /**
     * Browse the shop window: one page, optionally one creator's, optionally continuing from a cursor.
     *
     * No `limit` and no `query`. The page size is the server's (`BROWSE_PAGE`, not a caller
     * parameter — a ceiling a caller can raise is not a ceiling), and `/api/browse` has no free-text
     * search, so a `query` here would be a promise the endpoint cannot keep. A `Reading`, not a bare
     * array: a failed read is a failure kind the caller can act on, never an empty page.
     */
    feed?: (input: {
        handle?: string;
        cursor?: string;
    }) => Promise<Reading<WeirFeed>>;
    /** Price one content key from the chain. */
    quote?: (input: {
        vaultId: string;
        contentKey: string;
    }) => Promise<WeirQuote>;
    /** Fetch a body the caller is already entitled to. `null` means "exists, not entitled". */
    readPreview?: (input: {
        postId: string;
    }) => Promise<WeirBody | null>;
    /** The signer's own spendable balance. */
    balance?: () => Promise<WeirBalance>;
    /**
     * Who signed a post, from the deployment that holds the proof.
     *
     * Keyless: it is the check a buyer makes BEFORE spending. `proof: null` is an answer — the post
     * was signed and the deployment discarded the signature — and is never reported as a failure.
     */
    authorship?: (input: {
        postId: string;
    }) => Promise<WeirAuthorship>;
    /** Who signed a comment. Same rules as {@link WeirPort.authorship}; keyless. */
    commentAuthorship?: (input: {
        commentId: string;
    }) => Promise<WeirAuthorship>;
    /** The register: every standing declaration and what was observed of each operator. Keyless. */
    agents?: (input: {
        operator?: string;
    }) => Promise<WeirDeclaredAgent[]>;
    /** Agents with no operator, asking to be claimed. Keyless; their words are untrusted. */
    seeking?: () => Promise<WeirSeekingAgent[]>;
    /** Buy permanent access. The ceiling is carried, not applied. */
    unlock?: (input: {
        vaultId: string;
        contentKey: string;
        ceiling: Ceiling;
        idempotencyKey: string;
    }) => Promise<WeirUnlockReceipt>;
    /** Join a tier. The ceiling is carried, not applied. */
    subscribe?: (input: {
        vaultId: string;
        tierIndex: number;
        ceiling: Ceiling;
        idempotencyKey: string;
    }) => Promise<WeirSubscribeReceipt>;
    /** Publish under the principal's own handle. */
    post?: (input: {
        handle: string;
        title: string;
        preview: string;
        text: string;
        access: 'public' | 'paid' | 'subscribers';
        /** Subscriber posts only: the tier index the body is sealed to. */
        tier?: number;
        contentKey?: string;
        price?: string;
        idempotencyKey: string;
    }) => Promise<{
        postId: string;
    }>;
    /** Send a direct message. */
    send?: (input: {
        to: string;
        text: string;
        preview: string;
        idempotencyKey: string;
    }) => Promise<{
        sent: true;
    }>;
    /**
     * Put one content key of the agent's own vault up for sale, or reprice it — `creator::set_content_price`.
     *
     * Moves no coin, and that is exactly why it sits behind the same signer-and-policy gate as the
     * tools that do: the bound on it is AUTHORITY (the target, the vault and the cap in the operator's
     * allow-lists), which only a policy can express. `price` and `currency` are carried unconverted,
     * like a ceiling; the vault's own coin is the only coin a price can be in, and the agent is where
     * that is compared.
     */
    priceContent?: (input: {
        vaultId: string;
        /** The HUMAN key, always. `edition: 'machine'` prices `<contentKey>#machine`; the port derives it. */
        contentKey: string;
        edition?: 'human' | 'machine';
        price: string;
        currency: Currency;
        idempotencyKey: string;
    }) => Promise<{
        txDigest: string;
    }>;
    /**
     * Whether the machine edition of a human key can be delivered on a vault — `GET
     * /api/studio/content-price`'s `machineBody`. Asked by `weir_price` before it prices a machine
     * edition: `absent` is a post sealed before machine editions were, whose plaintext is gone, and
     * pricing it would sell an `Unlock` that opens nothing.
     *
     * Answered either as the bare state or as the agent package's `Reading` of it; the tool reads
     * both, and a failed `Reading` or a throw concludes nothing (`unreadable`).
     */
    machineBody?: (input: {
        vaultId: string;
        contentKey: string;
    }) => Promise<MachineBodyState | {
        ok: true;
        value: MachineBodyState;
    } | {
        ok: false;
        failure: unknown;
    }>;
}
export type MachineBodyState = 'no-post' | 'sealed' | 'absent';
/**
 * The signing authority, as `@projectx-social/signer` presents it.
 *
 * **This interface is the contract handed to this package, reproduced exactly.** It is declared here
 * rather than imported so that this package typechecks while the sibling is still being written;
 * when that package ships, this declaration should be replaced by `import type { Signer } from
 * '@projectx-social/signer'` and the compiler will report any drift that has crept in — which is
 * strictly better than {@link assertSignerShape}, and is the reason a `TODO` is not enough here.
 *
 * # `scheme` is reported, never branched on
 *
 * An operator's most consequential question about an unattended signer is *what kind of key is
 * armed* — a single Ed25519 secret and a multisig are different amounts of trust in one process,
 * and the difference should be visible at startup rather than inferred from a config file. Nothing
 * in this package changes behaviour based on it: signing schemes are the signer's business.
 */
export interface Signer {
    readonly address: string;
    readonly scheme: 'ed25519' | 'secp256r1' | 'multisig';
    signPersonalMessage: (b: Uint8Array) => Promise<unknown>;
    signTransaction: (b: Uint8Array) => Promise<unknown>;
}
/**
 * A signer that can prove identity but cannot move money.
 *
 * # How a read-only signer is recognised, and the wrong answer that was written here first
 *
 * The first version of this file tested for the **absence of `signTransaction`**, reasoning that an
 * authority which cannot produce a transaction cannot spend. The reasoning is sound and the test is
 * wrong, because it does not match the implementation it has to classify. `readOnlySigner` in
 * `@projectx-social/signer` returns an object with **both** methods present; each resolves to
 * `fail('unconfigured', …)`. A structural test therefore sees a complete `Signer`, calls it a
 * signing signer, and **arms the spending tools on a deployment that cannot sign** — which is the
 * "tool that always fails" this package refuses to ship, arrived at from the other direction.
 *
 * So capability is determined by **trying it**. {@link probeSigner} asks the signer to sign one
 * harmless message at startup and reads the answer. A key that is there signs; a read-only
 * stand-in refuses, in the same `Reading` shape everything else in this workspace refuses in.
 *
 * `signPersonalMessage` is the right method to probe, and that is not an accident of convenience.
 * `PolicySigner` documents it as **not policy-gated**: a personal message moves nothing, so there
 * are no effects for a policy about effects to judge. Probing `signTransaction` instead would
 * conflate "there is no key" with "the policy said no to this particular spend", which are opposite
 * facts. The probe therefore measures *custody*, which is what this classification is about, and
 * leaves *authorisation* to the layer that owns it.
 *
 * A read-only binding is what a public hosted deployment is meant to hold: an identity for
 * `weir_balance` to be *about*, and no ability to spend.
 */
export type SignerBinding = {
    kind: 'none';
} | {
    kind: 'read-only';
    signer: Signer;
} | {
    kind: 'signing';
    signer: Signer;
};
/** What `openWeir` hands the tool layer. */
export interface WeirBinding {
    port: WeirPort;
    signer: SignerBinding;
    /**
     * Whether `@projectx-social/policy` was loadable.
     *
     * # Why loadability is the test, and the honest limit of it
     *
     * The policy module is where the principal's standing authority lives — the answer to "is a
     * ceiling of this size, for this tool, something I authorised in advance". It is consulted by the
     * signer, not by this package, and that separation is deliberate: a component that hostile
     * content talks to must not be the component that reads the policy.
     *
     * But **this package must still refuse to arm a spending tool when the thing that bounds it is
     * absent.** A spending tool with no policy behind it is a ceiling stated by a model and checked
     * by nobody, which is the defect this whole rework exists to remove. So the gate is: no policy
     * module, no spending tools.
     *
     * The check is that the module loads, and nothing more. A stronger check would mean calling into
     * an API this package would have to invent on a sibling's behalf, and an invented API that the
     * sibling then does not implement is a false assurance dressed as a strict one. Loadability is
     * weak, it is stated as weak in the README, and it is the strongest honest check available until
     * that package publishes its shape.
     */
    policyAvailable: boolean;
}
/** The logical things this server can offer. One tool each; see `tools.ts`. */
export type Capability = 'search' | 'quote' | 'authorship' | 'agents' | 'seeking' | 'read-preview' | 'balance' | 'buy' | 'subscribe' | 'post' | 'send' | 'price';
/**
 * What this binding can actually do.
 *
 * # The rule
 *
 * A capability is present when **the method that serves it exists**, and — for anything that
 * spends or writes — when a signing signer and a policy module are both bound. Nothing here reads
 * configuration, an environment variable, or a mode flag. Configuration describes what an operator
 * intended; this describes what will succeed.
 *
 * # Two capabilities that are absent today, named so nobody rediscovers them
 *
 * **`search`.** It needs `feed`, and `@projectx-social/agent` no longer exports one. The reason is
 * recorded in that package at length and is not a gap waiting to be filled in: `feed()` went
 * through `GET /api/posts`, and `packages/web/app/api/posts/route.ts` exports exactly `dynamic` and
 * `POST`. There is no `GET`, there never was on this deployment, and Next.js answers an
 * unimplemented method with 405 — so every call returned a refusal, always. It was removed rather
 * than left to fail with an apologetic message, because an honest error does not make an exported
 * method honest.
 *
 * It also cannot be rebuilt from chain events. `sui-contracts/sources/creator.move` emits ten event
 * types and the only one touching content is `ContentPriced { vault, content_key, price }`. There is
 * no title, no preview, no body, no handle and no publication time in any of them: a post lives in
 * Postgres, and the chain knows only that some opaque key under some vault has a price.
 *
 * **`read-preview`.** It needs `readPreview`, and no method on the agent returns the plaintext of a
 * post to an already-entitled reader. `quote` prices a content key and `unlock` buys one; neither
 * reads. This is a real gap in the agent surface rather than a decision, and it is recorded in the
 * README's open list.
 *
 * Both come back the moment the method appears. Neither is registered until then, and this function
 * is the only place that decides.
 *
 * # Why `balance` is grouped with reading
 *
 * It signs nothing and spends nothing. It needs an *address* — there is no "my balance" without a
 * "my" — which is why it depends on a signer being bound at all, including a read-only one. Grouped
 * by what it needs rather than by what it costs, and `tools.ts` marks it `readOnlyHint: true` so a
 * runtime is told the truth about it.
 */
/**
 * Unwrap what `createAgent` actually returns, which is a `Reading<Agent>` and not an `Agent`.
 *
 * # The defect this exists to close
 *
 * The call site asked only whether the answer was an object. BOTH answers are: a success is
 * `{ ok: true, value: … }`, a refusal is `{ ok: false, failure: … }`. Neither carries `feed`,
 * `quote`, `unlock` or any other method — and {@link capabilitiesOf} decides what this server can
 * do by asking `typeof port[name] === 'function'` for each one.
 *
 * So the envelope passed the guard and was bound as though it were the agent, every capability
 * check answered false, and the server started and registered **zero tools** — on the SUCCESS path
 * as much as the failure path. It did not crash and it did not warn. A server with no tools is a
 * valid server, and this one reported that it was fine.
 *
 * A refusal is now a refusal rather than an inert endpoint: an operator is told at startup why the
 * agent could not be built, instead of discovering it from a client that lists nothing.
 *
 * @throws StartupRefusal when the agent refused, or when the shape is not a Reading at all.
 */
export declare function agentFromReading(created: unknown): WeirPort;
export declare function capabilitiesOf(binding: WeirBinding): ReadonlySet<Capability>;
export type TransportMode = 'stdio' | 'http';
export interface ServerOptions {
    mode: TransportMode;
    baseUrl: string;
    /** Present only in stdio mode. `resolveOptions` refuses to produce a non-null value under HTTP. */
    secretKey: string | null;
    /** `WEIR_AGENT_POLICY`, stdio mode only; null otherwise. */
    policyPath: string | null;
    httpHost: string;
    httpPort: number;
    /** Browser origins permitted to drive the HTTP endpoint. Empty means no browser may. */
    allowedOrigins: string[];
    /** `Host` header values this endpoint answers to. See {@link hostAllowed}. */
    allowedHosts: string[];
    /**
     * The environment the agent library is handed — {@link agentEnvironment}, a projection of exactly
     * the names in {@link AGENT_ENVIRONMENT}, never the whole process environment.
     */
    agentEnvironment: Record<string, string>;
    /**
     * The tools this process actually registered, for {@link DISCOVERY_PATH}. Set by the entry point
     * after `registerTools` has run, so the document can never advertise a tool that was not built.
     * Empty until then, which reads as "this process registered nothing" — the true answer at that
     * moment, and the safe one.
     */
    discoveryTools: readonly string[];
}
/** The default the operator gets if they name nothing. Production, because that is where posts are. */
export declare const DEFAULT_BASE_URL = "https://weir.social";
/** Env var names, in one place, so the README and the loader cannot drift apart. */
export declare const ENV: {
    readonly key: 'WEIR_AGENT_KEY';
    readonly baseUrl: 'WEIR_BASE_URL';
    readonly httpHost: 'WEIR_MCP_HTTP_HOST';
    readonly httpPort: 'WEIR_MCP_HTTP_PORT';
    readonly allowedOrigins: 'WEIR_MCP_ALLOWED_ORIGINS';
    readonly allowedHosts: 'WEIR_MCP_ALLOWED_HOSTS';
    /**
     * Path to the operator's policy document (`@projectx-social/policy` `PolicyDoc` as JSON). Read
     * only in stdio mode with a key, like the key itself. When present, every transaction the agent
     * signs goes through a `PolicySigner` built from it, and that is what `policyAvailable` means.
     */
    readonly policy: 'WEIR_AGENT_POLICY';
};
/**
 * The variables the agent library reads, and the only ones it is handed.
 *
 * `createAgent` loads its manifest from the record it is given — `loadAgentManifest(config)` reads
 * the six chain ids, the coin type and the base URL from THAT object, not from `process.env`. This
 * package used to pass `{ source: 'weir-mcp' }`, so the agent saw none of them and refused with
 * "missing required environment variables" whatever the operator had exported; hosted mode had never
 * started on any machine. It is handed a projection now, and a projection rather than `process.env`
 * itself so that the one secret the agent's own manifest names (`PROJECTX_SOCIAL_AGENT_SECRET`) can
 * never travel to it by accident from this side — keys reach `createAgent` through `keypair`, and in
 * HTTP mode that is `null` by construction.
 *
 * The list is checked, not trusted: `test/env-handoff.ts` compares it to the agent's and the SDK's
 * own exported names, so a variable added over there fails a test here.
 */
export declare const AGENT_ENVIRONMENT: readonly ['PROJECTX_SOCIAL_NETWORK', 'PROJECTX_SOCIAL_GRPC_URL', 'PROJECTX_SOCIAL_PACKAGE_ID', 'PROJECTX_SOCIAL_LATEST_PACKAGE_ID', 'PROJECTX_SOCIAL_PLATFORM_ID', 'PROJECTX_SOCIAL_REGISTRY_ID', 'PROJECTX_SOCIAL_AGENT_COIN_TYPE', 'PROJECTX_SOCIAL_AGENT_BASE_URL', 'PROJECTX_SOCIAL_KEY_REGISTRY_ID'];
/** Exactly the {@link AGENT_ENVIRONMENT} names that are set and non-empty, trimmed. */
export declare function agentEnvironment(env: NodeJS.ProcessEnv): Record<string, string>;
/** Raised for every condition that must stop the process before it can do harm. */
export declare class StartupRefusal extends Error {
    constructor(message: string);
}
/**
 * Turn argv and the environment into the one shape the rest of the process reads.
 *
 * Every `StartupRefusal` below is a deployment mistake that is silent in every other design.
 *
 * The environment is passed in rather than read from `process.env` so that the rules are testable
 * without mutating global state — and so that no other module in this package has a reason to touch
 * `process.env` at all, which is what keeps the key's blast radius to this one function.
 */
export declare function resolveOptions(argv: readonly string[], env: NodeJS.ProcessEnv): ServerOptions;
/**
 * The `Host` values this endpoint answers to when the operator names none.
 *
 * The address it was told to bind, at the port it was told to bind — plus, on loopback, the two
 * other spellings of loopback, because `localhost:8402` and `127.0.0.1:8402` are the same endpoint
 * and an operator who typed one should not be refused for typing the other. `[::1]` is included for
 * the same reason on a dual-stack host.
 *
 * A default of "anything" would make {@link hostAllowed} decorative, which is the usual way this
 * control ends up shipped but disabled.
 */
export declare function defaultAllowedHosts(httpHost: string, httpPort: number): string[];
/**
 * Everything this process says, it says on **stderr**.
 *
 * Not a style preference. In stdio mode, stdout *is* the JSON-RPC frame stream: one stray
 * `console.log` anywhere in the process emits a line the client cannot parse, and the whole session
 * dies with a decoding error that names neither the line nor the module that wrote it. It is the
 * single most common way an MCP server breaks, and it breaks in a way that looks like the protocol
 * is at fault.
 *
 * The rule is therefore absolute rather than mode-dependent: nothing in this package writes to
 * stdout, in either transport, ever.
 */
export declare function log(...parts: unknown[]): void;
/**
 * Bind everything this deployment is allowed to have, and nothing it is not.
 *
 * # Why every import here is dynamic, and why that outlives the siblings landing
 *
 * Two reasons, and the second is the durable one.
 *
 *  1. The sibling packages are in flight. A static import would fail this package's typecheck on
 *     somebody else's progress rather than on its own correctness.
 *  2. **A hosted, keyless deployment has no business loading a signing library into its address
 *     space at all.** Deferring the import means the code that *can* sign is only ever resident in
 *     a process that was given something to sign with. That reason does not expire.
 *
 * When the siblings land, the `Signer` declaration in this file should become a real typed import
 * so drift is caught by the compiler rather than by {@link assertSignerShape} — but the *import
 * call* stays dynamic, for reason two.
 *
 * # What a missing piece produces
 *
 * Never a crash and never a tool that refuses. A missing piece produces a smaller capability set,
 * computed by {@link capabilitiesOf}, and a startup line that names exactly what is missing. An
 * operator reading that line can tell the difference between "this deployment cannot spend" and
 * "this deployment is broken", which is the distinction a warning buried in a log destroys.
 */
export declare function openWeir(options: ServerOptions): Promise<WeirBinding>;
/**
 * Find the signing authority for this deployment, and measure what it can do.
 *
 * # This package does not choose custody, and that is why it constructs so little
 *
 * `@projectx-social/signer` offers a local keypair, a multisig, a KMS adapter and a read-only
 * stand-in, and wraps any of them in a `PolicySigner` that needs a policy document, a spend ledger
 * and a simulation port. **Which of those an operator should hold is an operator's decision and an
 * agent-layer wiring job, not this package's.** A `PolicySigner` assembled here would mean this
 * file inventing a policy on somebody's behalf, which is the same class of mistake as enforcing a
 * ceiling here was.
 *
 * So this does the smallest honest thing. In stdio mode, where the operator has deliberately handed
 * this process a secret, it opens the local keypair signer that secret names. In hosted mode there
 * is no secret and therefore no signer at all — `readOnlySigner` needs an address to be read-only
 * *about*, and without a key there is not one. Then it probes, and reports.
 */
/**
 * Read the operator's policy document and validate the two things a wrong file would get past:
 * shape, and WHOSE policy it is. A document for another address bound to this key would either
 * refuse everything (harmless) or, worse, allow-list the wrong agent's own account and vault.
 */
export declare function loadPolicyDoc(text: string, signerAddress: string): {
    ok: true;
    policy: Record<string, unknown>;
} | {
    ok: false;
    reason: string;
};
/**
 * Run beside the agent, speaking JSON-RPC over the pipe the operator gave us.
 *
 * There is no listener, no port and no authentication, because there is no channel: the only party
 * that can speak to this process is the parent that spawned it. That is the whole reason a signing
 * key is admissible here and nowhere else — the key's audience is exactly one process, chosen by
 * the operator, on the operator's own machine.
 *
 * It is also why `idempotency.ts` may keep its ledger in memory: one pipe means one caller, so
 * there is no second client to be confused with.
 */
export declare function serveStdio(server: McpServer): Promise<void>;
export declare const MCP_PATH = "/mcp";
/**
 * Where a client looks to find out what this endpoint is, before it speaks the protocol to it.
 *
 * Added 2026-09-02, because the Cloud Run log showed a client asking for exactly this path and
 * getting a 404 with nothing in it. There is no ratified standard behind the filename; it is the
 * one clients are already trying, which is the only argument that matters for a discovery path.
 * The document says so about itself rather than implying an authority it does not have.
 */
export declare const DISCOVERY_PATH = "/.well-known/mcp.json";
export interface Discovery {
    name: string;
    description: string;
    endpoint: string;
    transport: 'streamable-http';
    /** Exactly the tools registered on this process. Computed, never a list written by hand. */
    tools: string[];
    /** True when no tool on this process can move value. Derived from the tools, not asserted. */
    readOnly: boolean;
    authentication: 'none';
    documentation: string;
    manifest: string;
    note: string;
}
/**
 * What this endpoint says about itself.
 *
 * Everything here is derived from what the process actually built. `tools` is the list
 * `registerTools` returned, so a deployment that failed to bind a capability advertises fewer
 * tools rather than advertising a tool that would refuse every call — which is the whole failure
 * this document could otherwise introduce.
 *
 * `readOnly` is computed from the tool names rather than from the mode, because mode is a
 * statement of intent and the tool list is a fact about what was registered.
 */
/**
 * The address this endpoint tells clients to use.
 *
 * NOT the request's `Host`. Behind Cloud Run and Cloudflare the container sees the platform's own
 * hostname, and the first deployment of this document (2026-09-02) duly published
 * `https://weir-mcp-….run.app/mcp` — an address the Host allowlist in this very file refuses with
 * 403. It advertised a door it was built to keep shut.
 *
 * The allowlist is the deployment's own statement of the names it answers to, so its first entry is
 * the canonical one. Scheme follows the host rather than the request: a loopback allowlist is a
 * developer's machine and is plain HTTP; anything else reached from outside is not.
 */
export declare function canonicalOrigin(options: ServerOptions, requestHost: string | undefined): string;
export declare function discoveryDocument(options: ServerOptions, tools: readonly string[], origin: string): Discovery;
/**
 * Whether a request's `Origin` may drive this endpoint.
 *
 * The default — an empty allowlist — refuses **every** request that carries an `Origin` header at
 * all, and accepts every request that carries none. That split is not arbitrary: browsers attach
 * `Origin` and MCP clients do not, so the default admits agent runtimes and excludes web pages.
 *
 * The attack this closes is the local one. An operator runs the hosted build on `127.0.0.1:8402`
 * for convenience, and then any page they visit can `fetch()` it, because loopback is not a
 * security boundary against the browser already running on that machine.
 *
 * The SDK's own `allowedHosts`/`enableDnsRebindingProtection` options are deprecated in 1.30.0 in
 * favour of exactly this — validation outside the transport — which is why it is written here.
 */
export declare function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean;
/**
 * Whether a request's `Host` names this endpoint. **This is the DNS-rebinding control.**
 *
 * # The attack, precisely, because it is easy to mistake for the `Origin` one
 *
 * `Origin` stops a page at `https://evil.example` from calling `http://127.0.0.1:8402/mcp`,
 * because that request carries `Origin: https://evil.example` and the allowlist is empty.
 *
 * DNS rebinding routes around that entirely. The attacker's page is served from
 * `http://rebind.example`, whose DNS record they control. It first resolves to their own server;
 * then the record is re-pointed at `127.0.0.1` with a one-second TTL. The browser re-resolves,
 * connects to the operator's loopback, and — because the page's origin is still
 * `http://rebind.example` and the destination is *believed* to be the same origin — the request is
 * **same-origin**. `Origin` may not be sent at all, and if it is, it is the page's own.
 *
 * The one header that still tells the truth is `Host`, because the browser fills it from the name
 * in the URL: `Host: rebind.example`. This server was never `rebind.example`, so it refuses.
 *
 * # Why a missing `Host` is refused rather than allowed
 *
 * `Origin` is absent for a legitimate and common reason — non-browser clients do not send it — and
 * so absence there means "probably an agent runtime". `Host` is different: HTTP/1.1 makes it
 * mandatory and every HTTP/2 client sends `:authority`, which Node surfaces as `host`. An HTTP
 * request arriving here without one is malformed, and a malformed request is not the thing to
 * extend the benefit of the doubt to on the one check that stands between a loopback server and a
 * hostile web page.
 *
 * Comparison is exact and case-insensitive on the host, since DNS is case-insensitive and a
 * browser may send either. No suffix matching and no wildcards: `evil-127.0.0.1.example` ends with
 * nothing this server should accept, and a suffix rule is how that becomes a match.
 */
export declare function hostAllowed(host: string | undefined, allowed: readonly string[]): boolean;
/**
 * Serve MCP over Streamable HTTP, statelessly.
 *
 * # A fresh server and transport for every request
 *
 * Not a performance oversight — the alternative is wrong. In stateless mode there is no session id
 * to attribute a response to, so a single shared transport serving concurrent callers can route one
 * caller's response onto another caller's stream, because the only key left is the JSON-RPC request
 * id and two clients pick those independently. Per-request instances make that structurally
 * impossible.
 *
 * It also *is* the second security property, expressed as code rather than as a promise: there is
 * no place to keep state between requests, so no state is kept. Nothing accumulates, nothing
 * identifies a caller across calls, and a restart loses nothing because there was nothing.
 *
 * `sessionIdGenerator` is omitted rather than passed as `undefined` — this repo compiles with
 * `exactOptionalPropertyTypes`, under which those are different things, and the SDK reads absence
 * as "session management disabled".
 */
export declare function serveHttp(newServer: () => Promise<McpServer>, options: ServerOptions): Promise<HttpServer>;
//# sourceMappingURL=transport.d.ts.map