// SPDX-License-Identifier: BUSL-1.1
// Licensor: Northlatch Labs LLC. Change Date: 2029-09-01. Change License: Apache-2.0.
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/// The stake leg: a creator's profile as a no-loss vault.
///
/// A fan deposits SUI. The principal stays theirs, redeemable one-for-one, at any time. The vault
/// delegates it through a staking ladder, and the **yield** — never the principal — is split
/// between the creator, the platform, and optionally back to the depositors themselves as a perk
/// the creator configures.
///
/// This is the second of two revenue legs. The first (`creator`) is flow: a fan pays and the money
/// is gone. This one is stake: a fan commits and keeps everything. They monetise different people.
///
/// # The honest arithmetic, stated in the contract because it constrains the product
///
/// Sui native staking yields roughly 1.4951% a year. Paying a creator `X` per month from yield
/// alone therefore requires about `X * 802.6` of locked principal: ~$8,000 to produce $10 a month.
/// A thousand fans parking $100 each generate about $125 a month for the creator, where the same
/// thousand fans on a $5 subscription would generate $5,000.
///
/// So this leg is roughly **40× weaker per fan** than the flow leg, and anyone reasoning about it
/// as a salary replacement will be wrong. Its value is that it converts fans who would never
/// subscribe — parking money you keep is not spending — and that the revenue recurs without anyone
/// deciding to spend again. Deposit size can also gate membership tiers, which is arguably the
/// feature: subscriber status that costs nothing but commitment.
///
/// # The no-loss guarantee, and why it is unconditional
///
/// The invariant is checked on every mutating call:
///
/// > `liquid + staked_principal >= total_principal`
///
/// # What this vault deliberately does not do
///
/// It does not lend, leverage, or route principal anywhere but Sui native staking. Every additional
/// venue is another way for principal to fail to come back, and the entire proposition here is that
/// it always does.
module projectx_social::stake_vault;

use projectx_social::account::{Self, SocialAccount};
use projectx_social::platform::{Self, Platform, PlatformCap};
use projectx_social::stake_ladder;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::dynamic_field as df;
use sui::event;
use sui::sui::SUI;
use sui::table::{Self, Table};
use sui_system::staking_pool::StakedSui;
use sui_system::sui_system::SuiSystemState;

const VERSION: u64 = 1;
const BPS_DENOMINATOR: u64 = 10_000;

/// Fixed-point scale for the rebate accumulator.
///
/// 1e12, chosen against the smallest quantity it has to represent: one MIST of rebate spread over a
/// large pool. At 1e12 a pool of 1,000,000 SUI (1e15 MIST) still resolves a single MIST of rebate
/// to a non-zero increment, so small harvests are not silently rounded to nothing. `u128`
/// throughout, so the widening cannot overflow at any principal a vault can hold.
const ACC_SCALE: u128 = 1_000_000_000_000;

/// The smallest deposit that opens a position.
///
/// A position is a `Table` entry that persists until it is closed, so dust deposits impose a
/// permanent cost on the vault for no economic content. One SUI also matches the chain's own
/// minimum stake, which keeps the two floors from disagreeing.
const MIN_DEPOSIT_MIST: u64 = 1_000_000_000;

// === Errors ===

const EWrongVersion: u64 = 1;
const EWrongVault: u64 = 2;
const EWrongPlatform: u64 = 3;
/// The vault has stopped accepting new deposits. Withdrawals are deliberately unaffected.
const ENotAccepting: u64 = 4;
/// The deposit is below `MIN_DEPOSIT_MIST`.
const EDepositTooSmall: u64 = 5;
/// No position exists for this address.
const ENoPosition: u64 = 6;
/// More was withdrawn than the position holds.
const EInsufficientPrincipal: u64 = 7;
/// More was claimed than the balance holds.
const EInsufficientBalance: u64 = 8;
/// A rebate share above 100% of the creator's own yield was requested.
const ERebateAboveMax: u64 = 9;
/// The no-loss invariant does not hold. Should be unreachable; see `assert_solvent`.
const EInsolvent: u64 = 10;
/// The vault could not raise enough liquidity even after unwinding the whole ladder.
const ECannotRaiseLiquidity: u64 = 11;
/// `migrate` was called when the stored version already matches the package.
const ENotUpgraded: u64 = 12;

