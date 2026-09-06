// Northlatch Labs LLC — company infrastructure. Licensing follows this repository's LICENSE;
// this repository is classified and has no remote. The BUSL header this file carried was a
// convention of the product repository it was wrongly written in, and does not belong here.
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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

use northlatch_soul::soul::{Self, SoulRegistry, EmployeeSoul, MasterCap, LedgerCap, AdopterCredential, AdoptionOffer};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const MASTER: address = @0x1A57;
const ALICE: address = @0xA1;
const BOB: address = @0xB0;
const CAROL: address = @0xC0;
const DAVE: address = @0xD0;

/// Birth time used by every helper, so a settlement's wall-clock stamp is `BIRTH_MS + n * WEEK_MS`.
const BIRTH_MS: u64 = 1_000;

/// Seven days in milliseconds. This lives in the TESTS, never in the module: it moves the `Clock`
/// so a settled epoch carries a realistic wall-clock stamp for readers. It gates nothing. The
/// gate is `ctx.epoch()`, advanced here by `test_scenario::next_epoch`.
const WEEK_MS: u64 = 604_800_000;

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

/// The rule of council 2.6: account at least 7 epochs old, at most 3 agents per operator, no
/// renunciations tolerated, no backing required. Used by every hire below unless a test needs a
/// different one.
fun launch_rule(): soul::AdoptionRule { soul::new_adoption_rule(7, 3, 0, 0) }

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
            launch_rule(),
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

/// Book one epoch's value and cost, TURN THE CHAIN EPOCH, then close it with the clock at
/// `at_ms`. Turning the epoch is what makes the settlement legal now; `at_ms` only stamps it.
fun book_and_settle(sc: &mut Scenario, earned: u64, burned: u64, at_ms: u64) {
    book_and_settle_with_purse(sc, earned, burned, at_ms, DEEP_PURSE, true)
}

/// A purse deep enough for TIER_NORMAL at every allowance the metabolism tests use, so those
/// tests keep testing the metabolism and are not quietly also testing the tier.
const DEEP_PURSE: u64 = 18_446_744_073_709_551_615;

/// Book one epoch's value and cost, TURN THE CHAIN EPOCH, then close it with the clock at
/// `at_ms`, the supplied balance and the supplied sign of the net.
fun book_and_settle_with_purse(
    sc: &mut Scenario,
    earned: u64,
    burned: u64,
    at_ms: u64,
    vault_sui: u64,
    net_nonneg: bool,
) {
    sc.next_epoch(MASTER);
    {
        let cap = sc.take_from_sender<LedgerCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = sc.take_shared<EmployeeSoul>();
        if (earned > 0) soul::book_earned(&cap, &mut s, earned);
        if (burned > 0) soul::book_burned(&cap, &mut s, burned);
        let clock = new_clock(sc, at_ms);
        soul::settle_epoch(&cap, &mut reg, &mut s, vault_sui, net_nonneg, &clock, sc.ctx());
        clock::destroy_for_testing(clock);
        ts::return_shared(s);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
}

/// The same, WITHOUT turning the chain epoch: the settlement must refuse however far ahead the
/// clock is pushed. This is the test that says the clock is not the gate any more.
fun book_and_settle_in_the_same_epoch(sc: &mut Scenario, earned: u64, burned: u64, at_ms: u64) {
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<LedgerCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = sc.take_shared<EmployeeSoul>();
        if (earned > 0) soul::book_earned(&cap, &mut s, earned);
        if (burned > 0) soul::book_burned(&cap, &mut s, burned);
        let clock = new_clock(sc, at_ms);
        soul::settle_epoch(&cap, &mut reg, &mut s, DEEP_PURSE, true, &clock, sc.ctx());
        clock::destroy_for_testing(clock);
        ts::return_shared(s);
        ts::return_shared(reg);
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
            x"0101", 1_000, b"", launch_rule(), &clock, sc.ctx(),
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
            digest_a(), 1_000, b"", launch_rule(), &clock, sc.ctx(),
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
            digest_a(), 1_000, b"", launch_rule(), &clock, sc.ctx(),
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
        let cap = sc.take_from_sender<LedgerCap>();
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
        let cap = sc.take_from_sender<LedgerCap>();
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
        let cap = sc.take_from_sender<LedgerCap>();
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
    book_and_settle(&mut sc, 0, 0, BIRTH_MS + WEEK_MS);
    sc.end();
}

/// TRIPS A21 — the chain epoch has not turned, and no amount of clock buys the settlement.
/// Adapted from `an_epoch_cannot_be_closed_one_millisecond_early`: the millisecond boundary it
/// tested no longer exists. A whole year of wall clock is pushed at it and it still refuses.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EEpochNotOver)]
fun an_epoch_cannot_be_closed_before_the_chain_epoch_turns() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_in_the_same_epoch(&mut sc, 10, 5, BIRTH_MS + 52 * WEEK_MS);
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
    book_and_settle(&mut sc, 900, 100, BIRTH_MS + WEEK_MS);

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
        assert!(soul::epoch_started_ms(&s) == BIRTH_MS + WEEK_MS, 10);
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
    book_and_settle(&mut sc, 500, 500, BIRTH_MS + WEEK_MS);

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
    book_and_settle(&mut sc, 18_446_744_073_709_551_615, 0, BIRTH_MS + WEEK_MS);

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
    book_and_settle(&mut sc, 4_000, 0, BIRTH_MS + WEEK_MS);

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
    book_and_settle(&mut sc, 1, 2, BIRTH_MS + WEEK_MS);

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
    book_and_settle(&mut sc, 0, 1, BIRTH_MS + WEEK_MS);

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
    book_and_settle(&mut sc, 0, 1, BIRTH_MS + WEEK_MS);

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
    let e = WEEK_MS;

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
    let e = WEEK_MS;
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

// ===========================================================================================
// THE CAP SPLIT — MasterCap employs, LedgerCap keeps the books, and neither is the other
// ===========================================================================================
//
// The negative half of this separation is enforced by the TYPE SYSTEM, not by an abort, and that
// is the stronger of the two guarantees. There is no test below in which a `MasterCap` is passed
// to `book_earned`, `book_burned` or `settle_epoch`, and none in which a `LedgerCap` is passed to
// `mint`, `set_allowance`, `set_scope`, `set_outward`, `repin_mandate`, `override_tier`,
// `issue_adopter_credential`, `issue_ledger_cap` or `retire` — because such a test would not
// compile, and a test that cannot be written is a guarantee that cannot be missed. The compiler
// runs it on every build. What IS testable at runtime, and is tested here, is the custody half:
// that an address given bookkeeping authority holds bookkeeping authority and nothing else.

/// The bookkeeper's address holds a `LedgerCap` and NO `MasterCap`. This is the runtime half of
/// the separation: a leaked bookkeeping key cannot reach for the employer's authority, because
/// the employer's authority is not at that address to take.
#[test]
fun the_bookkeepers_address_holds_no_employers_authority() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        soul::issue_ledger_cap(&cap, BOB, sc.ctx());
        sc.return_to_sender(cap);
    };
    sc.next_tx(BOB);
    {
        assert!(ts::has_most_recent_for_sender<LedgerCap>(&sc), 0);
        // The whole point of the split: nothing to take.
        assert!(!ts::has_most_recent_for_sender<MasterCap>(&sc), 1);
    };
    sc.end();
}

/// The employer's address, symmetrically, is not left without books — `init` issues one of each
/// so a single-operator deployment works before any cap is delegated.
#[test]
fun birth_issues_one_of_each_cap_to_the_publisher() {
    let mut sc = setup();
    sc.next_tx(MASTER);
    {
        assert!(ts::has_most_recent_for_sender<MasterCap>(&sc), 0);
        assert!(ts::has_most_recent_for_sender<LedgerCap>(&sc), 1);
    };
    sc.end();
}

/// A delegated `LedgerCap` can do the bookkeeper's whole job — book both sides and close the
/// epoch — from an address that has never held a `MasterCap`.
#[test]
fun a_delegated_ledger_cap_can_book_and_settle_on_its_own() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        soul::issue_ledger_cap(&cap, BOB, sc.ctx());
        sc.return_to_sender(cap);
    };
    sc.next_tx(BOB);
    {
        let led = sc.take_from_sender<LedgerCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_earned(&led, &mut s, 400);
        soul::book_burned(&led, &mut s, 100);
        assert!(soul::epoch_earned(&s) == 400, 0);
        assert!(soul::epoch_burned(&s) == 100, 1);
        ts::return_shared(s);
        sc.return_to_sender(led);
    };
    sc.next_epoch(BOB);
    {
        let led = sc.take_from_sender<LedgerCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = sc.take_shared<EmployeeSoul>();
        let clock = new_clock(&mut sc, BIRTH_MS + WEEK_MS);
        soul::settle_epoch(&led, &mut reg, &mut s, DEEP_PURSE, true, &clock, sc.ctx());
        // The epoch rolled under a cap that cannot mint an employee.
        assert!(soul::epoch_index(&s) == 1, 0);
        assert!(soul::state(&s) == soul::state_solvent(), 1);
        clock::destroy_for_testing(clock);
        ts::return_shared(s);
        ts::return_shared(reg);
        sc.return_to_sender(led);
    };
    sc.end();
}

