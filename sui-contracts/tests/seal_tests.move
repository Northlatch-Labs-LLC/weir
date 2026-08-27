// SPDX-License-Identifier: BUSL-1.1
// Licensor: Northlatch Labs LLC. Change Date: 2029-09-01. Change License: Apache-2.0.
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/// The Seal policy: which key an entitlement is allowed to derive.
///
/// A Seal key server grants a share when one of these calls does not abort, and a key once derived
/// is permanent — there is no revoking it, no expiry on it, and no second check later. So every
/// property here is a property about something that cannot be undone, which is why the suite is
/// organised around what must *never* be approved rather than around what must.
///
/// The identity is the whole subject. Both functions already know who is asking and what they hold;
/// what they must also establish is that the bytes being requested are the bytes that entitlement
/// covers. A policy that checks the holder and not the identity approves a reader who bought
/// something cheap for the key to something expensive.
#[test_only]
module projectx_social::seal_tests;

use projectx_social::entitlement::{Self, Subscription, Unlock};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const CREATOR: address = @0xC1;
const FAN: address = @0xFA;
const STRANGER: address = @0x5A;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const PERIOD_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// A vault id to gate against. Nothing here needs a real vault — the policy compares an `ID`.
fun vault_id(scenario: &mut Scenario): ID {
    ts::next_tx(scenario, CREATOR);
    let uid = object::new(ts::ctx(scenario));
    let id = uid.to_inner();
    uid.delete();
    id
}

fun clock_at(scenario: &mut Scenario, at_ms: u64): Clock {
    let mut c = clock::create_for_testing(ts::ctx(scenario));
    c.set_for_testing(at_ms);
    c
}

// === Unlocks ===

#[test]
fun unlock_approves_its_own_content() {
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 1_000);

    entitlement::mint_unlock_for_testing(vault, FAN, b"issue-7", &clock, ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, FAN);
    let unlock = ts::take_from_sender<Unlock>(&scenario);
    entitlement::approve_unlock_for_testing(
        entitlement::unlock_identity(vault, b"issue-7"),
        &unlock,
        ts::ctx(&mut scenario),
    );

    ts::return_to_sender(&scenario, unlock);
    clock.destroy_for_testing();
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::ENotHolder)]
fun unlock_refuses_somebody_else_holding_it() {
    /*
      A reference proves possession of a reference. Owned objects are readable in a dry run, and the
      key server runs this with the *requester* as sender — so without this check, naming somebody
      else's unlock in the transaction would derive their key.
    */
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 1_000);

    entitlement::mint_unlock_for_testing(vault, FAN, b"issue-7", &clock, ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, FAN);
    let unlock = ts::take_from_sender<Unlock>(&scenario);

    ts::next_tx(&mut scenario, STRANGER);
    entitlement::approve_unlock_for_testing(
        entitlement::unlock_identity(vault, b"issue-7"),
        &unlock,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::EWrongIdentity)]
fun unlock_refuses_a_different_content_key() {
    // The defect this closes: an unlock for the cheap thing, presented for the key to the expensive
    // one. Holder and vault both check out; only the identity says no.
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 1_000);

    entitlement::mint_unlock_for_testing(vault, FAN, b"cheap", &clock, ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, FAN);
    let unlock = ts::take_from_sender<Unlock>(&scenario);
    entitlement::approve_unlock_for_testing(
        entitlement::unlock_identity(vault, b"expensive"),
        &unlock,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::EWrongIdentity)]
fun unlock_refuses_another_vault_with_the_same_content_key() {
    // Content keys are creator-chosen, so two creators will eventually pick the same one. The vault
    // prefix is what stops one creator's unlock deriving the other's key.
    let mut scenario = ts::begin(CREATOR);
    let mine = vault_id(&mut scenario);
    let theirs = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 1_000);

    entitlement::mint_unlock_for_testing(mine, FAN, b"issue-1", &clock, ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, FAN);
    let unlock = ts::take_from_sender<Unlock>(&scenario);
    entitlement::approve_unlock_for_testing(
        entitlement::unlock_identity(theirs, b"issue-1"),
        &unlock,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
fun a_crafted_content_key_cannot_forge_a_subscription_identity() {
    /*
      The reason the tag byte exists.

      `content_key` is arbitrary bytes the creator chooses. Without a separator between the two
      namespaces, a creator could publish content under a key shaped like a subscription identity's
      tail — `tier ‖ period` — and the two identities would be byte-identical. One cheap unlock
      would then open a whole period of subscriber content.

      Asserted as inequality rather than by expecting an abort: the point is that these two can
      never *be* the same bytes, which is a property of the encoding rather than of a check.
    */
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);

    let tier = 1u64;
    let period = 600u64;

    // Everything a subscription identity has after the vault, offered as a content key.
    let mut forged = std::bcs::to_bytes(&tier);
    forged.append(std::bcs::to_bytes(&period));

    assert!(
        entitlement::unlock_identity(vault, forged)
            != entitlement::period_identity(vault, tier, period),
        0,
    );

    ts::end(scenario);
}

// === Subscriptions ===