// === Types ===

/// One depositor's stake in one vault.
public struct Position has store {
    /// Principal, in MIST. Always redeemable one-for-one.
    principal: u64,
    /// `principal * acc_rebate_per_unit / ACC_SCALE` as of the last interaction. The standard
    /// accumulator bookkeeping: what this position would have been owed if it had held its current
    /// principal since the vault began, so the difference is what it is actually owed now.
    rebate_debt: u128,
    /// Accrued but unclaimed rebate, in MIST.
    pending: u64,
}

/// The creator's authority over exactly one stake vault.
public struct StakeCap has key, store {
    id: UID,
    vault: ID,
}

public struct StakeVault has key {
    id: UID,
    version: u64,
    platform: ID,
    creator: address,
    creator_account: ID,

    // --- terms ---
    /// The platform's cut of *yield*, snapshotted at creation. Never applies to principal.
    fee_bps_snapshot: u64,
    /// The creator's chosen share of their own post-fee yield, returned to depositors.
    /// Taken from the creator's share, never the platform's — it is theirs to give.
    rebate_bps: u64,
    /// Where principal is delegated.
    validator: address,

    // --- principal, owed in full to depositors ---
    total_principal: u64,
    positions: Table<address, Position>,

    // --- delegation ---
    tranches: vector<StakedSui>,
    /// Undelegated principal. Holds principal and nothing else, which is what makes the
    /// solvency check meaningful.
    liquid: Balance<SUI>,

    // --- yield, already split and never mixed with principal ---
    creator_yield: Balance<SUI>,
    platform_yield: Balance<SUI>,
    rebate_pool: Balance<SUI>,
    acc_rebate_per_unit: u128,

    accepting: bool,
    lifetime_yield: u64,
    harvests: u64,
}

// === Events ===

public struct StakeVaultOpened has copy, drop {
    vault: ID,
    platform: ID,
    creator: address,
    validator: address,
    fee_bps_snapshot: u64,
}

public struct Deposited has copy, drop {
    vault: ID,
    depositor: address,
    amount: u64,
    principal_after: u64,
    total_principal_after: u64,
}

public struct Withdrawn has copy, drop {
    vault: ID,
    depositor: address,
    amount: u64,
    principal_after: u64,
    /// Tranches unwound to fund this withdrawal. Non-zero means the buffer was short and the
    /// creator forfeited some accrued yield to make the depositor whole immediately.
    tranches_unwound: u64,
}

public struct Harvested has copy, drop {
    vault: ID,
    gross_yield: u64,
    creator_cut: u64,
    platform_cut: u64,
    rebate_cut: u64,
    principal_restaked: u64,
    tranches_after: u64,
}

public struct RebateClaimed has copy, drop {
    vault: ID,
    depositor: address,
    amount: u64,
}

public struct YieldClaimed has copy, drop {
    vault: ID,
    amount: u64,
    recipient: address,
    /// True when the platform claimed, false when the creator did.
    is_platform: bool,
}

public struct RebateSet has copy, drop {
    vault: ID,
    rebate_bps: u64,
}

// === The yield split ===

/// Divide harvested yield into (creator, platform, rebate).
///
/// Pure and public, for the same reasons as `creator::compute_split`: a client displaying a
/// breakdown must compute it identically, and a drift test needs something to assert against.
///
/// The order is deliberate and differs from the flow leg. The platform's cut comes off the gross
/// first; the rebate is then carved out of **what remains to the creator**, not out of the gross.
/// A creator setting a 100% rebate therefore gives away all of their own yield and none of the
/// platform's, which is the only reading under which "the creator chooses the perk" is true.
///
/// `creator + platform + rebate == gross` holds exactly. The creator's share is the remainder at
/// each step, so no rounding can strand a unit.
public fun compute_yield_split(
    gross: u64,
    fee_bps: u64,
    rebate_bps: u64,
): (u64, u64, u64) {
    let platform_cut = (((gross as u128) * (fee_bps as u128)) / (BPS_DENOMINATOR as u128)) as u64;
    let after_fee = gross - platform_cut;
    let rebate_cut =
        (((after_fee as u128) * (rebate_bps as u128)) / (BPS_DENOMINATOR as u128)) as u64;
    let creator_cut = after_fee - rebate_cut;

    (creator_cut, platform_cut, rebate_cut)
}