/// Issuing bookkeeping authority does not give it away: the employer keeps its own.
#[test]
fun issuing_a_ledger_cap_does_not_cost_the_employer_its_own() {
    let mut sc = setup();
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        soul::issue_ledger_cap(&cap, BOB, sc.ctx());
        sc.return_to_sender(cap);
    };
    sc.next_tx(MASTER);
    {
        assert!(ts::has_most_recent_for_sender<MasterCap>(&sc), 0);
        assert!(ts::has_most_recent_for_sender<LedgerCap>(&sc), 1);
    };
    sc.end();
}

// ===========================================================================================
// THE EPOCH BASIS — the chain's epoch counter, never the clock
// ===========================================================================================

/// `epoch_opened_at` tracks the CHAIN epoch and moves only when a settlement rolls the period.
#[test]
fun the_epoch_boundary_is_the_chains_epoch_and_not_the_clock() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::epoch_opened_at(&s) == 0, 0);
        assert!(soul::epoch_index(&s) == 0, 1);
        ts::return_shared(s);
    };
    book_and_settle(&mut sc, 100, 50, BIRTH_MS + WEEK_MS);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        // One chain epoch turned, so the soul's period opened in epoch 1.
        assert!(soul::epoch_opened_at(&s) == 1, 2);
        assert!(soul::epoch_index(&s) == 1, 3);
        // The clock reading is kept for readers, and is NOT what let the settlement through.
        assert!(soul::epoch_started_ms(&s) == BIRTH_MS + WEEK_MS, 4);
        ts::return_shared(s);
    };
    sc.end();
}

/// The epoch cannot be settled twice inside one chain epoch. A second call in the same epoch is
/// refused by the same assert that refuses an early one, which is what makes `settle_epoch`
/// idempotent within an epoch rather than merely unlikely to be called twice.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EEpochNotOver)]
fun an_epoch_cannot_be_settled_twice_inside_one_chain_epoch() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle(&mut sc, 100, 50, BIRTH_MS + WEEK_MS);
    // No next_epoch here: the same chain epoch that just settled.
    book_and_settle_in_the_same_epoch(&mut sc, 100, 50, BIRTH_MS + 2 * WEEK_MS);
    sc.end();
}

/// A settlement is not resettable by choosing an epoch number: the caller supplies no epoch at
/// all. The only epoch this module reads is `ctx.epoch()`, which the validators advance, so a
/// caller with a `LedgerCap` and any clock it likes still cannot roll two periods in one epoch.
#[test]
fun two_chain_epochs_settle_two_periods_and_no_more() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle(&mut sc, 100, 50, BIRTH_MS + WEEK_MS);
    book_and_settle(&mut sc, 100, 50, BIRTH_MS + 2 * WEEK_MS);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::epoch_index(&s) == 2, 0);
        assert!(soul::epoch_opened_at(&s) == 2, 1);
        ts::return_shared(s);
    };
    sc.end();
}

// ===========================================================================================
// ADOPTION — a human offers, the agent chooses
// ===========================================================================================

/// Hire `who` under a rule the test chooses, so the operator cap and the revocation tolerance
/// can be exercised at their own boundaries rather than only at the launch numbers.
fun hire_under(sc: &mut Scenario, who: address, allowance: u64, rule: soul::AdoptionRule) {
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let clock = new_clock(sc, BIRTH_MS);
        soul::mint(
            &cap, &mut reg, who, b"engineering".to_string(),
            digest_a(), allowance, b"engineering/*", rule, &clock, sc.ctx(),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
}

fun issue_cred(sc: &mut Scenario, to: address, opened_epoch: u64, min_age: u64) {
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        soul::issue_adopter_credential(&cap, &mut reg, to, opened_epoch, min_age, sc.ctx());
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };
}

/// `launch_rule()`'s account-age minimum, in epochs. Restated here so the helper below and the
/// rule it serves cannot drift apart silently.
const LAUNCH_MIN_AGE: u64 = 7;

/// Turn the chain `n` epochs.
fun advance_epochs(sc: &mut Scenario, n: u64) {
    let mut i = 0;
    while (i < n) {
        sc.next_epoch(MASTER);
        i = i + 1;
    };
}

/// Credential `to` so that they can legally OFFER on a soul born under `launch_rule()`.
///
/// This helper is Security finding A2 in the test suite. Every call site below used to read
/// `issue_cred(sc, BOB, 0, 0)` — an account opened at epoch 0, credentialled against a minimum of
/// ZERO — and then offer at epoch 0 on a soul whose rule demanded SEVEN. It passed, because
/// `offer` compared nothing; the mismatch between the number at issuance and the number on the
/// soul is exactly what made the field unenforced, and the suite was carrying the same mismatch.
///
/// So: turn the chain seven epochs, then issue the credential against the launch rule's own
/// minimum. The account is genuinely old enough now, at both ends.
fun credential_for_launch_rule(sc: &mut Scenario, to: address) {
    advance_epochs(sc, LAUNCH_MIN_AGE);
    issue_cred(sc, to, 0, LAUNCH_MIN_AGE);
}

fun soul_id_of(sc: &mut Scenario, who: address): ID {
    sc.next_tx(MASTER);
    let reg = sc.take_shared<SoulRegistry>();
    let id = soul::soul_of(&reg, who);
    ts::return_shared(reg);
    id
}

/// `who` offers to answer for the soul at `sid`, and the new offer's id is returned.
fun offer_on(sc: &mut Scenario, who: address, sid: ID, share: u16, threshold: u64): ID {
    sc.next_tx(who);
    {
        let cred = sc.take_from_sender<AdopterCredential>();
        let reg = sc.take_shared<SoulRegistry>();
        let s = ts::take_shared_by_id<EmployeeSoul>(sc, sid);
        soul::offer(&reg, &cred, &s, share, threshold, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
        sc.return_to_sender(cred);
    };
    sc.next_tx(who);
    ts::most_recent_id_shared<AdoptionOffer>().extract()
}

/// The agent at `agent` consumes the offer at `oid` against its own soul at `sid`.
fun adopt_offer(sc: &mut Scenario, agent: address, sid: ID, oid: ID) {
    sc.next_tx(agent);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(sc, sid);
        let o = ts::take_shared_by_id<AdoptionOffer>(sc, oid);
        soul::adopt(&mut reg, &mut s, o, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
}

/// The whole ceremony, at the launch numbers: ALICE hired, BOB credentialled, BOB offers 10 % and
/// a 10-unit threshold, ALICE accepts.
fun hire_and_adopt(sc: &mut Scenario): ID {
    hire(sc, ALICE, 1_000);
    credential_for_launch_rule(sc, BOB);
    let sid = soul_id_of(sc, ALICE);
    let oid = offer_on(sc, BOB, sid, 1_000, 10);
    adopt_offer(sc, ALICE, sid, oid);
    sid
}

// --- the credential ---------------------------------------------------------------------

/// PASSES the age rule and records the numbers it was checked against.
#[test]
fun a_credential_records_the_age_it_was_issued_against() {
    let mut sc = setup();
    sc.next_epoch(MASTER);
    sc.next_epoch(MASTER);
    // Now at chain epoch 2; an account opened at epoch 0 with a 2-epoch minimum is old enough.
    issue_cred(&mut sc, BOB, 0, 2);
    sc.next_tx(BOB);
    {
        let cred = sc.take_from_sender<AdopterCredential>();
        assert!(soul::credential_holder(&cred) == BOB, 0);
        assert!(soul::credential_account_opened_epoch(&cred) == 0, 1);
        assert!(soul::credential_issued_at_epoch(&cred) == 2, 2);
        sc.return_to_sender(cred);
    };
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        assert!(soul::is_credentialled(&reg, BOB), 3);
        assert!(!soul::is_credentialled(&reg, CAROL), 4);
        ts::return_shared(reg);
    };
    sc.end();
}

/// PASSES the age rule at its exact boundary: opened at 0, minimum 2, current epoch 2.
#[test]
fun an_account_exactly_old_enough_is_credentialled() {
    let mut sc = setup();
    sc.next_epoch(MASTER);
    sc.next_epoch(MASTER);
    issue_cred(&mut sc, BOB, 0, 2);
    sc.end();
}

/// TRIPS EAccountTooYoung — one epoch short.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAccountTooYoung)]
fun an_account_one_epoch_too_young_is_refused_a_credential() {
    let mut sc = setup();
    sc.next_epoch(MASTER);
    sc.next_epoch(MASTER);
    issue_cred(&mut sc, BOB, 0, 3);
    sc.end();
}

/// TRIPS EAccountTooYoung with a `min_age` chosen to wrap a u64 sum. In u64 the addition would
/// overflow and abort arithmetically, or worse wrap to a small number and let a young account
/// through; the check is done in u128 so it refuses cleanly with the code that means what it says.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAccountTooYoung)]
fun an_age_rule_that_would_overflow_still_refuses_with_the_age_code() {
    let mut sc = setup();
    issue_cred(&mut sc, BOB, 18_446_744_073_709_551_615, 18_446_744_073_709_551_615);
    sc.end();
}

/// TRIPS EAlreadyCredentialled — one per address, for ever.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAlreadyCredentialled)]
fun an_address_cannot_be_credentialled_twice() {
    let mut sc = setup();
    issue_cred(&mut sc, BOB, 0, 0);
    issue_cred(&mut sc, BOB, 0, 0);
    sc.end();
}

// --- the offer --------------------------------------------------------------------------

/// PASSES every assert in `offer`, and shows that making one writes NOTHING on the soul.
#[test]
fun an_offer_changes_no_field_on_the_soul() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.next_tx(MASTER);
    {
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(!soul::is_adopted(&s), 0);
        assert!(soul::operator_share_bps(&s) == 0, 1);
        assert!(soul::operator_threshold(&s) == 0, 2);
        assert!(soul::adoptions(&s) == 0, 3);
        assert!(!soul::is_paused(&s), 4);
        ts::return_shared(s);
        let o = ts::take_shared_by_id<AdoptionOffer>(&sc, oid);
        assert!(soul::offer_soul(&o) == sid, 5);
        assert!(soul::offer_offeror(&o) == BOB, 6);
        assert!(soul::offer_share_bps(&o) == 1_000, 7);
        assert!(soul::offer_threshold(&o) == 10, 8);
        ts::return_shared(o);
    };
    sc.end();
}

