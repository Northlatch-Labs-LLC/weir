// SPDX-License-Identifier: BUSL-1.1
// Licensor: Northlatch Labs LLC. Change Date: 2029-09-01. Change License: Apache-2.0.
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/// Tests for platform governance — fee ceilings, capability binding, and the treasury.
#[test_only]
module projectx_social::platform_tests;

use projectx_social::platform::{Self, Platform, PlatformCap};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const ADMIN: address = @0xAD;

fun setup(): Scenario {
    let mut sc = ts::begin(ADMIN);
    { platform::init_for_testing(sc.ctx()); };
    sc
}

#[test]
/// A freshly published platform charges nothing **and is shut**.
///
/// Both halves are load-bearing, and the second was added after a pre-publish review found the
/// hole it closes. Fees are snapshotted into each vault at creation and can never be raised, so a
/// vault opened between publish and `set_fees` would carry a zero fee for the life of the vault.
/// Publishing and configuring cannot be one transaction, so the only way to close that window is
/// for the platform to arrive closed.
fun a_fresh_platform_charges_nothing_and_is_shut() {
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let platform = sc.take_shared<Platform>();
        assert!(platform::fee_bps(&platform) == 0, 0);
        assert!(platform::referral_share_bps(&platform) == 0, 1);
        assert!(platform::creation_fee_mist(&platform) == 0, 2);
        // Shut on arrival. Opening it is a deliberate transaction, taken after fees are set.
        assert!(platform::creation_paused(&platform), 3);
        assert!(platform::treasury_value(&platform) == 0, 5);
        assert!(platform::version(&platform) == 1, 6);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::ECreationPaused)]
/// The window itself: no vault can be opened on a platform that has not been configured yet.
///
/// Uses a creator vault rather than an account because a vault is what snapshots the fee, and the
/// fee snapshot is the thing that would have been permanent.
fun no_vault_can_be_opened_before_the_platform_is_configured() {
    let mut sc = setup();
    // Deliberately no `set_creation_paused(false)` — this is the state straight after publish.
    sc.next_tx(ADMIN);
    {
        let platform = sc.take_shared<Platform>();
        platform::assert_can_create(&platform);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
fun fees_can_be_set_up_to_the_compiled_ceilings() {
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();

        // Exactly at both ceilings — the last accepted value.
        platform::set_fees(
            &mut platform,
            &cap,
            platform::max_platform_fee_bps(),
            platform::max_referral_share_bps(),
            5_000_000_000,
        );
        assert!(platform::fee_bps(&platform) == 3_000, 0);
        assert!(platform::referral_share_bps(&platform) == 5_000, 1);
        assert!(platform::creation_fee_mist(&platform) == 5_000_000_000, 2);

        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::EFeeAboveCeiling)]
fun one_basis_point_above_the_fee_ceiling_is_refused() {
    // The first rejected value. Paired with the test above so the boundary is pinned from both
    // sides; a ceiling tested only from below moves without anything failing.
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_fees(&mut platform, &cap, platform::max_platform_fee_bps() + 1, 0, 0);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::EFeeAboveCeiling)]
fun one_basis_point_above_the_referral_ceiling_is_refused() {
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_fees(&mut platform, &cap, 0, platform::max_referral_share_bps() + 1, 0);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::EWrongPlatform)]
fun a_capability_from_another_deployment_is_refused() {
    // Two platforms exist at once — mainnet and staging is the real case. Their caps are
    // indistinguishable in a wallet, so the binding has to be checked on chain.
    let mut sc = setup();
    sc.next_tx(ADMIN);
    { platform::init_for_testing(sc.ctx()); }; // a second deployment

    sc.next_tx(ADMIN);
    {
        let mut first = sc.take_shared<Platform>();
        // Take the cap belonging to the *other* platform.
        let mut caps = ts::ids_for_sender<PlatformCap>(&sc);
        let cap_a = sc.take_from_sender_by_id<PlatformCap>(caps.pop_back());
        let cap_b = sc.take_from_sender_by_id<PlatformCap>(caps.pop_back());
        caps.destroy_empty();

        // One of the two governs `first`; use the other.
        let foreign = if (platform::cap_platform_id(&cap_a) == object::id(&first)) {
            sc.return_to_sender(cap_a);
            cap_b
        } else {
            sc.return_to_sender(cap_b);
            cap_a
        };

        platform::set_fees(&mut first, &foreign, 100, 0, 0);

        sc.return_to_sender(foreign);
        ts::return_shared(first);
    };
    sc.end();
}

#[test]
fun the_creation_fee_is_collected_and_change_returned() {
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_fees(&mut platform, &cap, 0, 0, 1_000_000_000); // 1 SUI
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };

    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let payment = coin::mint_for_testing<SUI>(3_000_000_000, sc.ctx());
        let change = platform::collect_creation_fee(&mut platform, payment, sc.ctx());

        // Overpaying is not a donation.
        assert!(change.value() == 2_000_000_000, 0);
        assert!(platform::treasury_value(&platform) == 1_000_000_000, 1);

        coin::burn_for_testing(change);
        ts::return_shared(platform);
    };

    // And it can be swept back out.
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        let out = platform::sweep_treasury(&mut platform, &cap, 1_000_000_000, sc.ctx());
        assert!(out.value() == 1_000_000_000, 2);
        assert!(platform::treasury_value(&platform) == 0, 3);
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::EInsufficientFee)]
fun underpaying_the_creation_fee_aborts() {
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::set_fees(&mut platform, &cap, 0, 0, 1_000_000_000);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };

    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let payment = coin::mint_for_testing<SUI>(999_999_999, sc.ctx());
        let change = platform::collect_creation_fee(&mut platform, payment, sc.ctx());
        coin::burn_for_testing(change);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::EInsufficientTreasury)]
fun sweeping_more_than_the_treasury_holds_aborts() {
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        let out = platform::sweep_treasury(&mut platform, &cap, 1, sc.ctx());
        coin::burn_for_testing(out);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };
    sc.end();
}

#[test]
#[expected_failure(abort_code = ::projectx_social::platform::ENotUpgraded)]
fun migrating_a_current_platform_is_refused() {
    // `migrate` exists so `VERSION` can ever be raised. Calling it at the current version is a
    // mistake worth naming rather than a silent no-op.
    let mut sc = setup();
    sc.next_tx(ADMIN);
    {
        let mut platform = sc.take_shared<Platform>();
        let cap = sc.take_from_sender<PlatformCap>();
        platform::migrate(&mut platform, &cap);
        sc.return_to_sender(cap);
        ts::return_shared(platform);
    };
    sc.end();
}
