// SPDX-License-Identifier: BUSL-1.1
// Licensor: Northlatch Labs LLC. Change Date: 2029-09-01. Change License: Apache-2.0.
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/// End-to-end tests for the payment lifecycle.
///
/// The suite is organised around the properties that must hold rather than around the functions
/// that exist, because the defects worth catching here are the ones that live between functions —
/// value that leaves a buyer and arrives nowhere, a pause that traps a withdrawal, a fee that
/// changes under a creator who already agreed to a different one.
#[test_only]
module projectx_social::creator_tests;

use projectx_social::account::{Self, Registry, SocialAccount};
use projectx_social::creator::{Self, CreatorVault, CreatorCap};
use projectx_social::entitlement::{Self, Subscription, Unlock};
use projectx_social::platform::{Self, Platform, PlatformCap};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

/// Stands in for USDC. Only the type identity matters to the contract — the number of decimals
/// is never read on chain, which is exactly why clients must read it from `CoinMetadata`.
public struct USD has drop {}

const ADMIN: address = @0xAD;
const CREATOR: address = @0xC1;
const FAN: address = @0xFA;
const REFERRER: address = @0xEF;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const MONTH_MS: u64 = 30 * 24 * 60 * 60 * 1000;

// === Fixtures ===

/// Publish the package and register three identities: a creator, a fan referred by nobody, and
/// a referrer. Returns a scenario positioned at ADMIN.
fun setup(): (Scenario, Clock) {
    let mut sc = ts::begin(ADMIN);
    {
        let ctx = sc.ctx();
        platform::init_for_testing(ctx);
        account::init_for_testing(ctx);
    };
    // The platform publishes shut, so a fixture has to open it exactly as a real deployment
    // does. Doing this in the fixture rather than hiding it in `init_for_testing` keeps the
    // deploy sequence honest: if the default changes, these break.
    sc.next_tx(ADMIN);
    {
        let mut p = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_creation_paused(&mut p, &cap, false);
        sc.return_to_sender(cap);
        ts::return_shared(p);
    };
    let clock = clock::create_for_testing(sc.ctx());
    (sc, clock)
}

fun open_account(sc: &mut Scenario, who: address, handle: vector<u8>, referrer: Option<address>) {
    sc.next_tx(who);
    let mut platform = sc.take_shared<Platform>();
    let mut registry = sc.take_shared<Registry>();
    let clock = clock::create_for_testing(sc.ctx());
    account::open(
        &mut platform,
        &mut registry,
        handle.to_string(),
        referrer,
        &clock,
        sc.ctx(),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(platform);
    ts::return_shared(registry);
}

fun set_fees(sc: &mut Scenario, fee_bps: u64, referral_share_bps: u64, creation_fee: u64) {
    sc.next_tx(ADMIN);
    let mut platform = sc.take_shared<Platform>();
    let cap = sc.take_from_sender<PlatformCap>();
    platform::set_fees(&mut platform, &cap, fee_bps, referral_share_bps, creation_fee);
    sc.return_to_sender(cap);
    ts::return_shared(platform);
}

/// Open a USD vault for CREATOR with one monthly tier priced at `price`.
fun open_vault_with_tier(sc: &mut Scenario, price: u64) {
    sc.next_tx(CREATOR);
    {
        let mut platform = sc.take_shared<Platform>();
        let acct = sc.take_from_sender<SocialAccount>();
        let fee = coin::mint_for_testing<SUI>(1_000_000_000, sc.ctx());
        let (cap, change) = creator::open_vault<USD>(&mut platform, &acct, fee, sc.ctx());
        transfer::public_transfer(cap, CREATOR);
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(platform);
    };
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        creator::add_tier(&mut vault, &cap, b"Monthly".to_string(), price, MONTH_MS);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };
}

// === Conservation of value ===

