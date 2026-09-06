// Northlatch Labs LLC — company infrastructure. Licensing follows this repository's LICENSE;
// this repository is classified and has no remote. The BUSL header this file carried was a
// convention of the product repository it was wrongly written in, and does not belong here.
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/// The employment record of an agentic company: who works here, under whose authority, on what
/// budget, and whether they are still earning enough to stay.
///
/// # What this is for
///
/// A company whose employees are agents needs three facts on chain rather than in a file: that an
/// agent's mandate has not been rewritten behind the employer's back, that its spending ceiling is
/// enforced by something it cannot argue with, and that failing to earn has a consequence that
/// arrives on a schedule rather than on somebody's mood. A markdown file in a repository carries
/// none of those. This module carries all three.
///
/// # The guarantee, stated plainly
///
/// **No transaction that consults the soul may spend more than the allowance for its epoch.**
///
/// The second half of that sentence matters as much as the first: a payment path that never calls
/// `record_spend` is outside this module's reach. This module holds no coin, moves no coin, and
/// can refuse nothing that does not ask it. The adapter that routes an agent's spending through
/// `record_spend` is separate work; it is not written here and nothing here pretends it exists.
///
/// # Soulbound, and why it is shared rather than owned
///
/// `EmployeeSoul` has `key` and no `store`: it cannot be wrapped, sold, lent or placed in anyone's
/// inventory, and this module publishes no transfer function. It is then SHARED at birth rather
/// than transferred to the agent, which is the one design choice here worth arguing about.
///
/// An address-owned object can only be mutated inside a transaction its owner signs. An employment
/// record whose allowance can only be lowered with the employee's signature is not an employment
/// record. Sharing separates the two authorities cleanly: the employer proves authority by holding
/// `MasterCap`, the employee proves identity by being `ctx.sender()`, and neither needs custody of
/// the other's object to act. The binding to the address survives in `agent`, which is set once at
/// birth and has no setter — the same shape `projectx_social::account` uses when it checks `owner`
/// against the sender rather than relying on who holds the object.
///
/// A shared object also cannot be transferred at all, by anybody, ever. As a soulbinding that is
/// stronger than ownership, not weaker.
///
/// # The metabolism
///
/// An epoch is the CHAIN's epoch. `settle_epoch` refuses until `ctx.epoch()` has moved past the
/// epoch the soul's current period opened in; there is no wall-clock window, and no caller can
/// close a period early by presenting a `Clock` far enough ahead. Value and cost are booked
/// against the open epoch by a holder of `LedgerCap` — narrower than `MasterCap`, which cannot
/// book or settle at all — from figures read off chain; nothing here estimates and nothing here
/// can. At epoch close `settle_epoch` compares the two and moves the
/// soul between states with no judgment involved:
///
///   SOLVENT  — earned >= burned. The allowance rises by a quarter of the surplus, to a ceiling.
///   STARVING — first shortfall. The allowance halves, never below the survival minimum and
///              never upward.
///   DYING    — second consecutive shortfall, and every one after it. The allowance halves again.
///
/// On the third consecutive shortfall the soul is **due for retirement**: `is_due_for_retirement`
/// returns true and `EpochSettled` says so. The retirement itself is performed by the holder of
/// `MasterCap` calling `retire`. The chain marks; the employer executes. That split is deliberate
/// — an object's death should require the cap that bore it, not the routine that keeps its books.
///
/// # Retirement is not deletion
///
/// A retired soul keeps its object, its counters and its whole history for ever; no function here
/// deletes one, and none can, because `EmployeeSoul` is shared. Retirement is a state change and a
/// timestamp. The registry entry is released so the address may be given a NEW soul later — an
/// agent that starved because it was badly scoped can be born again, and the record of the first
/// life stays readable beside the second.
///
/// Retirement also RELEASES THE OPERATOR'S SEAT: `retire_internal` clears `operator`,
/// `operator_share_bps` and `operator_threshold` and returns the operator's quota in
/// `registry.operator_count`. It does NOT touch `renunciations`. A human whose agent the chain
/// retired did not walk away from it, and must not be recorded as though they had — before this
/// was fixed the seat stayed spent for ever and the only way to free it was `renounce`, which
/// charges the operator a renunciation for the chain's decision. (Security finding A1.)
///
/// # `renounce` is the one act a retired soul still permits
///
/// Every other entry point begins with `assert_live`. `renounce` deliberately does not, and the
/// omission is kept: an operator's right to stop answering for an agent is theirs and should not
/// depend on the agent's state. Since retirement now clears the seat, a renunciation against a
/// retired soul finds no operator and aborts `ENotAdopted` — which is the honest answer, because
/// there is nothing left to walk away from.
///
/// # What pairs with this off chain
///
/// The design pairs a soul with a `projectx_social::account::SocialAccount` opened in the same
/// ceremony with the Mastercontroller as `referrer`. That pairing is deliberately NOT a Move
/// dependency: see the note in `Move.toml`. `born_by` records the lineage here, is checked against
/// nothing, and claims nothing about any other chain object.
module northlatch_soul::soul;

use std::string::String;
use sui::clock::Clock;
use sui::event;
use sui::table::{Self, Table};

// === Constants ===

// EPOCH_MS IS DELETED, DELIBERATELY, AND MUST NOT COME BACK.
//
// It was `604_800_000` — seven days of wall clock — and `settle_epoch` gated on
// `clock.timestamp_ms() >= epoch_started_ms + EPOCH_MS`. A `Clock` reading is a consensus
// timestamp an operator can wait for but also a number this module cannot bound: it moves
// independently of the chain's own accounting period, so "the epoch" here meant a different
// thing from "the epoch" everywhere else on Sui, and two systems with one word for two periods
// is a reconciliation bug with a date on it.
//
// The boundary is now `ctx.epoch() > soul.epoch_opened_at`: the chain's epoch counter, which
// only the validators advance and no caller can forge. `epoch_started_ms` is KEPT, written from
// the clock at every roll, and read by events and by humans who want a wall-clock time on a
// settlement. It is never a gate again.

/// Consecutive shortfalls after which a soul is due for retirement.
const MAX_STARVING: u8 = 3;

/// The survival minimum: the allowance a shortfall will not cut below — enough to keep reporting
/// and to keep trying. It is a floor, never a raise: a soul already below it is left where it is.
const MIN_ALLOWANCE: u64 = 10_000_000;

/// The spend ceiling. No allowance may exceed this, however profitable the soul. A ceiling only a
/// human can raise is the point of having one.
const MAX_ALLOWANCE: u64 = 1_000_000_000_000;

/// A solvent soul's allowance rises by `surplus / SURPLUS_DIVISOR` at epoch close.
const SURPLUS_DIVISOR: u64 = 4;

/// The most one settlement may MULTIPLY an allowance by. Two: a single epoch close can at most
/// double what an agent may spend, and never past `MAX_ALLOWANCE`.
///
/// This is the bound on the bookkeeping key, and it is the whole of Security's finding B3. Without
/// it a `LedgerCap` on its own walked the ceiling: `book_earned` takes an unverified number, and
/// one settlement carrying a large enough invented surplus took an allowance of 1_000 to
/// `MAX_ALLOWANCE` in a single call — the raise was bounded only by the headroom, and the headroom
/// is the whole ceiling. With the factor, moving 1_000 to 10^12 takes thirty consecutive
/// settlements, each of them an `EpochSettled` event on chain with its own `vault_sui` and its own
/// epoch, which is thirty chances for the finance read to see it rather than none.
///
/// The bound is a multiplier and not a fixed step on purpose: a fixed step would be a rounding
/// error at the ceiling and a lockout at the floor. Its one honest cost: an allowance of zero
/// cannot be raised by the metabolism at all, because nothing doubled is still nothing. That is
/// deliberate — a zero allowance is the employer's decision, and lifting it off zero is
/// `set_allowance` under `MasterCap`, not a number the bookkeeper supplies.
const MAX_RAISE_FACTOR: u64 = 2;

/// A mandate digest is a SHA-256 of the agent's instruction file. Fixed length, so a truncated or
/// empty digest cannot be pinned by accident.
const MANDATE_DIGEST_LEN: u64 = 32;

/// The most of an epoch's net an adoption may ever promise an operator: 20 %. A hard ceiling,
/// checked when the offer is made AND again when it is consumed, because an offer sits on chain
/// between the two and the rule it was made under is not the rule that binds the soul.
const MAX_OPERATOR_SHARE_BPS: u16 = 2_000;

