// SPDX-License-Identifier: BUSL-1.1
// Licensor: Northlatch Labs LLC. Change Date: 2029-09-01. Change License: Apache-2.0.
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/// Tests for the stake leg, against a real `SuiSystemState` with real epoch advancement.
///
/// These are integration tests, not simulations. `governance_test_utils` stands up an actual
/// validator set, and `advance_epoch_with_reward_amounts` distributes actual staking rewards, so
/// yield here is produced by the same code path that produces it on mainnet. That matters more
/// than usual for this module: the two defects it is built to avoid — withdrawing inside the
/// activation epoch, and a ladder that silently collapses into a lump — both present as a yield of
/// exactly zero, and neither is visible to a test that mocks the staking layer.
#[test_only]
module projectx_social::stake_vault_tests;

use projectx_social::account::{Self, Registry, SocialAccount};
use projectx_social::platform::{Self, Platform, PlatformCap};
use projectx_social::stake_ladder as ladder;
use projectx_social::stake_vault::{Self as sv, StakeVault, StakeCap};
use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use sui_system::governance_test_utils as gtu;
use sui_system::sui_system::SuiSystemState;


const ADMIN: address = @0xAD;
const CREATOR: address = @0xC1;
const FAN: address = @0xFA;
const FAN2: address = @0xFB;
const VALIDATOR: address = @0x1001;

const SUI_1: u64 = 1_000_000_000;
/// The platform fee on yield, in bps — the rate chosen for deployment.
const FEE_BPS: u64 = 290;

// === Fixtures ===

fun setup(): Scenario {
    let mut sc = ts::begin(ADMIN);
    gtu::set_up_sui_system_state(vector[VALIDATOR]);

    sc.next_tx(ADMIN);
    {
        let ctx = sc.ctx();
        platform::init_for_testing(ctx);
        account::init_for_testing(ctx);
    };

    sc.next_tx(ADMIN);
    {
        let mut p = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_fees(&mut p, &cap, FEE_BPS, 0, 0);
        platform::set_creation_paused(&mut p, &cap, false);
        sc.return_to_sender(cap);
        ts::return_shared(p);
    };

    open_account(&mut sc, CREATOR, b"creator");
    open_account(&mut sc, FAN, b"fan");
    open_account(&mut sc, FAN2, b"fantwo");

    sc.next_tx(CREATOR);
    {
        let mut p = sc.take_shared<Platform>();
        let acct = sc.take_from_sender<SocialAccount>();
        let cap = sv::open(&mut p, &acct, VALIDATOR, sc.ctx());
        transfer::public_transfer(cap, CREATOR);
        sc.return_to_sender(acct);
        ts::return_shared(p);
    };
    sc
}

fun open_account(sc: &mut Scenario, who: address, handle: vector<u8>) {
    sc.next_tx(who);
    let mut p = sc.take_shared<Platform>();
    let mut reg = sc.take_shared<Registry>();
    let clk = clock::create_for_testing(sc.ctx());
    account::open(&mut p, &mut reg, handle.to_string(), option::none(), &clk, sc.ctx());
    clock::destroy_for_testing(clk);
    ts::return_shared(p);
    ts::return_shared(reg);
}

fun deposit(sc: &mut Scenario, who: address, amount: u64) {
    sc.next_tx(who);
    let p = sc.take_shared<Platform>();
    let mut v = sc.take_shared<StakeVault>();
    let acct = sc.take_from_sender<SocialAccount>();
    let funds = coin::mint_for_testing<SUI>(amount, sc.ctx());
    sv::deposit(&p, &mut v, &acct, funds, sc.ctx());
    sc.return_to_sender(acct);
    ts::return_shared(v);
    ts::return_shared(p);
}

fun harvest(sc: &mut Scenario) {
    sc.next_tx(ADMIN); // permissionless — deliberately not the creator
    let mut v = sc.take_shared<StakeVault>();
    let mut state = sc.take_shared<SuiSystemState>();
    sv::harvest(&mut v, &mut state, sc.ctx());
    ts::return_shared(state);
    ts::return_shared(v);
}

