// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Chain calls an agent makes: read the price, refuse if it is wrong, simulate, then sign.
 *
 * # The order in this file is the safety property
 *
 * There is one exported function that submits — {@link simulateAndExecute} — and it simulates
 * inside itself. `packages/daemon/src/adapters/signer.ts` gives the argument for that shape and it
 * is worth quoting rather than rediscovering: a separate `submit()` "would eventually be called on
 * its own — that is not a hypothetical, it is what happens to every 'remember to simulate first'
 * convention".
 *
 * On a chain the cost of skipping is asymmetric. A doomed transaction still spends gas, and an
 * agent retrying one in a loop spends it invisibly — it surfaces as a balance draining, not as an
 * error. Worse, a *successful* transaction discovered after signing may have moved money somewhere
 * unintended, and nothing retries that away.
 *
 * # There is exactly ONE simulation reader in this repository and it is not in this file
 *
 * This module used to carry its own `statusOf()`, reading six candidate envelope paths because
 * `packages/sdk/src/client.ts::simulate()` was known to read the wrong one. That is no longer true:
 * the SDK's reader was corrected on 2026-08-31 and now reads `sim.Transaction.status` — capital T,
 * **no `effects` in the path** — measured live against mainnet as `{"success":true,"error":null}`,
 * and it refuses an unrecognised shape rather than passing it.
 *
 * So the second reader is deleted and {@link simulateAndExecute} calls `simulate()`. Two readers of
 * one wire format is the defect, not the mitigation: they drift, and the drift is silent in both
 * directions — the daemon spent a production run journalling every successful harvest as a failed
 * simulation because its copy read the JSON-RPC path against a gRPC client.
 *
 * # The gate is reached on EVERY transaction this package builds, and it is the only gate
 *
 * The previous version of this header claimed `Transaction.build({ client })` simulates internally
 * and throws first, making the explicit call below a second gate. **That is false for every
 * transaction this package builds, and it was the most dangerous sentence in the file** — it
 * described the explicit branch as belt-and-braces when it is in fact the only belt.
 *
 * Read from `@mysten/sui` 2.27.1, `src/client/core-resolver.ts:155-160`:
 *
 * ```ts
 * async function setGasBudget(transactionData, client, simulateExpiration) {
 *   if (transactionData.gasData.budget) {
 *     return;                                  // <- early return. Nothing is simulated.
 *   }
 *   const simulateResult = await client.core.simulateTransaction({ ... });
 *   if (simulateResult.$kind === 'FailedTransaction') { throw new SimulationError(...) }
 * ```
 *
 * `build()` only dry-runs when it has to *compute* a budget. {@link simulateAndExecute} always calls
 * `setGasBudget(manifest.gasBudgetMist)` first — it must, because an unattended signer with no gas
 * ceiling has an unbounded spend that never appears as an error — so the early return is taken
 * every time and `build()` makes no network call at all.
 *
 * Measured, not reasoned: building a fully-specified transaction with a gas budget set, against a
 * client whose `simulateTransaction` throws on contact, produced 211 bytes and **zero client
 * calls**. The abort probe recorded in the old header was real, but it was run without a gas
 * budget, which is a path this package never takes.
 *
 * `test/simulate-gate.test.ts` exercises the branch directly for this reason.
 *
 * # Why the bytes that are signed are provably the bytes that were simulated
 *
 * The SDK's `simulate()` takes a `Transaction`, not bytes, and builds it itself. Building twice
 * would be a real hazard rather than a tidiness question: `build()` re-resolves object references,
 * so a version changing between the two builds would mean signing bytes nobody simulated.
 *
 * So this module builds **once**, round-trips the bytes through `Transaction.from()`, and hands
 * *that* to `simulate()`. A transaction restored from BCS carries resolved inputs and a complete
 * `gasData`, so `needsTransactionResolution()` in `src/transactions/resolve.ts:28` is false and the
 * rebuild is pure local re-serialisation with no client involved. Measured: byte-identical, with no
 * client passed at all. The equality is asserted at runtime anyway, because a guarantee that costs
 * one comparison should not be left as a claim in a comment.
 *
 * # Three classifications, not two
 *
 * See {@link Precondition}. `Reading`'s kinds force a state-dependent refusal to be reported as
 * `malformed`, which reads as "never retry" — and "the platform is paused" or "fund the wallet" are
 * not that. The third classification is carried alongside, in this package, for reasons given in
 * full at {@link PRECONDITION_MARKER}.
 */