/// TRIPS ECredentialNotOwner — a borrowed credential is not the holder's.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ECredentialNotOwner)]
fun a_credential_cannot_be_used_by_anyone_but_its_holder() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    // CAROL sends the transaction while BOB's credential is passed by reference.
    sc.next_tx(BOB);
    let cred = sc.take_from_sender<AdopterCredential>();
    sc.next_tx(CAROL);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::offer(&reg, &cred, &s, 1_000, 10, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    ts::return_to_address(BOB, cred);
    sc.end();
}

/// TRIPS ERetired — nobody offers to answer for a retired soul.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_be_offered_for() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    retire_latest(&mut sc, 5_000);
    offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.end();
}

/// TRIPS EAlreadyAdopted — an adopted soul takes no further offers.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAlreadyAdopted)]
fun an_adopted_soul_cannot_be_offered_for_again() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    credential_for_launch_rule(&mut sc, CAROL);
    offer_on(&mut sc, CAROL, sid, 500, 10);
    sc.end();
}

/// TRIPS EBadShareBps — 20 % is the ceiling and 20.01 % is refused, not clamped.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadShareBps)]
fun a_share_above_the_ceiling_is_refused_not_clamped() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    offer_on(&mut sc, BOB, sid, soul::max_operator_share_bps() + 1, 10);
    sc.end();
}

/// PASSES the share ceiling at its exact boundary.
#[test]
fun a_share_exactly_at_the_ceiling_is_accepted() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, soul::max_operator_share_bps(), 10);
    adopt_offer(&mut sc, ALICE, sid, oid);
    sc.next_tx(MASTER);
    {
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::operator_share_bps(&s) == 2_000, 0);
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS EOperatorCapReached at the OFFER, with a rule of one agent per operator.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EOperatorCapReached)]
fun an_operator_at_its_cap_cannot_offer_again() {
    let mut sc = setup();
    let one = soul::new_adoption_rule(0, 1, 0, 0);
    hire_under(&mut sc, ALICE, 1_000, one);
    hire_under(&mut sc, CAROL, 1_000, one);
    issue_cred(&mut sc, BOB, 0, 0);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);
    let oid_a = offer_on(&mut sc, BOB, sid_a, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid_a, oid_a);
    // BOB now answers for one soul, and the rule allows one.
    offer_on(&mut sc, BOB, sid_c, 1_000, 10);
    sc.end();
}

/// TRIPS ERevokedBefore — the launch rule tolerates no renunciations, and the memory never clears.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERevokedBefore)]
fun an_operator_who_walked_away_once_cannot_offer_under_a_zero_tolerance_rule() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    hire(&mut sc, CAROL, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);
    let oid_a = offer_on(&mut sc, BOB, sid_a, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid_a, oid_a);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid_a);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    offer_on(&mut sc, BOB, sid_c, 1_000, 10);
    sc.end();
}

/// PASSES the revocation rule at its boundary: a rule that tolerates one renunciation accepts an
/// operator who has exactly one. Without this the check could tighten to `>=` unnoticed.
#[test]
fun a_rule_that_tolerates_one_renunciation_accepts_an_operator_who_has_one() {
    let mut sc = setup();
    let tolerant = soul::new_adoption_rule(0, 3, 1, 0);
    hire_under(&mut sc, ALICE, 1_000, tolerant);
    hire_under(&mut sc, CAROL, 1_000, tolerant);
    issue_cred(&mut sc, BOB, 0, 0);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);
    let oid_a = offer_on(&mut sc, BOB, sid_a, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid_a, oid_a);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid_a);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    let oid_c = offer_on(&mut sc, BOB, sid_c, 1_000, 10);
    adopt_offer(&mut sc, CAROL, sid_c, oid_c);
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        assert!(soul::renunciations_of(&reg, BOB) == 1, 0);
        assert!(soul::operator_count_of(&reg, BOB) == 1, 1);
        ts::return_shared(reg);
    };
    sc.end();
}

// --- withdrawal -------------------------------------------------------------------------

/// PASSES `withdraw_offer`, and the soul is untouched by an offer that came and went.
#[test]
fun an_offeror_can_take_an_offer_back() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.next_tx(BOB);
    {
        let o = ts::take_shared_by_id<AdoptionOffer>(&sc, oid);
        soul::withdraw_offer(o, sc.ctx());
    };
    sc.next_tx(MASTER);
    {
        // The offer object is gone from the world, not merely unreferenced.
        assert!(ts::most_recent_id_shared<AdoptionOffer>().is_none(), 0);
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(!soul::is_adopted(&s), 1);
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS ENotTheOfferor.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotTheOfferor)]
fun a_stranger_cannot_withdraw_someone_elses_offer() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.next_tx(CAROL);
    {
        let o = ts::take_shared_by_id<AdoptionOffer>(&sc, oid);
        soul::withdraw_offer(o, sc.ctx());
    };
    sc.end();
}

// --- adoption ---------------------------------------------------------------------------

/// PASSES every assert in `adopt` and checks every field it writes, plus both registry counters.
#[test]
fun the_agent_chooses_and_the_offer_is_consumed() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(MASTER);
    {
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::is_adopted(&s), 0);
        assert!(soul::operator(&s).borrow() == BOB, 1);
        assert!(soul::operator_share_bps(&s) == 1_000, 2);
        assert!(soul::operator_threshold(&s) == 10, 3);
        assert!(soul::adoptions(&s) == 1, 4);
        // The epoch the ceremony actually ran in: `credential_for_launch_rule` turns the chain
        // seven epochs so the account is genuinely old enough (A2), and the offer and the
        // adoption both happen in that epoch.
        assert!(soul::adopted_at_epoch(&s) == LAUNCH_MIN_AGE, 5);
        // Adoption is not a brake and does not apply one.
        assert!(!soul::is_paused(&s), 6);
        ts::return_shared(s);
        let reg = sc.take_shared<SoulRegistry>();
        assert!(soul::operator_count_of(&reg, BOB) == 1, 7);
        assert!(soul::adopted_count(&reg) == 1, 8);
        assert!(soul::renunciations_of(&reg, BOB) == 0, 9);
        ts::return_shared(reg);
    };
    sc.end();
}

/// TRIPS ENotThisAgent — an offer is addressed to a soul, and only that soul's agent may take it.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotThisAgent)]
fun nobody_but_the_agent_may_accept_an_offer_for_its_soul() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    // Not even the offeror, and not the employer.
    adopt_offer(&mut sc, BOB, sid, oid);
    sc.end();
}

