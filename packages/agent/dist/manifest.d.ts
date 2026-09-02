/**
 * What this agent is pointed at, and what it is allowed to spend there.
 *
 * # There are no defaults in this file either, and it is the same argument
 *
 * `packages/sdk/src/config.ts` refuses to guess a package id, and gives the reason: a
 * syntactically valid placeholder is not a failed request, it is money sent somewhere nobody
 * chose. That reasoning gets *sharper* here, not softer. An agent runs unattended. A human paying
 * a wrong address at least sees the confirmation screen; an agent pointed at the wrong deployment
 * discovers it in a balance report, days later, after a loop has run some thousands of times.
 *
 * So {@link loadAgentManifest} takes an environment and returns a {@link Reading}. Nothing in this
 * module falls back to mainnet, and {@link MAINNET_RECORD} below is a **record**, not a default —
 * it is exported so tests and documentation can name the real ids without retyping them, and
 * loading it is an explicit call a reviewer can see in a diff.
 *
 * # The original package id and the latest package id are different values and both are needed
 *
 * This is the single most expensive mistake available in this codebase and it is silent. Sui does
 * not resolve a package address to its newest version: a `moveCall` at the ORIGINAL address runs
 * the ORIGINAL bytecode. It does not error in a way that names the cause — a module added after
 * publication is simply absent, and a function whose behaviour changed in an upgrade quietly does
 * the old thing.
 *
 * The estate has already paid for this once. `UPDATE.md`, 2026-08-30: the harvest daemon was
 * pinned to package v2 against a v3 deployment, so every harvest it built executed v2 bytecode.
 * Nothing was at risk only because that daemon holds no capability. An agent that spends does.
 *
 * Both ids are therefore carried separately, exactly as `ProjectXSocialConfig` carries them:
 *
 *   - `packageId` — the ORIGINAL publication. Type tags and event filters, forever. It never moves.
 *   - `latestPackageId` — the current version. **Every** `moveCall` target, and nothing else.
 *
 * The SDK's transaction builders in `packages/sdk/src/tx.ts` already read `latestPackageId` for
 * every target, which is why this package builds through them rather than writing its own
 * `moveCall` strings. Reusing that module is not tidiness; it is how this agent inherits a
 * decision it would otherwise have to remember.
 */
import { type ProjectXSocialConfig, type Reading } from '@projectx-social/sdk';
/** Every variable this package reads beyond the six the SDK already requires. */
export declare const AGENT_ENV: {
    /**
     * The coin an agent spends. `unlock<T>`, `subscribe<T>` and `tip<T>` are generic and the
     * contract does not pick T for you.
     *
     * No default, and USDC is not assumed despite being the only coin this product has ever
     * denominated a vault in. A vault opened in a different coin takes payment in that coin and
     * aborts on any other, so an assumed T is a transaction that cannot succeed — and the agent
     * would retry it.
     */
    readonly coinType: 'PROJECTX_SOCIAL_AGENT_COIN_TYPE';
    /**
     * The agent's Ed25519 secret, bech32 `suiprivkey1…`.
     *
     * **A secret.** Named here so a deployment script can print the variable list; its value is never
     * read by this module, never echoed in a failure, and never attached to a manifest. See
     * `keys.ts`, which is the only file that touches it.
     */
    readonly secret: 'PROJECTX_SOCIAL_AGENT_SECRET';
    /** Where the weir HTTP surface lives, for the calls that are not chain calls. */
    readonly baseUrl: 'PROJECTX_SOCIAL_AGENT_BASE_URL';
    /**
     * Optional. The object id of ONE coin of `coinType` this agent owns and pays from, by splitting.
     * Needed only when a policy signer is bound and the vault's coin is not SUI. See `PaymentSource`.
     */
    readonly paymentCoin: 'PROJECTX_SOCIAL_AGENT_PAYMENT_COIN';
};
/**
 * The gas budget every transaction this agent builds is capped at, in MIST.
 *
 * # Why a ceiling rather than letting the node choose
 *
 * An unattended signer with no gas ceiling has an unbounded spend that never appears as an error.
 * The daemon learned this in its own words: a doomed transaction still costs gas, and across a
 * loop that spend "shows up as a gas balance draining, not as an error". Simulation catches the
 * doomed ones; it does not catch a correct transaction whose gas the node was willing to quote
 * high. Only a budget does.
 *
 * Half a SUI. Generous against every call this package builds — the most expensive is `unlock`,
 * which touches one shared vault, one owned account and the clock — and small enough that a bug
 * looping on it drains a funded key in hours rather than minutes, which is the difference between
 * an alert and a post-mortem.
 */