#[test]
/// The property the whole module exists for: every unit the fan pays lands somewhere.
fun a_subscription_conserves_every_unit() {
    let (mut sc, clock) = setup();
    set_fees(&mut sc, 1_000, 5_000, 0); // 10% platform, half of it referred
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, REFERRER, b"referrer", option::none());
    open_account(&mut sc, FAN, b"fan", option::some(REFERRER));
    open_vault_with_tier(&mut sc, 10_000_000); // 10 USDC at 6dp

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());

        let change = creator::subscribe(
            &platform, &mut vault, &acct, 0, payment, &clock, sc.ctx(),
        );

        assert!(change.value() == 0, 0);
        coin::burn_for_testing(change);

        // 10 USDC: 9 to the creator, 0.5 to the platform, 0.5 to the referrer.
        assert!(creator::earnings_value(&vault) == 9_000_000, 1);
        assert!(creator::platform_fees_value(&vault) == 500_000, 2);
        assert!(creator::gross_volume(&vault) == 10_000_000, 3);

        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    // The referrer's leg left the vault, so it is checked as a coin in their wallet. Vault
    // balances alone would not prove conservation — the missing unit could simply be gone.
    sc.next_tx(REFERRER);
    {
        let paid = sc.take_from_sender<Coin<USD>>();
        assert!(paid.value() == 500_000, 4);
        // 9_000_000 + 500_000 + 500_000 == 10_000_000
        sc.return_to_sender(paid);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
/// With no referrer, the referral leg must fold into the platform's cut rather than vanish.
fun an_unreferred_payment_gives_the_whole_fee_to_the_platform() {
    let (mut sc, clock) = setup();
    set_fees(&mut sc, 1_000, 5_000, 0);
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none()); // organic signup
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);

        assert!(creator::earnings_value(&vault) == 9_000_000, 0);
        // The full 10%, not 5%, because there was nobody to refer to.
        assert!(creator::platform_fees_value(&vault) == 1_000_000, 1);

        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

// === Pauses must never trap money ===

#[test]
/// The invariant stated at the top of `platform.move`, tested rather than asserted in prose.
fun neither_pause_can_block_a_claim() {
    let (mut sc, clock) = setup();
    set_fees(&mut sc, 1_000, 0, 0);
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    // Everything that can be switched off, switched off.
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_creation_paused(&mut platform, &cap, true);
        platform::set_payments_paused(&mut platform, &cap, true);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        creator::set_accepting(&mut vault, &cap, false);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    // The creator still gets paid.
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        let out = creator::claim_earnings(&mut vault, &cap, 9_000_000, sc.ctx());
        assert!(out.value() == 9_000_000, 0);
        assert!(creator::earnings_value(&vault) == 0, 1);
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    // And so does the platform.
    sc.next_tx(ADMIN);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<PlatformCap>();
        let out = creator::claim_platform_fees(&mut vault, &cap, 1_000_000, sc.ctx());
        assert!(out.value() == 1_000_000, 2);
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::EPaymentsPaused)]
fun a_payments_pause_does_block_a_new_payment() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_payments_paused(&mut platform, &cap, true);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

// === Fee snapshotting ===

#[test]
/// ProjectX raises the platform fee. A vault that already exists must keep its original rate.
fun the_platform_cannot_raise_a_fee_on_an_existing_vault() {
    let (mut sc, clock) = setup();
    set_fees(&mut sc, 500, 0, 0); // 5% at vault creation
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    set_fees(&mut sc, 3_000, 0, 0); // platform raises to the 30% ceiling afterwards

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();

        assert!(platform::fee_bps(&platform) == 3_000, 0);
        assert!(creator::fee_bps_snapshot(&vault) == 500, 1);

        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);

        // Charged at 5%, the rate the creator agreed to.
        assert!(creator::earnings_value(&vault) == 9_500_000, 2);
        assert!(creator::platform_fees_value(&vault) == 500_000, 3);

        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