#[test]
fun subscription_approves_a_period_it_paid_for() {
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    // Starts exactly on a period boundary, so period 10 is covered from its first millisecond.
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);
    entitlement::approve_subscription_for_testing(
        entitlement::period_identity(vault, 1, 10),
        1,
        10,
        &subscription,
        ts::ctx(&mut scenario),
    );

    ts::return_to_sender(&scenario, subscription);
    clock.destroy_for_testing();
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::EPeriodNotPaid)]
fun subscription_refuses_a_period_before_it_started() {
    // The back catalogue is not included. A new subscriber who could derive earlier periods would
    // be buying the archive for one period's price, permanently.
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);
    entitlement::approve_subscription_for_testing(
        entitlement::period_identity(vault, 1, 9),
        1,
        9,
        &subscription,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::EPeriodNotPaid)]
fun subscription_refuses_a_period_after_it_expires() {
    /*
      The property that makes recurring revenue possible at all.

      Encrypt every subscriber post to one identity per tier and a single period's payment buys the
      archive forever, including everything published after the subscriber stops paying — and
      nothing about it would look wrong, because the check passes once and a Seal key is permanent.
      The period in the identity is what makes "paid until" mean something.
    */
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);
    entitlement::approve_subscription_for_testing(
        entitlement::period_identity(vault, 1, 11),
        1,
        11,
        &subscription,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
fun a_lapsed_subscriber_keeps_the_periods_they_paid_for() {
    /*
      Deliberate, and the reason no `Clock` is read by the policy.

      A key is permanent once derived, so requiring the subscription to be *currently* active would
      control nothing — anybody could fetch every key the day before lapsing — while punishing the
      subscriber who simply did not open the app in time. What they bought, they keep; what they did
      not buy stays shut, which the previous test asserts.
    */
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);

    // Nothing here advances the clock, and nothing needs to: the policy never asks what time it is,
    // so this call is identical to one made years after the subscription lapsed.
    entitlement::approve_subscription_for_testing(
        entitlement::period_identity(vault, 1, 10),
        1,
        10,
        &subscription,
        ts::ctx(&mut scenario),
    );

    ts::return_to_sender(&scenario, subscription);
    clock.destroy_for_testing();
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::ETierTooLow)]
fun subscription_refuses_content_above_its_tier() {
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);
    entitlement::approve_subscription_for_testing(
        entitlement::period_identity(vault, 2, 10),
        2,
        10,
        &subscription,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
fun a_higher_tier_reads_everything_below_it() {
    // Equality on the tier would mean upgrading silently revoked access to the content the lower
    // tier had been buying — an upgrade that takes something away.
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 3, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);
    entitlement::approve_subscription_for_testing(
        entitlement::period_identity(vault, 1, 10),
        1,
        10,
        &subscription,
        ts::ctx(&mut scenario),
    );

    ts::return_to_sender(&scenario, subscription);
    clock.destroy_for_testing();
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::EWrongIdentity)]
fun subscription_refuses_a_period_that_is_not_the_one_in_the_identity() {
    /*
      `tier` and `period` arrive as arguments, so on their own they could name a window the
      subscription paid for while the *identity* names another. The equality against
      `period_identity` is what binds them: mismatched arguments cannot produce matching bytes.
    */
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);
    entitlement::approve_subscription_for_testing(
        // The identity says period 99; the arguments claim the paid one.
        entitlement::period_identity(vault, 1, 99),
        1,
        10,
        &subscription,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::ENotHolder)]
fun subscription_refuses_somebody_else_holding_it() {
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 10 * PERIOD_MS);

    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);

    ts::next_tx(&mut scenario, STRANGER);
    entitlement::approve_subscription_for_testing(
        entitlement::period_identity(vault, 1, 10),
        1,
        10,
        &subscription,
        ts::ctx(&mut scenario),
    );

    abort 0
}

#[test]
fun periods_partition_time_at_a_fixed_width() {
    // The publisher stamps content with `period_of` and the policy compares against the same
    // arithmetic. If these ever disagree, every identity issued under the old boundary is stranded.
    let scenario = ts::begin(CREATOR);

    assert!(entitlement::period_of(0) == 0, 0);
    assert!(entitlement::period_of(PERIOD_MS - 1) == 0, 1);
    assert!(entitlement::period_of(PERIOD_MS) == 1, 2);
    assert!(entitlement::period_of(PERIOD_MS + DAY_MS) == 1, 3);

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = ::projectx_social::entitlement::EExpired)]
/// `assert_subscribed` must refuse a subscription whose expiry has passed.
fun assert_subscribed_refuses_an_expired_subscription() {
    // The expiry check in `assert_subscribed` is a separate code path from the period checks
    // in `seal_approve_subscription` — both must be covered.
    let mut scenario = ts::begin(CREATOR);
    let vault = vault_id(&mut scenario);
    let clock = clock_at(&mut scenario, 0);

    // A subscription covering period 0.
    entitlement::mint_subscription_for_testing(
        vault, FAN, 1, PERIOD_MS, &clock, ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, FAN);
    let subscription = ts::take_from_sender<Subscription>(&scenario);
    // Clock at PERIOD_MS + 1 ms: the subscription expired at PERIOD_MS.
    let mut later = clock_at(&mut scenario, PERIOD_MS + 1);
    entitlement::assert_subscribed(
        &subscription,
        vault,
        FAN,
        &later,
    );
    abort 0
}