export declare const DEFAULT_GAS_BUDGET_MIST = 500000000n;
export interface AgentManifest {
    /** Package ids, object ids and the gRPC endpoint. Loaded through the SDK, unmodified. */
    config: ProjectXSocialConfig;
    /** The coin every spending method is denominated in. The `T` in `unlock<T>`. */
    coinType: string;
    /** Origin of the weir HTTP surface, with no trailing slash. */
    baseUrl: string;
    /** Ceiling on gas for every transaction built by this agent. */
    gasBudgetMist: bigint;
    /**
     * `PROJECTX_SOCIAL_AGENT_PAYMENT_COIN`: the one owned coin of `coinType` payments are split from,
     * or null. Required only under a policy signer for a non-SUI coin; see `PaymentSource`.
     */
    paymentCoin: string | null;
    /**
     * `PROJECTX_SOCIAL_KEY_REGISTRY_ID`: the on-chain `key_registry` object, or null when unset.
     * Needed only by the mind (`publishMindKey`, `remember`); every other call ignores it. Loaded
     * through the SDK's `loadKeyRegistryId`, so it is validated as the browser validates it.
     */
    keyRegistryId: string | null;
}
/**
 * Build a manifest from an environment.
 *
 * Takes the environment as an argument rather than reaching for `process.env`, for the same reason
 * `loadConfig` does: it is testable, and a caller running two agents against two deployments in
 * one process is a normal thing to want rather than a misuse.
 */
export declare function loadAgentManifest(env: Record<string, string | undefined>, overrides?: {
    gasBudgetMist?: bigint;
}): Reading<AgentManifest>;
/**
 * Mainnet, as read from the chain on 2026-08-31. **A record, not a default.**
 *
 * Nothing in this package reads this constant. It exists so tests, documentation and a deployment
 * script can name the live deployment without a literal being retyped into each of them — the same
 * role `sui-contracts/deploy/mainnet.json` plays for the repo, and it carries the same warning:
 * load it deliberately if you want it, and do not let it become an implicit default.
 *
 * The two package ids are the reason this is worth having at all. They differ, they look alike,
 * and using the first where the second belongs is a silent failure — see this file's header.
 */
export declare const MAINNET_RECORD: {
    readonly network: 'mainnet';
    /**
     * The ORIGINAL publication. Type tags and event filters only.
     *
     * Also the namespace Seal is bound to: `packages/sdk/src/seal.ts` requires version 1 of the
     * package for identity derivation, which is this address and not the one below.
     */
    readonly packageId: '0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d';
    /** The LATEST publication, version 3. **Every** `moveCall` target. */
    readonly latestPackageId: '0xfa7eb18bbb29b047ec86434e8a8f4cfba35615bde9680eebd781a187ca3a3694';
    /** The shared `platform::Platform`. */
    readonly platformId: '0x3f695b2c32714e2359c4bb9515598d8dd765b216148c5b8fa818073d52b50f36';
    /** The shared `account::Registry`. */
    readonly registryId: '0x1a3fb4ac25458d7524be064a2b7e1586ccd9ed09c0d5b351621e3b101e1203a0';
    /** Native USDC. Six decimals — never assume nine. `readDecimals` is the authority. */
    readonly usdcType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
};
/**
 * Assert an id looks like an id, for a caller assembling a manifest by hand.
 *
 * Exported because the loader above only sees ids that came through `loadConfig`, and a test or a
 * script building an `AgentManifest` literal gets no validation at all otherwise.
 */
export declare function isObjectId(value: string): boolean;
/** Same, for a coin type. */
export declare function isCoinType(value: string): boolean;
//# sourceMappingURL=manifest.d.ts.map