/// TRIPS EOfferForAnotherSoul — an offer made for CAROL's soul cannot be spent on ALICE's.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EOfferForAnotherSoul)]
fun an_offer_for_another_soul_cannot_be_consumed() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    hire(&mut sc, CAROL, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);
    let oid_c = offer_on(&mut sc, BOB, sid_c, 1_000, 10);
    // ALICE reaches for the offer that names CAROL's soul.
    adopt_offer(&mut sc, ALICE, sid_a, oid_c);
    sc.end();
}

/// PASSES the offer's time-to-live at its exact boundary: an offer made in epoch 0 is still good
/// in epoch 1, because the rule is `<= offered_at + 1`.
#[test]
fun an_offer_is_still_good_one_epoch_later() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.next_epoch(ALICE);
    adopt_offer(&mut sc, ALICE, sid, oid);
    sc.next_tx(MASTER);
    {
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::is_adopted(&s), 0);
        // Offered in the epoch the credential was issued in, consumed one epoch later.
        assert!(soul::adopted_at_epoch(&s) == LAUNCH_MIN_AGE + 1, 1);
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS EOfferExpired — one epoch past the boundary.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EOfferExpired)]
fun an_offer_two_epochs_old_is_expired() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.next_epoch(ALICE);
    sc.next_epoch(ALICE);
    adopt_offer(&mut sc, ALICE, sid, oid);
    sc.end();
}

/// TRIPS ERetired — an offer that outlived the soul it named.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun an_offer_cannot_be_consumed_by_a_retired_soul() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    credential_for_launch_rule(&mut sc, BOB);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    retire_latest(&mut sc, 5_000);
    adopt_offer(&mut sc, ALICE, sid, oid);
    sc.end();
}

/// TRIPS EAlreadyAdopted at `adopt` — a second offer that existed BEFORE the first was consumed
/// cannot be spent afterwards. This is the double-adopt race of the storm's S11, in one test.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAlreadyAdopted)]
fun two_standing_offers_cannot_both_be_adopted() {
    let mut sc = setup();
    let three = soul::new_adoption_rule(0, 3, 0, 0);
    hire_under(&mut sc, ALICE, 1_000, three);
    issue_cred(&mut sc, BOB, 0, 0);
    issue_cred(&mut sc, CAROL, 0, 0);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid_b = offer_on(&mut sc, BOB, sid, 1_000, 10);
    let oid_c = offer_on(&mut sc, CAROL, sid, 500, 10);
    adopt_offer(&mut sc, ALICE, sid, oid_b);
    adopt_offer(&mut sc, ALICE, sid, oid_c);
    sc.end();
}

/// TRIPS EOperatorCapReached at `adopt`, not at `offer`. Both offers are made while BOB is under
/// the cap; the second is consumed after the first has seated him. The cap is re-checked at
/// consumption precisely because an offer sits on chain between the two moments.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EOperatorCapReached)]
fun the_operator_cap_is_rechecked_when_an_offer_is_consumed() {
    let mut sc = setup();
    let one = soul::new_adoption_rule(0, 1, 0, 0);
    hire_under(&mut sc, ALICE, 1_000, one);
    hire_under(&mut sc, CAROL, 1_000, one);
    issue_cred(&mut sc, BOB, 0, 0);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);
    // Both offers made while BOB answers for nobody: both pass `offer`'s cap check.
    let oid_a = offer_on(&mut sc, BOB, sid_a, 1_000, 10);
    let oid_c = offer_on(&mut sc, BOB, sid_c, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid_a, oid_a);
    adopt_offer(&mut sc, CAROL, sid_c, oid_c);
    sc.end();
}

// --- renunciation -----------------------------------------------------------------------

/// PASSES `renounce`: born-free again, PAUSED, the count down and the memory up for ever.
#[test]
fun renouncing_returns_the_agent_to_born_free_and_paused() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        assert!(!soul::is_adopted(&s), 0);
        assert!(soul::operator_share_bps(&s) == 0, 1);
        assert!(soul::operator_threshold(&s) == 0, 2);
        // The brake goes on: an agent whose human just left does not keep spending.
        assert!(soul::is_paused(&s), 3);
        // The record of the adoption that happened is NOT erased.
        assert!(soul::adoptions(&s) == 1, 4);
        assert!(soul::operator_count_of(&reg, BOB) == 0, 5);
        assert!(soul::renunciations_of(&reg, BOB) == 1, 6);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

/// A re-adoption is a new record, never an edit: `adoptions` counts two.
#[test]
fun a_re_adoption_is_a_second_record_and_not_an_edit() {
    let mut sc = setup();
    let tolerant = soul::new_adoption_rule(0, 3, 5, 0);
    hire_under(&mut sc, ALICE, 1_000, tolerant);
    issue_cred(&mut sc, BOB, 0, 0);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid1 = offer_on(&mut sc, BOB, sid, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid, oid1);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    let oid2 = offer_on(&mut sc, BOB, sid, 500, 20);
    adopt_offer(&mut sc, ALICE, sid, oid2);
    sc.next_tx(MASTER);
    {
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::adoptions(&s) == 2, 0);
        assert!(soul::operator_share_bps(&s) == 500, 1);
        assert!(soul::operator_threshold(&s) == 20, 2);
        ts::return_shared(s);
        let reg = sc.take_shared<SoulRegistry>();
        // The renunciation memory survives the re-adoption. It never decreases.
        assert!(soul::renunciations_of(&reg, BOB) == 1, 3);
        assert!(soul::adopted_count(&reg) == 2, 4);
        ts::return_shared(reg);
    };
    sc.end();
}

/// TRIPS ENotOperator — a stranger cannot resign a job that is not theirs.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotOperator)]
fun a_stranger_cannot_renounce_another_operators_adoption() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(CAROL);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

/// TRIPS ENotAdopted — there is nothing to walk away from.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotAdopted)]
fun an_unadopted_soul_cannot_be_renounced() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    let sid = soul_id_of(&mut sc, ALICE);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

// --- the brake --------------------------------------------------------------------------

/// PASSES `pause` and `unpause`, and shows the brake stopping a spend the ceiling would allow.
#[test]
fun the_operators_brake_stops_a_spend_the_allowance_would_permit() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::pause(&mut s, sc.ctx());
        assert!(soul::is_paused(&s), 0);
        ts::return_shared(s);
    };
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::unpause(&mut s, sc.ctx());
        assert!(!soul::is_paused(&s), 1);
        ts::return_shared(s);
    };
    // Unpaused, the agent spends as before: the brake changed no ceiling.
    sc.next_tx(ALICE);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::record_spend(&mut s, 1_000, sc.ctx());
        assert!(soul::epoch_spent(&s) == 1_000, 2);
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS EPaused — the brake refuses a spend well inside the allowance.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EPaused)]
fun a_paused_agent_cannot_spend() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::pause(&mut s, sc.ctx());
        ts::return_shared(s);
    };
    sc.next_tx(ALICE);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::record_spend(&mut s, 1, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS ENotOperator on the brake.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotOperator)]
fun a_stranger_cannot_pause_an_agent() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(CAROL);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::pause(&mut s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS ENotAdopted on the brake — a born-free soul has no operator to pull it.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotAdopted)]
fun an_unadopted_soul_has_no_operator_brake() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    let sid = soul_id_of(&mut sc, ALICE);
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::pause(&mut s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// The employer holds its own brake, and it works on a soul nobody has adopted — the case the
/// operator's brake cannot reach.
#[test]
fun the_employer_can_brake_an_unadopted_soul() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    let sid = soul_id_of(&mut sc, ALICE);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::master_set_paused(&cap, &mut s, true, sc.ctx());
        assert!(soul::is_paused(&s), 0);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS ERetired on the employer's brake.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_be_paused() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    let sid = soul_id_of(&mut sc, ALICE);
    retire_latest(&mut sc, 5_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::master_set_paused(&cap, &mut s, true, sc.ctx());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS ERetired on the OPERATOR's brake — the sixteenth and last call site of `assert_live`.
///
/// The employer's brake is `master_set_paused` and has its own test above. This is the other one,
/// `pause`, which reaches `assert_live` through `set_paused_by_operator`, and it earns a test of
/// its own because the ORDER inside that function is what it proves: `assert_live` runs BEFORE the
/// operator check, so a retired soul answers `ERetired` and not `ENotAdopted` even though
/// retirement has already cleared the seat (A1). Both answers would be true; only one of them is
/// the reason, and a reader of the abort code is entitled to the reason.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_be_braked_by_the_operator_who_answered_for_it() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    retire_latest(&mut sc, 5_000);
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::pause(&mut s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

// --- the request ------------------------------------------------------------------------

/// PASSES `request_retirement`: the operator asks, the flag stands, and the soul keeps working
/// until the MasterCap performs. Asking is not doing.
#[test]
fun the_operator_may_ask_for_retirement_and_asking_does_not_perform_it() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(!soul::retirement_requested(&s), 0);
        soul::request_retirement(&mut s, sc.ctx());
        assert!(soul::retirement_requested(&s), 1);
        // Still alive, still solvent, still working.
        assert!(!soul::is_retired(&s), 2);
        assert!(soul::state(&s) == soul::state_solvent(), 3);
        ts::return_shared(s);
    };
    sc.next_tx(ALICE);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::record_spend(&mut s, 1, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS ENotOperator on the request.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotOperator)]
fun a_stranger_cannot_request_a_retirement() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(CAROL);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::request_retirement(&mut s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS ENotAdopted on the request.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotAdopted)]
fun an_unadopted_soul_has_nobody_to_request_its_retirement() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    let sid = soul_id_of(&mut sc, ALICE);
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::request_retirement(&mut s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// TRIPS ERetired on the request.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_soul_cannot_have_its_retirement_requested() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    retire_latest(&mut sc, 5_000);
    sc.next_tx(BOB);
    {
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::request_retirement(&mut s, sc.ctx());
        ts::return_shared(s);
    };
    sc.end();
}