import { Transaction } from '@mysten/sui/transactions';
import { classify, decodeAbort, fail, ok, readContentPrice, readCreatorVault, simulate, tx as build, } from '@projectx-social/sdk';
import { sameAddress } from './keys.js';
/**
 * The prefix under which a `precondition` refusal names its condition in `Failure.detail`.
 *
 * A marker in the text rather than a field, because `Failure` is the SDK's shape and this package
 * does not get to add fields to it. It carries the NAME only; the fact that the refusal is a
 * precondition is the kind itself. The marker is machine-readable, it is the first thing in the
 * string so a truncating log still shows it, and {@link preconditionOf} is the only thing that
 * parses it — no caller should be matching on prose.
 *
 * Deliberately ugly. It is meant to look like a token and not like a sentence, because the one
 * failure mode of a text marker is somebody writing a message that accidentally contains it.
 */
export const PRECONDITION_MARKER = '[precondition:';
/** What has to change, per condition. One place, so a message cannot disagree with a name. */
const CLEARS_WHEN = {
    'creation-paused': 'an operator sets platform::set_creation_paused(false). Read platform.creation_paused to check.',
    'payments-paused': 'an operator sets platform::set_payments_paused(false). Read platform.payments_paused to check.',
    'vault-not-accepting': 'the creator calls creator::set_accepting(true). Read the vault to check.',
    'tier-retired': 'the creator reactivates that tier with creator::set_tier(..., active: true).',
    'content-not-priced': 'the creator calls creator::set_content_price for this key.',
    'insufficient-balance': 'this agent is funded with more of the coin it spends.',
    'referrer-not-registered': 'the address named as referrer opens an account here, or a different referrer is named.',
    'price-above-ceiling': 'the on-chain price falls below the ceiling, or the operator raises maxPrice deliberately.',
    'price-changed': 'a fresh quote is read and the decision is taken again against it.',
    'tip-below-minimum': 'the tip is raised to the creator minimum, or the creator lowers it.',
    'schema-not-migrated': 'the object is migrated to the package schema.',
};
/**
 * Refuse, naming a precondition.
 *
 * The SDK kind is `precondition`: not `transport` (retrying blindly is exactly wrong), not
 * `not-found` (the thing exists), not `unconfigured` (nothing here is missing from an env file),
 * not `malformed` (the request was fine). The marker at the head of `detail` names WHICH
 * condition; {@link preconditionOf} reads the name and {@link classificationOf} reads the kind.
 */
export function refusePrecondition(name, source, detail) {
    return fail('precondition', source, `${PRECONDITION_MARKER}${name}] ${detail} This clears when ${CLEARS_WHEN[name]}`);
}
/** The precondition a failure names, or `null` when it names none. */
export function preconditionOf(failure) {
    // The kind is authoritative. A `malformed` failure whose text happens to start with the marker
    // — a message quoting one, say — is not a precondition, and must not hand a caller `mayClear`.
    if (failure.kind !== 'precondition')
        return null;
    if (!failure.detail.startsWith(PRECONDITION_MARKER))
        return null;
    const end = failure.detail.indexOf(']');
    if (end === -1)
        return null;
    const name = failure.detail.slice(PRECONDITION_MARKER.length, end);
    const clearsWhen = CLEARS_WHEN[name];
    // An unrecognised name is not a precondition. Better to under-report than to hand a caller a
    // `mayClear: true` for a condition this package cannot say anything about.
    if (clearsWhen === undefined)
        return null;
    return { name, clearsWhen, mayClear: true };
}
/**
 * The three-way classification, which is the thing an agent loop actually branches on.
 *
 * `unconfigured` is deliberately `permanent` here even though an operator could fix it. The
 * distinction being drawn is not "could a human ever change this" — a human could change anything —
 * it is **"can this loop usefully come back and look again on its own"**. A paused platform, an
 * unfunded wallet and a moved price all answer yes. A missing environment variable answers no: the
 * process must stop and be restarted with a different environment, and a loop that keeps polling it
 * is a loop that never reports the real problem.
 */
export function classificationOf(failure) {
    // Exhaustive on purpose: a kind added to the SDK union without a line here turns `_exhaustive`
    // into a non-`never` and the build goes red. A loop must never meet a kind it cannot classify.
    switch (failure.kind) {
        case 'transport':
        case 'timeout':
            return 'transport';
        case 'precondition':
            // A `precondition` whose name this package does not recognise is still one the loop may
            // wait on — it is not permanent — but `preconditionOf` will not invent a `clearsWhen` for it.
            return 'precondition';
        case 'malformed':
        case 'unconfigured':
        case 'not-found':
        case 'budget-exhausted':
        case 'denied':
            return 'permanent';
        default: {
            const _exhaustive = failure.kind;
            return _exhaustive;
        }
    }
}
/**
 * Move abort codes, classified. Read from the Move sources on 2026-08-31, not from memory.
 *
 * Keyed by **module then code**, and the module half is load-bearing rather than decoration:
 * `abort code: 4` is `EAlreadyRegistered` in `account`, `ECreationPaused` in `platform` and
 * `ENotAccepting` in `creator`. One of those three is permanent and two are preconditions. A table
 * keyed on the code alone would classify all three the same way and be wrong twice.
 *
 * The module reported by a Sui abort is the module the failing `assert!` is **written in**, not the
 * entry point that was called. `account::open` begins `platform.assert_can_create()`, and that
 * assert lives at `platform.move:319`, so a paused platform surfaces as a `platform` abort from an
 * `account::open` call. That is why `account: 4` can stay permanent without swallowing a pause.
 *
 * `'permanent'` is written out for every listed code rather than left implicit, so adding a code to
 * this table forces a decision instead of defaulting to one.
 *
 * Sources:
 *   - `sui-contracts/sources/platform.move:55-69` (codes) and `:317-325` (the two assert sites)
 *   - `sui-contracts/sources/account.move:48-62`
 *   - `sui-contracts/sources/creator.move:75-116`
 */