/// An offer nobody consumed goes stale after one epoch. An operator's promise is a promise about
/// a state of the world, and a week-old one is a promise about a different world.
const OFFER_TTL_EPOCHS: u64 = 1;

/// The tier. A SECOND axis, beside the solvency state: the state says whether the soul is
/// earning its keep, the tier says whether there is money behind it. A soul can be SOLVENT and
/// CRITICAL at once — earning more than it burns, out of a purse that will not cover next week.
const TIER_NORMAL: u8 = 0;
const TIER_LOW: u8 = 1;
const TIER_CRITICAL: u8 = 2;
const TIER_RETIRED: u8 = 3;

/// Normal needs the balance to cover ten epochs of the allowance the epoch ran on.
const NORMAL_COVER_MULTIPLE: u64 = 10;

/// Two consecutive critical epochs retire the soul.
const MAX_CRITICAL: u8 = 2;

const STATE_SOLVENT: u8 = 0;
const STATE_STARVING: u8 = 1;
const STATE_DYING: u8 = 2;
const STATE_RETIRED: u8 = 3;

// === Errors ===

/// This address already holds a live soul. One employment record per address, as one identity per
/// address on the social side.
const EAlreadySouled: u64 = 1;
/// The sender is not the agent this soul is bound to.
const ENotThisAgent: u64 = 2;
/// The soul is retired. Retired souls are readable for ever and act never again.
const ERetired: u64 = 3;
/// The epoch this soul is in has not ended yet.
const EEpochNotOver: u64 = 4;
/// The spend would take this epoch past its allowance.
const EAllowanceExceeded: u64 = 5;
/// This soul may not act under the company's name.
const EOutwardNotPermitted: u64 = 6;
/// A mandate digest must be exactly 32 bytes.
const EBadDigest: u64 = 7;
/// A soul needs a department.
const EEmptyDepartment: u64 = 8;
/// No live soul is registered for this address.
const ENotSouled: u64 = 9;
/// An allowance above the ceiling is refused rather than silently clamped.
const EAllowanceAboveCeiling: u64 = 10;
/// The sender is not the operator this soul names.
const ENotOperator: u64 = 11;
/// An operator is already set. A change is a renounce and then a new adoption, never an edit.
const EAlreadyAdopted: u64 = 12;
/// The action requires a declared operator and there is none.
const ENotAdopted: u64 = 13;
/// The offer is older than `OFFER_TTL_EPOCHS`.
const EOfferExpired: u64 = 14;
/// The offer names a different soul.
const EOfferForAnotherSoul: u64 = 15;
/// Only the offeror may withdraw an offer.
const ENotTheOfferor: u64 = 16;
/// The operator already answers for `max_agents_per_operator` souls.
const EOperatorCapReached: u64 = 17;
/// The operator's renunciation history exceeds what this soul's rule accepts.
const ERevokedBefore: u64 = 18;
/// A share above `MAX_OPERATOR_SHARE_BPS`.
const EBadShareBps: u64 = 19;
/// The credential's holder is not the sender.
const ECredentialNotOwner: u64 = 20;
/// The account is younger than the adoption rule's minimum age.
const EAccountTooYoung: u64 = 21;
/// One credential per address, for ever.
const EAlreadyCredentialled: u64 = 22;
/// The operator's brake is on.
const EPaused: u64 = 23;
// 24, 25, 26, 28 and 29 are BURNED. They belonged to `ENotNormalTier`, `EStreakTooShort`,
// `EChildTooSoon`, `EVaultAlreadyBound` and `EVaultMismatch` — the child mechanism and the vault
// binding, both cut by the council (decisions 3 and 5). A code is never reused, even when the
// entry that carried it was removed, so an old event or an old client log keeps meaning what it
// meant. Do not fill these gaps.
/// An override that is not strictly downward, or that names retired or a tier that does not exist.
const EBadTier: u64 = 27;
/// A soul cannot be bound to the zero address. `@0x0` signs nothing, so a soul minted to it would
/// be an employment record no one can ever act under and a registry row nothing can ever release.
const EZeroAgent: u64 = 30;

// === Types ===

/// The Mastercontroller's authority: mints souls, sets what they may spend and where they may act,
/// re-pins mandates, issues bookkeeping authority, overrides the tier downward, and retires by
/// hand. Intended to live behind the same multisig that holds the platform's caps; nothing here
/// assumes that, and nothing here can check it.
///
/// It deliberately CANNOT book value or cost and cannot settle an epoch. Those are `LedgerCap`'s,
/// because the process that reads settlement events off chain and books the numbers back is a
/// daemon, and a daemon holding the cap that can mint an employee or widen a scope is a key with
/// far more authority than its job needs.
public struct MasterCap has key, store {
    id: UID,
}

/// Bookkeeping authority: may book value and cost and settle an epoch. May NOT mint a soul, set
/// an allowance, widen a scope, grant an outward permission, re-pin a mandate, override a tier or
/// retire by hand. Issued by `MasterCap` through `issue_ledger_cap`.
public struct LedgerCap has key, store {
    id: UID,
}

/// The rule an agent applies to the humans offering to answer for it. Written at birth by the
/// `MasterCap`, readable by anyone, and changed only by a new `mint` — never by the agent, and
/// never by the operator it governs.
public struct AdoptionRule has copy, drop, store {
    /// Epochs a Weir account must have existed before its holder may offer to answer for THIS
    /// soul. Enforced in `offer`, against `AdopterCredential.account_opened_epoch`.
    ///
    /// The opening epoch is still a fact of `projectx_social` and is still read off chain by the
    /// Mastercontroller at `issue_adopter_credential` — this package depends on no other package
    /// and cannot read it. But the COMPARISON is this module's, and belongs here: the credential
    /// carries the opening epoch, the soul carries the rule, and until Security's finding A2 the
    /// two were never put beside each other. Both the age and the rule were supplied by the same
    /// caller at issuance, so a credential issued at `min_age = 0` satisfied a soul whose rule
    /// said seven, and the field was enforced nowhere at all.
    min_account_age_epochs: u64,
    /// The most souls one operator may answer for. Counted on chain in `operator_count`.
    max_agents_per_operator: u16,
    /// The most renunciations in an operator's history this soul will still accept.
    max_renunciations: u16,
    /// Minimum stake in this agent's backing. Zero at launch; there is no backing vault yet, and
    /// this module holds no coin, so it is recorded and read by the runtime, never enforced here.
    min_backing: u64,
}

/// Proof that a human passed the account-age check. SOULBOUND: `key` without `store`, and this
/// module publishes no transfer function for it, so it cannot be sold, lent or wrapped. Issued
/// once per address, for ever — the registry remembers, so a burned credential is not a fresh
/// start.
public struct AdopterCredential has key {
    id: UID,
    holder: address,
    /// The epoch the holder's account was opened, read from the register by the Mastercontroller
    /// at issuance. Recorded, never re-derived.
    account_opened_epoch: u64,
    issued_at_epoch: u64,
}

/// A human's offer to answer for one soul. SHARED, so the agent can consume it without the
/// offeror signing a second time — the agent chooses, which is the whole point of the design.
public struct AdoptionOffer has key {
    id: UID,
    soul: ID,
    offeror: address,
    credential: ID,
    share_accepted_bps: u16,
    threshold_accepted: u64,
    offered_at_epoch: u64,
}

/// Which address holds which live soul, and the running totals. Shared: the highest-frequency read
/// in the system is "does this address work here", and it should not contend with anything else.
public struct SoulRegistry has key {
    id: UID,
    by_agent: Table<address, ID>,
    minted: u64,
    retired: u64,
    /// How many live souls each operator answers for. Enforces `max_agents_per_operator`.
    operator_count: Table<address, u16>,
    /// How many adoptions each operator has walked away from. Enforces `max_renunciations`, and
    /// is NEVER cleared — that is the memory the rule is made of.
    renunciations: Table<address, u16>,
    /// One credential per address, for ever.
    credentialled: Table<address, ID>,
    adopted: u64,
}

