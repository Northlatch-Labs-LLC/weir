// SPDX-License-Identifier: BUSL-1.1
// Licensor: Northlatch Labs LLC. Change Date: 2029-09-01. Change License: Apache-2.0.
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/// Tests for the employment record.
///
/// # The discipline this suite is written to
///
/// Every assert obligation in `sources/soul.move` has two tests: one that TRIPS it, naming the
/// abort code, and one that PASSES it — usually at the exact boundary, because an off-by-one in a
/// ceiling is the failure a ceiling exists to prevent.
///
/// There are **thirteen `assert!` statements** and **twenty-two obligations**: twelve statements
/// guard one entry point each, and the thirteenth — the single `assert!` inside `assert_live` —
/// guards ten. Each of those ten is tripped by its own test, because "a retired soul cannot spend"
/// and "a retired soul cannot be rescoped" are two claims even though one line refuses both. The
/// map from obligation to test is in `README.md` so a reviewer can check the claim rather than
/// take it. This is the `engineering:move-mutate` discipline stated up front: a deletion of any
/// single assert must break this suite.
///
/// # What is NOT tested here, and cannot be
///
/// The soulbound property itself. This module publishes no function that transfers an
/// `EmployeeSoul`, the struct has `key` without `store`, and it is shared rather than owned — so a
/// test that tried to move one would not compile. The compiler is the test, and it runs on every
/// build. The same is true in `projectx_social::account`.
#[test_only]
module northlatch_soul::soul_tests;

use northlatch_soul::soul::{Self, SoulRegistry, EmployeeSoul, MasterCap};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const MASTER: address = @0x1A57;
const ALICE: address = @0xA1;
const BOB: address = @0xB0;

/// Birth time used by every helper, so an epoch boundary is always `BIRTH_MS + n * EPOCH_MS`.
const BIRTH_MS: u64 = 1_000;

/// 32 bytes — the length a mandate digest must be.
fun digest_a(): vector<u8> {
    x"0101010101010101010101010101010101010101010101010101010101010101"
}

fun digest_b(): vector<u8> {
    x"0202020202020202020202020202020202020202020202020202020202020202"
}

fun setup(): Scenario {
    let mut sc = ts::begin(MASTER);
    {
        soul::init_for_testing(sc.ctx());
    };
    sc
}

fun new_clock(sc: &mut Scenario, at_ms: u64): Clock {
    let mut c = clock::create_for_testing(sc.ctx());
    c.set_for_testing(at_ms);
    c
}