/// Advance far enough that a tranche staked in the current epoch has matured.
///
/// Derived from `ladder_depth()` rather than written as 7, so a depth change moves every test with
/// it instead of leaving them asserting the wrong boundary.
fun advance_to_maturity(sc: &mut Scenario) {
    let mut i = 0;
    while (i <= ladder::ladder_depth()) {
        gtu::advance_epoch_with_reward_amounts(0, 400, sc);
        i = i + 1;
    };
}

// === The yield split, pure ===

#[test]
fun the_yield_split_conserves_and_takes_the_rebate_from_the_creator() {
    // No rebate: creator takes everything after the platform's 290 bps.
    let (c, p, r) = sv::compute_yield_split(1_000_000, FEE_BPS, 0);
    assert!(p == 29_000, 0);
    assert!(c == 971_000, 1);
    assert!(r == 0, 2);
    assert!(c + p + r == 1_000_000, 3);

    // Half rebate: the platform's cut is untouched; the creator's halves.
    let (c2, p2, r2) = sv::compute_yield_split(1_000_000, FEE_BPS, 5_000);
    assert!(p2 == 29_000, 4); // identical — the rebate is not taken from the platform
    assert!(r2 == 485_500, 5);
    assert!(c2 == 485_500, 6);
    assert!(c2 + p2 + r2 == 1_000_000, 7);

    // Full rebate: the creator gives away all of their own yield, and none of the platform's.
    let (c3, p3, r3) = sv::compute_yield_split(1_000_000, FEE_BPS, 10_000);
    assert!(c3 == 0, 8);
    assert!(p3 == 29_000, 9);
    assert!(r3 == 971_000, 10);
    assert!(c3 + p3 + r3 == 1_000_000, 11);
}

#[test]
fun the_yield_split_conserves_across_a_sweep() {
    let mut gross = 1;
    while (gross < 10_000_000) {
        let mut rebate = 0;
        while (rebate <= 10_000) {
            let (c, p, r) = sv::compute_yield_split(gross, FEE_BPS, rebate);
            assert!(c + p + r == gross, 0);
            rebate = rebate + 1_111;
        };
        gross = gross * 7 + 3;
    };
}

// === The regression that matters ===

#[test]
/// **Principal staked across a full ladder period must realise non-zero yield.**
///
/// This is the direct regression for the mainnet defect: a pool whose 22 consecutive harvests all
/// read zero because its tranches shared an activation epoch and matured as one lump. If this
/// asserts a positive number, the ladder is laddering.
fun a_matured_tranche_actually_yields() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 100 * SUI_1);

    harvest(&mut sc); // stakes the first rung
    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::tranche_count(&v) == 1, 0);
        assert!(sv::staked_principal(&v) > 0, 1);
        ts::return_shared(v);
    };

    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        // The whole point: yield is strictly positive.
        assert!(sv::lifetime_yield(&v) > 0, 2);
        assert!(sv::platform_yield_value(&v) > 0, 3);
        assert!(sv::creator_yield_value(&v) > 0, 4);
        // And principal is still fully backed.
        assert!(sv::is_solvent(&v), 5);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
/// Two stakes in one epoch would share an activation epoch and collapse the ladder. The guard
/// makes the second harvest a no-op for staking rather than a second rung.
fun the_ladder_stakes_at_most_one_rung_per_epoch() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 100 * SUI_1);

    harvest(&mut sc);
    harvest(&mut sc); // same epoch
    harvest(&mut sc); // still the same epoch

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::tranche_count(&v) == 1, 0);
        ts::return_shared(v);
    };

    // A new epoch permits exactly one more.
    gtu::advance_epoch_with_reward_amounts(0, 400, &mut sc);
    harvest(&mut sc);
    harvest(&mut sc);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::tranche_count(&v) == 2, 1);
        ts::return_shared(v);
    };

    sc.end();
}

// === The no-loss guarantee ===