// === Opening ===

/// Open a stake vault. One per creator; a second is possible but pointless and splits liquidity.
///
/// Permissionless, and deliberately so. An earlier draft took a `T: drop` witness parameter,
/// intending to make opening a vault a deliberate act by a module rather than something any caller
/// could do. **It achieved nothing** — any caller can declare their own `has drop` struct and pass
/// it, so the parameter restricted no one while reading like a gate. It was removed before publish
/// rather than shipped: a control that does not control is worse than an absent one, because the
/// next reader trusts it.
///
/// What actually gates this is the `SocialAccount`, which is soulbound and must authenticate the
/// sender, plus the platform's `creation_paused` switch.
public fun open(
    platform: &mut Platform,
    creator_account: &SocialAccount,
    validator: address,
    ctx: &mut TxContext,
): StakeCap {
    platform.assert_can_create();

    let platform_id = object::id(platform);
    let creator = ctx.sender();
    account::assert_authenticates(creator_account, creator, platform_id);

    let vault = StakeVault {
        id: object::new(ctx),
        version: VERSION,
        platform: platform_id,
        creator,
        creator_account: object::id(creator_account),
        fee_bps_snapshot: platform.fee_bps(),
        // Starts at zero: a creator who has chosen nothing gives nothing away, and a rebate
        // nobody configured should not quietly redirect their revenue.
        rebate_bps: 0,
        validator,
        total_principal: 0,
        positions: table::new(ctx),
        tranches: vector[],
        liquid: balance::zero(),
        creator_yield: balance::zero(),
        platform_yield: balance::zero(),
        rebate_pool: balance::zero(),
        acc_rebate_per_unit: 0,
        accepting: true,
        lifetime_yield: 0,
        harvests: 0,
    };
    let vault_id = object::id(&vault);

    event::emit(StakeVaultOpened {
        vault: vault_id,
        platform: platform_id,
        creator,
        validator,
        fee_bps_snapshot: vault.fee_bps_snapshot,
    });

    platform.record_vault_created();
    transfer::share_object(vault);

    StakeCap { id: object::new(ctx), vault: vault_id }
}

// === Depositor accounting ===

/// Bring a position's accrued rebate up to date. Must be called before principal changes.
/// Rebate eligibility for principal deposited since the last harvest.
///
/// # The defect this closes
///
/// The accumulator credits `rebate_cut / denominator` per unit of principal. A deposit made in the
/// same transaction as a harvest used to sit inside that denominator, so a large enough deposit
/// took almost the whole cut and withdrew again in the same transaction at no cost — every epoch,
/// forever, out of the depositors the rebate exists to reward.
///
/// Freshly deposited principal has not been delegated yet — `stake_one_rung` stakes it on a later
/// harvest — so it earned none of the yield being split. It is therefore excluded from *both*
/// sides: it does not count toward the denominator, and it does not accrue. Withdrawal is
/// untouched; this delays when a deposit starts earning a rebate, never whether it can be taken out.
///
/// Eligibility advances on the harvest counter rather than on the depositor doing something, so a
/// depositor who deposits and waits still earns. `at_harvest` no longer matching `vault.harvests`
/// *is* maturity — nothing has to sweep.
public struct FreshEntry has copy, drop, store {
    at_harvest: u64,
    amount: u64,
    /// `Σ amount_i * acc_i / ACC_SCALE` over the deposits in this window. Added to the position's
    /// debt when the money matures, so it earns from harvests after its deposit and not before.
    /// Without this the newly-eligible principal would be credited the whole accumulator history.
    debt_delta: u128,
}
public struct Fresh has copy, drop, store { who: address }
/// `acc_rebate_per_unit` as it stood at the end of harvest `harvest`. Fresh principal that matured
/// out of harvest H must start earning from the value recorded at H+1 — the harvest it sat out —
/// and not from the value at its deposit, which would hand it exactly the harvest it missed.
public struct AccAt has copy, drop, store { harvest: u64 }
public struct FreshTotal has copy, drop, store {}