/// A creator may opt in to the current schedule, which is how a fee cut reaches existing vaults.
fun a_creator_can_adopt_the_current_terms() {
    let (mut sc, clock) = setup();
    set_fees(&mut sc, 3_000, 0, 0);
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    set_fees(&mut sc, 100, 0, 0); // platform cuts the fee to 1%

    sc.next_tx(CREATOR);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();

        assert!(creator::fee_bps_snapshot(&vault) == 3_000, 0);
        creator::accept_current_terms(&mut vault, &cap, &platform);
        assert!(creator::fee_bps_snapshot(&vault) == 100, 1);

        sc.return_to_sender(cap);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

// === Entitlements ===

#[test]
fun a_subscription_expires_on_time_and_renewal_extends_from_the_expiry() {
    let (mut sc, mut clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    let vault_id;
    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        vault_id = object::id(&vault);
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    sc.next_tx(FAN);
    {
        let sub = sc.take_from_sender<Subscription>();
        assert!(entitlement::is_active(&sub, vault_id, FAN, &clock), 0);
        assert!(entitlement::expires_at_ms(&sub) == MONTH_MS, 1);

        // One millisecond before expiry: still active. The boundary is tested from both sides
        // because an off-by-one here is a free day for every subscriber on the platform.
        clock.set_for_testing(MONTH_MS - 1);
        assert!(entitlement::is_active(&sub, vault_id, FAN, &clock), 2);

        // Exactly at expiry: not active. `expires_at_ms` is exclusive.
        clock.set_for_testing(MONTH_MS);
        assert!(!entitlement::is_active(&sub, vault_id, FAN, &clock), 3);

        sc.return_to_sender(sub);
    };

    // Renew ten days after expiry. The new expiry runs a full month from *now*, not from the
    // stale expiry — otherwise the fan pays for a month and receives twenty days.
    sc.next_tx(FAN);
    {
        clock.set_for_testing(MONTH_MS + 10 * DAY_MS);
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let mut sub = sc.take_from_sender<Subscription>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());

        let change = creator::renew(
            &platform, &mut vault, &acct, &mut sub, payment, &clock, sc.ctx(),
        );
        coin::burn_for_testing(change);

        assert!(entitlement::renewals(&sub) == 1, 4);
        assert!(entitlement::expires_at_ms(&sub) == MONTH_MS + 10 * DAY_MS + MONTH_MS, 5);
        assert!(entitlement::is_active(&sub, vault_id, FAN, &clock), 6);

        sc.return_to_sender(sub);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
/// Renewing early must add a period rather than reset the clock, or the fan loses the remainder.
fun renewing_early_does_not_discard_time_already_paid_for() {
    let (mut sc, mut clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    sc.next_tx(FAN);
    {
        clock.set_for_testing(DAY_MS); // one day in, 29 remaining
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let mut sub = sc.take_from_sender<Subscription>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::renew(&platform, &mut vault, &acct, &mut sub, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);

        // Two months from the original start, not one month from today.
        assert!(entitlement::expires_at_ms(&sub) == MONTH_MS * 2, 0);

        sc.return_to_sender(sub);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

// === Unlocks ===

#[test]
fun unlocking_content_pays_the_creator_and_grants_permanent_access() {
    let (mut sc, clock) = setup();
    set_fees(&mut sc, 1_000, 0, 0);
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    let key = b"post:0191f3c7";

    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        assert!(!creator::is_for_sale(&vault, key), 0); // unpriced means unbuyable
        creator::set_content_price(&mut vault, &cap, key, 2_000_000);
        assert!(creator::content_price(&vault, key) == 2_000_000, 1);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    let vault_id;
    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        vault_id = object::id(&vault);

        // Overpay deliberately: the change must come back rather than become a donation.
        let payment = coin::mint_for_testing<USD>(5_000_000, sc.ctx());
        let change = creator::unlock(&platform, &mut vault, &acct, key, payment, &clock, sc.ctx());
        assert!(change.value() == 3_000_000, 2);
        coin::burn_for_testing(change);

        assert!(creator::earnings_value(&vault) == 1_800_000, 3);
        assert!(creator::platform_fees_value(&vault) == 200_000, 4);
        assert!(creator::unlocks_sold(&vault) == 1, 5);

        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    // Delisting must not revoke what somebody already bought.
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        creator::unprice_content(&mut vault, &cap, key);
        assert!(!creator::is_for_sale(&vault, key), 6);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    sc.next_tx(FAN);
    {
        let unlock = sc.take_from_sender<Unlock>();
        assert!(entitlement::unlocks(&unlock, vault_id, FAN, key), 7);
        // ...but it does not unlock a different post.
        assert!(!entitlement::unlocks(&unlock, vault_id, FAN, b"post:other"), 8);
        sc.return_to_sender(unlock);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::EContentNotForSale)]
fun unpriced_content_cannot_be_bought() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(9_999_999, sc.ctx());
        let change = creator::unlock(
            &platform, &mut vault, &acct, b"never:priced", payment, &clock, sc.ctx(),
        );
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

// === Tips ===

#[test]
fun a_tip_takes_the_whole_coin_and_respects_the_minimum() {
    let (mut sc, clock) = setup();
    set_fees(&mut sc, 1_000, 0, 0);
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(1_500_000, sc.ctx());
        creator::tip(&platform, &mut vault, &acct, payment, sc.ctx());

        assert!(creator::earnings_value(&vault) == 1_350_000, 0);
        assert!(creator::platform_fees_value(&vault) == 150_000, 1);
        assert!(creator::tips_received(&vault) == 1, 2);

        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::EBelowMinTip)]
fun a_tip_below_the_minimum_is_refused() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        creator::set_min_tip(&mut vault, &cap, 1_000_000);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(999_999, sc.ctx());
        creator::tip(&platform, &mut vault, &acct, payment, sc.ctx());
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

// === Authorisation ===

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::ESelfPayment)]
fun a_creator_cannot_pay_their_own_vault() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(CREATOR);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::EInsufficientPayment)]
fun underpaying_a_subscription_aborts() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(9_999_999, sc.ctx()); // one unit short
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::EInsufficientBalance)]
fun a_creator_cannot_claim_more_than_they_earned() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);

    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        let out = creator::claim_earnings(&mut vault, &cap, 1, sc.ctx());
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