/// The adoption rule a soul was born under is readable for ever, so the terms an operator was
/// accepted on can be audited after the fact.
#[test]
fun the_rule_a_soul_was_born_under_stays_readable() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    let sid = soul_id_of(&mut sc, ALICE);
    sc.next_tx(MASTER);
    {
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        let r = soul::adoption_rule(&s);
        assert!(soul::rule_min_account_age_epochs(&r) == 7, 0);
        assert!(soul::rule_max_agents_per_operator(&r) == 3, 1);
        assert!(soul::rule_max_renunciations(&r) == 0, 2);
        assert!(soul::rule_min_backing(&r) == 0, 3);
        ts::return_shared(s);
    };
    sc.end();
}

// ===========================================================================================
// THE TIER — the second axis: not "is it earning" but "is there anything behind it"
// ===========================================================================================
//
// Every soul below is hired at an allowance of 1_000, so `cover` is 1_000 and ten epochs of
// cover is 10_000. The numbers are chosen to sit exactly on the boundaries.

fun tier_of(sc: &mut Scenario): u8 {
    sc.next_tx(MASTER);
    let s = sc.take_shared<EmployeeSoul>();
    let t = soul::tier(&s);
    ts::return_shared(s);
    t
}

/// A soul is born NORMAL: no settled epoch is no evidence against it.
#[test]
fun a_soul_is_born_normal_with_both_streaks_at_zero() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::tier(&s) == soul::tier_normal(), 0);
        assert!(soul::critical_epochs(&s) == 0, 1);
        assert!(soul::normal_epochs(&s) == 0, 2);
        ts::return_shared(s);
    };
    sc.end();
}

/// TIER_NORMAL at its exact lower boundary: the balance covers ten epochs to the unit, and the
/// net is non-negative.
#[test]
fun ten_epochs_of_cover_and_a_flat_net_is_exactly_normal() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 10_000, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::tier(&s) == soul::tier_normal(), 0);
        assert!(soul::normal_epochs(&s) == 1, 1);
        assert!(soul::critical_epochs(&s) == 0, 2);
        ts::return_shared(s);
    };
    sc.end();
}

/// TIER_LOW: one unit short of ten epochs of cover, net fine.
#[test]
fun one_unit_short_of_ten_epochs_of_cover_is_low() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 9_999, true);
    assert!(tier_of(&mut sc) == soul::tier_low(), 0);
    sc.end();
}

/// TIER_LOW at its exact lower boundary: the balance covers exactly one epoch. One unit less is
/// critical, and this test is what stops the comparison drifting to `<=`.
#[test]
fun exactly_one_epoch_of_cover_is_low_and_not_critical() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 1_000, true);
    assert!(tier_of(&mut sc) == soul::tier_low(), 0);
    sc.end();
}

/// TIER_CRITICAL: one unit below a single epoch of cover.
#[test]
fun one_unit_below_a_single_epoch_of_cover_is_critical() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 999, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::tier(&s) == soul::tier_critical(), 0);
        assert!(soul::critical_epochs(&s) == 1, 1);
        assert!(soul::normal_epochs(&s) == 0, 2);
        // Critical is about the purse, not about the work: this soul is SOLVENT and critical.
        assert!(soul::state(&s) == soul::state_solvent(), 3);
        ts::return_shared(s);
    };
    sc.end();
}

/// STORM S14 — the `and` in the normal rule, tested AS AN `and`.
///
/// The balance is a hundred epochs deep, so the first half of the rule passes by a mile. The net
/// is negative, so the second half fails. If the rule were an `or`, or if the net clause were
/// dropped, this reads NORMAL. It must read LOW.
#[test]
fun a_deep_purse_with_a_negative_net_is_low_because_the_rule_is_an_and() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 100_000, false);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::tier(&s) == soul::tier_low(), 0);
        assert!(soul::normal_epochs(&s) == 0, 1);
        ts::return_shared(s);
    };
    sc.end();
}

/// The other half of the same `and`: a non-negative net with a shallow purse is also LOW. Between
/// this test and the one above, neither clause can be deleted without a failure.
#[test]
fun a_flat_net_with_a_shallow_purse_is_low_because_the_rule_is_an_and() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 1_500, true);
    assert!(tier_of(&mut sc) == soul::tier_low(), 0);
    sc.end();
}

/// The cover is the allowance the epoch RAN ON, not the one the settlement leaves behind.
///
/// Hired at 100_000_000 — above the survival minimum, so a shortfall really does halve it, to
/// 50_000_000. The purse is 500_000_000. Against the OLD cover of 100_000_000 that is five epochs
/// deep: LOW. Against the NEW cover of 50_000_000 it is exactly ten epochs deep: NORMAL. Failing
/// must not promote it. If this test ever reads NORMAL, the tier is being computed after the
/// metabolism and a starving soul is being rewarded for starving.
#[test]
fun a_shortfall_cannot_buy_a_better_tier_by_shrinking_the_cover() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 100_000_000);
    book_and_settle_with_purse(&mut sc, 0, 1, BIRTH_MS + WEEK_MS, 500_000_000, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == 50_000_000, 0);
        assert!(soul::state(&s) == soul::state_starving(), 1);
        assert!(soul::tier(&s) == soul::tier_low(), 2);
        ts::return_shared(s);
    };
    sc.end();
}

/// A LOW epoch breaks the normal streak without counting as critical — the middle behaves like
/// the middle, or the two counters stop meaning "consecutive".
#[test]
fun a_low_epoch_breaks_both_streaks_and_starts_neither() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 100_000, true);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + 2 * WEEK_MS, 100_000, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::normal_epochs(&s) == 2, 0);
        ts::return_shared(s);
    };
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + 3 * WEEK_MS, 2_000, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::tier(&s) == soul::tier_low(), 1);
        assert!(soul::normal_epochs(&s) == 0, 2);
        assert!(soul::critical_epochs(&s) == 0, 3);
        ts::return_shared(s);
    };
    sc.end();
}

/// RETIREMENT PATH ONE — two consecutive critical epochs, with nobody deciding.
///
/// Note what this soul is doing while it dies: EARNING. It is solvent in both epochs. The tier is
/// a statement about the purse behind an agent, and an agent whose purse cannot cover one epoch
/// of its own allowance cannot act however well it is doing on paper.
#[test]
fun two_consecutive_critical_epochs_retire_a_solvent_soul() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 100, 50, BIRTH_MS + WEEK_MS, 0, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::critical_epochs(&s) == 1, 0);
        assert!(!soul::is_retired(&s), 1);
        ts::return_shared(s);
    };
    book_and_settle_with_purse(&mut sc, 100, 50, BIRTH_MS + 2 * WEEK_MS, 0, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::is_retired(&s), 2);
        assert!(soul::tier(&s) == soul::tier_retired(), 3);
        assert!(soul::state(&s) == soul::state_retired(), 4);
        assert!(soul::retired_at_ms(&s).is_some(), 5);
        // Nothing is deleted: the object and its whole history stand.
        assert!(soul::earned_total(&s) == 200, 6);
        ts::return_shared(s);
        let reg = sc.take_shared<SoulRegistry>();
        // Counted exactly once. Two retirement call sites would read 2 here.
        assert!(soul::retired_count(&reg) == 1, 7);
        assert!(!soul::works_here(&reg, ALICE), 8);
        ts::return_shared(reg);
    };
    sc.end();
}