fun record_acc_at(vault: &mut StakeVault) {
    let h = vault.harvests;
    let acc = vault.acc_rebate_per_unit;
    if (df::exists(&vault.id, AccAt { harvest: h })) {
        *df::borrow_mut<AccAt, u128>(&mut vault.id, AccAt { harvest: h }) = acc;
    } else {
        df::add(&mut vault.id, AccAt { harvest: h }, acc);
    }
}

/// The accumulator as of the end of harvest `h`. Falls back to the current value, which is the
/// conservative direction: an unrecorded boundary yields nothing rather than everything.
fun acc_at(vault: &StakeVault, h: u64): u128 {
    if (df::exists(&vault.id, AccAt { harvest: h })) *df::borrow<AccAt, u128>(&vault.id, AccAt { harvest: h })
    else vault.acc_rebate_per_unit
}

fun fresh_of(vault: &StakeVault, who: address): u64 {
    if (!df::exists(&vault.id, Fresh { who })) return 0;
    let e = df::borrow<Fresh, FreshEntry>(&vault.id, Fresh { who });
    if (e.at_harvest == vault.harvests) e.amount else 0
}

/// Principal that may accrue rebate: everything except what arrived since the last harvest.
fun eligible_of(vault: &StakeVault, who: address): u64 {
    let p = vault.positions.borrow(who).principal;
    let f = fresh_of(vault, who);
    if (f >= p) 0 else p - f
}

/// Fold matured principal into the debt and drop the marker. Idempotent, and a no-op while the
/// money is still fresh.
fun settle_fresh(vault: &mut StakeVault, who: address) {
    if (!df::exists(&vault.id, Fresh { who })) return;
    let e = *df::borrow<Fresh, FreshEntry>(&vault.id, Fresh { who });
    if (e.at_harvest == vault.harvests) return;
    let _: FreshEntry = df::remove(&mut vault.id, Fresh { who });
    // Start from where the accumulator stood once the harvest this money sat out had finished.
    let start = acc_at(vault, e.at_harvest + 1);
    let owed_from = ((e.amount as u128) * start) / ACC_SCALE;
    let position = vault.positions.borrow_mut(who);
    position.rebate_debt = position.rebate_debt + owed_from;
}

fun note_fresh(vault: &mut StakeVault, who: address, amount: u64, acc: u128) {
    let h = vault.harvests;
    let add_debt = ((amount as u128) * acc) / ACC_SCALE;

    let cur = if (df::exists(&vault.id, Fresh { who })) {
        let e = *df::borrow<Fresh, FreshEntry>(&vault.id, Fresh { who });
        if (e.at_harvest == h) e else FreshEntry { at_harvest: h, amount: 0, debt_delta: 0 }
    } else FreshEntry { at_harvest: h, amount: 0, debt_delta: 0 };
    let next = FreshEntry {
        at_harvest: h,
        amount: cur.amount + amount,
        debt_delta: cur.debt_delta + add_debt,
    };
    if (df::exists(&vault.id, Fresh { who })) {
        *df::borrow_mut<Fresh, FreshEntry>(&mut vault.id, Fresh { who }) = next;
    } else {
        df::add(&mut vault.id, Fresh { who }, next);
    };

    let curt = if (df::exists(&vault.id, FreshTotal {})) {
        let e = *df::borrow<FreshTotal, FreshEntry>(&vault.id, FreshTotal {});
        if (e.at_harvest == h) e.amount else 0
    } else 0;
    let nextt = FreshEntry { at_harvest: h, amount: curt + amount, debt_delta: 0 };
    if (df::exists(&vault.id, FreshTotal {})) {
        *df::borrow_mut<FreshTotal, FreshEntry>(&mut vault.id, FreshTotal {}) = nextt;
    } else {
        df::add(&mut vault.id, FreshTotal {}, nextt);
    };
}

/// Principal that has actually been earning: the denominator the accumulator must divide by.
public fun eligible_total(vault: &StakeVault): u64 {
    let f = if (df::exists(&vault.id, FreshTotal {})) {
        let e = df::borrow<FreshTotal, FreshEntry>(&vault.id, FreshTotal {});
        if (e.at_harvest == vault.harvests) e.amount else 0
    } else 0;
    if (f >= vault.total_principal) 0 else vault.total_principal - f
}