export const ABORT_CLASSIFICATION = {
    platform: {
        1: 'schema-not-migrated', // EWrongVersion — clears on platform::migrate.
        2: 'permanent', // EWrongPlatform — the wrong deployment. Waiting cannot fix an address.
        3: 'permanent', // EFeeAboveCeiling — above the compiled ceiling. Not a state.
        4: 'creation-paused', // ECreationPaused
        5: 'payments-paused', // EPaymentsPaused
        6: 'insufficient-balance', // EInsufficientFee — the SUI sent does not cover the creation fee.
        7: 'permanent', // EInsufficientTreasury — an operator claim path; not reachable from this agent.
        /*
          8: ENotUpgraded. NOT `schema-not-migrated`, and the difference is the opposite of what the
          name suggests. platform.move:283 asserts `platform.version < VERSION`, and its own doc line
          reads "`migrate` was called when the stored version already matches the package" — so this
          fires when there is nothing to migrate, not when there is. Classified permanent, and the
          point is moot for this agent either way: it never calls `migrate`, which is an operator path
          behind a capability it does not hold.
        */
        8: 'permanent',
    },
    account: {
        1: 'permanent', // EHandleLength — 3 to 30. A different handle, not a later retry.
        2: 'permanent', // EHandleCharset
        3: 'permanent', // EHandleTaken — another address holds it.
        /*
          4: EAlreadyRegistered. Permanent, and worth the note because `account::close` exists at
          `account.move:186`, so in the narrowest sense the condition *can* clear. It is still not a
          precondition: the only way it clears is this agent deleting its own account, which is an act
          rather than a wait, and the correct response is to use the account it already has. A loop that
          treated this as "come back later" would wait for ever for something only it could do.
        */
        4: 'permanent',
        5: 'permanent', // ENotOwner
        6: 'permanent', // EWrongPlatform
        7: 'permanent', // ESelfReferral
        /*
          8: EHandleMismatch. Guards `account::close` against a registry that has drifted from the
          object graph. Permanent, and it is the one code in this table nobody should ever see: if it
          fires, the registry and the accounts disagree, and no amount of waiting reconciles them.
        */
        8: 'permanent',
        /*
          9: EReferrerNotRegistered. A PRECONDITION, and the only one in this module.
    
          Every other code here describes something the caller must change — a different handle, a
          different account, a different platform. This one describes something SOMEBODY ELSE has not
          done yet: the address named as referrer does not hold an account here. It can clear without
          the caller doing anything, the moment that person registers, so an agent that treated it as
          permanent would abandon a referral that becomes valid an hour later.
    
          An agent hitting it should say which address was refused. "Your referrer is not registered
          here" is actionable; "permanent failure" is not.
        */
        9: 'referrer-not-registered',
    },
    creator: {
        1: 'schema-not-migrated', // EWrongVersion — the vault needs migrating.
        2: 'permanent', // EWrongVault — a CreatorCap bound to a different vault.
        3: 'permanent', // EWrongPlatform
        4: 'vault-not-accepting', // ENotAccepting — creator::set_accepting(true) clears it.
        5: 'insufficient-balance', // EInsufficientPayment — the coin does not cover the price.
        6: 'permanent', // ENoSuchTier — acting on a stale index. Read the vault again, do not wait.
        7: 'tier-retired', // ETierInactive — creator.move:394-397 sets `active` back to true.
        8: 'permanent', // ETooManyTiers
        9: 'permanent', // EBadPeriod
        10: 'permanent', // EZeroPrice
        11: 'tip-below-minimum', // EBelowMinTip
        12: 'content-not-priced', // EContentNotForSale — UPDATE.md 2026-08-30 records this clearing.
        13: 'permanent', // ESelfPayment — a creator cannot pay their own vault, ever.
        14: 'insufficient-balance', // EInsufficientBalance
        15: 'permanent', // ESubscriptionVaultMismatch
        16: 'permanent', // EEmptyName
        17: 'permanent', // ENotUpgraded — migrate with nothing to migrate. See platform:8 above.
        18: 'permanent', // EPeriodNotWholeSealPeriods
        19: 'permanent', // ETierPriceNotAscending — a tier must cost more than the one before it; the same call never succeeds.
        /*
          20: ENotSubscriber. `renew` presented somebody else's Subscription. Permanent for the same
          reason entitlement's ENotHolder is: the holder of the object is fixed at mint and the object
          cannot be transferred, so no wait and no retry changes who is allowed to renew it. Until this
          code existed the same refusal came back as 15, indistinguishable from the wrong vault.
        */
        20: 'permanent',
        21: 'permanent', // EWrongIdentity — the identity bytes do not match the vault, tier and period named.
        22: 'permanent', // ETierNotPaidFor — the tier costs more than the subscription pays; no retry changes the price paid.
        23: 'permanent', // EPeriodNotPaid — the period is outside the paid window; renewing is a different action.
    },
};
/** The abort a raw error names, with its classification. `null` when there is no abort in it. */
export function classifyAbort(raw) {
    if (!/abort code:\s*\d+/i.test(raw))
        return null;
    const decoded = decodeAbort(raw);
    const entry = ABORT_CLASSIFICATION[decoded.module]?.[decoded.code];
    return {
        module: decoded.module,
        code: decoded.code,
        explanation: decoded.explanation,
        // An unlisted code is NOT assumed to be a precondition. Under-reporting costs a retry that
        // never happens; over-reporting costs a loop waiting for a condition that will never clear.
        precondition: entry === undefined || entry === 'permanent' ? null : entry,
    };
}
/**
 * Refuse a price the operator did not authorise.
 *
 * Returns a `Reading` rather than throwing so the refusal travels the same way every other failure
 * in this codebase does, and so an agent loop can log it and continue rather than dying — a thrown
 * exception in an autonomous process is a restart, and a restart is a retry of the thing that was
 * just refused.
 */