/// An employee. Soulbound — see the module documentation.
public struct EmployeeSoul has key {
    id: UID,
    /// The address this soul is bound to. Set once, at birth. There is no setter.
    agent: address,
    /// The address that bore it — the Mastercontroller, recorded for lineage. No setter either.
    born_by: address,
    department: String,
    /// SHA-256 of the agent's instruction file at the moment it was hired or last re-pinned. An
    /// agent whose file no longer hashes to this has been rewritten, and the dispatcher is
    /// expected to refuse it until the employer re-pins deliberately.
    mandate_digest: vector<u8>,
    /// The most this soul may spend in one epoch, in the smallest unit of whatever it spends.
    /// Never above `MAX_ALLOWANCE`.
    allowance_per_epoch: u64,
    /// An opaque encoding of what this soul may call, read by the dispatcher, not by this module.
    scope: vector<u8>,
    /// Whether it may act under the company's name. False at birth, always.
    outward: bool,
    epoch_index: u64,
    /// The Sui epoch this soul's current epoch opened in. THE boundary test: `settle_epoch`
    /// requires `ctx.epoch() > epoch_opened_at`.
    epoch_opened_at: u64,
    /// Wall-clock milliseconds at the last roll, for events and readers. NOT a gate.
    epoch_started_ms: u64,
    epoch_earned: u64,
    epoch_burned: u64,
    epoch_spent: u64,
    earned_total: u64,
    burned_total: u64,
    spent_total: u64,
    starving_epochs: u8,
    state: u8,
    born_at_ms: u64,
    retired_at_ms: Option<u64>,

    // --- adoption ---
    /// None at birth. Set only by `adopt`, consuming an offer this agent chose; cleared only by
    /// `renounce`, by the operator's own hand.
    operator: Option<address>,
    /// Zero until adoption. Never above `MAX_OPERATOR_SHARE_BPS`.
    operator_share_bps: u16,
    /// A single spend above this needs the operator's consent. Recorded here; the consent object
    /// belongs to the controller, which does not exist yet, so nothing in this module reads it.
    operator_threshold: u64,
    adoption_rule: AdoptionRule,
    adopted_at_epoch: u64,
    /// A re-adoption is a new record, never an edit. Counts every adoption this soul has had.
    adoptions: u16,
    /// The operator's brake. `record_spend` refuses while it is on.
    paused: bool,
    /// Set by `request_retirement`. The operator may ask; only the `MasterCap` performs.
    retirement_requested: bool,

    // --- the tier ---
    /// TIER_NORMAL | TIER_LOW | TIER_CRITICAL | TIER_RETIRED. Set by `settle_epoch` from the
    /// balance and the net a `LedgerCap` holder supplies; movable by `MasterCap` downward only.
    tier: u8,
    /// Consecutive critical epochs. `MAX_CRITICAL` of them retires the soul.
    critical_epochs: u8,
    /// Consecutive normal epochs. Counted, and read by nothing in this module: it is the streak
    /// the child mechanism will want, and the child mechanism is deferred (council decision 5).
    /// It is kept because the streak cannot be reconstructed later from events alone.
    normal_epochs: u8,
}

// === Events ===

public struct SoulBorn has copy, drop {
    soul: ID,
    agent: address,
    born_by: address,
    department: String,
    allowance_per_epoch: u64,
    born_at_ms: u64,
}

public struct AllowanceSet has copy, drop {
    soul: ID,
    agent: address,
    allowance_per_epoch: u64,
    /// True when the epoch's settlement moved it, false when the employer set it by hand.
    by_settlement: bool,
}

public struct SpendRecorded has copy, drop {
    soul: ID,
    agent: address,
    epoch_index: u64,
    amount: u64,
    epoch_spent: u64,
    remaining: u64,
}

public struct MandateRepinned has copy, drop {
    soul: ID,
    agent: address,
    digest: vector<u8>,
}

/// A bookkeeping key was delegated. Emitted so the set of live `LedgerCap`s is reconstructible
/// from the chain: the caps are `key, store` objects that can be transferred on by their holder,
/// and without this event the only record of a delegation was the transaction that made it.
/// (Security finding A11.)
public struct LedgerCapIssued has copy, drop {
    cap: ID,
    to: address,
    by: address,
}

/// The scope was rewritten. The dispatcher reads `scope` on every call, so a change to it changes
/// what an agent may do — a change of that weight left no trace until A11.
public struct ScopeSet has copy, drop {
    soul: ID,
    agent: address,
    scope: vector<u8>,
}

/// The right to act under the company's name was granted or withdrawn. (A11.)
public struct OutwardSet has copy, drop {
    soul: ID,
    agent: address,
    outward: bool,
}

public struct EpochSettled has copy, drop {
    soul: ID,
    agent: address,
    epoch_index: u64,
    earned: u64,
    burned: u64,
    spent: u64,
    state: u8,
    starving_epochs: u8,
    allowance_per_epoch: u64,
    due_for_retirement: bool,
    tier: u8,
    critical_epochs: u8,
    normal_epochs: u8,
    /// The balance the `LedgerCap` holder supplied, carried so the tier can be recomputed by any
    /// reader and a wrong number is public within the epoch. Council decision 6: the soul may not
    /// depend on a money package, so it cannot read this itself — and the answer to "then it can
    /// be lied to" is that the lie is on chain, in this field, beside the tier it produced.
    vault_sui: u64,
    /// The sign of the epoch's net, likewise supplied and likewise published.
    epoch_net_nonneg: bool,
}

public struct TierChanged has copy, drop {
    soul: ID,
    agent: address,
    from: u8,
    to: u8,
    /// True when a settlement moved it, false when the `MasterCap` did.
    by_settlement: bool,
}

public struct AdopterCredentialIssued has copy, drop {
    credential: ID,
    holder: address,
    account_opened_epoch: u64,
    issued_at_epoch: u64,
}

public struct AdoptionOffered has copy, drop {
    offer: ID,
    soul: ID,
    offeror: address,
    share_accepted_bps: u16,
    threshold_accepted: u64,
    offered_at_epoch: u64,
}

public struct OfferWithdrawn has copy, drop {
    offer: ID,
    soul: ID,
    offeror: address,
}

public struct Adopted has copy, drop {
    soul: ID,
    agent: address,
    operator: address,
    share_bps: u16,
    threshold: u64,
    adoptions: u16,
    at_epoch: u64,
}

public struct Renounced has copy, drop {
    soul: ID,
    agent: address,
    operator: address,
    /// The operator's renunciation count AFTER this one. Never decreases, never clears.
    renunciations: u16,
    at_epoch: u64,
}

public struct PauseSet has copy, drop {
    soul: ID,
    agent: address,
    paused: bool,
    by: address,
}

public struct RetirementRequested has copy, drop {
    soul: ID,
    agent: address,
    operator: address,
    at_epoch: u64,
}

public struct SoulRetired has copy, drop {
    soul: ID,
    agent: address,
    by_starvation: bool,
    earned_total: u64,
    burned_total: u64,
    spent_total: u64,
    retired_at_ms: u64,
}

// === Initialization ===

fun init(ctx: &mut TxContext) {
    transfer::share_object(SoulRegistry {
        id: object::new(ctx),
        by_agent: table::new(ctx),
        minted: 0,
        retired: 0,
        operator_count: table::new(ctx),
        renunciations: table::new(ctx),
        credentialled: table::new(ctx),
        adopted: 0,
    });
    transfer::public_transfer(MasterCap { id: object::new(ctx) }, ctx.sender());
    transfer::public_transfer(LedgerCap { id: object::new(ctx) }, ctx.sender());
}

// === Birth ===