fun accrue_on(position: &mut Position, acc: u128, eligible: u64) {
    let entitled = ((eligible as u128) * acc) / ACC_SCALE;
    // `acc` only ever increases and `rebate_debt` was set from the same principal, so this cannot
    // underflow — provided `resync_debt` follows every principal change, which is why the two are
    // never called separately.
    let owed = entitled - position.rebate_debt;
    position.pending = position.pending + (owed as u64);
    position.rebate_debt = entitled;
}

/// Re-baseline a position after its principal changed.
fun resync_debt_on(position: &mut Position, acc: u128, eligible: u64) {
    position.rebate_debt = ((eligible as u128) * acc) / ACC_SCALE;
}

/// The no-loss invariant. Asserted after every operation that moves principal.
///
/// Not a defensive nicety: it is the one property the entire product promises, and the cheapest
/// place to catch a violation is the transaction that causes it rather than the withdrawal that
/// discovers it months later.
fun assert_solvent(vault: &StakeVault) {
    let backing = vault.liquid.value() + stake_ladder::staked_principal(&vault.tranches);
    assert!(backing >= vault.total_principal, EInsolvent);
}

// === Depositing ===

/// Deposit SUI. Principal remains the depositor's and is redeemable at any time.
public fun deposit(
    platform: &Platform,
    vault: &mut StakeVault,
    depositor_account: &SocialAccount,
    payment: Coin<SUI>,
    ctx: &mut TxContext,
) {
    assert_version(vault);
    platform.assert_can_pay();
    assert!(vault.platform == object::id(platform), EWrongPlatform);
    assert!(vault.accepting, ENotAccepting);

    let who = ctx.sender();
    account::assert_authenticates(depositor_account, who, vault.platform);

    let amount = payment.value();
    assert!(amount >= MIN_DEPOSIT_MIST, EDepositTooSmall);

    let acc = vault.acc_rebate_per_unit;
    if (!vault.positions.contains(who)) {
        vault.positions.add(who, Position { principal: 0, rebate_debt: 0, pending: 0 });
    };
    settle_fresh(vault, who);
    let eligible = eligible_of(vault, who);
    {
        let position = vault.positions.borrow_mut(who);
        accrue_on(position, acc, eligible);
        position.principal = position.principal + amount;
    };
    // The deposit raises principal and `fresh` by the same amount, so eligibility is unchanged —
    // which is the whole point, and why the debt below is the same number it already was.
    note_fresh(vault, who, amount, acc);
    let eligible_after = eligible_of(vault, who);
    let principal_after = {
        let position = vault.positions.borrow_mut(who);
        resync_debt_on(position, acc, eligible_after);
        position.principal
    };

    vault.total_principal = vault.total_principal + amount;
    vault.liquid.join(payment.into_balance());

    assert_solvent(vault);

    event::emit(Deposited {
        vault: object::id(vault),
        depositor: who,
        amount,
        principal_after,
        total_principal_after: vault.total_principal,
    });
}