// === Tier terms must be whole Seal content periods ===
//
// Access is released in fixed 30-day quanta by `entitlement::seal_approve_subscription`, but tier
// terms were free-form. A one-day tier bought in the 24 hours before a period boundary satisfied
// both of that function's time checks and released the entire next 30-day period — thirty days of
// content for one day of payment — while the same tier bought at any other moment released
// nothing. Sold monthly, charged daily. These three tests pin the two models together.

#[test]
/// The guard is the whole finding: a term that is not a whole number of periods is refused.
#[expected_failure(abort_code = projectx_social::creator::EPeriodNotWholeSealPeriods)]
fun a_tier_term_that_is_not_whole_periods_is_refused() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);
    sc.next_tx(CREATOR);
    let mut vault = sc.take_shared<CreatorVault<USD>>();
    let cap = sc.take_from_sender<CreatorCap>();
    // Six weeks: longer than a period, but not a multiple of one.
    creator::add_tier(&mut vault, &cap, b"Six weeks".to_string(), 1_000, MONTH_MS + 12 * DAY_MS);
    sc.return_to_sender(cap);
    ts::return_shared(vault);
    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
/// Multi-period terms stay legal — the fix constrains the shape, not the length.
fun a_multi_period_tier_term_is_accepted() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        // Priced above the 10_000_000 tier the fixture opens with, and above each other. This
        // test is about the period length, but tiers are now required to ascend in price because
        // the index is what Seal ranks access by — see `ETierPriceNotAscending`.
        creator::add_tier(&mut vault, &cap, b"Quarterly".to_string(), 30_000_000, 3 * MONTH_MS);
        creator::add_tier(&mut vault, &cap, b"Annual".to_string(), 120_000_000, 12 * MONTH_MS);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
/// A drift test. `creator` and `entitlement` must keep agreeing about how wide a period is; the
/// original defect was precisely that they did not, and nothing failed when they diverged.
fun the_tier_floor_is_exactly_one_seal_period() {
    assert!(creator::min_period_ms() == entitlement::seal_period_ms(), 0);
    assert!(creator::min_period_ms() % entitlement::seal_period_ms() == 0, 1);
}