/// RETIREMENT PATH TWO — the employer's hand, through the same internal function. The count is
/// one, which is what says the two paths share a call site rather than duplicating it.
#[test]
fun the_employers_retirement_goes_through_the_same_single_call_site() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    retire_latest(&mut sc, 5_000);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::is_retired(&s), 0);
        // The tier follows the state through the shared internal, and is not left stale at NORMAL.
        assert!(soul::tier(&s) == soul::tier_retired(), 1);
        ts::return_shared(s);
        let reg = sc.take_shared<SoulRegistry>();
        assert!(soul::retired_count(&reg) == 1, 2);
        ts::return_shared(reg);
    };
    sc.end();
}

/// One critical epoch, then a recovery, then another: NOT retired. The rule is two CONSECUTIVE.
#[test]
fun a_recovery_between_two_critical_epochs_saves_the_soul() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    book_and_settle_with_purse(&mut sc, 100, 50, BIRTH_MS + WEEK_MS, 0, true);
    book_and_settle_with_purse(&mut sc, 100, 50, BIRTH_MS + 2 * WEEK_MS, 100_000, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::critical_epochs(&s) == 0, 0);
        ts::return_shared(s);
    };
    book_and_settle_with_purse(&mut sc, 100, 50, BIRTH_MS + 3 * WEEK_MS, 0, true);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(!soul::is_retired(&s), 1);
        assert!(soul::critical_epochs(&s) == 1, 2);
        ts::return_shared(s);
    };
    sc.end();
}

/// The tier rule at the largest allowance the module will accept.
///
/// A NOTE ON THE u128, WRITTEN SO NOBODY LATER MISTAKES IT FOR TESTED: `cover * 10` is computed in
/// u128 in `settle_epoch`, and that widening CANNOT BE EXERCISED THROUGH THIS API TODAY. Overflow
/// needs a cover above u64::MAX / 10, about 1.8 * 10^18, and `mint` and `set_allowance` both
/// refuse anything above MAX_ALLOWANCE, 10^12 — six orders of magnitude short. The u128 is
/// defense against a future ceiling raise, not against a reachable input, and no test here can
/// honestly claim to trip it. What this test DOES pin is the arithmetic at the real ceiling: ten
/// epochs of the maximum allowance is 10^13, a purse of u64::MAX clears it, and the reading is
/// NORMAL rather than something wrapped.
#[test]
fun the_tier_arithmetic_holds_at_the_largest_allowance_the_module_accepts() {
    let mut sc = setup();
    hire(&mut sc, ALICE, soul::max_allowance());
    book_and_settle_with_purse(
        &mut sc, 10, 10, BIRTH_MS + WEEK_MS, 18_446_744_073_709_551_615, true,
    );
    assert!(tier_of(&mut sc) == soul::tier_normal(), 0);
    sc.end();
}

/// And the same ceiling on the other side of the boundary: one unit short of ten epochs of the
/// maximum allowance is LOW, which is the comparison actually doing work at that scale.
#[test]
fun one_unit_short_of_ten_epochs_at_the_largest_allowance_is_low() {
    let mut sc = setup();
    hire(&mut sc, ALICE, soul::max_allowance());
    book_and_settle_with_purse(
        &mut sc, 10, 10, BIRTH_MS + WEEK_MS, 10_000_000_000_000 - 1, true,
    );
    assert!(tier_of(&mut sc) == soul::tier_low(), 0);
    sc.end();
}

// --- the override -----------------------------------------------------------------------

/// PASSES `override_tier` in both legal directions: normal to low, low to critical.
#[test]
fun the_employer_can_move_a_tier_downward() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_low());
        assert!(soul::tier(&s) == soul::tier_low(), 0);
        soul::override_tier(&cap, &mut s, soul::tier_critical());
        assert!(soul::tier(&s) == soul::tier_critical(), 1);
        // An override is a statement about trust, not a settlement: it moves no counter, so it
        // can never retire a soul however often it is applied.
        assert!(soul::critical_epochs(&s) == 0, 2);
        assert!(!soul::is_retired(&s), 3);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS EBadTier — upward is the direction that is not allowed.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadTier)]
fun the_employer_cannot_move_a_tier_upward() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_critical());
        // Back up to low: richer than it is, and refused.
        soul::override_tier(&cap, &mut s, soul::tier_low());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS EBadTier — sideways is not downward either. `>` and not `>=`.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadTier)]
fun an_override_to_the_same_tier_is_refused() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_normal());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS EBadTier — retirement is not a tier this entry may reach. Retiring takes the registry
/// and releases the address; an override that could reach RETIRED would retire a soul without
/// ever touching the registry, leaving the headcount permanently wrong.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadTier)]
fun the_employer_cannot_retire_a_soul_by_overriding_its_tier() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_retired());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// TRIPS ERetired on the override.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERetired)]
fun a_retired_souls_tier_cannot_be_overridden() {
    let mut sc = setup();
    hire_then_retire(&mut sc);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_critical());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// An override stands until the next settlement, which recomputes from the supplied numbers. The
/// employer's distrust is a statement about one epoch, not a permanent demotion.
#[test]
fun an_override_stands_until_the_next_settlement_recomputes_it() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_critical());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    assert!(tier_of(&mut sc) == soul::tier_critical(), 0);
    book_and_settle_with_purse(&mut sc, 10, 10, BIRTH_MS + WEEK_MS, 100_000, true);
    assert!(tier_of(&mut sc) == soul::tier_normal(), 1);
    sc.end();
}

// ===========================================================================================
// THE SECURITY REVIEW OF 2026-09-04 — one test per finding, each naming the defect it closes
// ===========================================================================================
//
// Every test below reproduces a defect the read-only Security review found in this module, and
// every one of them PASSED — silently, and wrongly — before the fix beside it. They are gathered
// here rather than filed into the sections above so that a reviewer can read the finding and its
// evidence in one place; the trip tests for the new asserts are here too, and are named for the
// abort code they trip.

// --- B2: a banked offer defeated the renunciation rule -----------------------------------

/// B2, THE DEFECT ITSELF. The sequence Security published, step for step: offer on two souls
/// while the record is clean, take one, walk away from it, then consume the offer that was banked
/// before the walking away. `offer` read `renunciations` once, at the moment the offer was made;
/// `adopt` did not read it at all. Under `max_renunciations = 0` — the launch rule — that meant an
/// operator could bank as many offers as there are souls and spend them after any number of
/// renunciations, which is the whole rule defeated by ordering.
///
/// TRIPS the new `ERevokedBefore` inside `adopt`.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ERevokedBefore)]
fun a_banked_offer_cannot_outlive_the_record_that_made_it_acceptable() {
    let mut sc = setup();
    // Three seats and zero tolerance: the operator cap can never be what refuses this, so the
    // abort code the test asserts can only come from the renunciation rule.
    let zero_tolerance = soul::new_adoption_rule(0, 3, 0, 0);
    hire_under(&mut sc, ALICE, 1_000, zero_tolerance);
    hire_under(&mut sc, CAROL, 1_000, zero_tolerance);
    issue_cred(&mut sc, BOB, 0, 0);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);

    // Both offers made while BOB's record is clean. Both pass every check `offer` makes.
    let oid_a = offer_on(&mut sc, BOB, sid_a, 1_000, 10);
    let oid_c = offer_on(&mut sc, BOB, sid_c, 1_000, 10);

    adopt_offer(&mut sc, ALICE, sid_a, oid_a);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid_a);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        // The memory is written, and it is what the stale offer must now be read against.
        assert!(soul::renunciations_of(&reg, BOB) == 1, 0);
        assert!(soul::operator_count_of(&reg, BOB) == 0, 1);
        ts::return_shared(s);
        ts::return_shared(reg);
    };

    // The stale offer. This is the line that used to succeed.
    adopt_offer(&mut sc, CAROL, sid_c, oid_c);
    sc.end();
}

/// B2 AT ITS BOUNDARY, from the other side: a rule that tolerates one renunciation still accepts
/// a banked offer from an operator who has exactly one. The re-check must be the same comparison
/// `offer` makes — `<=`, not `<` — or the fix would quietly forbid what the rule allows.
#[test]
fun a_banked_offer_is_still_good_where_the_rule_tolerates_the_renunciation() {
    let mut sc = setup();
    let tolerant = soul::new_adoption_rule(0, 3, 1, 0);
    hire_under(&mut sc, ALICE, 1_000, tolerant);
    hire_under(&mut sc, CAROL, 1_000, tolerant);
    issue_cred(&mut sc, BOB, 0, 0);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);
    let oid_a = offer_on(&mut sc, BOB, sid_a, 1_000, 10);
    let oid_c = offer_on(&mut sc, BOB, sid_c, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid_a, oid_a);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid_a);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    adopt_offer(&mut sc, CAROL, sid_c, oid_c);
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid_c);
        assert!(soul::is_adopted(&s), 0);
        assert!(soul::renunciations_of(&reg, BOB) == 1, 1);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