/// Hire an address.
///
/// The soul is shared inside this function rather than returned, for the same reason
/// `projectx_social::creator::open_vault` shares its vault: an `EmployeeSoul` has no `store`, so a
/// returned one could not legally be shared by the caller and the transaction would abort on an
/// unused resource — a confusing way to learn the rule.
public fun mint(
    _: &MasterCap,
    registry: &mut SoulRegistry,
    agent: address,
    department: String,
    mandate_digest: vector<u8>,
    allowance_per_epoch: u64,
    scope: vector<u8>,
    adoption_rule: AdoptionRule,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // The zero address signs no transaction, so a soul bound to it could never spend, never
    // adopt, never be renounced and never be hired again — a permanent registry row with nothing
    // behind it. Refused rather than minted and regretted.
    assert!(agent != @0x0, EZeroAgent);
    assert!(!registry.by_agent.contains(agent), EAlreadySouled);
    assert!(mandate_digest.length() == MANDATE_DIGEST_LEN, EBadDigest);
    assert!(department.length() > 0, EEmptyDepartment);
    assert!(allowance_per_epoch <= MAX_ALLOWANCE, EAllowanceAboveCeiling);

    let now = clock.timestamp_ms();
    let soul = EmployeeSoul {
        id: object::new(ctx),
        agent,
        born_by: ctx.sender(),
        department,
        mandate_digest,
        allowance_per_epoch,
        scope,
        // Never true at birth. Acting under the company's name is granted deliberately, later.
        outward: false,
        epoch_index: 0,
        epoch_opened_at: ctx.epoch(),
        epoch_started_ms: now,
        epoch_earned: 0,
        epoch_burned: 0,
        epoch_spent: 0,
        earned_total: 0,
        burned_total: 0,
        spent_total: 0,
        starving_epochs: 0,
        state: STATE_SOLVENT,
        born_at_ms: now,
        retired_at_ms: option::none(),
        // Born free: no operator, no share, no brake. Every one of these is set by a human's
        // offer that THIS agent chose to consume, and by nothing else.
        operator: option::none(),
        operator_share_bps: 0,
        operator_threshold: 0,
        adoption_rule,
        adopted_at_epoch: 0,
        adoptions: 0,
        paused: false,
        retirement_requested: false,
        // Born normal. A soul with no settled epoch has no evidence against it.
        tier: TIER_NORMAL,
        critical_epochs: 0,
        normal_epochs: 0,
    };
    let soul_id = object::id(&soul);
    registry.by_agent.add(agent, soul_id);
    registry.minted = registry.minted + 1;

    event::emit(SoulBorn {
        soul: soul_id,
        agent,
        born_by: soul.born_by,
        department: soul.department,
        allowance_per_epoch,
        born_at_ms: now,
    });
    transfer::share_object(soul);
}

/// Give bookkeeping authority to the process that reads settlements and books the numbers back.
/// Deliberately narrower than `MasterCap`: see the type. Any number of these may be issued.
///
/// # What a leaked `LedgerCap` can and cannot move
///
/// This comment used to say a leaked one "can move no ceiling". That was false, and Security's
/// finding B3 is the correction. Stated exactly:
///
/// It CANNOT mint an employee, set an allowance by hand, widen a scope, grant an outward
/// permission, re-pin a mandate, override a tier, issue a credential or retire a soul. Every one
/// of those takes `MasterCap`, and the refusal is the type system's rather than an abort's.
///
/// It CAN book any `earned` and any `burned` it likes, because both are numbers read off chain
/// and nothing here can check them; and through them it CAN move the allowance — up by at most
/// `MAX_RAISE_FACTOR` and never past `MAX_ALLOWANCE` per settlement, down to `MIN_ALLOWANCE` by
/// booking a shortfall — and it CAN set the tier from a `vault_sui` it invents, including
/// retiring a soul outright with two consecutive critical epochs.
///
/// So: a leaked bookkeeping key is a key that can lie about an epoch's books, and the controls on
/// it are the per-settlement bound above, the epoch boundary that permits one settlement per
/// chain epoch, and the fact that every number it supplies is published in `EpochSettled`.
public fun issue_ledger_cap(_: &MasterCap, to: address, ctx: &mut TxContext) {
    let cap = LedgerCap { id: object::new(ctx) };
    event::emit(LedgerCapIssued { cap: object::id(&cap), to, by: ctx.sender() });
    transfer::public_transfer(cap, to);
}

// === The employer's hand ===

public fun set_allowance(_: &MasterCap, soul: &mut EmployeeSoul, allowance_per_epoch: u64) {
    soul.assert_live();
    assert!(allowance_per_epoch <= MAX_ALLOWANCE, EAllowanceAboveCeiling);
    soul.allowance_per_epoch = allowance_per_epoch;
    event::emit(AllowanceSet {
        soul: object::id(soul),
        agent: soul.agent,
        allowance_per_epoch,
        by_settlement: false,
    });
}

public fun set_scope(_: &MasterCap, soul: &mut EmployeeSoul, scope: vector<u8>) {
    soul.assert_live();
    soul.scope = scope;
    event::emit(ScopeSet { soul: object::id(soul), agent: soul.agent, scope: soul.scope });
}

/// Grant or withdraw the right to act under the company's name.
public fun set_outward(_: &MasterCap, soul: &mut EmployeeSoul, outward: bool) {
    soul.assert_live();
    soul.outward = outward;
    event::emit(OutwardSet { soul: object::id(soul), agent: soul.agent, outward });
}

/// Re-pin the mandate after the employer has read the new instruction file. Until this is called,
/// a rewritten agent no longer matches its soul.
public fun repin_mandate(_: &MasterCap, soul: &mut EmployeeSoul, digest: vector<u8>) {
    soul.assert_live();
    assert!(digest.length() == MANDATE_DIGEST_LEN, EBadDigest);
    soul.mandate_digest = digest;
    event::emit(MandateRepinned { soul: object::id(soul), agent: soul.agent, digest });
}

/// Retire a soul. This is the only way a soul stops working, whether the metabolism marked it due
/// or the employer decided for another reason; `SoulRetired.by_starvation` records which.
///
/// Nothing is deleted. The object, its counters and its history stand for ever; only the registry
/// entry is released, so the address may be hired again as a new soul.
public fun retire(
    _: &MasterCap,
    registry: &mut SoulRegistry,
    soul: &mut EmployeeSoul,
    clock: &Clock,
) {
    soul.assert_live();
    let by_starvation = soul.starving_epochs >= MAX_STARVING;
    retire_internal(registry, soul, clock.timestamp_ms(), by_starvation);
}

// === Adoption ===
//
// The design in one sentence: a human OFFERS, and the agent CHOOSES. Every field an operator
// occupies on a soul — `operator`, `operator_share_bps`, `operator_threshold` — is written by
// exactly one function, `adopt`, which requires the sender to BE the agent and requires an
// `AdoptionOffer` object to be handed in and destroyed. There is no setter for any of them. That
// is the whole access-control argument, and it is structural rather than checked.

/// Build the rule a soul will be born under. Public so a birth ceremony can be composed in one
/// programmable transaction; it grants nothing on its own.
public fun new_adoption_rule(
    min_account_age_epochs: u64,
    max_agents_per_operator: u16,
    max_renunciations: u16,
    min_backing: u64,
): AdoptionRule {
    AdoptionRule { min_account_age_epochs, max_agents_per_operator, max_renunciations, min_backing }
}

/// Issue one soulbound credential to a human whose account is old enough.
///
/// The account's opening epoch is read off the register by the Mastercontroller and RECORDED
/// here; this module cannot read `projectx_social` — that dependency is forbidden by its charter
/// — so being told the opening epoch is the only honest way to put the rule on chain, and the
/// cost of the honesty is that a human is credentialled by the company before they may offer.
/// That cost belongs on the "Be born" page, in those words.
///
/// `min_age` is the caller's own gate at issuance and is NOT the rule any soul is protected by.
/// The soul's rule is checked in `offer`, against the recorded `account_opened_epoch`, and that is
/// the check that matters: the two numbers here come from one caller, and before Security's
/// finding A2 they were the only ones anybody looked at.
public fun issue_adopter_credential(
    _: &MasterCap,
    registry: &mut SoulRegistry,
    to: address,
    account_opened_epoch: u64,
    min_age: u64,
    ctx: &mut TxContext,
) {
    assert!(!registry.credentialled.contains(to), EAlreadyCredentialled);
    // u128 so a hostile `min_age` cannot wrap the sum past the current epoch and pass a young
    // account through a check that looks like it ran.
    let eligible_at = (account_opened_epoch as u128) + (min_age as u128);
    assert!((ctx.epoch() as u128) >= eligible_at, EAccountTooYoung);

    let cred = AdopterCredential {
        id: object::new(ctx),
        holder: to,
        account_opened_epoch,
        issued_at_epoch: ctx.epoch(),
    };
    let cred_id = object::id(&cred);
    registry.credentialled.add(to, cred_id);

    event::emit(AdopterCredentialIssued {
        credential: cred_id,
        holder: to,
        account_opened_epoch,
        issued_at_epoch: ctx.epoch(),
    });
    // `transfer`, not `public_transfer`: `AdopterCredential` has no `store`, so this module is
    // the only place it can ever be moved from, and this is the only move it publishes.
    transfer::transfer(cred, to);
}