#[test]
/// A depositor gets their whole principal back, even when every unit of it is staked and the
/// liquid buffer is empty. The vault unwinds tranches to make them whole immediately.
fun principal_is_returned_in_full_even_when_fully_staked() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 100 * SUI_1);

    // Build several rungs so principal is genuinely delegated.
    let mut i = 0;
    while (i < 4) {
        harvest(&mut sc);
        gtu::advance_epoch_with_reward_amounts(0, 400, &mut sc);
        i = i + 1;
    };

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::staked_principal(&v) > 0, 0);
        assert!(sv::liquid_value(&v) < 100 * SUI_1, 1); // buffer alone cannot cover it
        ts::return_shared(v);
    };

    sc.next_tx(FAN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let mut state = sc.take_shared<SuiSystemState>();
        let acct = sc.take_from_sender<SocialAccount>();

        let out = sv::withdraw(&mut v, &acct, 100 * SUI_1, &mut state, sc.ctx());

        // Exactly what was deposited. Not less, and not after a waiting period.
        assert!(out.value() == 100 * SUI_1, 2);
        assert!(sv::total_principal(&v) == 0, 3);
        assert!(sv::principal_of(&v, FAN) == 0, 4);
        assert!(sv::is_solvent(&v), 5);

        coin::burn_for_testing(out);
        sc.return_to_sender(acct);
        ts::return_shared(state);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
/// The solvency invariant holds through a mixed sequence of deposits, harvests and withdrawals.
fun the_vault_stays_solvent_through_churn() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 50 * SUI_1);
    deposit(&mut sc, FAN2, 30 * SUI_1);

    let mut round = 0;
    while (round < 3) {
        harvest(&mut sc);
        gtu::advance_epoch_with_reward_amounts(0, 400, &mut sc);

        sc.next_tx(FAN);
        {
            let mut v = sc.take_shared<StakeVault>();
            let mut state = sc.take_shared<SuiSystemState>();
            let acct = sc.take_from_sender<SocialAccount>();
            let out = sv::withdraw(&mut v, &acct, 5 * SUI_1, &mut state, sc.ctx());
            assert!(out.value() == 5 * SUI_1, 0);
            assert!(sv::is_solvent(&v), 1);
            coin::burn_for_testing(out);
            sc.return_to_sender(acct);
            ts::return_shared(state);
            ts::return_shared(v);
        };

        deposit(&mut sc, FAN2, 10 * SUI_1);
        round = round + 1;
    };

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::is_solvent(&v), 2);
        assert!(sv::principal_of(&v, FAN) == 35 * SUI_1, 3);
        assert!(sv::principal_of(&v, FAN2) == 60 * SUI_1, 4);
        assert!(sv::total_principal(&v) == 95 * SUI_1, 5);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::stake_vault::EInsufficientPrincipal)]
fun a_depositor_cannot_withdraw_more_than_they_deposited() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 10 * SUI_1);

    sc.next_tx(FAN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let mut state = sc.take_shared<SuiSystemState>();
        let acct = sc.take_from_sender<SocialAccount>();
        let out = sv::withdraw(&mut v, &acct, 10 * SUI_1 + 1, &mut state, sc.ctx());
        coin::burn_for_testing(out);
        sc.return_to_sender(acct);
        ts::return_shared(state);
        ts::return_shared(v);
    };
    sc.end();
}

#[test]
/// Deposits can be closed; withdrawals and rebate claims cannot. Same asymmetry as the flow leg.
fun closing_deposits_does_not_close_withdrawals() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 10 * SUI_1);

    sc.next_tx(CREATOR);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<StakeCap>();
        sv::set_accepting(&mut v, &cap, false);
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };

    sc.next_tx(FAN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let mut state = sc.take_shared<SuiSystemState>();
        let acct = sc.take_from_sender<SocialAccount>();
        let out = sv::withdraw(&mut v, &acct, 10 * SUI_1, &mut state, sc.ctx());
        assert!(out.value() == 10 * SUI_1, 0);
        coin::burn_for_testing(out);
        sc.return_to_sender(acct);
        ts::return_shared(state);
        ts::return_shared(v);
    };
    sc.end();
}

// === The rebate ===