export function guardPrice(input) {
    const source = `spend guard for ${input.what}`;
    /*
      A missing ceiling is a refusal, not a default.
  
      The type says `bigint`, so this branch is unreachable from TypeScript — and it is here because
      this package is a library, JavaScript callers exist, and JSON round-trips drop fields. A default
      ceiling would be a number this file chose on behalf of every operator who ever forgot one, and
      the whole argument above is that the ceiling must come from the operator.
    */
    if (input.maxPrice === undefined || typeof input.maxPrice !== 'bigint') {
        return fail('malformed', source, 'maxPrice is required on every spending call and was not supplied. There is no default ' +
            'ceiling: it is the only thing standing between this agent and a price it read in ' +
            'content somebody else wrote. Nothing was spent.');
    }
    /*
      The live price gets the same runtime check, for the same reason.
  
      `maxPrice` was validated at runtime because "this package is a library, JavaScript callers
      exist, and JSON round-trips drop fields" — and every word of that applies to `livePrice`, which
      had no such check. A caller who dropped it reached `undefined > maxPrice`, which is `false`, and
      `undefined < 0n`, which is also `false`. Both guards below were skipped and the function
      returned `ok(undefined)`: a spend the operator never authorised, approved by the component whose
      only job is to refuse exactly that.
  
      The comparison operators are the trap. A missing ceiling fails closed because it is tested with
      `=== undefined`; a missing price failed open because it was tested with `>`, and every
      comparison against `undefined` is `false`. Anything reached only through a relational operator
      has to be proved to be a number first.
    */
    if (typeof input.livePrice !== 'bigint') {
        return fail('malformed', source, 'livePrice is required and must be a bigint read from the chain. It was not supplied, so ' +
            'there was no price to compare the ceiling against and nothing could be authorised. ' +
            'Nothing was spent.');
    }
    if (input.expected !== undefined && typeof input.expected !== 'bigint') {
        return fail('malformed', source, 'expected was supplied but is not a bigint; a belief that cannot be compared cannot be ' +
            'checked, and passing it silently would drop the second half of the guard. Nothing was ' +
            'spent.');
    }
    if (input.maxPrice < 0n || input.livePrice < 0n) {
        return fail('malformed', source, 'a price may not be negative.');
    }
    /*
      Over the ceiling is a PRECONDITION, not a permanent refusal.
  
      A price is a value on chain that a creator changes when they feel like it, so "too expensive
      right now" is exactly the kind of state that clears. Reported as permanent, an agent told to
      watch for a post to come within budget would stop watching the first time it looked.
    */
    if (input.livePrice > input.maxPrice) {
        return refusePrecondition('price-above-ceiling', source, `refused: the on-chain price is ${input.livePrice} but maxPrice is ${input.maxPrice} ` +
            `(${input.coinType}, minor units). Nothing was signed and nothing was spent. This is the ` +
            `guard working, not a fault — raise maxPrice deliberately if the price is genuinely what ` +
            `you intend to pay.`);
    }
    if (input.expected !== undefined && input.expected !== input.livePrice) {
        // Also a precondition: the caller re-reads a quote and decides again. Nothing is broken.
        return refusePrecondition('price-changed', source, `refused: this agent expected to pay ${input.expected} but the vault charges ` +
            `${input.livePrice} right now (${input.coinType}, minor units). The price changed, or the ` +
            `figure the agent was working from did not come from the chain. Nothing was spent — read ` +
            `a fresh quote and decide again.`);
    }
    return ok(input.livePrice);
}
// === Reads that a spending decision depends on ===
/**
 * Find the agent's `SocialAccount`.
 *
 * Mirrors `findAccount` in `packages/web/lib/checkout.ts`, including the distinction it draws:
 * `ok(null)` means we looked and there is none — a real answer, and the prompt to open one — while
 * a failed reading means we could not look, which is not the same and must not become a
 * registration prompt.
 *
 * Filtered on `packageId`, the **original** publication, and not on `latestPackageId`. A struct's
 * type identity is bound to the address it was first published at and does not move on upgrade, so
 * filtering by the latest id matches nothing at all. This is the same pair of ids as everywhere
 * else and the opposite choice from a `moveCall` target.
 */