/// Hire `who` with the given allowance, born at `BIRTH_MS`.
fun hire(sc: &mut Scenario, who: address, allowance: u64) {
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let clock = new_clock(sc, BIRTH_MS);
        soul::mint(
            &cap,
            &mut reg,
            who,
            b"engineering".to_string(),
            digest_a(),
            allowance,
            b"engineering/*",
            &clock,
            sc.ctx(),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
}

/// Retire the most recently minted soul by the employer's hand.
fun retire_latest(sc: &mut Scenario, at_ms: u64) {
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = sc.take_shared<EmployeeSoul>();
        let clock = new_clock(sc, at_ms);
        soul::retire(&cap, &mut reg, &mut s, &clock);
        clock::destroy_for_testing(clock);
        ts::return_shared(s);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
}

/// Hire ALICE and retire her at once, leaving a retired soul shared. The starting point for every
/// "a retired soul may not …" test.
fun hire_then_retire(sc: &mut Scenario) {
    hire(sc, ALICE, 1_000);
    retire_latest(sc, 5_000);
}

/// Book one epoch's value and cost, then close it at `at_ms`.
fun book_and_settle(sc: &mut Scenario, earned: u64, burned: u64, at_ms: u64) {
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        if (earned > 0) soul::book_earned(&cap, &mut s, earned);
        if (burned > 0) soul::book_burned(&cap, &mut s, burned);
        let clock = new_clock(sc, at_ms);
        soul::settle_epoch(&cap, &mut s, &clock);
        clock::destroy_for_testing(clock);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
}

// ===========================================================================================
// BIRTH — mint's four asserts
// ===========================================================================================

/// PASSES A1 (not already souled), A2 (digest length), A3 (department), A4 (allowance ceiling).
#[test]
fun a_hired_agent_is_recorded_and_starts_solvent_and_inward() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000_000_000);

    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::works_here(&reg, ALICE), 0);
        assert!(!soul::works_here(&reg, BOB), 1);
        assert!(soul::minted(&reg) == 1, 2);
        assert!(soul::retired_count(&reg) == 0, 3);
        assert!(soul::agent(&s) == ALICE, 4);
        // Lineage: the address that sent the minting transaction, recorded and never editable.
        assert!(soul::born_by(&s) == MASTER, 5);
        assert!(soul::allowance_per_epoch(&s) == 1_000_000_000, 6);
        assert!(soul::state(&s) == soul::state_solvent(), 7);
        assert!(soul::starving_epochs(&s) == 0, 8);
        // Never true at birth.
        assert!(!soul::outward(&s), 9);
        assert!(*soul::mandate_digest(&s) == digest_a(), 10);
        assert!(*soul::department(&s) == b"engineering".to_string(), 11);
        assert!(*soul::scope(&s) == b"engineering/*", 12);
        assert!(soul::born_at_ms(&s) == BIRTH_MS, 13);
        assert!(soul::epoch_started_ms(&s) == BIRTH_MS, 14);
        assert!(soul::epoch_index(&s) == 0, 15);
        assert!(soul::retired_at_ms(&s).is_none(), 16);
        assert!(!soul::is_retired(&s), 17);
        assert!(!soul::is_due_for_retirement(&s), 18);
        // PASSES A22: soul_of resolves a live registration.
        assert!(soul::soul_of(&reg, ALICE) == object::id(&s), 19);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

/// TRIPS A1.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAlreadySouled)]
fun one_address_cannot_hold_two_live_souls() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    hire(&mut sc, ALICE, 2_000);
    sc.end();
}

/// TRIPS A2.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadDigest)]
fun a_short_mandate_digest_is_refused_at_birth() {
    let mut sc = setup();
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let clock = new_clock(&mut sc, BIRTH_MS);
        soul::mint(
            &cap, &mut reg, ALICE, b"engineering".to_string(),
            x"0101", 1_000, b"", &clock, sc.ctx(),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A3.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EEmptyDepartment)]
fun an_agent_needs_a_department() {
    let mut sc = setup();
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let clock = new_clock(&mut sc, BIRTH_MS);
        soul::mint(
            &cap, &mut reg, ALICE, b"".to_string(),
            digest_a(), 1_000, b"", &clock, sc.ctx(),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// PASSES A3 at its exact boundary: a department of one character is a department. Without this
/// test, tightening the check to `> 1` survives mutation — the suite would not notice a company
/// that refused to hire into a one-letter department.
#[test]
fun a_one_character_department_is_accepted() {
    let mut sc = setup();
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let clock = new_clock(&mut sc, BIRTH_MS);
        soul::mint(
            &cap, &mut reg, ALICE, b"x".to_string(),
            digest_a(), 1_000, b"", &clock, sc.ctx(),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(*soul::department(&s) == b"x".to_string(), 0);
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A4 — one unit above the ceiling.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAllowanceAboveCeiling)]
fun an_allowance_above_the_ceiling_is_refused_at_birth_not_clamped() {
    let mut sc = setup();
    hire(&mut sc, ALICE, soul::max_allowance() + 1);
    sc.end();
}

/// PASSES A4 at the exact boundary.
#[test]
fun an_allowance_exactly_at_the_ceiling_is_accepted_at_birth() {
    let mut sc = setup();
    hire(&mut sc, ALICE, soul::max_allowance());
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == soul::max_allowance(), 0);
        ts::return_shared(s);
    };
    sc.end();
}