/// Withdraw principal. Always available, in full, immediately.
///
/// Consults no pause switch — not the platform's, not the creator's. If the liquid buffer is short
/// the ladder is unwound newest-first until it is not; see the module documentation for why that
/// costs the creator and never the depositor.
public fun withdraw(
    vault: &mut StakeVault,
    depositor_account: &SocialAccount,
    amount: u64,
    state: &mut SuiSystemState,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert_version(vault);

    let who = ctx.sender();
    account::assert_authenticates(depositor_account, who, vault.platform);
    assert!(vault.positions.contains(who), ENoPosition);

    let acc = vault.acc_rebate_per_unit;
    settle_fresh(vault, who);
    let eligible = eligible_of(vault, who);
    {
        let position = vault.positions.borrow_mut(who);
        accrue_on(position, acc, eligible);
        assert!(position.principal >= amount, EInsufficientPrincipal);
    };

    // Raise liquidity if the buffer is short. Bounded by the tranche count, which
    // `stake_ladder::MAX_TRANCHES` caps, so this loop cannot run away.
    let mut tranches_unwound = 0;
    while (vault.liquid.value() < amount) {
        assert!(!vault.tranches.is_empty(), ECannotRaiseLiquidity);

        let (proceeds, principal) = stake_ladder::unwind_newest(
            &mut vault.tranches,
            state,
            ctx,
        );
        tranches_unwound = tranches_unwound + 1;
        credit_proceeds(vault, proceeds, principal);
    };

    {
        let position = vault.positions.borrow_mut(who);
        position.principal = position.principal - amount;
    };
    let eligible_after = eligible_of(vault, who);
    let principal_after = {
        let position = vault.positions.borrow_mut(who);
        resync_debt_on(position, acc, eligible_after);
        position.principal
    };

    vault.total_principal = vault.total_principal - amount;
    let out = coin::from_balance(vault.liquid.split(amount), ctx);

    assert_solvent(vault);

    event::emit(Withdrawn {
        vault: object::id(vault),
        depositor: who,
        amount,
        principal_after,
        tranches_unwound,
    });

    out
}

/// Claim accrued rebate. Separate from `withdraw` because a depositor usually wants the perk
/// without touching the principal earning it.
public fun claim_rebate(
    vault: &mut StakeVault,
    depositor_account: &SocialAccount,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert_version(vault);

    let who = ctx.sender();
    account::assert_authenticates(depositor_account, who, vault.platform);
    assert!(vault.positions.contains(who), ENoPosition);

    let acc = vault.acc_rebate_per_unit;
    settle_fresh(vault, who);
    let eligible = eligible_of(vault, who);
    let position = vault.positions.borrow_mut(who);
    accrue_on(position, acc, eligible);
    let amount = position.pending;
    position.pending = 0;

    assert!(vault.rebate_pool.value() >= amount, EInsufficientBalance);

    event::emit(RebateClaimed { vault: object::id(vault), depositor: who, amount });

    coin::from_balance(vault.rebate_pool.split(amount), ctx)
}

// === Harvesting ===

/// Split withdrawn stake proceeds into principal and yield, and route each.
///
/// Shared by the harvest path and the emergency-unwind path inside `withdraw`, so both account for
/// yield identically. An early unwind simply yields less; it is not a special case.
fun credit_proceeds(vault: &mut StakeVault, mut proceeds: Balance<SUI>, principal: u64) {
    // Principal first, so a rounding error can only ever shrink the yield, never the principal.
    vault.liquid.join(proceeds.split(principal));

    let gross = proceeds.value();
    if (gross == 0) {
        proceeds.destroy_zero();
        return
    };

    let (creator_cut, platform_cut, rebate_cut) =
        compute_yield_split(gross, vault.fee_bps_snapshot, vault.rebate_bps);

    vault.platform_yield.join(proceeds.split(platform_cut));

    // A rebate with nobody to pay it goes to the creator rather than being stranded in a pool no
    // accumulator can distribute. `total_principal` is zero only if every depositor has exited,
    // in which case there is no one whose deposit earned it.
    // Divide by principal that was actually delegated when this yield accrued, not by everything
    // sitting in the vault. They differ by exactly the deposits made since the last harvest.
    let eligible = eligible_total(vault);
    if (rebate_cut > 0 && eligible > 0) {
        vault.rebate_pool.join(proceeds.split(rebate_cut));
        vault.acc_rebate_per_unit =
            vault.acc_rebate_per_unit +
            (((rebate_cut as u128) * ACC_SCALE) / (eligible as u128));
    };

    // Whatever remains is the creator's, joined rather than split — conservation is structural.
    let _ = creator_cut;
    vault.creator_yield.join(proceeds);

    vault.lifetime_yield = vault.lifetime_yield + gross;
}