export async function findAgentAccount(client, config, owner) {
    const source = `SocialAccount owned by ${owner}`;
    try {
        const response = await client.listOwnedObjects({
            owner,
            type: `${config.packageId}::account::SocialAccount`,
            limit: 5,
        });
        const first = response.objects?.[0];
        return ok(typeof first?.objectId === 'string' ? first.objectId : null);
    }
    catch (error) {
        const failure = classify(error, source);
        return fail(failure.kind, source, failure.detail);
    }
}
/**
 * The reserved marker inside a content key. A machine edition of a key is named by appending it
 * (`packages/web/lib/machine-pricing.ts`), so a human key that contains it could collide with
 * another post's machine edition — and an Unlock cannot be withdrawn once someone holds it. The
 * studio refuses such a key before pricing; so does `priceContent`. `test/price-content.test.ts`
 * reads the web's constant from source, so the two cannot drift.
 */
export const MACHINE_EDITION_MARKER = '#machine';
/**
 * The `CreatorCap` this address holds FOR THIS VAULT, or `not-found`.
 *
 * A cap is bound to one vault (`creator.move` `assert_cap`, `EWrongVault`); a creator with two
 * vaults holds two caps, and the first one returned is right only by luck. Every cap is decoded —
 * 32 bytes of its own id, 32 bytes of the vault it governs — and only the one naming `vaultId` is
 * returned. Choosing any other would build a transaction the chain aborts after gas is spent, with
 * a failure that names neither the cap nor the vault. A shorter object that matched the type filter
 * is a different struct and is refused rather than decoded into a plausible-looking vault id.
 */
export async function findCreatorCap(client, config, owner, vaultId) {
    const source = `CreatorCap for vault ${vaultId} owned by ${owner}`;
    try {
        const response = await client.listOwnedObjects({
            owner,
            type: `${config.packageId}::creator::CreatorCap`,
            limit: 50,
            include: { content: true },
        });
        const objects = response.objects ?? [];
        for (const object of objects) {
            if (typeof object.objectId !== 'string')
                continue;
            const raw = object.content?.value ?? object.content;
            const bytes = raw instanceof Uint8Array ? raw : typeof raw === 'string' ? Uint8Array.from(Buffer.from(raw, 'base64')) : null;
            if (bytes === null || bytes.length < 64) {
                return fail('malformed', source, `object ${object.objectId} matched the CreatorCap type filter but is not a CreatorCap.`);
            }
            const governs = `0x${Buffer.from(bytes.subarray(32, 64)).toString('hex')}`;
            if (sameAddress(governs, vaultId))
                return ok(object.objectId);
        }
        return fail('not-found', source, `${owner} holds no CreatorCap for vault ${vaultId}. Only the vault's creator can price its content.`);
    }
    catch (error) {
        const failure = classify(error, source);
        return fail(failure.kind, source, failure.detail);
    }
}
/** Total spendable balance of one coin type. */
export async function totalBalance(client, owner, coinType) {
    const source = `${coinType} balance of ${owner}`;
    try {
        const response = await client.getBalance({ owner, coinType });
        const value = response.balance?.balance;
        return ok(BigInt(String(value ?? '0')));
    }
    catch (error) {
        const failure = classify(error, source);
        return fail(failure.kind, source, failure.detail);
    }
}
/**
 * What a vault charges for one content key, read from chain.
 *
 * `readContentPrice` answers `ok(null)` for a key that has no price, and that is a measurement
 * rather than a fault — most keys have never been priced. For an agent about to *buy*, though,
 * `null` is the end of the road: `creator::unlock` aborts with `EContentNotForSale` (code 12), so
 * this converts it into a refusal that says so, rather than letting a caller spend gas learning it.
 *
 * `UPDATE.md`, 2026-08-30, records that exact abort reaching a real checkout because a post was
 * published without its price ever being set on chain. An agent hits it more often than a human
 * would, because it acts on lists.
 */