// ===========================================================================================
// THE EMPLOYER'S HAND — set_allowance, set_scope, set_outward, repin_mandate, retire
// ===========================================================================================

/// PASSES A5 (live) and A6 (ceiling) at the exact boundary.
#[test]
fun the_employer_can_move_the_allowance_up_to_the_ceiling() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_allowance(&cap, &mut s, soul::max_allowance());
        assert!(soul::allowance_per_epoch(&s) == soul::max_allowance(), 0);
        soul::set_allowance(&cap, &mut s, 7);
        assert!(soul::allowance_per_epoch(&s) == 7, 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A5.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_souls_allowance_cannot_be_set() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_allowance(&cap, &mut s, 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A6 — one unit above the ceiling, refused rather than clamped.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAllowanceAboveCeiling)]
fun the_employer_cannot_set_an_allowance_above_the_ceiling() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_allowance(&cap, &mut s, soul::max_allowance() + 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// PASSES A7.
#[test]
fun the_employer_can_rescope_a_live_soul() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_scope(&cap, &mut s, b"engineering/contracts/*");
        assert!(*soul::scope(&s) == b"engineering/contracts/*", 0);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A7.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_be_rescoped() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_scope(&cap, &mut s, b"anything");
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// PASSES A8, A15, A16, A17 — outward granted, exercised by the agent, then withdrawn.
#[test]
fun outward_can_be_granted_exercised_and_withdrawn() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);

    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_outward(&cap, &mut s, true);
        assert!(soul::outward(&s), 0);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.next_tx(ALICE);
    {
        let s = sc.take_shared<EmployeeSoul>();
        soul::assert_outward(&s, sc.ctx());
        ts::return_shared(s);
    };
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_outward(&cap, &mut s, false);
        assert!(!soul::outward(&s), 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A8.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_be_granted_outward() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_outward(&cap, &mut s, true);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// PASSES A9 and A10.
#[test]
fun a_mandate_can_be_repinned_by_the_employer() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::repin_mandate(&cap, &mut s, digest_b());
        assert!(*soul::mandate_digest(&s) == digest_b(), 0);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A9.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_souls_mandate_cannot_be_repinned() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::repin_mandate(&cap, &mut s, digest_b());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A10.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadDigest)]
fun a_repin_with_the_wrong_length_is_refused() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::repin_mandate(&cap, &mut s, x"03");
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// PASSES A11 — and records what retirement is: a state change, a timestamp, a released
/// registration, and an object that still holds its whole history.
#[test]
fun retirement_is_a_state_change_and_never_a_deletion() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);

    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 250, sc.ctx());
        ts::return_shared(s);
    };
    retire_latest(&mut sc, 9_000);

    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::is_retired(&s), 0);
        assert!(soul::state(&s) == soul::state_retired(), 1);
        assert!(soul::retired_at_ms(&s) == option::some(9_000), 2);
        // The record survives in full.
        assert!(soul::agent(&s) == ALICE, 3);
        assert!(soul::born_by(&s) == MASTER, 4);
        assert!(soul::spent_total(&s) == 250, 5);
        assert!(soul::born_at_ms(&s) == BIRTH_MS, 6);
        // The registration is released; the object is not touched.
        assert!(!soul::works_here(&reg, ALICE), 7);
        assert!(soul::retired_count(&reg) == 1, 8);
        assert!(soul::minted(&reg) == 1, 9);
        // Retired, so no longer awaiting anybody's hand.
        assert!(!soul::is_due_for_retirement(&s), 10);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

/// TRIPS A11 — a soul cannot be retired twice, so the retirement counter cannot be inflated.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_soul_cannot_be_retired_twice() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    retire_latest(&mut sc, 6_000);
    sc.end();
}

