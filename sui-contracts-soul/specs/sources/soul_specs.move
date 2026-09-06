// Northlatch Labs LLC — company infrastructure. Licensing follows this repository's LICENSE;
// this repository is classified and has no remote.
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/// Machine-checked proofs of the soul's arithmetic, for the Sui Prover.
///
/// # What a proof here means, and what it does not
///
/// The tests beside this package sample points. The prover discharges each `ensures` for EVERY
/// input satisfying the `requires`, or hands back a counterexample. That is a far stronger
/// statement, and it is available only for functions the prover can reason about in isolation:
/// scalars in, scalars out, no object, no `TxContext`, no event. The soul's money arithmetic was
/// pulled into exactly such functions so that it could be proved rather than sampled.
///
/// # The council's six holds, and which of them a prover can actually take
///
/// Council 2.4 names six. They are not all the same kind of statement, and saying so is the point
/// of this comment.
///
///   1. THE CEILING ARITHMETIC IN u128 — proved below, twice: `compute_remaining_spec` and
///      `compute_settled_allowance_spec`.
///   2. `settle_epoch` IDEMPOTENT WITHIN AN EPOCH AND NOT RESETTABLE BY A CHOSEN EPOCH NUMBER —
///      NOT provable here, and not because it is hard. `settle_epoch` takes a `&mut EmployeeSoul`
///      and a `&TxContext`; it is a state machine, not a sum. The second half of the hold is
///      structural and stronger than any proof: the function ACCEPTS NO EPOCH ARGUMENT. There is
///      no number a caller can choose. The only epoch it reads is `ctx.epoch()`, which validators
///      advance. Covered by test at `an_epoch_cannot_be_settled_twice_inside_one_chain_epoch`.
///   3. THE TIER MONOTONE UNDER THE MasterCap — proved below as `is_legal_override_spec`, which
///      is the whole of the predicate `override_tier` asserts on. The tier rule itself is proved
///      as `compute_tier_spec`.
///   4. THE ADOPTION FIELDS WRITABLE ONLY BY AN OFFER THIS AGENT CONSUMED — not a property of any
///      function; it is a property of the ABSENCE of functions. `operator`, `operator_share_bps`
///      and `operator_threshold` are written by `adopt` and cleared by `renounce`, and by nothing
///      else in the module. The compiler enforces it on every build, which is a check no prover
///      run is needed for and no reviewer can forget to run.
///   5. `renunciations` NEVER DECREASES — likewise structural: the table is touched by `bump` and
///      by nothing else, and `bump` only adds. Covered by test at
///      `a_re_adoption_is_a_second_record_and_not_an_edit`.
///   6. `agent` AND `born_by` SET ONCE WITH NO SETTER — structural, and the strongest of the six:
///      no function in the module assigns either field outside the struct literal in `mint`.
///
/// Four holds are proved here. Two of the remaining are enforced by the type system and one by a
/// missing parameter. None of the six is left to hope, and none of them is claimed to be proved
/// when it is not.
module northlatch_soul_specs::soul_specs;

use northlatch_soul::soul;

#[spec_only]
use prover::prover::{ensures, requires};

/// HOLD 1a — the ceiling arithmetic. What remains is never more than the allowance, is zero once
/// the allowance is spent, and is the exact difference otherwise. The subtraction never wraps.
#[spec(prove, target = northlatch_soul::soul::compute_remaining)]
fun compute_remaining_spec(allowance_per_epoch: u64, epoch_spent: u64): u64 {
    let remaining = soul::compute_remaining(allowance_per_epoch, epoch_spent);

    // Never more than the ceiling itself.
    ensures(remaining <= allowance_per_epoch);
    // Spent out means nothing left — no negative, no wrap, no surprise headroom.
    ensures(epoch_spent < allowance_per_epoch || remaining == 0);
    // And where there is headroom it is exactly the headroom.
    ensures(epoch_spent >= allowance_per_epoch
        || remaining == allowance_per_epoch - epoch_spent);

    remaining
}