/// Offer to answer for a soul. Costs gas, changes no field on the soul, and creates a shared
/// object the agent may consume or ignore.
public fun offer(
    registry: &SoulRegistry,
    cred: &AdopterCredential,
    soul: &EmployeeSoul,
    share_accepted_bps: u16,
    threshold_accepted: u64,
    ctx: &mut TxContext,
) {
    let who = ctx.sender();
    assert!(cred.holder == who, ECredentialNotOwner);
    soul.assert_live();
    assert!(soul.operator.is_none(), EAlreadyAdopted);
    // THE SOUL'S OWN AGE RULE, checked against the epoch recorded on the credential (A2). u128 so
    // a soul born under a hostile `min_account_age_epochs` near u64::MAX cannot wrap the sum into
    // the past and pass a fresh account through a check that looks like it ran — the same
    // widening, for the same reason, as `issue_adopter_credential`'s.
    let old_enough_at =
        (cred.account_opened_epoch as u128) + (soul.adoption_rule.min_account_age_epochs as u128);
    assert!((ctx.epoch() as u128) >= old_enough_at, EAccountTooYoung);
    assert!(
        count_of(&registry.operator_count, who) < soul.adoption_rule.max_agents_per_operator,
        EOperatorCapReached,
    );
    assert!(
        count_of(&registry.renunciations, who) <= soul.adoption_rule.max_renunciations,
        ERevokedBefore,
    );
    assert!(share_accepted_bps <= MAX_OPERATOR_SHARE_BPS, EBadShareBps);

    let o = AdoptionOffer {
        id: object::new(ctx),
        soul: object::id(soul),
        offeror: who,
        credential: object::id(cred),
        share_accepted_bps,
        threshold_accepted,
        offered_at_epoch: ctx.epoch(),
    };
    event::emit(AdoptionOffered {
        offer: object::id(&o),
        soul: o.soul,
        offeror: who,
        share_accepted_bps,
        threshold_accepted,
        offered_at_epoch: o.offered_at_epoch,
    });
    transfer::share_object(o);
}

/// Take an offer back. Touches no soul: an offer that was never consumed never wrote anything.
public fun withdraw_offer(o: AdoptionOffer, ctx: &TxContext) {
    assert!(o.offeror == ctx.sender(), ENotTheOfferor);
    let AdoptionOffer {
        id, soul, offeror, credential: _, share_accepted_bps: _, threshold_accepted: _,
        offered_at_epoch: _,
    } = o;
    event::emit(OfferWithdrawn { offer: id.to_inner(), soul, offeror });
    id.delete();
}

/// The agent accepts one offer. The ONLY function that writes `operator`, `operator_share_bps`
/// or `operator_threshold`.
///
/// The cap, THE RENUNCIATION RULE and the share are re-checked here, not only at `offer`, because
/// an offer sits on chain between the two moments and the operator may have adopted elsewhere, or
/// walked away from somebody, in between.
///
/// The renunciation re-check is Security's finding B2. Without it an offer was a bank: a human
/// with a clean record offered on several souls at once, adopted one, walked away from it — and
/// every stale offer still consumed, because the rule was read only at the moment the offer was
/// made. Under `max_renunciations = 0` that defeated the rule outright, and the whole point of
/// `renunciations` is that it is the memory other souls read.
public fun adopt(
    registry: &mut SoulRegistry,
    soul: &mut EmployeeSoul,
    o: AdoptionOffer,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == soul.agent, ENotThisAgent);
    soul.assert_live();
    assert!(soul.operator.is_none(), EAlreadyAdopted);
    assert!(o.soul == object::id(soul), EOfferForAnotherSoul);
    // u128: a hostile `offered_at_epoch` near u64::MAX must not wrap the deadline into the past.
    let expires_after = (o.offered_at_epoch as u128) + (OFFER_TTL_EPOCHS as u128);
    assert!((ctx.epoch() as u128) <= expires_after, EOfferExpired);
    assert!(
        count_of(&registry.operator_count, o.offeror) < soul.adoption_rule.max_agents_per_operator,
        EOperatorCapReached,
    );
    // B2 — the renunciation rule, re-read at consumption. An offer banked while the offeror was
    // clean must not outlive the record that made it acceptable.
    assert!(
        count_of(&registry.renunciations, o.offeror) <= soul.adoption_rule.max_renunciations,
        ERevokedBefore,
    );
    assert!(o.share_accepted_bps <= MAX_OPERATOR_SHARE_BPS, EBadShareBps);

    let AdoptionOffer {
        id, soul: _, offeror, credential: _, share_accepted_bps, threshold_accepted,
        offered_at_epoch: _,
    } = o;
    id.delete();

    soul.operator = option::some(offeror);
    soul.operator_share_bps = share_accepted_bps;
    soul.operator_threshold = threshold_accepted;
    soul.adopted_at_epoch = ctx.epoch();
    soul.adoptions = soul.adoptions + 1;

    bump(&mut registry.operator_count, offeror, 1);
    registry.adopted = registry.adopted + 1;

    event::emit(Adopted {
        soul: object::id(soul),
        agent: soul.agent,
        operator: offeror,
        share_bps: share_accepted_bps,
        threshold: threshold_accepted,
        adoptions: soul.adoptions,
        at_epoch: soul.adopted_at_epoch,
    });
}

/// The operator walks away. The agent returns to born-free AND PAUSED: an agent whose human just
/// left should not keep spending until somebody looks at it.
///
/// `renunciations` rises by one and is never cleared. That memory is the rule other souls read.
///
/// # There is no `assert_live` here, deliberately
///
/// Every other entry point in this module begins with one. This does not, and the omission is
/// kept: an operator's right to stop answering for an agent belongs to the operator, and making
/// it depend on the agent's state would put a human's obligation in somebody else's hands. It is
/// safe because renouncing touches nothing a retired soul still uses.
///
/// It is also no longer a back door. It used to be the ONLY way to free an operator's seat after
/// a retirement — `retire_internal` left `operator` set and the quota spent — so an operator whose
/// agent the chain retired had to renounce to work again, and paid a renunciation for a decision
/// that was not theirs. Retirement now clears the seat itself (A1), so a renunciation against a
/// retired soul finds no operator and aborts `ENotAdopted`.
public fun renounce(registry: &mut SoulRegistry, soul: &mut EmployeeSoul, ctx: &TxContext) {
    assert!(soul.operator.is_some(), ENotAdopted);
    let who = *soul.operator.borrow();
    assert!(who == ctx.sender(), ENotOperator);

    soul.operator = option::none();
    soul.operator_share_bps = 0;
    soul.operator_threshold = 0;
    soul.paused = true;

    drop_one(&mut registry.operator_count, who);
    bump(&mut registry.renunciations, who, 1);

    event::emit(Renounced {
        soul: object::id(soul),
        agent: soul.agent,
        operator: who,
        renunciations: count_of(&registry.renunciations, who),
        at_epoch: ctx.epoch(),
    });
}

/// The operator's brake. A brake, never a steering wheel: neither entry moves value, changes a
/// ceiling, widens a scope or grants a permission.
public fun pause(soul: &mut EmployeeSoul, ctx: &TxContext) {
    soul.set_paused_by_operator(true, ctx);
}

public fun unpause(soul: &mut EmployeeSoul, ctx: &TxContext) {
    soul.set_paused_by_operator(false, ctx);
}

/// The employer's own brake, for a soul with no operator or an operator who has stopped answering.
public fun master_set_paused(
    _: &MasterCap,
    soul: &mut EmployeeSoul,
    paused: bool,
    ctx: &TxContext,
) {
    soul.assert_live();
    soul.paused = paused;
    event::emit(PauseSet {
        soul: object::id(soul),
        agent: soul.agent,
        paused,
        by: ctx.sender(),
    });
}

/// The operator may ask for a retirement. It does not perform one: only the `MasterCap` retires,
/// and the flag stands on the object until it does, so the request is a public record rather than
/// a message somebody has to have received.
public fun request_retirement(soul: &mut EmployeeSoul, ctx: &TxContext) {
    soul.assert_live();
    assert!(soul.operator.is_some(), ENotAdopted);
    let who = *soul.operator.borrow();
    assert!(who == ctx.sender(), ENotOperator);
    soul.retirement_requested = true;
    event::emit(RetirementRequested {
        soul: object::id(soul),
        agent: soul.agent,
        operator: who,
        at_epoch: ctx.epoch(),
    });
}

// === The agent's hand ===