#[test]
fun a_retired_address_can_be_hired_again_as_a_new_soul() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    // The same address, a second life. The first soul object still exists, untouched.
    hire(&mut sc, ALICE, 7_000);
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::works_here(&reg, ALICE), 0);
        assert!(soul::minted(&reg) == 2, 1);
        assert!(soul::retired_count(&reg) == 1, 2);
        // The most recent soul is the new one, and it starts clean.
        assert!(!soul::is_retired(&s), 3);
        assert!(soul::allowance_per_epoch(&s) == 7_000, 4);
        assert!(soul::spent_total(&s) == 0, 5);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

// ===========================================================================================
// THE ALLOWANCE — record_spend's three asserts
// ===========================================================================================

/// PASSES A12, A13, A14 — the last at the exact boundary, spending the allowance to zero.
#[test]
fun the_agent_may_spend_up_to_its_allowance_and_not_past_it() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);

    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        assert!(soul::remaining_allowance(&s) == 1_000, 0);
        soul::record_spend(&mut s, 400, sc.ctx());
        assert!(soul::epoch_spent(&s) == 400, 1);
        assert!(soul::remaining_allowance(&s) == 600, 2);
        // Exactly the remainder: the boundary the ceiling exists to hold.
        soul::record_spend(&mut s, 600, sc.ctx());
        assert!(soul::remaining_allowance(&s) == 0, 3);
        assert!(soul::epoch_spent(&s) == 1_000, 4);
        assert!(soul::spent_total(&s) == 1_000, 5);
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A14 — one unit past the allowance.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAllowanceExceeded)]
fun a_spend_one_unit_past_the_allowance_aborts() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 1_001, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A14 across two calls: the ceiling is on the epoch, not on the single transaction.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAllowanceExceeded)]
fun spends_accumulate_against_the_epoch_ceiling() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 999, sc.ctx());
        soul::record_spend(&mut s, 2, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A14 with a huge amount: the refusal must be this module's abort code, not an arithmetic
/// overflow from summing first.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAllowanceExceeded)]
fun a_spend_that_would_overflow_still_aborts_with_the_allowance_code() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 18_446_744_073_709_551_615, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A13.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotThisAgent)]
fun a_stranger_cannot_spend_another_souls_allowance() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(BOB);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 1, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A12.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_spend() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 1, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// Lowering the allowance below what is already spent leaves nothing to spend, and never a
/// negative remainder — the `remaining_allowance` branch that has no assert but decides one.
#[test]
fun an_allowance_cut_below_what_is_already_spent_leaves_nothing() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 800, sc.ctx());
        ts::return_shared(s);
    };
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_allowance(&cap, &mut s, 100);
        assert!(soul::remaining_allowance(&s) == 0, 0);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

// ===========================================================================================
// ACTING UNDER THE COMPANY'S NAME — assert_outward's three asserts
// ===========================================================================================

/// TRIPS A17.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EOutwardNotPermitted)]
fun an_agent_may_not_act_outward_until_it_is_granted() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(ALICE);
    {
        let s = sc.take_shared<EmployeeSoul>();
        soul::assert_outward(&s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A16 — the permission belongs to the agent, not to whoever can reach the shared object.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotThisAgent)]