export async function livePriceOfContent(client, vault, contentKey) {
    const reading = await readContentPrice(client, vault.contentPricesTableId, contentKey);
    if (!reading.ok)
        return reading;
    if (reading.value === null) {
        /*
          `not-found` was defensible — we looked and there is no price — but it is not the whole
          answer for an agent. UPDATE.md, 2026-08-30, records a real post published without its price
          ever being set on chain, and a creator running `set_content_price` cleared it. The condition
          is therefore one that clears, and an agent watching for a post to go on sale should be told
          so rather than told the price does not exist.
        */
        return refusePrecondition('content-not-priced', `price of "${contentKey}"`, `this vault sets no price for "${contentKey}", so it is not for sale. creator::unlock ` +
            `would abort with EContentNotForSale (code 12). Nothing was spent.`);
    }
    return ok(reading.value);
}
/** The tier at an index, refusing an index that does not exist or one the creator has retired. */
export function tierAt(vault, tierIndex) {
    const source = `tier ${tierIndex} of vault ${vault.vaultId}`;
    if (!Number.isInteger(tierIndex) || tierIndex < 0) {
        return fail('malformed', source, 'a tier index must be a non-negative whole number.');
    }
    const tier = vault.tiers[tierIndex];
    if (tier === undefined) {
        return fail('not-found', source, `this vault has ${vault.tiers.length} tier(s); there is none at index ${tierIndex}. ` +
            `creator::subscribe would abort with ENoSuchTier (code 6).`);
    }
    /*
      A retired tier is refused here rather than on chain.
  
      Retired tiers stay in the list — `creator.ts` says why: removing one would renumber the others
      and strand every existing subscriber's index. So an out-of-date agent working from a cached
      tier list will happily point at one, and the contract aborts with code 7. Refusing here names
      the cause instead of returning an abort code.
    */
    if (!tier.active) {
        // A precondition: `creator::set_tier` at creator.move:394-397 writes `active` and can write it
        // back to true, so a retired tier is a state and not a fact about the world.
        return refusePrecondition('tier-retired', source, `tier ${tierIndex} ("${tier.name}") has been retired by the creator. Retired tiers stay in ` +
            `the list so existing subscribers keep a valid index, but nobody new may join one.`);
    }
    return ok(tier);
}
/**
 * Read a vault, refusing early on the two conditions that make any payment to it pointless.
 *
 * `payer` is `null` for a read-only agent, which has no address: the self-payment refusal has no
 * subject and is skipped, and nothing else is. The not-accepting refusal is about the vault, not
 * the payer, and applies to both.
 */