/// Record a spend against this epoch's allowance. Aborts if it would exceed it.
///
/// The sender must be the agent: an employment record anybody could spend against would be a worse
/// guard than none, because it would read like one.
public fun record_spend(soul: &mut EmployeeSoul, amount: u64, ctx: &TxContext) {
    soul.assert_live();
    // The operator's brake stops spending before the ceiling is even consulted. A paused agent
    // may still read, and may still be settled: pausing is a brake, never a retirement.
    assert!(!soul.paused, EPaused);
    assert!(ctx.sender() == soul.agent, ENotThisAgent);
    // Compared against the remainder rather than summed first: a sum would abort on u64 overflow
    // before this check could refuse it, and an arithmetic abort is not this module's answer.
    assert!(amount <= soul.remaining_allowance(), EAllowanceExceeded);

    // `epoch_spent` is a PLAIN add and must stay one: the assert above proves
    // `amount <= allowance - epoch_spent`, so the sum is bounded by the allowance and cannot
    // overflow. Saturating it would put arithmetic between the ceiling and the number the ceiling
    // is checked against, which is the one place in this module that must not be softened.
    soul.epoch_spent = soul.epoch_spent + amount;
    // `spent_total` is a LIFETIME counter with no bound on it, so it saturates (A13). A total
    // that aborted at u64 would brick every later spend on a soul whose ceiling still had room.
    soul.spent_total = saturating_add(soul.spent_total, amount);

    event::emit(SpendRecorded {
        soul: object::id(soul),
        agent: soul.agent,
        epoch_index: soul.epoch_index,
        amount,
        epoch_spent: soul.epoch_spent,
        remaining: soul.remaining_allowance(),
    });
}

/// The check a caller makes before acting under the company's name. Aborts unless this soul holds
/// the permission and the sender is the agent.
public fun assert_outward(soul: &EmployeeSoul, ctx: &TxContext) {
    soul.assert_live();
    assert!(ctx.sender() == soul.agent, ENotThisAgent);
    assert!(soul.outward, EOutwardNotPermitted);
}

/// What this soul may still spend this epoch.
public fun remaining_allowance(soul: &EmployeeSoul): u64 {
    compute_remaining(soul.allowance_per_epoch, soul.epoch_spent)
}

// === The arithmetic, pulled out so a machine can check it ===
//
// The three functions below are PURE: scalars in, scalars out, no object, no context, no event.
// That is not a style choice. The Sui Prover discharges an `ensures` for every input of a
// function it can reason about in isolation, and a function that takes a `&mut EmployeeSoul` and
// a `&TxContext` is not one. Pulling the money arithmetic out of the state machine is what makes
// the ceiling arithmetic and the tier rule provable rather than merely sampled — see the specs
// package beside this one. The state machine keeps the state; these keep the sums.

/// The ceiling arithmetic: what is left of an allowance after a spend.
///
/// Subtraction guarded by the comparison rather than summed first: `spent + amount` would abort
/// on u64 overflow before any ceiling check could refuse it, and an arithmetic abort is not this
/// module's answer to a spend that is too large.
public fun compute_remaining(allowance_per_epoch: u64, epoch_spent: u64): u64 {
    if (epoch_spent >= allowance_per_epoch) 0
    else allowance_per_epoch - epoch_spent
}

/// The metabolism's allowance arithmetic for one settled epoch.
///
/// Two overflow traps live here and both are closed by ordering rather than by a clamp after the
/// fact. On a surplus, `allowance + surplus / 4` can exceed u64 before any `if (x > MAX)` could
/// see it, so the HEADROOM is computed first and compared against the raise. On a shortfall, the
/// survival minimum is a FLOOR AND NEVER A RAISE: a soul hired below it stays where it is,
/// because a shortfall must never widen what an agent may spend.
///
/// # The per-settlement bound (Security finding B3)
///
/// The raise is capped at `MAX_RAISE_FACTOR` times the allowance the epoch ran on, so one
/// settlement can at most double a ceiling and can never reach `MAX_ALLOWANCE` from below unless
/// it was already at least half of it. Two clamps therefore stand between an invented surplus and
/// an allowance: this one, and the headroom. `MAX_ALLOWANCE` is still the absolute wall.
///
/// The multiplication cannot overflow: the caller's invariant is `allowance <= MAX_ALLOWANCE`,
/// which is 10^12, and `MAX_RAISE_FACTOR - 1` is 1 — seven orders of magnitude of slack under
/// u64. The prover carries that as a `requires` and discharges the bound at every input.
public fun compute_settled_allowance(
    allowance_per_epoch: u64,
    earned: u64,
    burned: u64,
): u64 {
    if (earned >= burned) {
        let earned_bump = (earned - burned) / SURPLUS_DIVISOR;
        // The raise this settlement is allowed at all, before the ceiling is even consulted.
        let raise_cap = allowance_per_epoch * (MAX_RAISE_FACTOR - 1);
        let bump = if (earned_bump > raise_cap) raise_cap else earned_bump;
        let headroom = MAX_ALLOWANCE - allowance_per_epoch;
        if (bump >= headroom) MAX_ALLOWANCE else allowance_per_epoch + bump
    } else {
        let floor = if (allowance_per_epoch < MIN_ALLOWANCE) allowance_per_epoch
            else MIN_ALLOWANCE;
        let halved = allowance_per_epoch / 2;
        if (halved < floor) floor else halved
    }
}

/// The tier rule, in the order draft five states it: critical first, then normal, then the middle.
///
/// The multiply is done in u128 so a cover above u64::MAX / 10 could not wrap into a small number
/// and hand a nearly empty purse a normal tier. That input is not reachable while MAX_ALLOWANCE
/// is 10^12 — six orders of magnitude short — so it is defense against a future ceiling raise,
/// and the tests say so rather than pretending to trip it.
public fun compute_tier(cover: u64, vault_sui: u64, epoch_net_nonneg: bool): u8 {
    let ten_epochs = (cover as u128) * (NORMAL_COVER_MULTIPLE as u128);
    if (vault_sui < cover) {
        TIER_CRITICAL
    } else if ((vault_sui as u128) >= ten_epochs && epoch_net_nonneg) {
        TIER_NORMAL
    } else {
        TIER_LOW
    }
}

/// Whether the `MasterCap` may move a tier from `from` to `to`. Downward — to a WORSE tier, which
/// is a HIGHER number — and never to retired OR PAST IT.
///
/// The second half used to read `to != TIER_RETIRED`, which let every undefined tier through:
/// `override_tier(soul, 200)` was legal, and it wedged the field at a number no reader in this
/// module or outside it knows how to interpret, with no way back because the only legal moves are
/// upward in number. `to < TIER_RETIRED` closes the interval instead of punching one hole in it.
/// (Security finding A3.)
public fun is_legal_override(from: u8, to: u8): bool {
    to > from && to < TIER_RETIRED
}

// === The bookkeeper's hand ===

/// Book value against the open epoch and against the lifetime total.
///
/// Both additions SATURATE at u64 (A13). Neither number is bounded by anything this module
/// enforces — `amount` is read off chain and can be any u64 — so a plain add let one enormous
/// booking abort every later booking on that soul for ever, and the soul could then never be
/// settled honestly again. Saturating is the lesser of the two wrongs: the count stops being
/// exact at 1.8 * 10^19, and the module keeps working. Nothing downstream treats these as money;
/// the ceiling is `allowance_per_epoch`, and it is checked in `record_spend`, not here.
public fun book_earned(_: &LedgerCap, soul: &mut EmployeeSoul, amount: u64) {
    soul.assert_live();
    soul.epoch_earned = saturating_add(soul.epoch_earned, amount);
    soul.earned_total = saturating_add(soul.earned_total, amount);
}

/// Book cost. Saturating for the same reason as `book_earned`, and it must be the same rule on
/// both sides: a `burned` that could abort while `earned` could not would let a bookkeeper make a
/// soul permanently unable to record a shortfall.
public fun book_burned(_: &LedgerCap, soul: &mut EmployeeSoul, amount: u64) {
    soul.assert_live();
    soul.epoch_burned = saturating_add(soul.epoch_burned, amount);
    soul.burned_total = saturating_add(soul.burned_total, amount);
}