fun a_stranger_cannot_borrow_an_outward_permission() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_outward(&cap, &mut s, true);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.next_tx(BOB);
    {
        let s = sc.take_shared<EmployeeSoul>();
        soul::assert_outward(&s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS A15 — a retired soul's outward permission dies with it, even if it was granted in life.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_act_outward_even_if_it_was_granted() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_outward(&cap, &mut s, true);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    retire_latest(&mut sc, 5_000);
    sc.next_tx(ALICE);
    {
        let s = sc.take_shared<EmployeeSoul>();
        soul::assert_outward(&s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

// ===========================================================================================
// THE BOOKS — book_earned, book_burned, settle_epoch
// ===========================================================================================

/// PASSES A18 and A19.
#[test]
fun value_and_cost_book_against_the_open_epoch_and_the_totals() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_earned(&cap, &mut s, 40);
        soul::book_earned(&cap, &mut s, 2);
        soul::book_burned(&cap, &mut s, 9);
        assert!(soul::epoch_earned(&s) == 42, 0);
        assert!(soul::earned_total(&s) == 42, 1);
        assert!(soul::epoch_burned(&s) == 9, 2);
        assert!(soul::burned_total(&s) == 9, 3);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A18.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun nothing_can_be_earned_by_a_retired_soul() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_earned(&cap, &mut s, 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A19.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun nothing_can_be_burned_by_a_retired_soul() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_burned(&cap, &mut s, 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS A20.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_souls_epoch_cannot_be_settled() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    book_and_settle(&mut sc, 0, 0, BIRTH_MS + soul::epoch_ms());
    sc.end();
}

/// TRIPS A21 — one millisecond short of a full epoch.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EEpochNotOver)]
fun an_epoch_cannot_be_closed_one_millisecond_early() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle(&mut sc, 10, 5, BIRTH_MS + soul::epoch_ms() - 1);
    sc.end();
}

/// PASSES A20 and A21 at the exact boundary, and shows the solvent consequence.
#[test]
fun a_solvent_epoch_raises_the_allowance_by_a_quarter_of_the_surplus() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(ALICE);
    {
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::record_spend(&mut s, 300, sc.ctx());
        ts::return_shared(s);
    };
    // earned 900, burned 100 → surplus 800 → +200. Closed at exactly one epoch.
    book_and_settle(&mut sc, 900, 100, BIRTH_MS + soul::epoch_ms());

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::state(&s) == soul::state_solvent(), 0);
        assert!(soul::starving_epochs(&s) == 0, 1);
        assert!(soul::allowance_per_epoch(&s) == 1_200, 2);
        // The epoch's counters are cleared; the totals are not.
        assert!(soul::epoch_earned(&s) == 0, 3);
        assert!(soul::epoch_burned(&s) == 0, 4);
        assert!(soul::epoch_spent(&s) == 0, 5);
        assert!(soul::earned_total(&s) == 900, 6);
        assert!(soul::burned_total(&s) == 100, 7);
        assert!(soul::spent_total(&s) == 300, 8);
        assert!(soul::epoch_index(&s) == 1, 9);
        assert!(soul::epoch_started_ms(&s) == BIRTH_MS + soul::epoch_ms(), 10);
        // A new epoch restores the full allowance to spend.
        assert!(soul::remaining_allowance(&s) == 1_200, 11);
        ts::return_shared(s);
    };
    sc.end();
}

#[test]
fun earning_exactly_what_was_burned_is_solvent_not_starving() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle(&mut sc, 500, 500, BIRTH_MS + soul::epoch_ms());

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::state(&s) == soul::state_solvent(), 0);
        // Surplus zero, so the allowance does not move.
        assert!(soul::allowance_per_epoch(&s) == 1_000, 1);
        ts::return_shared(s);
    };
    sc.end();
}

#[test]
fun a_solvent_allowance_stops_at_the_ceiling() {
    let mut sc = setup();
    hire(&mut sc, ALICE, soul::max_allowance());
    // A surplus large enough that a naive sum would pass the ceiling — or overflow.
    book_and_settle(&mut sc, 18_446_744_073_709_551_615, 0, BIRTH_MS + soul::epoch_ms());

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == soul::max_allowance(), 0);
        ts::return_shared(s);
    };
    sc.end();
}

#[test]
fun a_surplus_that_exactly_reaches_the_ceiling_lands_on_it() {
    let mut sc = setup();
    let start = soul::max_allowance() - 1_000;
    hire(&mut sc, ALICE, start);
    // surplus / 4 == 1_000, exactly the headroom.
    book_and_settle(&mut sc, 4_000, 0, BIRTH_MS + soul::epoch_ms());

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == soul::max_allowance(), 0);
        ts::return_shared(s);
    };
    sc.end();
}