/// Harvest matured tranches and restake one rung.
///
/// **Permissionless.** Anyone may call it, and that is the liveness guarantee: an absent or
/// unwilling creator delays nothing, because the yield the harvest realises is not theirs to
/// withhold. The sibling raffle contract reaches the same conclusion about its draw.
public fun harvest(
    vault: &mut StakeVault,
    state: &mut SuiSystemState,
    ctx: &mut TxContext,
) {
    assert_version(vault);

    let creator_before = vault.creator_yield.value();
    let platform_before = vault.platform_yield.value();
    let rebate_before = vault.rebate_pool.value();

    let (proceeds, principal_returned) = stake_ladder::harvest_matured(
        &mut vault.tranches,
        state,
        ctx,
    );
    credit_proceeds(vault, proceeds, principal_returned);

    // Restake everything liquid: `liquid` holds only principal, and principal not delegated earns
    // nothing. `stake_one_rung` applies the one-rung-per-epoch rule and declines rather than
    // aborting when staking would be wrong.
    let available = vault.liquid.value();
    let principal_restaked = stake_ladder::stake_one_rung(
        &mut vault.tranches,
        state,
        &mut vault.liquid,
        available,
        vault.total_principal,
        vault.validator,
        ctx,
    );

    vault.harvests = vault.harvests + 1;
    record_acc_at(vault);
    assert_solvent(vault);

    event::emit(Harvested {
        vault: object::id(vault),
        gross_yield: (vault.creator_yield.value() - creator_before)
            + (vault.platform_yield.value() - platform_before)
            + (vault.rebate_pool.value() - rebate_before),
        creator_cut: vault.creator_yield.value() - creator_before,
        platform_cut: vault.platform_yield.value() - platform_before,
        rebate_cut: vault.rebate_pool.value() - rebate_before,
        principal_restaked,
        tranches_after: vault.tranches.length(),
    });
}

// === Creator and platform configuration ===

/// Set the share of the creator's own yield returned to depositors.
///
/// Capped at 100% of the creator's post-fee share. A creator may give away everything they earn;
/// they cannot give away the platform's cut, and they cannot reach principal.
public fun set_rebate_bps(vault: &mut StakeVault, cap: &StakeCap, rebate_bps: u64) {
    assert_version(vault);
    assert_cap(vault, cap);
    assert!(rebate_bps <= BPS_DENOMINATOR, ERebateAboveMax);
    vault.rebate_bps = rebate_bps;
    event::emit(RebateSet { vault: object::id(vault), rebate_bps });
}

/// Stop or resume new deposits. Cannot affect withdrawals or rebate claims.
public fun set_accepting(vault: &mut StakeVault, cap: &StakeCap, accepting: bool) {
    assert_version(vault);
    assert_cap(vault, cap);
    vault.accepting = accepting;
}

public fun claim_creator_yield(
    vault: &mut StakeVault,
    cap: &StakeCap,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert_version(vault);
    assert_cap(vault, cap);
    assert!(vault.creator_yield.value() >= amount, EInsufficientBalance);

    event::emit(YieldClaimed {
        vault: object::id(vault),
        amount,
        recipient: ctx.sender(),
        is_platform: false,
    });

    coin::from_balance(vault.creator_yield.split(amount), ctx)
}

public fun claim_platform_yield(
    vault: &mut StakeVault,
    cap: &PlatformCap,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert_version(vault);
    assert!(cap.cap_platform_id() == vault.platform, EWrongPlatform);
    assert!(vault.platform_yield.value() >= amount, EInsufficientBalance);

    event::emit(YieldClaimed {
        vault: object::id(vault),
        amount,
        recipient: ctx.sender(),
        is_platform: true,
    });

    coin::from_balance(vault.platform_yield.split(amount), ctx)
}

public fun migrate(vault: &mut StakeVault, cap: &StakeCap) {
    assert_cap(vault, cap);
    assert!(vault.version < VERSION, ENotUpgraded);
    vault.version = VERSION;
}

/// The same migration, reachable by the platform when the creator's cap is not.
///
/// # Why a second door is necessary rather than tidy
///
/// `StakeCap` has `store`, so it can be transferred, sold, or lost, and `migrate` was the only
/// way to advance a vault's stored version. Every entry point here begins with `assert_version`,
/// including `withdraw` — so a creator who walks away with, or simply loses, their cap would
/// leave their depositors unable to reach their own principal through the current package the
/// moment a new version ships. The old package stays callable, so the money is not gone, but
/// asking a depositor to hand-build transactions against a retired package id is not a
/// withdrawal path, and it contradicts the one promise this vault makes.
///
/// This grants the platform nothing else. Version is the only field it touches; principal,
/// tranches, yield and the rebate accumulator are all out of reach, and the vault it migrates to
/// is the same version the creator's own `migrate` would have reached.
public fun migrate_as_platform(vault: &mut StakeVault, platform: &Platform, cap: &PlatformCap) {
    assert!(vault.platform == object::id(platform), EWrongPlatform);
    assert!(cap.cap_platform_id() == vault.platform, EWrongPlatform);
    assert!(vault.version < VERSION, ENotUpgraded);
    vault.version = VERSION;
}