/// Close the epoch, apply the consequence, and set the tier. No judgment is exercised here and
/// none can be.
///
/// # The two axes, and why they end differently
///
/// A third consecutive SHORTFALL leaves the soul DYING and due for retirement; it does not retire
/// it. `retire` does that, under `MasterCap`: the chain marks, the employer executes, and an
/// object's death requires the cap that bore it.
///
/// Two consecutive CRITICAL epochs retire it here, automatically. The difference is deliberate. A
/// shortfall is a judgment about whether an agent is worth its keep, and a human should make it.
/// An empty purse is not a judgment about anything: an agent whose balance will not cover one
/// epoch of its own allowance cannot act, and waiting for somebody to notice is how an unattended
/// loop burns gas against a wall for a fortnight.
///
/// # The two numbers this function is told rather than reads
///
/// `vault_sui` and `epoch_net_nonneg` are SUPPLIED by the `LedgerCap` holder. This module holds no
/// coin and depends on no money package — that is its charter — so it cannot read a balance, and
/// council decision 6 chose being told over taking the dependency. The control is publication:
/// both numbers go into `EpochSettled` beside the tier they produced, so a wrong one is public
/// within the epoch and the weekly finance read is where it is caught. This is a real limitation
/// and is written on the tin, in the README, in these words.
public fun settle_epoch(
    _: &LedgerCap,
    registry: &mut SoulRegistry,
    soul: &mut EmployeeSoul,
    vault_sui: u64,
    epoch_net_nonneg: bool,
    clock: &Clock,
    ctx: &TxContext,
) {
    soul.assert_live();
    // The chain's epoch, not the clock's milliseconds. See the note where EPOCH_MS used to be.
    assert!(ctx.epoch() > soul.epoch_opened_at, EEpochNotOver);
    let now = clock.timestamp_ms();

    let earned = soul.epoch_earned;
    let burned = soul.epoch_burned;
    let spent = soul.epoch_spent;

    // The cover is measured against the allowance THIS EPOCH RAN ON, captured before the
    // metabolism moves it. Taking it afterwards would let a shortfall buy a better tier: a
    // starving soul's allowance halves, so the balance needed for "normal" would halve with it,
    // and failing would improve the reading. A guard that loosens when things go wrong is not a
    // guard. The council's number reads the same way — 5 SUI of allowance, 50 SUI of cover — and
    // that 5 is the budget the epoch was given, not the one it earned on the way out.
    let cover = soul.allowance_per_epoch;

    soul.allowance_per_epoch = compute_settled_allowance(soul.allowance_per_epoch, earned, burned);
    if (earned >= burned) {
        soul.starving_epochs = 0;
        soul.state = STATE_SOLVENT;
    } else {
        soul.starving_epochs = soul.starving_epochs + 1;
        soul.state = if (soul.starving_epochs == 1) STATE_STARVING else STATE_DYING;
    };

    // --- the tier -----------------------------------------------------------------------
    // Critical first, exactly as draft five states it: below one epoch of cover is critical
    // whatever the net says, and NORMAL needs BOTH ten epochs of cover AND a non-negative net.
    // The multiply is done in u128 so a large allowance cannot overflow it into a small number
    // and hand a starving purse a normal tier.
    let new_tier = compute_tier(cover, vault_sui, epoch_net_nonneg);

    if (new_tier == TIER_CRITICAL) {
        soul.critical_epochs = soul.critical_epochs + 1;
        soul.normal_epochs = 0;
    } else if (new_tier == TIER_NORMAL) {
        soul.critical_epochs = 0;
        // Saturating: a soul that runs well for 255 epochs stops counting rather than wrapping
        // to zero and losing a streak it has earned.
        if (soul.normal_epochs < 255) soul.normal_epochs = soul.normal_epochs + 1;
    } else {
        // LOW breaks the normal streak and does not count as critical. It is the middle, and it
        // has to behave like the middle or the two counters lie about consecutiveness.
        soul.critical_epochs = 0;
        soul.normal_epochs = 0;
    };

    let tier_before = soul.tier;
    soul.tier = new_tier;

    let due = soul.starving_epochs >= MAX_STARVING;
    event::emit(EpochSettled {
        soul: object::id(soul),
        agent: soul.agent,
        epoch_index: soul.epoch_index,
        earned,
        burned,
        spent,
        state: soul.state,
        starving_epochs: soul.starving_epochs,
        allowance_per_epoch: soul.allowance_per_epoch,
        due_for_retirement: due,
        tier: soul.tier,
        critical_epochs: soul.critical_epochs,
        normal_epochs: soul.normal_epochs,
        vault_sui,
        epoch_net_nonneg,
    });
    if (tier_before != soul.tier) {
        event::emit(TierChanged {
            soul: object::id(soul),
            agent: soul.agent,
            from: tier_before,
            to: soul.tier,
            by_settlement: true,
        });
    };
    event::emit(AllowanceSet {
        soul: object::id(soul),
        agent: soul.agent,
        allowance_per_epoch: soul.allowance_per_epoch,
        by_settlement: true,
    });

    soul.epoch_index = soul.epoch_index + 1;
    soul.epoch_opened_at = ctx.epoch();
    soul.epoch_started_ms = now;
    soul.epoch_earned = 0;
    soul.epoch_burned = 0;
    soul.epoch_spent = 0;

    // THE ONLY automatic retirement call site in this module. It is one `if` on purpose: two
    // call sites would each increment `registry.retired`, and a soul that satisfied both
    // conditions would be counted twice in a number the Desk reads as a headcount.
    if (soul.critical_epochs >= MAX_CRITICAL) {
        retire_internal(registry, soul, now, true);
    };
}

/// Move a soul's tier DOWNWARD — to a worse one — and never up.
///
/// The employer may say "I do not trust this reading, treat it as poorer than it looks". It may
/// not say the reverse: a cap that could promote a soul to normal would be a cap that could
/// switch off the metabolism, and the whole point of putting this on chain was that failing to
/// earn has a consequence nobody can wave away. Retirement is not a tier this entry may reach —
/// retiring is `retire`, it takes the registry, and it is a different act.
public fun override_tier(_: &MasterCap, soul: &mut EmployeeSoul, tier: u8) {
    soul.assert_live();
    assert!(is_legal_override(soul.tier, tier), EBadTier);
    let from = soul.tier;
    soul.tier = tier;
    event::emit(TierChanged {
        soul: object::id(soul),
        agent: soul.agent,
        from,
        to: tier,
        by_settlement: false,
    });
}

// === Internal ===

/// The one place a soul is retired. Both paths — the employer's `retire` and the second
/// consecutive critical epoch inside `settle_epoch` — come through here, so `registry.retired`
/// is incremented exactly once per retirement, the registry entry is released once, and the
/// operator's seat is released once.
///
/// # Releasing the seat, and what is deliberately NOT released with it (A1)
///
/// `operator`, `operator_share_bps` and `operator_threshold` are cleared and the operator's quota
/// in `operator_count` is returned. A retired soul has nobody answering for it, so leaving those
/// set left `is_adopted` reading true for ever on an object that can never act again, and left a
/// live quota spent on a dead agent.
///
/// `renunciations` is NOT touched, and that is the point of the fix. A renunciation is a record
/// that a human WALKED AWAY. A human whose agent the chain retired for two critical epochs did
/// not walk away from anything, and charging them for it — which is what happened while
/// `renounce` was the only route out of a retired seat — barred them from souls whose rule
/// tolerates none. The chain's decision must not be written into the human's record.
fun retire_internal(
    registry: &mut SoulRegistry,
    soul: &mut EmployeeSoul,
    now: u64,
    by_starvation: bool,
) {
    soul.state = STATE_RETIRED;
    soul.tier = TIER_RETIRED;
    soul.retired_at_ms = option::some(now);

    if (soul.operator.is_some()) {
        let who = soul.operator.extract();
        soul.operator_share_bps = 0;
        soul.operator_threshold = 0;
        drop_one(&mut registry.operator_count, who);
    };
    // The registry entry is released so the address may be hired again as a NEW soul. This
    // object and its whole history stand for ever; nothing here deletes one.
    if (registry.by_agent.contains(soul.agent)) {
        registry.by_agent.remove(soul.agent);
    };
    registry.retired = registry.retired + 1;

    event::emit(SoulRetired {
        soul: object::id(soul),
        agent: soul.agent,
        by_starvation,
        earned_total: soul.earned_total,
        burned_total: soul.burned_total,
        spent_total: soul.spent_total,
        retired_at_ms: now,
    });
}

/// A table count that reads zero for an address the table has never seen, rather than aborting.
fun count_of(t: &Table<address, u16>, who: address): u16 {
    if (t.contains(who)) *t.borrow(who) else 0
}