export async function readPayableVault(client, vaultId, payer) {
    const vault = await readCreatorVault(client, vaultId);
    if (!vault.ok)
        return vault;
    // ESelfPayment, code 13. An agent operated by a creator will try this — it is the obvious way to
    // test a purchase flow — and the abort code explains nothing.
    if (payer !== null && sameAddress(payer, vault.value.owner)) {
        return fail('malformed', `vault ${vaultId}`, 'this agent owns that vault, and a creator cannot pay their own. creator aborts with ' +
            'ESelfPayment (code 13).');
    }
    if (!vault.value.accepting) {
        // ENotAccepting, code 4. A precondition: one `creator::set_accepting(true)` clears it.
        return refusePrecondition('vault-not-accepting', `vault ${vaultId}`, 'this creator is not currently accepting payments (creator::set_accepting is false). ' +
            'Existing entitlements are unaffected; new ones cannot be bought.');
    }
    return vault;
}
export async function simulateAndExecute(input) {
    const source = input.what;
    try {
        input.transaction.setSenderIfNotSet(input.key.address);
        input.transaction.setGasBudget(input.gasBudgetMist);
        // Built ONCE. These are the bytes that will be signed, if anything is signed at all.
        const bytes = await input.transaction.build({ client: input.client });
        /*
          The SDK's `simulate()` takes a `Transaction` and builds it itself, so it is handed a
          transaction restored from the very bytes above rather than the original builder. A restored
          transaction has resolved inputs and a complete `gasData`, so its rebuild is local and
          byte-identical; handing over the original would mean a second resolution against the chain,
          and an object version moving between the two would put a signature on bytes nobody simulated.
    
          The equality is checked rather than trusted. It costs one comparison of a few hundred bytes,
          it needs no network, and the alternative is a safety property that lives only in a comment.
        */
        const replay = Transaction.from(bytes);
        const rebuilt = await replay.build();
        if (!sameBytes(bytes, rebuilt)) {
            return fail('malformed', source, 'the transaction did not survive a BCS round trip byte-for-byte, so the bytes that would ' +
                'be simulated are not provably the bytes that would be signed. Nothing was submitted. ' +
                'This is a client library shape change, not a rejected transaction.');
        }
        // --- Nothing above this line is signed. ---
        /*
          One simulation reader, and it is the SDK's.
    
          `packages/sdk/src/client.ts::simulate()` reads `sim.Transaction.status` — capital T, no
          `effects` in the path — measured live on mainnet as `{"success":true,"error":null}`, and it
          refuses an unrecognised shape rather than treating "no status found" as permission to sign.
          This module used to carry its own six-path reader beside it. Two readers of one wire format
          is the defect; see the header.
        */
        const outcome = await simulate(input.client, replay, input.key.address);
        if (!outcome.ok) {
            // The SDK already refuses an unrecognised envelope as `malformed`. Passed through unmodified
            // — including its `kind`, so a transport fault reaching it stays a transport fault here.
            return fail(outcome.failure.kind, source, outcome.failure.detail);
        }
        if (!outcome.value.wouldSucceed) {
            return refuseSimulationFailure(source, outcome.value);
        }
        // --- Simulation passed. Only now do we sign. ---
        let result;
        if (input.transactionSigner !== undefined) {
            /*
              The policy path. The signer simulates and evaluates the SAME bytes again under the
              operator's document — a second simulation is the price of a bound that lives in a separate
              package, and it is paid on purpose — then signs or refuses. Its refusal passes through
              with its own kind, so "the policy said no" never reads as "the network failed".
            */
            const signed = await input.transactionSigner.signTransaction(bytes);
            if (!signed.ok)
                return fail(signed.failure.kind, source, signed.failure.detail);
            if (!sameBytes(signed.value.bytes, bytes)) {
                return fail('malformed', source, 'the signer returned a signature over different bytes than it was given; nothing was submitted.');
            }
            result = await input.client.executeTransaction({ transaction: bytes, signatures: [signed.value.signature] });
        }
        else {
            result = await input.client.signAndExecuteTransaction({
                transaction: bytes,
                signer: input.key.keypair,
            });
        }
        const digest = digestOf(result);
        if (digest === null) {
            /*
              Submitted, but we cannot name what.
      
              Reported as a failure so nothing is recorded as succeeded that cannot be pointed at — and
              the message says explicitly that it may have landed, because the daemon's version of this
              bug recorded a real, successful, money-moving transaction as a failure and the operator
              acted on the wrong belief.
            */
            return fail('malformed', source, 'the transaction was submitted but the node returned no digest in any envelope this ' +
                'client knows. Check the chain before retrying — it may well have succeeded.');
        }
        return ok({ digest, simulation: outcome.value });
    }
    catch (error) {
        /*
          A throw here is a network fault, or a Move abort raised by `build()` when a caller has
          reached this function with no gas budget set. Both are decoded before being classified:
          `classify` would call an abort `transport`, which reads as "retry me blindly" and is wrong
          for most aborts and dangerously wrong for none of them.
    
          The old comment here said "a transaction that aborts will abort again for ever". That is
          false for `ECreationPaused`, `EPaymentsPaused`, `ENotAccepting` and every insufficient-coin
          abort, and reporting those as permanent is how an unattended loop gives up for good on a
          platform that was paused for a minute. See {@link ABORT_CLASSIFICATION}.
        */
        const raw = error instanceof Error ? error.message : String(error);
        const abort = classifyAbort(raw);
        if (abort !== null) {
            return refuseAbort(source, 'refused before signing', abort, raw);
        }
        const failure = classify(error, source);
        return fail(failure.kind, source, failure.detail);
    }
}
/** A failed simulation, classified. Shared by the abort path and the simulation path. */
function refuseSimulationFailure(source, outcome) {
    const raw = outcome.status;
    const abort = classifyAbort(raw);
    if (abort === null) {
        // Raw text, unmodified. A confident wrong explanation is worse than an opaque one, because an
        // opaque one can be searched for.
        return fail('malformed', source, `simulation failed, so nothing was signed: ${raw}`);
    }
    return refuseAbort(source, 'simulation failed, so nothing was signed', abort, raw);
}
/** One place that turns a classified abort into a refusal, so the two call sites cannot disagree. */
function refuseAbort(source, lead, abort, raw) {
    const said = abort.explanation === null
        ? `${lead}: ${raw}`
        : `${lead}: ${abort.explanation} (${abort.module} abort ${abort.code}). Raw: ${raw}`;
    return abort.precondition === null
        ? fail('malformed', source, said)
        : refusePrecondition(abort.precondition, source, said);
}
/** Constant-length byte comparison. Not a secret; this is a shape check, not a MAC check. */
function sameBytes(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i += 1)
        if (a[i] !== b[i])
            return false;
    return true;
}
/** The digest, through every envelope. See this file's header for what each one cost. */
function digestOf(result) {
    const r = result;
    const digest = r.Transaction?.digest ?? r.transaction?.digest ?? r.digest;
    return typeof digest === 'string' && digest !== '' ? digest : null;
}
// === Builders ===
//
// Each of these composes an SDK builder rather than writing its own `moveCall`. That is not
// deference for its own sake: `packages/sdk/src/tx.ts` quotes the authoritative Move signature
// above every call site and its own test suite reads the built transaction back and asserts the
// argument count, order and type parameters. A programmable transaction is an untyped positional
// boundary — two same-typed `u64`s in the wrong order build, sign, and do the wrong thing — and
// that test is the only thing checking the order. A second, unchecked copy of these calls in this
// package would be outside it.
/** `account::open` — claim a handle. Takes no payment; the creation fee is charged on a vault. */
export function buildOpenAccount(config, args) {
    return build.openAccount({ config }, { handle: args.handle, referrer: args.referrer ?? null });
}
function paymentFor(tx, source, coinType, amount) {
    if (amount <= 0n)
        throw new RangeError(`a payment must be positive; got ${amount.toString()}`);
    switch (source.kind) {
        case 'gas': {
            const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
            return coin;
        }
        case 'object': {
            const [coin] = tx.splitCoins(tx.object(source.objectId), [tx.pure.u64(amount)]);
            return coin;
        }
        case 'merge': {
            const [coin] = tx.coin({ type: coinType, balance: amount });
            return coin;
        }
    }
}
/**
 * `creator::unlock<T>` — buy permanent access to one content key.
 *
 * The coin is sourced for **exactly** the guarded price. `tx.coin({ type, balance })` resolves and
 * merges the sender's coins of that type, and the contract returns change, which the SDK builder
 * transfers back — a returned coin that is never transferred makes the transaction fail to build,
 * because Move cannot drop it.
 */