#[test]
/// Rebate accrues pro rata to principal, and only to deposits present when it was earned.
fun the_rebate_is_shared_in_proportion_to_principal() {
    let mut sc = setup();

    sc.next_tx(CREATOR);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<StakeCap>();
        sv::set_rebate_bps(&mut v, &cap, 10_000); // creator gives away all of their yield
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };

    // 75 / 25 split of the pool.
    deposit(&mut sc, FAN, 75 * SUI_1);
    deposit(&mut sc, FAN2, 25 * SUI_1);

    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::rebate_pool_value(&v) > 0, 0);
        // The creator kept nothing, having set a 100% rebate.
        assert!(sv::creator_yield_value(&v) == 0, 1);

        let a = sv::claimable_rebate(&v, FAN);
        let b = sv::claimable_rebate(&v, FAN2);
        assert!(a > 0 && b > 0, 2);
        // 75:25. Compared as a ratio with a one-unit tolerance for floor division rather than as
        // an exact equality, because the accumulator floors twice.
        assert!(a >= b * 3 - 1 && a <= b * 3 + 1, 3);
        ts::return_shared(v);
    };

    // And it can actually be taken out.
    sc.next_tx(FAN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let acct = sc.take_from_sender<SocialAccount>();
        let expected = sv::claimable_rebate(&v, FAN);
        let out = sv::claim_rebate(&mut v, &acct, sc.ctx());
        assert!(out.value() == expected, 4);
        assert!(sv::claimable_rebate(&v, FAN) == 0, 5);
        coin::burn_for_testing(out);
        sc.return_to_sender(acct);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
/// A depositor who arrives after a harvest must not be paid a rebate they were not there to earn.
fun a_late_depositor_does_not_share_earlier_yield() {
    let mut sc = setup();

    sc.next_tx(CREATOR);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<StakeCap>();
        sv::set_rebate_bps(&mut v, &cap, 10_000);
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };

    deposit(&mut sc, FAN, 50 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc); // yield earned entirely by FAN

    deposit(&mut sc, FAN2, 50 * SUI_1); // arrives afterwards

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::claimable_rebate(&v, FAN) > 0, 0);
        assert!(sv::claimable_rebate(&v, FAN2) == 0, 1);
        ts::return_shared(v);
    };

    sc.end();
}

// === Claims ===

#[test]
fun the_creator_and_platform_can_take_their_yield() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 100 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    let creator_due;
    let platform_due;
    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        creator_due = sv::creator_yield_value(&v);
        platform_due = sv::platform_yield_value(&v);
        assert!(creator_due > 0 && platform_due > 0, 0);
        ts::return_shared(v);
    };

    sc.next_tx(CREATOR);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<StakeCap>();
        let out = sv::claim_creator_yield(&mut v, &cap, creator_due, sc.ctx());
        assert!(out.value() == creator_due, 1);
        assert!(sv::creator_yield_value(&v) == 0, 2);
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };

    sc.next_tx(ADMIN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<PlatformCap>();
        let out = sv::claim_platform_yield(&mut v, &cap, platform_due, sc.ctx());
        assert!(out.value() == platform_due, 3);
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
/// Yield claims must never be able to reach principal. Both parties drain everything they are
/// owed; the depositor must still be able to take their full deposit afterwards.
fun draining_all_yield_cannot_touch_principal() {
    let mut sc = setup();
    deposit(&mut sc, FAN, 100 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    sc.next_tx(CREATOR);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<StakeCap>();
        let amt = sv::creator_yield_value(&v);
        let out = sv::claim_creator_yield(&mut v, &cap, amt, sc.ctx());
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };
    sc.next_tx(ADMIN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<PlatformCap>();
        let amt = sv::platform_yield_value(&v);
        let out = sv::claim_platform_yield(&mut v, &cap, amt, sc.ctx());
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };

    sc.next_tx(FAN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let mut state = sc.take_shared<SuiSystemState>();
        let acct = sc.take_from_sender<SocialAccount>();
        let out = sv::withdraw(&mut v, &acct, 100 * SUI_1, &mut state, sc.ctx());
        assert!(out.value() == 100 * SUI_1, 0);
        coin::burn_for_testing(out);
        sc.return_to_sender(acct);
        ts::return_shared(state);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::stake_vault::EDepositTooSmall)]
fun a_dust_deposit_is_refused() {
    let mut sc = setup();
    deposit(&mut sc, FAN, sv::min_deposit_mist() - 1);
    sc.end();
}

/// The August 2026 audit finding: a deposit must not earn the harvest it walks into.
///
/// Before the fix the accumulator divided the rebate by *all* principal, so principal deposited
/// moments earlier — still sitting in `liquid`, never delegated, having earned nothing — took a
/// share proportional to its size. Deposit big, harvest, claim, withdraw, all in one transaction,
/// at no cost, every epoch. The money came out of the depositors the rebate exists to reward.
#[test]
fun a_deposit_does_not_earn_the_harvest_it_walks_into() {
    let mut sc = setup();

    sc.next_tx(CREATOR);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<StakeCap>();
        sv::set_rebate_bps(&mut v, &cap, 10_000); // the attack is only armed when a rebate exists
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };

    // An honest depositor, staked and earning.
    deposit(&mut sc, FAN, 50 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);

    // The attacker arrives with ten times the honest stake, immediately before the harvest.
    deposit(&mut sc, FAN2, 500 * SUI_1);
    harvest(&mut sc);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        // The whole finding, in two lines.
        assert!(sv::claimable_rebate(&v, FAN2) == 0, 0);
        assert!(sv::claimable_rebate(&v, FAN) > 0, 1);
        ts::return_shared(v);
    };

    // And the fix must not confiscate — once the money has actually been delegated through a
    // harvest, it earns like anybody else's.
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::claimable_rebate(&v, FAN2) > 0, 2);
        ts::return_shared(v);
    };

    sc.end();
}