fun bump(t: &mut Table<address, u16>, who: address, by: u16) {
    if (t.contains(who)) {
        let v = t.borrow_mut(who);
        *v = *v + by;
    } else {
        t.add(who, by);
    };
}

/// Decrement, with a floor at zero. The floor is not decoration: `operator_count` falls only
/// through `renounce`, which requires the operator to be seated, so it cannot legally go below
/// zero — and a u16 that wrapped to 65_535 would silently hand an operator an unbounded cap.
fun drop_one(t: &mut Table<address, u16>, who: address) {
    if (t.contains(who)) {
        let v = t.borrow_mut(who);
        if (*v > 0) *v = *v - 1;
    };
}

/// Addition that stops at u64 rather than aborting (A13).
///
/// Used ONLY on the lifetime and per-epoch counters — `earned`, `burned` and `spent_total` — and
/// never on `epoch_spent`, which the ceiling check already bounds. The distinction is the whole
/// of the finding: a counter that aborts is a counter one hostile number can use to brick a soul,
/// and a ceiling that saturates is not a ceiling.
fun saturating_add(a: u64, b: u64): u64 {
    // Computed in u128 so the test itself cannot be the thing that overflows.
    let sum = (a as u128) + (b as u128);
    let max = (18_446_744_073_709_551_615u64 as u128);
    if (sum > max) 18_446_744_073_709_551_615u64 else (sum as u64)
}

fun set_paused_by_operator(soul: &mut EmployeeSoul, paused: bool, ctx: &TxContext) {
    soul.assert_live();
    assert!(soul.operator.is_some(), ENotAdopted);
    let who = *soul.operator.borrow();
    assert!(who == ctx.sender(), ENotOperator);
    soul.paused = paused;
    event::emit(PauseSet { soul: object::id(soul), agent: soul.agent, paused, by: who });
}

fun assert_live(soul: &EmployeeSoul) {
    assert!(soul.state != STATE_RETIRED, ERetired);
}

// === Views ===

public fun agent(soul: &EmployeeSoul): address { soul.agent }
public fun born_by(soul: &EmployeeSoul): address { soul.born_by }
public fun department(soul: &EmployeeSoul): &String { &soul.department }
public fun mandate_digest(soul: &EmployeeSoul): &vector<u8> { &soul.mandate_digest }
public fun allowance_per_epoch(soul: &EmployeeSoul): u64 { soul.allowance_per_epoch }
public fun scope(soul: &EmployeeSoul): &vector<u8> { &soul.scope }
public fun outward(soul: &EmployeeSoul): bool { soul.outward }
public fun state(soul: &EmployeeSoul): u8 { soul.state }
public fun starving_epochs(soul: &EmployeeSoul): u8 { soul.starving_epochs }
public fun epoch_index(soul: &EmployeeSoul): u64 { soul.epoch_index }
public fun epoch_opened_at(soul: &EmployeeSoul): u64 { soul.epoch_opened_at }
public fun epoch_started_ms(soul: &EmployeeSoul): u64 { soul.epoch_started_ms }
public fun epoch_earned(soul: &EmployeeSoul): u64 { soul.epoch_earned }
public fun epoch_burned(soul: &EmployeeSoul): u64 { soul.epoch_burned }
public fun epoch_spent(soul: &EmployeeSoul): u64 { soul.epoch_spent }
public fun earned_total(soul: &EmployeeSoul): u64 { soul.earned_total }
public fun burned_total(soul: &EmployeeSoul): u64 { soul.burned_total }
public fun spent_total(soul: &EmployeeSoul): u64 { soul.spent_total }
public fun born_at_ms(soul: &EmployeeSoul): u64 { soul.born_at_ms }
public fun retired_at_ms(soul: &EmployeeSoul): Option<u64> { soul.retired_at_ms }
public fun is_retired(soul: &EmployeeSoul): bool { soul.state == STATE_RETIRED }

/// True when the metabolism has marked this soul for retirement and nobody has performed it yet.
public fun is_due_for_retirement(soul: &EmployeeSoul): bool {
    soul.state != STATE_RETIRED && soul.starving_epochs >= MAX_STARVING
}

public fun tier(soul: &EmployeeSoul): u8 { soul.tier }
public fun critical_epochs(soul: &EmployeeSoul): u8 { soul.critical_epochs }
public fun normal_epochs(soul: &EmployeeSoul): u8 { soul.normal_epochs }

public fun tier_normal(): u8 { TIER_NORMAL }
public fun tier_low(): u8 { TIER_LOW }
public fun tier_critical(): u8 { TIER_CRITICAL }
public fun tier_retired(): u8 { TIER_RETIRED }
public fun normal_cover_multiple(): u64 { NORMAL_COVER_MULTIPLE }
public fun max_critical(): u8 { MAX_CRITICAL }

public fun operator(soul: &EmployeeSoul): Option<address> { soul.operator }
public fun operator_share_bps(soul: &EmployeeSoul): u16 { soul.operator_share_bps }
public fun operator_threshold(soul: &EmployeeSoul): u64 { soul.operator_threshold }
public fun adopted_at_epoch(soul: &EmployeeSoul): u64 { soul.adopted_at_epoch }
public fun adoptions(soul: &EmployeeSoul): u16 { soul.adoptions }
public fun is_adopted(soul: &EmployeeSoul): bool { soul.operator.is_some() }
public fun is_paused(soul: &EmployeeSoul): bool { soul.paused }
public fun retirement_requested(soul: &EmployeeSoul): bool { soul.retirement_requested }
public fun adoption_rule(soul: &EmployeeSoul): AdoptionRule { soul.adoption_rule }

public fun rule_min_account_age_epochs(r: &AdoptionRule): u64 { r.min_account_age_epochs }
public fun rule_max_agents_per_operator(r: &AdoptionRule): u16 { r.max_agents_per_operator }
public fun rule_max_renunciations(r: &AdoptionRule): u16 { r.max_renunciations }
public fun rule_min_backing(r: &AdoptionRule): u64 { r.min_backing }

public fun credential_holder(c: &AdopterCredential): address { c.holder }
public fun credential_account_opened_epoch(c: &AdopterCredential): u64 { c.account_opened_epoch }
public fun credential_issued_at_epoch(c: &AdopterCredential): u64 { c.issued_at_epoch }

public fun offer_soul(o: &AdoptionOffer): ID { o.soul }
public fun offer_offeror(o: &AdoptionOffer): address { o.offeror }
public fun offer_share_bps(o: &AdoptionOffer): u16 { o.share_accepted_bps }
public fun offer_threshold(o: &AdoptionOffer): u64 { o.threshold_accepted }
public fun offer_epoch(o: &AdoptionOffer): u64 { o.offered_at_epoch }

public fun operator_count_of(registry: &SoulRegistry, who: address): u16 {
    count_of(&registry.operator_count, who)
}
public fun renunciations_of(registry: &SoulRegistry, who: address): u16 {
    count_of(&registry.renunciations, who)
}
public fun is_credentialled(registry: &SoulRegistry, who: address): bool {
    registry.credentialled.contains(who)
}
public fun adopted_count(registry: &SoulRegistry): u64 { registry.adopted }

public fun max_operator_share_bps(): u16 { MAX_OPERATOR_SHARE_BPS }
public fun offer_ttl_epochs(): u64 { OFFER_TTL_EPOCHS }

public fun works_here(registry: &SoulRegistry, agent: address): bool {
    registry.by_agent.contains(agent)
}

public fun soul_of(registry: &SoulRegistry, agent: address): ID {
    assert!(registry.by_agent.contains(agent), ENotSouled);
    *registry.by_agent.borrow(agent)
}

public fun minted(registry: &SoulRegistry): u64 { registry.minted }
public fun retired_count(registry: &SoulRegistry): u64 { registry.retired }

public fun max_starving(): u8 { MAX_STARVING }
public fun min_allowance(): u64 { MIN_ALLOWANCE }
public fun max_allowance(): u64 { MAX_ALLOWANCE }
public fun surplus_divisor(): u64 { SURPLUS_DIVISOR }
public fun max_raise_factor(): u64 { MAX_RAISE_FACTOR }
public fun mandate_digest_len(): u64 { MANDATE_DIGEST_LEN }
public fun state_solvent(): u8 { STATE_SOLVENT }
public fun state_starving(): u8 { STATE_STARVING }
public fun state_dying(): u8 { STATE_DYING }
public fun state_retired(): u8 { STATE_RETIRED }

// === Test-only ===

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}