// === Assertions ===

fun assert_version(vault: &StakeVault) {
    assert!(vault.version == VERSION, EWrongVersion);
}

fun assert_cap(vault: &StakeVault, cap: &StakeCap) {
    assert!(cap.vault == object::id(vault), EWrongVault);
}

// === Reads ===

public fun cap_vault_id(cap: &StakeCap): ID { cap.vault }

public fun version(vault: &StakeVault): u64 { vault.version }

public fun creator(vault: &StakeVault): address { vault.creator }

public fun validator(vault: &StakeVault): address { vault.validator }

public fun fee_bps_snapshot(vault: &StakeVault): u64 { vault.fee_bps_snapshot }

public fun rebate_bps(vault: &StakeVault): u64 { vault.rebate_bps }

public fun total_principal(vault: &StakeVault): u64 { vault.total_principal }

public fun liquid_value(vault: &StakeVault): u64 { vault.liquid.value() }

public fun staked_principal(vault: &StakeVault): u64 {
    stake_ladder::staked_principal(&vault.tranches)
}

/// Everything backing depositor principal. Must always be at least `total_principal`.
public fun backing(vault: &StakeVault): u64 {
    vault.liquid.value() + stake_ladder::staked_principal(&vault.tranches)
}

public fun is_solvent(vault: &StakeVault): bool { backing(vault) >= vault.total_principal }

public fun tranche_count(vault: &StakeVault): u64 { vault.tranches.length() }

public fun creator_yield_value(vault: &StakeVault): u64 { vault.creator_yield.value() }

public fun platform_yield_value(vault: &StakeVault): u64 { vault.platform_yield.value() }

public fun rebate_pool_value(vault: &StakeVault): u64 { vault.rebate_pool.value() }

public fun lifetime_yield(vault: &StakeVault): u64 { vault.lifetime_yield }

public fun harvests(vault: &StakeVault): u64 { vault.harvests }

public fun accepting(vault: &StakeVault): bool { vault.accepting }

public fun has_position(vault: &StakeVault, who: address): bool { vault.positions.contains(who) }

public fun principal_of(vault: &StakeVault, who: address): u64 {
    assert!(vault.positions.contains(who), ENoPosition);
    vault.positions.borrow(who).principal
}

/// Rebate a depositor could claim right now, including what has accrued since their last
/// interaction. Computed rather than read, so a client never shows a stale zero.
public fun claimable_rebate(vault: &StakeVault, who: address): u64 {
    if (!vault.positions.contains(who)) return 0;
    let position = vault.positions.borrow(who);
    // Mirrors `settle_fresh` + `accrue_on` without mutating: matured principal counts, and carries
    // the debt it was deposited with.
    let (fresh, carried) = if (df::exists(&vault.id, Fresh { who })) {
        let e = *df::borrow<Fresh, FreshEntry>(&vault.id, Fresh { who });
        if (e.at_harvest == vault.harvests) (e.amount, 0u128)
        else (0, ((e.amount as u128) * acc_at(vault, e.at_harvest + 1)) / ACC_SCALE)
    } else (0, 0u128);
    let eligible = if (fresh >= position.principal) 0 else position.principal - fresh;
    let debt = position.rebate_debt + carried;
    let entitled = ((eligible as u128) * vault.acc_rebate_per_unit) / ACC_SCALE;
    if (entitled <= debt) position.pending else position.pending + ((entitled - debt) as u64)
}

public fun min_deposit_mist(): u64 { MIN_DEPOSIT_MIST }

public fun acc_scale(): u128 { ACC_SCALE }

public fun bps_denominator(): u64 { BPS_DENOMINATOR }