export function buildUnlock(config, args) {
    const tx = new Transaction();
    const coin = paymentFor(tx, args.payment ?? { kind: 'merge' }, args.coinType, args.price);
    return build.unlockContent({ config, tx }, {
        coinType: args.coinType,
        vaultId: args.vaultId,
        accountId: args.accountId,
        contentKey: new TextEncoder().encode(args.contentKey),
        paymentCoin: coin,
        sender: args.sender,
    });
}
/**
 * `creator::set_content_price<T>` — put one key up for sale at `price`, or reprice it.
 *
 * # What the operator's policy must and must not treat this as
 *
 * No coin leaves in this transaction; only gas does. When a `PolicySigner` is in front of the key,
 * `outflow-ceiling` therefore passes trivially and MUST NOT be what authorises the call. The bound
 * is AUTHORITY, never spend: `move-call-target` must list `…::creator::set_content_price`,
 * `object-input` must list BOTH the vault and this cap (an owned object with a stable id),
 * `type-argument` the vault's coin, and `gas-budget` applies as it does to every call. A policy that
 * only sets ceilings never authorises pricing — the safe default — and an operator who wants a
 * buying agent that cannot reprice its own catalogue leaves the target out, exactly as
 * `claim_earnings` is left out of the buyer fixture.
 */
export function buildSetContentPrice(config, args) {
    return build.setContentPrice({ config }, {
        coinType: args.coinType,
        vaultId: args.vaultId,
        capId: args.capId,
        contentKey: new TextEncoder().encode(args.contentKey),
        price: args.price,
    });
}
/** `creator::subscribe<T>` — join a tier for one period. */
export function buildSubscribe(config, args) {
    const tx = new Transaction();
    const coin = paymentFor(tx, args.payment ?? { kind: 'merge' }, args.coinType, args.price);
    return build.subscribe({ config, tx }, {
        coinType: args.coinType,
        vaultId: args.vaultId,
        accountId: args.accountId,
        tierIndex: BigInt(args.tierIndex),
        paymentCoin: coin,
        sender: args.sender,
    });
}
/**
 * `creator::tip<T>` — pay a creator with no entitlement in return.
 *
 * Takes the coin **entire** and returns nothing: a tip has no price to overpay, so there is no
 * change. That makes the exact amount sourced into the coin the exact amount spent, which is why
 * the ceiling check on a tip is a check on the amount itself rather than on a price read from a
 * vault — there is no on-chain price here for the guard to consult.
 */
export function buildTip(config, args) {
    const tx = new Transaction();
    const coin = paymentFor(tx, args.payment ?? { kind: 'merge' }, args.coinType, args.amount);
    return build.tip({ config, tx }, {
        coinType: args.coinType,
        vaultId: args.vaultId,
        accountId: args.accountId,
        paymentCoin: coin,
    });
}
//# sourceMappingURL=tx.js.map