#[test]
#[expected_failure(abort_code = projectx_social::creator::ETierInactive)]
/// A tier the creator has retired must refuse new subscriptions.
fun a_retired_tier_cannot_be_subscribed_to() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());

    sc.next_tx(CREATOR);
    {
        let mut platform = sc.take_shared<Platform>();
        let acct = sc.take_from_sender<SocialAccount>();
        let fee = coin::mint_for_testing<SUI>(1_000_000_000, sc.ctx());
        let (cap, change) = creator::open_vault<USD>(&mut platform, &acct, fee, sc.ctx());
        transfer::public_transfer(cap, CREATOR);
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(platform);
    };
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        creator::add_tier(&mut vault, &cap, b"Monthly".to_string(), 10_000_000, MONTH_MS);
        // Retire the tier.
        creator::update_tier(&mut vault, &cap, 0, 10_000_000, MONTH_MS, false);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::ENotAccepting)]
/// A vault that has stopped accepting payments must refuse new ones.
fun a_vault_that_has_stopped_accepting_refuses_new_payments() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_account(&mut sc, FAN, b"fan", option::none());

    sc.next_tx(CREATOR);
    {
        let mut platform = sc.take_shared<Platform>();
        let acct = sc.take_from_sender<SocialAccount>();
        let fee = coin::mint_for_testing<SUI>(1_000_000_000, sc.ctx());
        let (cap, change) = creator::open_vault<USD>(&mut platform, &acct, fee, sc.ctx());
        transfer::public_transfer(cap, CREATOR);
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(platform);
    };
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        creator::add_tier(&mut vault, &cap, b"Monthly".to_string(), 10_000_000, MONTH_MS);
        // Stop accepting payments.
        creator::set_accepting(&mut vault, &cap, false);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };

    sc.next_tx(FAN);
    {
        let platform = sc.take_shared<Platform>();
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let acct = sc.take_from_sender<SocialAccount>();
        let payment = coin::mint_for_testing<USD>(10_000_000, sc.ctx());
        let change = creator::subscribe(&platform, &mut vault, &acct, 0, payment, &clock, sc.ctx());
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(vault);
        ts::return_shared(platform);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = projectx_social::creator::EZeroPrice)]
/// A tier with a zero price must be refused — a free tier is a free subscription to everything.
fun a_tier_with_a_zero_price_is_refused() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());

    sc.next_tx(CREATOR);
    {
        let mut platform = sc.take_shared<Platform>();
        let acct = sc.take_from_sender<SocialAccount>();
        let fee = coin::mint_for_testing<SUI>(1_000_000_000, sc.ctx());
        let (cap, change) = creator::open_vault<USD>(&mut platform, &acct, fee, sc.ctx());
        transfer::public_transfer(cap, CREATOR);
        coin::burn_for_testing(change);
        sc.return_to_sender(acct);
        ts::return_shared(platform);
    };
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();
        creator::add_tier(&mut vault, &cap, b"Free".to_string(), 0, MONTH_MS);
        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}