/// `StakeCap` has `store`, so it can be transferred, sold or lost — and `migrate` was the only
/// way to advance a vault's version. Since every entry point begins with `assert_version`,
/// including `withdraw`, a creator who loses their cap would strand their depositors' access to
/// their own principal the moment a new version shipped. `migrate_as_platform` is the second door.
///
/// It cannot be exercised at the current version, so this pins the gate the same way
/// `platform_tests` pins its own: calling it when there is nothing to migrate is a named refusal
/// rather than a silent no-op.
#[test]
#[expected_failure(abort_code = projectx_social::stake_vault::ENotUpgraded)]
fun the_platform_door_refuses_a_vault_already_at_version() {
    let mut sc = setup();
    sc.next_tx(ADMIN);
    let mut v = sc.take_shared<StakeVault>();
    let p = sc.take_shared<Platform>();
    let cap = sc.take_from_sender<PlatformCap>();
    sv::migrate_as_platform(&mut v, &p, &cap);
    sc.return_to_sender(cap);
    ts::return_shared(p);
    ts::return_shared(v);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::stake_vault::ERebateAboveMax)]
/// A rebate share above 100% of the creator's post-fee yield must be refused.
fun a_rebate_above_one_hundred_percent_is_refused() {
    let mut sc = setup();
    sc.next_tx(CREATOR);
    {
        let mut v = sc.take_shared<StakeVault>();
        let cap = sc.take_from_sender<StakeCap>();
        // 10_001 bps is above the 10_000 bps ceiling.
        sv::set_rebate_bps(&mut v, &cap, 10_001);
        sc.return_to_sender(cap);
        ts::return_shared(v);
    };
    sc.end();
}

// === Adversarial sequences ===
//
// `a_deposit_does_not_earn_the_harvest_it_walks_into` proves the one known timing attack;
// these drive the class — adversarially timed sequences trying to beat an honest holder.

fun set_full_rebate(sc: &mut Scenario) {
    sc.next_tx(CREATOR);
    let mut v = sc.take_shared<StakeVault>();
    let cap = sc.take_from_sender<StakeCap>();
    sv::set_rebate_bps(&mut v, &cap, 10_000);
    sc.return_to_sender(cap);
    ts::return_shared(v);
}

fun withdraw_exact(sc: &mut Scenario, who: address, amount: u64) {
    sc.next_tx(who);
    let mut v = sc.take_shared<StakeVault>();
    let mut state = sc.take_shared<SuiSystemState>();
    let acct = sc.take_from_sender<SocialAccount>();
    let out = sv::withdraw(&mut v, &acct, amount, &mut state, sc.ctx());
    assert!(out.value() == amount, 99);
    coin::burn_for_testing(out);
    sc.return_to_sender(acct);
    ts::return_shared(state);
    ts::return_shared(v);
}