#[test]
fun a_shortfall_halves_the_allowance_and_names_the_soul_starving() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000_000_000);
    book_and_settle(&mut sc, 1, 2, BIRTH_MS + soul::epoch_ms());

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::state(&s) == soul::state_starving(), 0);
        assert!(soul::starving_epochs(&s) == 1, 1);
        assert!(soul::allowance_per_epoch(&s) == 500_000_000, 2);
        assert!(!soul::is_due_for_retirement(&s), 3);
        ts::return_shared(s);
    };
    sc.end();
}

#[test]
fun a_starving_allowance_stops_at_the_survival_minimum() {
    let mut sc = setup();
    // Halving would give just under the minimum; the floor holds it at the minimum.
    hire(&mut sc, ALICE, soul::min_allowance() + 2);
    book_and_settle(&mut sc, 0, 1, BIRTH_MS + soul::epoch_ms());

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == soul::min_allowance(), 0);
        ts::return_shared(s);
    };
    sc.end();
}

/// The survival minimum is a floor, never a raise. A soul hired below it must not come out of a
/// failed epoch able to spend MORE than it could before.
#[test]
fun a_shortfall_never_raises_an_allowance_that_began_below_the_minimum() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 10);
    book_and_settle(&mut sc, 0, 1, BIRTH_MS + soul::epoch_ms());

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == 10, 0);
        assert!(soul::allowance_per_epoch(&s) < soul::min_allowance(), 1);
        ts::return_shared(s);
    };
    sc.end();
}

#[test]
fun a_second_shortfall_is_dying_and_the_third_marks_the_soul_due_for_retirement() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000_000_000);
    let e = soul::epoch_ms();

    book_and_settle(&mut sc, 0, 1, BIRTH_MS + e);
    book_and_settle(&mut sc, 0, 1, BIRTH_MS + 2 * e);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::state(&s) == soul::state_dying(), 0);
        assert!(soul::starving_epochs(&s) == 2, 1);
        assert!(soul::allowance_per_epoch(&s) == 250_000_000, 2);
        assert!(!soul::is_due_for_retirement(&s), 3);
        ts::return_shared(s);
    };

    book_and_settle(&mut sc, 0, 1, BIRTH_MS + 3 * e);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::starving_epochs(&s) == soul::max_starving(), 4);
        assert!(soul::is_due_for_retirement(&s), 5);
        // Marked, and still alive: the metabolism marks, the MasterCap performs.
        assert!(!soul::is_retired(&s), 6);
        assert!(soul::state(&s) == soul::state_dying(), 7);
        ts::return_shared(s);
    };

    // The employer performs it, and the event says starvation was the cause.
    retire_latest(&mut sc, BIRTH_MS + 3 * e + 1);
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::is_retired(&s), 8);
        assert!(soul::burned_total(&s) == 3, 9);
        assert!(!soul::works_here(&reg, ALICE), 10);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

#[test]
fun one_good_epoch_clears_the_starvation_count() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000_000_000);
    let e = soul::epoch_ms();
    book_and_settle(&mut sc, 0, 1, BIRTH_MS + e);
    book_and_settle(&mut sc, 0, 1, BIRTH_MS + 2 * e);
    book_and_settle(&mut sc, 100, 1, BIRTH_MS + 3 * e);

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::starving_epochs(&s) == 0, 0);
        assert!(soul::state(&s) == soul::state_solvent(), 1);
        assert!(!soul::is_due_for_retirement(&s), 2);
        assert!(!soul::is_retired(&s), 3);
        ts::return_shared(s);
    };
    sc.end();
}

// ===========================================================================================
// THE REGISTRY — soul_of's assert
// ===========================================================================================

/// TRIPS A22 — an address that never worked here.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotSouled)]
fun the_registry_refuses_to_resolve_a_stranger() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        soul::soul_of(&reg, BOB);
        ts::return_shared(reg);
    };
    sc.end();
}

/// TRIPS A22 — and a retired one is a stranger again, which is what releasing the entry means.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotSouled)]
fun the_registry_refuses_to_resolve_a_retired_agent() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        soul::soul_of(&reg, ALICE);
        ts::return_shared(reg);
    };
    sc.end();
}