// === Tier rank is price rank ===
//
// `entitlement::seal_approve_subscription` grants access with `subscription.tier >= tier`, and
// `subscription.tier` is the INDEX into `tiers`. The index is therefore the rank. Nothing tied the
// rank to the price until 2026-09-01, so a cheap tier sitting at a high index outranked the
// expensive ones below it and its subscribers could derive their keys — permanently, because a
// Seal key cannot be revoked, and silently, because nothing in the flow said anything was wrong.

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::ETierPriceNotAscending)]
/// The launch shape of the defect: Basic, then VIP, then a cheap Trial added later that outranks
/// both. This is the one a creator falls into by growing their pricing.
fun a_cheaper_tier_cannot_be_added_above_an_expensive_one() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000); // index 0, "Basic"
    sc.next_tx(CREATOR);
    let mut vault = sc.take_shared<CreatorVault<USD>>();
    let cap = sc.take_from_sender<CreatorCap>();
    creator::add_tier(&mut vault, &cap, b"VIP".to_string(), 100_000_000, MONTH_MS);
    // Index 2, and cheaper than both. Before the fix its subscribers outranked VIP.
    creator::add_tier(&mut vault, &cap, b"Trial".to_string(), 1_000_000, MONTH_MS);
    abort 0
}

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::ETierPriceNotAscending)]
/// The sibling, and the one that would have survived a fix confined to `add_tier`. Repricing reads
/// like a pricing decision, so this is the easier of the two to do by accident — and it inverts the
/// rank of everybody already subscribed to the two tiers involved.
fun a_reprice_cannot_invert_two_tiers() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);
    sc.next_tx(CREATOR);
    let mut vault = sc.take_shared<CreatorVault<USD>>();
    let cap = sc.take_from_sender<CreatorCap>();
    creator::add_tier(&mut vault, &cap, b"VIP".to_string(), 100_000_000, MONTH_MS);
    // Lift index 0 above index 1. Every index-0 subscriber would then outrank nobody, and every
    // index-1 subscriber would keep reading index-0's newly premium content for the old price.
    creator::update_tier(&mut vault, &cap, 0, 500_000_000, MONTH_MS, true);
    abort 0
}

#[test]
/// And the rule must not block ordinary pricing work. Adding upwards, repricing inside the gap
/// between neighbours, and retiring a tier all have to keep working — a rule that stops a creator
/// running their business would be traded away the first time it got in the way.
fun ordinary_pricing_still_works_under_the_ordering_rule() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);
    sc.next_tx(CREATOR);
    {
        let mut vault = sc.take_shared<CreatorVault<USD>>();
        let cap = sc.take_from_sender<CreatorCap>();

        creator::add_tier(&mut vault, &cap, b"Plus".to_string(), 50_000_000, MONTH_MS);
        creator::add_tier(&mut vault, &cap, b"VIP".to_string(), 100_000_000, MONTH_MS);

        // Reprice the middle tier anywhere strictly between its neighbours.
        creator::update_tier(&mut vault, &cap, 1, 60_000_000, MONTH_MS, true);
        assert!(creator::tier_price(&vault, 1) == 60_000_000, 0);

        // Retire it. A retired tier keeps its index, so it keeps its rank and its place in the
        // ordering — but retiring is not a repricing and must not be refused.
        creator::update_tier(&mut vault, &cap, 1, 60_000_000, MONTH_MS, false);
        assert!(!creator::tier_active(&vault, 1), 1);

        // The top tier can still go up.
        creator::update_tier(&mut vault, &cap, 2, 200_000_000, MONTH_MS, true);
        assert!(creator::tier_price(&vault, 2) == 200_000_000, 2);

        sc.return_to_sender(cap);
        ts::return_shared(vault);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::creator::ENotUpgraded)]
/// `CreatorCap` has `store` — it can be transferred, sold or lost — and `migrate` was the only way
/// to advance a creator vault's version. Every entry point begins with `assert_version`, including
/// `claim_earnings` and `claim_platform_fees`, so a lost cap would strand BOTH the creator's
/// earnings and the platform's own commission behind the version gate the moment a new version
/// shipped. `stake_vault` has had this second door since it shipped and its comment says why; the
/// vault holding the subscription money did not.
///
/// It cannot be exercised at the current version, so this pins the gate the way `stake_vault`'s
/// twin does: called with nothing to migrate, it is a named refusal rather than a silent no-op.
fun the_platform_door_refuses_a_creator_vault_already_at_version() {
    let (mut sc, clock) = setup();
    open_account(&mut sc, CREATOR, b"creator", option::none());
    open_vault_with_tier(&mut sc, 10_000_000);
    sc.next_tx(ADMIN);
    let mut vault = sc.take_shared<CreatorVault<USD>>();
    let platform = sc.take_shared<Platform>();
    let cap = sc.take_from_sender<PlatformCap>();
    creator::migrate_as_platform(&mut vault, &platform, &cap);
    abort 0
}
