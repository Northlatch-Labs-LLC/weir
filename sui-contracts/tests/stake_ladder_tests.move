// SPDX-License-Identifier: BUSL-1.1
// Licensor: Northlatch Labs LLC. Change Date: 2029-09-01. Change License: Apache-2.0.
// Built-by: @projectx.sui · Co-authored-by: Claude <no-reply@anthropic.com>
/// Tests for the ladder's arithmetic — the functions that decide, from a target alone, how the
/// seven rungs are sized and how much of a validator epoch the vault captures.
///
/// The tranche-behaviour functions (`is_matured`, `staked_this_epoch`, `harvest_matured`,
/// `stake_one_rung`, `unwind_newest`) need live `StakedSui` against a system state and are
/// exercised where that machinery is already built: `stake_vault_tests.move`, which drives the
/// ladder through real deposits, harvests, unwinds and churn. What that suite cannot lose sight
/// of are the pure numbers below, because every one of them is a policy constant someone chose:
///
///   * a target under 7 SUI still stakes 1-SUI rungs — the ladder prefers being coarse to being
///     empty, and the floor is Sui's own minimum, not ours;
///   * `rung_size` never returns more than a seventh of the target above that floor, so seven
///     rungs never stake more than the target plus rounding;
///   * capture is 8571/10000 at depth 6 — the number a depositor is told the vault earns with,
///     pinned here so a "small" edit to it fails a test whose name says what was lost.
#[test_only]
module projectx_social::stake_ladder_tests;

use projectx_social::stake_ladder as ladder;
use std::vector;
use sui_system::staking_pool::StakedSui;

const MAX_U64: u64 = 18446744073709551615;
const ONE_SUI: u64 = 1_000_000_000;
const SEVEN_SUI: u64 = 7_000_000_000;

#[test]
fun the_constants_are_the_policy_someone_chose() {
    assert!(ladder::rungs() == 7, 0);
    assert!(ladder::ladder_depth() == 6, 1);
    assert!(ladder::max_tranches() == 16, 2);
    assert!(ladder::min_stake_mist() == ONE_SUI, 3);
}

#[test]
fun capture_is_eight_thousand_five_hundred_and_seventy_one_bps() {
    // 6/7 of an epoch, rounded down — and strictly under the whole, so the vault can never
    // claim more of an epoch than exists.
    assert!(ladder::capture_bps() == 8_571, 0);
    assert!(ladder::capture_bps() < 10_000, 1);
}

#[test]
fun a_target_below_seven_sui_stakes_one_sui_rungs_rather_than_nothing() {
    assert!(ladder::rung_size(0) == ONE_SUI, 0);
    assert!(ladder::rung_size(1) == ONE_SUI, 1);
    assert!(ladder::rung_size(SEVEN_SUI - 1) == ONE_SUI, 2);
}

#[test]
fun an_exact_target_divides_into_seven_equal_rungs() {
    assert!(ladder::rung_size(SEVEN_SUI) == ONE_SUI, 0);
    assert!(ladder::rung_size(70_000_000_000) == 10_000_000_000, 1);
    assert!(ladder::rung_size(SEVEN_SUI * 1_000) == ONE_SUI * 1_000, 2);
}

#[test]
fun an_uneven_target_floors_rather_than_rounds_up() {
    // 8 SUI / 7 = 1.142857142 SUI exactly; the rung is that, in MIST — integer division that
    // rounds DOWN. Rounding UP would stake more than the target across seven rungs, which is the
    // one thing the ladder must never do above the floor.
    assert!(ladder::rung_size(SEVEN_SUI + ONE_SUI) == 1_142_857_142, 0);
    assert!(ladder::rung_size(SEVEN_SUI + 6 * ONE_SUI) == 1_857_142_857, 1);
    assert!(ladder::rung_size(SEVEN_SUI + 7 * ONE_SUI) == 2 * ONE_SUI, 2);
}

#[test]
fun the_largest_target_does_not_overflow() {
    let rung = ladder::rung_size(MAX_U64);
    assert!(rung == MAX_U64 / 7, 0);
    assert!(rung * 7 <= MAX_U64, 1);
}

#[test]
fun seven_rungs_never_stake_more_than_the_target_above_the_floor() {
    // Above 7 SUI the rung is exactly the seventh, so rung * 7 <= target always holds. Below it,
    // the floor can round up (a 3-SUI target stakes 7 SUI of 1-SUI rungs) — that is the coarse-
    // not-empty choice, and this test draws the line where it stops applying.
    let mut target = SEVEN_SUI;
    let mut i = 0;
    while (i < 8) {
        let rung = ladder::rung_size(target);
        assert!(rung * 7 <= target, i);
        target = target * 2;
        i = i + 1;
    };
    let floored = ladder::rung_size(SEVEN_SUI - 1);
    assert!(floored * 7 > SEVEN_SUI - 1, 100); // the floor's whole point
}

#[test]
fun an_empty_ladder_has_not_converged_and_stakes_nothing() {
    // Converged means every rung occupied — one maturing per epoch from here. A new vault's empty
    // ladder is the opposite of converged: it has not started turning yet.
    let tranches: vector<StakedSui> = vector[];
    assert!(!ladder::is_converged(&tranches), 0);
    assert!(ladder::staked_principal(&tranches) == 0, 1);
    assert!(!ladder::staked_this_epoch(&tranches, 0), 2);
    vector::destroy_empty(tranches);
}