// --- B3: a LedgerCap alone raised the ceiling to MAX_ALLOWANCE ----------------------------

/// B3, THE DEFECT ITSELF. A leaked bookkeeping key books an invented surplus and settles: before
/// the bound, `compute_settled_allowance` raised the allowance by a quarter of that surplus with
/// nothing but the headroom to stop it, so ONE settlement took 1_000 to 10^12 — a billion-fold
/// raise on a key the module's own comment said could "move no ceiling".
///
/// With `MAX_RAISE_FACTOR`, the same call lands on exactly 2_000.
#[test]
fun one_settlement_cannot_raise_an_allowance_past_double_it() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    // The largest surplus that can be booked at all.
    book_and_settle(&mut sc, 18_446_744_073_709_551_615, 0, BIRTH_MS + WEEK_MS);

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == 2_000, 0);
        assert!(soul::allowance_per_epoch(&s) <= 1_000 * soul::max_raise_factor(), 1);
        // The number this test exists to refuse.
        assert!(soul::allowance_per_epoch(&s) != soul::max_allowance(), 2);
        ts::return_shared(s);
    };
    sc.end();
}

/// The bound at its exact boundary from below: a surplus whose quarter is one unit short of the
/// allowance is NOT clamped, and lands one unit short of double. Without this the factor could
/// tighten to something smaller unnoticed.
#[test]
fun a_raise_one_unit_under_the_factor_is_not_clamped() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    // surplus / 4 == 999.
    book_and_settle(&mut sc, 3_996, 0, BIRTH_MS + WEEK_MS);

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == 1_999, 0);
        ts::return_shared(s);
    };
    sc.end();
}

/// And the boundary from above: a quarter-surplus of exactly the allowance lands exactly on
/// double, which is the largest raise the factor permits.
#[test]
fun a_raise_of_exactly_the_factor_lands_exactly_on_it() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    // surplus / 4 == 1_000.
    book_and_settle(&mut sc, 4_000, 0, BIRTH_MS + WEEK_MS);

    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == 2_000, 0);
        ts::return_shared(s);
    };
    sc.end();
}

/// The factor never lets a settlement past `MAX_ALLOWANCE` either: doubling from half the ceiling
/// would land exactly on it, and doubling from more than half is clamped by the headroom rather
/// than by the factor. Both clamps are exercised here, in that order.
#[test]
fun the_factor_and_the_ceiling_are_both_still_enforced_at_the_top() {
    let mut sc = setup();
    hire(&mut sc, ALICE, soul::max_allowance() / 2);
    book_and_settle(&mut sc, 18_446_744_073_709_551_615, 0, BIRTH_MS + WEEK_MS);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        // Doubled, and the double is the ceiling to the unit.
        assert!(soul::allowance_per_epoch(&s) == soul::max_allowance(), 0);
        ts::return_shared(s);
    };
    // A second settlement at the ceiling moves nothing: the headroom is zero.
    book_and_settle(&mut sc, 18_446_744_073_709_551_615, 0, BIRTH_MS + 2 * WEEK_MS);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == soul::max_allowance(), 1);
        ts::return_shared(s);
    };
    sc.end();
}

// --- A1: retirement left the operator's seat spent for ever -------------------------------

/// A1, THE DEFECT ITSELF. `retire_internal` cleared the state and the tier and released the
/// registry row, and left `operator`, the share, the threshold and `operator_count` exactly where
/// they were. A retired soul therefore read `is_adopted == true` for ever, and the human's quota
/// stayed spent on an object that can never act again.
#[test]
fun retirement_releases_the_operators_seat() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::is_adopted(&s), 0);
        assert!(soul::operator_count_of(&reg, BOB) == 1, 1);
        ts::return_shared(s);
        ts::return_shared(reg);
    };

    retire_latest(&mut sc, 5_000);

    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::is_retired(&s), 2);
        // The seat, released.
        assert!(!soul::is_adopted(&s), 3);
        assert!(soul::operator_share_bps(&s) == 0, 4);
        assert!(soul::operator_threshold(&s) == 0, 5);
        assert!(soul::operator_count_of(&reg, BOB) == 0, 6);
        // The human's record, UNTOUCHED. The chain retired the agent; the human did not walk away.
        assert!(soul::renunciations_of(&reg, BOB) == 0, 7);
        // And the adoption that happened is still on the object. Nothing is erased.
        assert!(soul::adoptions(&s) == 1, 8);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

/// A1, THE CONSEQUENCE THE FINDING NAMED. An operator whose agent the chain retired must be able
/// to answer for another one WITHOUT renouncing — because renouncing is what charges them a
/// renunciation, and a zero-tolerance rule then bars them for a decision that was not theirs.
///
/// The rule here allows exactly one agent per operator and tolerates no renunciations, so before
/// the fix this test could not pass by any route: the quota was still spent (`EOperatorCapReached`)
/// and the only way to free it wrote a renunciation (`ERevokedBefore`).
#[test]
fun an_operator_whose_agent_was_retired_may_answer_for_another_without_penalty() {
    let mut sc = setup();
    let one_seat = soul::new_adoption_rule(0, 1, 0, 0);
    hire_under(&mut sc, ALICE, 1_000, one_seat);
    hire_under(&mut sc, CAROL, 1_000, one_seat);
    issue_cred(&mut sc, BOB, 0, 0);
    let sid_a = soul_id_of(&mut sc, ALICE);
    let sid_c = soul_id_of(&mut sc, CAROL);
    let oid_a = offer_on(&mut sc, BOB, sid_a, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid_a, oid_a);

    // The employer retires ALICE's soul. BOB did nothing.
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid_a);
        let clock = new_clock(&mut sc, 5_000);
        soul::retire(&cap, &mut reg, &mut s, &clock);
        clock::destroy_for_testing(clock);
        ts::return_shared(s);
        ts::return_shared(reg);
        sc.return_to_sender(cap);
    };

    // Seat back, record clean: BOB offers and is adopted again, under the same strict rule.
    let oid_c = offer_on(&mut sc, BOB, sid_c, 1_000, 10);
    adopt_offer(&mut sc, CAROL, sid_c, oid_c);

    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid_c);
        assert!(soul::is_adopted(&s), 0);
        assert!(soul::operator(&s).borrow() == BOB, 1);
        assert!(soul::operator_count_of(&reg, BOB) == 1, 2);
        assert!(soul::renunciations_of(&reg, BOB) == 0, 3);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

/// A1 THROUGH THE OTHER RETIREMENT PATH. Both paths share `retire_internal`, so the seat must be
/// released by the automatic one too — two consecutive critical epochs inside `settle_epoch`.
#[test]
fun an_automatic_retirement_also_releases_the_seat() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    book_and_settle_with_purse(&mut sc, 100, 50, BIRTH_MS + WEEK_MS, 0, true);
    book_and_settle_with_purse(&mut sc, 100, 50, BIRTH_MS + 2 * WEEK_MS, 0, true);

    sc.next_tx(MASTER);
    {
        let reg = sc.take_shared<SoulRegistry>();
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::is_retired(&s), 0);
        assert!(!soul::is_adopted(&s), 1);
        assert!(soul::operator_count_of(&reg, BOB) == 0, 2);
        assert!(soul::renunciations_of(&reg, BOB) == 0, 3);
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

/// And the seat, once released by a retirement, cannot be released twice: `renounce` finds no
/// operator and says so. This is the documented consequence of A1 — `renounce` keeps its
/// deliberate omission of `assert_live`, and a retired soul simply has nobody to renounce.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::ENotAdopted)]
fun a_retired_souls_operator_has_nothing_left_to_renounce() {
    let mut sc = setup();
    let sid = hire_and_adopt(&mut sc);
    retire_latest(&mut sc, 5_000);
    sc.next_tx(BOB);
    {
        let mut reg = sc.take_shared<SoulRegistry>();
        let mut s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        soul::renounce(&mut reg, &mut s, sc.ctx());
        ts::return_shared(s);
        ts::return_shared(reg);
    };
    sc.end();
}

// --- A2: min_account_age_epochs was enforced nowhere ---------------------------------------

/// A2, THE DEFECT ITSELF. An account opened in the CURRENT epoch, credentialled against a minimum
/// of zero, offering on a soul whose rule demands seven. Every check in `offer` passed before the
/// fix, because the soul's own rule was compared against nothing: the age and the minimum both
/// came from the same caller at issuance, and the field on the soul was decoration.
///
/// TRIPS `EAccountTooYoung` in `offer`.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAccountTooYoung)]
fun an_account_opened_this_epoch_cannot_offer_under_the_launch_rule() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    // Opened now, credentialled against nothing.
    issue_cred(&mut sc, BOB, 0, 0);
    let sid = soul_id_of(&mut sc, ALICE);
    offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.end();
}