#[test]
/// Churning the same principal in and out around harvests must never out-earn holding it.
///
/// The holder commits once, before anyone else, and waits. The churner deposits the same
/// amount immediately before each harvest and withdraws immediately after, three cycles in a
/// row — the rational strategy if timing could beat commitment. Every epoch the churner is
/// present the holder is present too, and the holder is also there for the opening harvest the
/// churner missed, so the holder must end strictly ahead.
fun churning_around_harvests_beats_nobody() {
    let mut sc = setup();
    set_full_rebate(&mut sc);

    deposit(&mut sc, FAN, 100 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);                      // the holder's head start, earned alone

    let mut cycle = 0;
    while (cycle < 3) {
        deposit(&mut sc, FAN2, 100 * SUI_1);
        harvest(&mut sc);
        advance_to_maturity(&mut sc);
        harvest(&mut sc);
        withdraw_exact(&mut sc, FAN2, 100 * SUI_1);
        cycle = cycle + 1;
    };

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        let holder = sv::claimable_rebate(&v, FAN);
        let churner = sv::claimable_rebate(&v, FAN2);
        assert!(holder > 0, 0);
        assert!(churner < holder, 1);
        ts::return_shared(v);
    };
    sc.end();
}

#[test]
/// A second claim in the same state takes nothing. The guard is accounting, not an abort: the
/// first claim zeroes `pending`, so the second returns an empty coin rather than a double
/// payment — and the pool balance is untouched by the repeat.
fun a_second_claim_in_the_same_state_takes_nothing() {
    let mut sc = setup();
    set_full_rebate(&mut sc);
    deposit(&mut sc, FAN, 50 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    sc.next_tx(FAN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let acct = sc.take_from_sender<SocialAccount>();
        let first = sv::claim_rebate(&mut v, &acct, sc.ctx());
        assert!(first.value() > 0, 0);
        let pool_after_first = sv::rebate_pool_value(&v);
        let second = sv::claim_rebate(&mut v, &acct, sc.ctx());
        assert!(second.value() == 0, 1);
        assert!(sv::rebate_pool_value(&v) == pool_after_first, 2);
        coin::burn_for_testing(first);
        coin::destroy_zero(second);
        sc.return_to_sender(acct);
        ts::return_shared(v);
    };
    sc.end();
}

// === Freshness markers must follow principal out ===
//
// `deposit` writes two markers — `Fresh{who}` and `FreshTotal` — recording money that arrived
// inside the current harvest window and has therefore not earned yet. Until 2026-09-01 `withdraw`
// reduced the principal and left both markers where they were, and the three tests below are the
// three ways that one omission was reachable. None of them needs an attacker; the first is what an
// ordinary depositor does by changing their mind.

/// Returns what came back, so a test can assert the amount rather than assume it —
/// `withdraw_exact` above asserts it internally and is used where that is all a test needs.
fun withdraw_returning(sc: &mut Scenario, who: address, amount: u64): u64 {
    sc.next_tx(who);
    let mut v = sc.take_shared<StakeVault>();
    let mut state = sc.take_shared<SuiSystemState>();
    let acct = sc.take_from_sender<SocialAccount>();
    let out = sv::withdraw(&mut v, &acct, amount, &mut state, sc.ctx());
    let got = out.value();
    coin::burn_for_testing(out);
    sc.return_to_sender(acct);
    ts::return_shared(state);
    ts::return_shared(v);
    got
}

#[test]
/// The one that costs a depositor their money.
///
/// Deposit, then take part of it back before the next harvest. The stale `Fresh` marker was folded
/// into `rebate_debt` at the next settle, and `accrue_on`'s `entitled - rebate_debt` then
/// underflowed. Every route out of a position runs that line — `deposit`, `withdraw` and
/// `claim_rebate` — so the remaining principal was unreachable from then on, permanently, with no
/// administrative rescue anywhere in the module.
fun a_partial_withdrawal_inside_one_window_does_not_strand_the_rest() {
    let mut sc = setup();
    set_full_rebate(&mut sc);

    // Somebody else earning, so the accumulator actually moves. With a single depositor it stays
    // at zero and the defect is not armed — which is why it survived the original suite.
    deposit(&mut sc, FAN2, 100 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::claimable_rebate(&v, FAN2) > 0, 0); // the precondition is real
        ts::return_shared(v);
    };

    // Deposit and change your mind, inside the same window.
    deposit(&mut sc, FAN, 50 * SUI_1);
    assert!(withdraw_returning(&mut sc, FAN, 10 * SUI_1) == 10 * SUI_1, 1);

    // The marker must have come down with the principal: 90 SUI is FAN2's 100 minus FAN's 40 fresh
    // — FAN's remaining 40 all arrived this window and none of it is eligible yet.
    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::principal_of(&v, FAN) == 40 * SUI_1, 2);
        assert!(sv::eligible_total(&v) == 100 * SUI_1, 3);
        ts::return_shared(v);
    };

    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    // The line under test. Before the fix this aborted with an arithmetic error and every retry
    // aborted the same way.
    assert!(withdraw_returning(&mut sc, FAN, 40 * SUI_1) == 40 * SUI_1, 4);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::principal_of(&v, FAN) == 0, 5);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