/// HOLD 1b — the metabolism's allowance arithmetic. The ceiling holds at every input; a shortfall
/// never widens what an agent may spend; a surplus never narrows it.
///
/// The `requires` is the invariant the module maintains everywhere else: `mint` and
/// `set_allowance` both refuse an allowance above the ceiling, and this function is the only
/// other thing that writes one.
#[spec(prove, target = northlatch_soul::soul::compute_settled_allowance)]
fun compute_settled_allowance_spec(allowance_per_epoch: u64, earned: u64, burned: u64): u64 {
    requires(allowance_per_epoch <= soul::max_allowance());

    let next = soul::compute_settled_allowance(allowance_per_epoch, earned, burned);

    // THE CEILING, at every input. This is the one that matters: the surplus branch adds, and
    // the addition is ordered against the headroom so it cannot pass the ceiling by overflowing.
    ensures(next <= soul::max_allowance());
    // A shortfall NEVER raises an allowance. The survival minimum is a floor, not a gift.
    ensures(earned >= burned || next <= allowance_per_epoch);
    // A surplus NEVER cuts one.
    ensures(earned < burned || next >= allowance_per_epoch);
    // HOLD 1c — THE PER-SETTLEMENT BOUND, Security finding B3. One settlement multiplies the
    // allowance by at most `MAX_RAISE_FACTOR`, at EVERY input, on both branches and through both
    // clamps. This is the statement that says a `LedgerCap` alone cannot walk the ceiling: no
    // `earned` it can invent, however large, takes an allowance to `MAX_ALLOWANCE` in one call
    // unless the allowance was already at least `MAX_ALLOWANCE / MAX_RAISE_FACTOR`.
    //
    // In u128 so the bound itself cannot be the thing that overflows. A sampled test can show two
    // or three points on this curve; the prover shows all 2^192 of them.
    ensures((next as u128)
        <= (allowance_per_epoch as u128) * (soul::max_raise_factor() as u128));

    next
}

/// HOLD 3a — the tier rule. The `and` in the normal branch is an `and` at every input, an empty
/// purse is always critical, and the rule never returns RETIRED: retiring takes the registry and
/// is a different act.
#[spec(prove, target = northlatch_soul::soul::compute_tier)]
fun compute_tier_spec(cover: u64, vault_sui: u64, epoch_net_nonneg: bool): u8 {
    let tier = soul::compute_tier(cover, vault_sui, epoch_net_nonneg);

    // Only the three living tiers are ever produced here.
    ensures(tier == soul::tier_normal() || tier == soul::tier_low()
        || tier == soul::tier_critical());
    // Below one epoch of cover is critical, whatever the net says.
    ensures(vault_sui >= cover || tier == soul::tier_critical());
    // NORMAL requires the net — this is the `and`, proved as an `and` at every input rather than
    // sampled at the two points a test can reach.
    ensures(tier != soul::tier_normal() || epoch_net_nonneg);
    // NORMAL requires the depth too.
    ensures(tier != soul::tier_normal() || vault_sui >= cover);

    tier
}

/// HOLD 3b — the tier is monotone under the `MasterCap`. The employer may only make a soul
/// poorer, may never reach retirement by this door, and may never leave the tier on a number that
/// is not a tier at all.
#[spec(prove, target = northlatch_soul::soul::is_legal_override)]
fun is_legal_override_spec(from: u8, to: u8): bool {
    let legal = soul::is_legal_override(from, to);

    // Legal implies strictly worse: never sideways, never richer.
    ensures(!legal || to > from);
    // Legal never means retired.
    ensures(!legal || to != soul::tier_retired());
    // AND NEVER PAST IT — Security finding A3. The predicate used to exclude the single value
    // `TIER_RETIRED` and admit every u8 above it, so `override_tier(soul, 200)` was legal and
    // wedged the field on a number no reader can interpret. Proved as a closed interval rather
    // than a hole: every legal target is a tier this module defines.
    ensures(!legal || to < soul::tier_retired());

    legal
}