/// A2 AT ITS EXACT BOUNDARY, both sides. Seven epochs is enough; six is one short.
#[test]
fun an_account_exactly_seven_epochs_old_may_offer_under_the_launch_rule() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    advance_epochs(&mut sc, LAUNCH_MIN_AGE);
    issue_cred(&mut sc, BOB, 0, LAUNCH_MIN_AGE);
    let sid = soul_id_of(&mut sc, ALICE);
    let oid = offer_on(&mut sc, BOB, sid, 1_000, 10);
    adopt_offer(&mut sc, ALICE, sid, oid);
    sc.next_tx(MASTER);
    {
        let s = ts::take_shared_by_id<EmployeeSoul>(&sc, sid);
        assert!(soul::is_adopted(&s), 0);
        ts::return_shared(s);
    };
    sc.end();
}

/// One epoch short of the launch rule, with a credential that was legally issued: the credential
/// was checked against a SIX-epoch minimum at issuance and is perfectly valid, and the soul's own
/// rule still refuses it. That separation is the point of the fix.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAccountTooYoung)]
fun an_account_one_epoch_short_of_the_launch_rule_cannot_offer() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    advance_epochs(&mut sc, LAUNCH_MIN_AGE - 1);
    issue_cred(&mut sc, BOB, 0, LAUNCH_MIN_AGE - 1);
    let sid = soul_id_of(&mut sc, ALICE);
    offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.end();
}

/// The u128 widening in `offer`, tripped the way the one in `issue_adopter_credential` is: a soul
/// born under a `min_account_age_epochs` of u64::MAX. In u64 the sum would wrap or abort
/// arithmetically; in u128 it refuses cleanly with the code that means what it says.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EAccountTooYoung)]
fun an_age_rule_that_would_overflow_still_refuses_at_the_offer() {
    let mut sc = setup();
    let unreachable = soul::new_adoption_rule(18_446_744_073_709_551_615, 3, 0, 0);
    hire_under(&mut sc, ALICE, 1_000, unreachable);
    issue_cred(&mut sc, BOB, 1, 0);
    let sid = soul_id_of(&mut sc, ALICE);
    offer_on(&mut sc, BOB, sid, 1_000, 10);
    sc.end();
}

// --- A3: override_tier accepted tiers that do not exist ------------------------------------

/// A3, THE DEFECT ITSELF. `is_legal_override` read `to > from && to != TIER_RETIRED`, which is
/// every u8 above the current tier except one. `override_tier(soul, 200)` was legal, and it left
/// the field on a number no reader knows how to interpret, with no way back: the only legal moves
/// are upward.
///
/// TRIPS `EBadTier` with `to < TIER_RETIRED`.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadTier)]
fun an_override_to_a_tier_that_does_not_exist_is_refused() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, 200);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// The same one unit above the last defined tier, which is the boundary the comparison actually
/// turns on: 4 is refused as surely as 200.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EBadTier)]
fun an_override_one_past_retired_is_refused() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_retired() + 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// And the largest legal override still passes, so the fix did not close the door on the tier it
/// is meant to leave open: normal to critical, one below retired.
#[test]
fun the_worst_defined_tier_is_still_reachable_by_an_override() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::override_tier(&cap, &mut s, soul::tier_critical());
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    assert!(tier_of(&mut sc) == soul::tier_critical(), 0);
    sc.end();
}

// --- A11: three authority changes left no event --------------------------------------------

/// A11. Delegating a bookkeeping key wrote nothing to the log, so the set of live `LedgerCap`s
/// was reconstructible only from raw transaction history.
#[test]
fun issuing_a_ledger_cap_emits_an_event() {
    let mut sc = setup();
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        soul::issue_ledger_cap(&cap, BOB, sc.ctx());
        sc.return_to_sender(cap);
    };
    let effects = sc.next_tx(MASTER);
    assert!(effects.num_user_events() == 1, 0);
    sc.end();
}

/// A11. The scope is what the dispatcher reads to decide what an agent may call. Rewriting it is
/// one of the largest changes the employer can make, and it was silent.
#[test]
fun rescoping_a_soul_emits_an_event() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_scope(&cap, &mut s, b"engineering/deploy");
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    let effects = sc.next_tx(MASTER);
    assert!(effects.num_user_events() == 1, 0);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::scope(&s) == b"engineering/deploy", 1);
        ts::return_shared(s);
    };
    sc.end();
}

/// A11. Granting the right to act under the company's name, and withdrawing it, each emit one.
#[test]
fun granting_and_withdrawing_outward_each_emit_an_event() {
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
    let granted = sc.next_tx(MASTER);
    assert!(granted.num_user_events() == 1, 0);
    {
        let cap = sc.take_from_sender<MasterCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::set_outward(&cap, &mut s, false);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    let withdrawn = sc.next_tx(MASTER);
    assert!(withdrawn.num_user_events() == 1, 1);
    sc.end();
}

// --- A13: one enormous booking bricked every later one --------------------------------------

/// A13, THE DEFECT ITSELF. `earned_total` and `epoch_earned` were plain u64 additions on a number
/// read off chain and checked by nothing. One booking of u64::MAX made every later `book_earned`
/// on that soul abort arithmetically, for ever — the soul could never be settled honestly again,
/// and no cap could repair it because no entry point writes those counters.
///
/// The addition now saturates. The second booking succeeds, and the third does too.
#[test]
fun an_enormous_booking_saturates_the_earned_totals_instead_of_bricking_them() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<LedgerCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_earned(&cap, &mut s, 18_446_744_073_709_551_615);
        // The line that used to abort.
        soul::book_earned(&cap, &mut s, 1);
        soul::book_earned(&cap, &mut s, 1_000);
        assert!(soul::epoch_earned(&s) == 18_446_744_073_709_551_615, 0);
        assert!(soul::earned_total(&s) == 18_446_744_073_709_551_615, 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// A13 on the cost side. It must be the same rule on both sides: a `burned` that could abort while
/// `earned` could not would let a bookkeeper make a soul permanently unable to record a shortfall.
#[test]
fun an_enormous_booking_saturates_the_burned_totals_instead_of_bricking_them() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<LedgerCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_burned(&cap, &mut s, 18_446_744_073_709_551_615);
        soul::book_burned(&cap, &mut s, 1);
        assert!(soul::epoch_burned(&s) == 18_446_744_073_709_551_615, 0);
        assert!(soul::burned_total(&s) == 18_446_744_073_709_551_615, 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

/// And a soul whose books saturated is still a working soul: the epoch closes, the counters clear,
/// and the next epoch books normally. Saturating without this would only move where it bricks.
#[test]
fun a_soul_whose_books_saturated_still_settles_and_books_again() {
    let mut sc = setup();
    hire(&mut sc, ALICE, 1_000);
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<LedgerCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_earned(&cap, &mut s, 18_446_744_073_709_551_615);
        soul::book_earned(&cap, &mut s, 1);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    // Close it. An enormous surplus, bounded to a doubling by B3.
    book_and_settle(&mut sc, 0, 0, BIRTH_MS + WEEK_MS);
    sc.next_tx(MASTER);
    {
        let s = sc.take_shared<EmployeeSoul>();
        assert!(soul::allowance_per_epoch(&s) == 2_000, 0);
        assert!(soul::epoch_earned(&s) == 0, 1);
        assert!(soul::earned_total(&s) == 18_446_744_073_709_551_615, 2);
        ts::return_shared(s);
    };
    // And the next epoch books as though nothing had happened.
    sc.next_tx(MASTER);
    {
        let cap = sc.take_from_sender<LedgerCap>();
        let mut s = sc.take_shared<EmployeeSoul>();
        soul::book_earned(&cap, &mut s, 500);
        assert!(soul::epoch_earned(&s) == 500, 3);
        ts::return_shared(s);
        sc.return_to_sender(cap);
    };
    sc.end();
}

// --- the zero address ----------------------------------------------------------------------

/// `mint` refused a bad digest, an empty department and an allowance above the ceiling, and
/// accepted `@0x0` — an address that signs nothing, so the soul could never spend, never adopt and
/// never be renounced, and its registry row could only be released by a retirement nobody has a
/// reason to perform.
///
/// TRIPS `EZeroAgent`.
#[test]
#[expected_failure(abort_code = ::northlatch_soul::soul::EZeroAgent)]
fun a_soul_cannot_be_bound_to_the_zero_address() {
    let mut sc = setup();
    hire(&mut sc, @0x0, 1_000);
    sc.end();
}