/// The one that costs everybody else theirs.
///
/// A round trip in a single window — deposit and withdraw the same amount, cost: gas — left
/// `FreshTotal` claiming money the vault no longer held. `eligible_total` is the denominator the
/// rebate is divided by, so it fell below the principal actually earning and `acc_rebate_per_unit`
/// grew past anything `rebate_pool` could pay. Honest depositors' claims then aborted on the
/// balance check and never recovered, because the accumulator only ever increases.
fun a_round_trip_cannot_inflate_the_accumulator() {
    let mut sc = setup();
    set_full_rebate(&mut sc);

    deposit(&mut sc, FAN, 100 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    // In and straight back out, same window.
    deposit(&mut sc, FAN2, 100 * SUI_1);
    assert!(withdraw_returning(&mut sc, FAN2, 100 * SUI_1) == 100 * SUI_1, 0);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::principal_of(&v, FAN2) == 0, 1);
        // The whole finding. This read 0 before the fix, because a stale `FreshTotal` of 100
        // covered the entire vault.
        assert!(sv::eligible_total(&v) == 100 * SUI_1, 2);
        ts::return_shared(v);
    };

    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    // The rebate must still be payable out of the pool that was funded for it. An inflated
    // accumulator shows up here as a claim larger than the pool, which aborts.
    sc.next_tx(FAN);
    {
        let mut v = sc.take_shared<StakeVault>();
        let acct = sc.take_from_sender<SocialAccount>();
        let due = sv::claimable_rebate(&v, FAN);
        assert!(due > 0, 3);
        assert!(due <= sv::rebate_pool_value(&v), 4);
        let out = sv::claim_rebate(&mut v, &acct, sc.ctx());
        assert!(out.value() == due, 5);
        coin::burn_for_testing(out);
        sc.return_to_sender(acct);
        ts::return_shared(v);
    };

    sc.end();
}

#[test]
/// And the fix must not become a gift.
///
/// A withdrawal comes out of MATURED principal first, so the marker only shrinks once what remains
/// cannot cover it. The other order would let anyone deposit and immediately withdraw the same
/// amount of older principal, and the new money would start earning as though it had sat through a
/// harvest. Here 100 is mature and 50 is fresh; withdrawing 50 must leave the 50 fresh still
/// ineligible, not convert it.
fun a_withdrawal_comes_out_of_matured_principal_first() {
    let mut sc = setup();
    set_full_rebate(&mut sc);

    deposit(&mut sc, FAN, 100 * SUI_1);
    harvest(&mut sc);
    advance_to_maturity(&mut sc);
    harvest(&mut sc);

    deposit(&mut sc, FAN, 50 * SUI_1);
    assert!(withdraw_returning(&mut sc, FAN, 50 * SUI_1) == 50 * SUI_1, 0);

    sc.next_tx(ADMIN);
    {
        let v = sc.take_shared<StakeVault>();
        assert!(sv::principal_of(&v, FAN) == 100 * SUI_1, 1);
        // 100 principal, 50 of it still fresh. Not 100, which is what taking from the fresh side
        // first would have produced.
        assert!(sv::eligible_total(&v) == 50 * SUI_1, 2);
        ts::return_shared(v);
    };

    sc.end();
}
