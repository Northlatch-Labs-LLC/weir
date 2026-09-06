# `sui-contracts-soul` — the employment record of an agentic company

`northlatch_soul::soul`. One module, no coin, no dependency on the money package.

An agent of this company is markdown today: `northlatch/plugins/<department>/skills/<agent>/SKILL.md`.
That file is the agent's *mandate*, and it is all there is — the agent has no identity, no budget it
cannot exceed, and no consequence for producing nothing. This package puts the three facts that
cannot safely live in a file on chain instead:

1. **The mandate is pinned.** `mandate_digest` is the SHA-256 of the agent's instruction file. An
   agent whose file no longer hashes to its soul has been rewritten, and the dispatcher is expected
   to refuse it until the employer re-pins deliberately.
2. **The budget is enforced by something that cannot be argued with.** `record_spend` aborts when a
   spend would take the epoch past the allowance.
3. **Failing to earn has a consequence that arrives on a schedule.** Three consecutive epochs
   spending more than was earned marks the soul due for retirement.

It is written from the design in
`work/reports/2026-09-03-executive-the-soulbound-company.md` (§1 BIRTH, §2 THE MASTERCONTROLLER
RULE, §3 METABOLISM), and it is item 066 on the week's list.

---

## The objects

| Object | Ownership | What it is |
|---|---|---|
| `EmployeeSoul` | **shared** | one employee's record: who it is, what it may spend, what it has earned and burned, and whether it is still working |
| `SoulRegistry` | **shared** | address → live soul, and the minted/retired counters |
| `MasterCap` | owned, one at publish | the Mastercontroller's authority: mint, set allowance and scope, grant outward, re-pin the mandate, book the epoch, settle it, retire |

### Why the soul is shared rather than owned

`EmployeeSoul` has `key` and no `store`. It cannot be wrapped, sold, lent or placed in anyone's
inventory, and this module publishes no transfer function. The same shape as
`projectx_social::account::SocialAccount`.

It is then **shared** rather than transferred to the agent. That is the one choice here worth
arguing about, and the argument is short: an address-owned object can only be mutated inside a
transaction its owner signs, so an employment record owned by the employee could only have its
allowance lowered with the employee's signature. That is not an employment record.

Sharing separates the two authorities cleanly — the employer proves authority by holding
`MasterCap`, the employee proves identity by being `ctx.sender()` — and neither needs custody of
the other's object to act. The binding to the address survives in `agent`, set once at birth with
no setter. A shared object also cannot be transferred at all, by anybody, ever; as a soulbinding
that is stronger than ownership, not weaker.

---

## What it guarantees

> **No transaction that consults the soul may spend more than the allowance for its epoch.**

Precisely, and nothing wider:

- `record_spend` aborts with `EAllowanceExceeded` when `amount` exceeds what is left of the
  allowance this epoch. The comparison is against the remainder, never a sum, so an amount near
  `u64::MAX` is refused with this module's abort code rather than an arithmetic overflow.
- Only the agent can spend against its own soul (`ENotThisAgent`). The soul is a shared object;
  being able to reach it is not authority over it.
- No allowance can ever exceed `MAX_ALLOWANCE` — not at birth, not by the employer's hand, and not
  by a solvent epoch's raise, which clamps against the headroom before it adds.
- A shortfall never *widens* what an agent may spend. `MIN_ALLOWANCE` is a floor on the halving,
  not a grant: a soul hired below it stays where it is.
- One live soul per address (`EAlreadySouled`), the same rule and the same reason as one
  `SocialAccount` per address.
- A retired soul acts never again: every entry point checks it.
- Retirement is a state change and a timestamp. **Nothing here deletes anything**, and nothing here
  could — `EmployeeSoul` is shared, and no function consumes one.

## What it cannot do

Said plainly, because a guard that is believed to be wider than it is, is worse than no guard.

- **It does not hold or move a single coin.** There is no `Coin`, no `Balance`, no treasury, and no
  transfer of value anywhere in this package.
- **It cannot stop a spend that does not ask it.** The guarantee is exactly "no transaction that
  *consults* the soul may exceed the ceiling". A payment path that never calls `record_spend` is
  outside this module's reach entirely. **The adapter that routes an agent's spending through
  `record_spend` is not written yet**, and nothing here pretends otherwise.
- **It cannot check who holds `MasterCap`.** The design intends the cap to live behind the same
  2-of-3 multisig that holds the platform's caps. Nothing on chain here can verify that; it is a
  custody arrangement, recorded in the deployment record, not a property of this code.
- **It cannot read the agent's instruction file.** `mandate_digest` is a number this module stores
  and compares to nothing. Hashing the file and comparing it is the dispatcher's job, off chain.
- **It books nothing by itself.** `book_earned` and `book_burned` take figures from whoever holds
  `MasterCap`. The design requires every figure to have a transaction behind it; that discipline
  lives in the process that reads settlements, not here.
- **It cannot tell one currency from another.** Allowances, earnings and costs are bare `u64` in
  "the smallest unit of whatever it spends". A figure without its coin type is not a figure on this
  platform (the design's §8.1 correction); keeping the type alongside is the bookkeeper's job.

---

## The metabolism

An epoch is seven days (`EPOCH_MS`), aligned to the company's weekly merge. `settle_epoch` compares
the epoch's booked value with its booked cost and applies the consequence with no judgement
involved:

| Outcome | Condition | Consequence |
|---|---|---|
| `SOLVENT` | `earned >= burned` | starvation count cleared; allowance rises by `surplus / 4`, clamped to `MAX_ALLOWANCE` |
| `STARVING` | first shortfall | allowance halved, floored at `MIN_ALLOWANCE`, never raised |
| `DYING` | second consecutive shortfall, and each after it | allowance halved again |
| **due for retirement** | third consecutive shortfall | `is_due_for_retirement` returns true; `EpochSettled.due_for_retirement` says so |

**The chain marks; the employer performs.** `settle_epoch` does not retire anybody. Retirement is
`retire`, under `MasterCap`, and `SoulRetired.by_starvation` records whether the metabolism had
marked the soul or the employer decided for another reason.

That split is deliberate and it is the one place this package differs from the draft it was written
from (`northlatch/contracts/soul/`, another hand, read-only): in the draft, the bookkeeping
capability retired souls automatically inside `settle_epoch`, which is a larger power than the
draft's own documentation claimed for it. An object's death should require the cap that bore it,
not the routine that keeps its books.

Retirement releases the registry entry, so the address may be hired again as a **new** soul. The
first soul object, its counters and its whole history stand for ever beside the second — an agent
that starved because it was badly scoped can be born again without its record being touched.

## Events

| Event | Emitted by | Why it exists |
|---|---|---|
| `SoulBorn` | `mint` | the birth certificate: soul, agent, `born_by`, department, allowance, timestamp |
| `AllowanceSet` | `set_allowance`, `settle_epoch` | every move of the budget, with `by_settlement` saying which hand moved it |
| `SpendRecorded` | `record_spend` | every spend, with what is left after it |
| `MandateRepinned` | `repin_mandate` | the mandate changed, deliberately, by the employer |
| `EpochSettled` | `settle_epoch` | the epoch's verdict, the state, and whether retirement is now due |
| `SoulRetired` | `retire` | the end of an employment, with the whole life's totals and its cause |

---

## How it pairs with a `SocialAccount`, off chain

The design's birth ceremony (§1) is two transactions and one address:

1. Generate a keypair. **That address is the employee.**
2. From the Mastercontroller address, send `projectx_social::account::open` with
   `handle = nl-<department>-<name>` and **`referrer = <the Mastercontroller>`**. `referrer` is
   fixed at creation and can never be edited, so the `AccountOpened` event is an unforgeable,
   permanent birth certificate — and, through `referral_share_bps`, the same field routes a cut of
   every fee the agent's work generates back to that address.
3. From the same address, call `soul::mint` with the agent's address, its department, the SHA-256 of
   its `SKILL.md`, its opening allowance and its scope. `born_by` records the sender.

**This is a pairing, not a link.** There is deliberately no Move dependency between the two
packages, and `born_by` is checked against nothing on chain:

- A dependency would fix a publish ordering between the two packages for ever, and would make an
  employment record unpublishable on any chain where the social package is not live.
- The two objects answer different questions. `SocialAccount` says who an address **is** on a
  network; `EmployeeSoul` says who it **works for**. An agent can have either without the other.
- `agent_mind` (`../sui-contracts-mind`) is the precedent for a sibling package that must never
  become an upgrade of the money package. This one goes a step further and depends on it not at all.

Anything that wants both facts joins them by address, off chain, from the two events.

---

## Building and testing

```
cd sui-contracts-soul
sui move build
sui move test
```

The Sui framework is pinned to `d50b78880fdacb1bbde92e6974ed71a7650c1090` — **the same revision as
`../sui-contracts`**, which is the whole reason the `Sui` dependency is declared at all. Read the
long note in `Move.toml` before touching it; the CLI prints a `[NOTE]` on every build advising that
the line be removed, and following that advice silently reverts this package to a different
framework revision than the money package compiles against.

### The test discipline

`sources/soul.move` has **thirteen `assert!` statements** and **twenty-two assert obligations**:
twelve statements guard one entry point each, and the thirteenth — the single `assert!` inside
`assert_live` — guards ten. Every obligation has **two** tests: one that trips it, naming the abort
code, and one that passes it, at the exact boundary wherever there is one. The ten `ERetired` rows
below all trip the same statement, from ten different entry points, because "a retired soul cannot
spend" and "a retired soul cannot be rescoped" are two claims even though one line refuses both.

| # | Assert | Trips it | Passes it |
|---|---|---|---|
| A1 | `mint` · `EAlreadySouled` | `one_address_cannot_hold_two_live_souls` | `a_hired_agent_is_recorded_…` |
| A2 | `mint` · `EBadDigest` | `a_short_mandate_digest_is_refused_at_birth` | `a_hired_agent_is_recorded_…` |
| A3 | `mint` · `EEmptyDepartment` | `an_agent_needs_a_department` | `a_one_character_department_is_accepted` |
| A4 | `mint` · `EAllowanceAboveCeiling` | `an_allowance_above_the_ceiling_is_refused_at_birth_not_clamped` | `an_allowance_exactly_at_the_ceiling_is_accepted_at_birth` |
| A5 | `set_allowance` · `ERetired` | `a_retired_souls_allowance_cannot_be_set` | `the_employer_can_move_the_allowance_up_to_the_ceiling` |
| A6 | `set_allowance` · `EAllowanceAboveCeiling` | `the_employer_cannot_set_an_allowance_above_the_ceiling` | `the_employer_can_move_the_allowance_up_to_the_ceiling` |
| A7 | `set_scope` · `ERetired` | `a_retired_soul_cannot_be_rescoped` | `the_employer_can_rescope_a_live_soul` |
| A8 | `set_outward` · `ERetired` | `a_retired_soul_cannot_be_granted_outward` | `outward_can_be_granted_exercised_and_withdrawn` |
| A9 | `repin_mandate` · `ERetired` | `a_retired_souls_mandate_cannot_be_repinned` | `a_mandate_can_be_repinned_by_the_employer` |
| A10 | `repin_mandate` · `EBadDigest` | `a_repin_with_the_wrong_length_is_refused` | `a_mandate_can_be_repinned_by_the_employer` |
| A11 | `retire` · `ERetired` | `a_soul_cannot_be_retired_twice` | `retirement_is_a_state_change_and_never_a_deletion` |
| A12 | `record_spend` · `ERetired` | `a_retired_soul_cannot_spend` | `the_agent_may_spend_up_to_its_allowance_and_not_past_it` |
| A13 | `record_spend` · `ENotThisAgent` | `a_stranger_cannot_spend_another_souls_allowance` | `the_agent_may_spend_up_to_its_allowance_and_not_past_it` |
| A14 | `record_spend` · `EAllowanceExceeded` | `a_spend_one_unit_past_the_allowance_aborts`, `spends_accumulate_against_the_epoch_ceiling`, `a_spend_that_would_overflow_still_aborts_with_the_allowance_code` | `the_agent_may_spend_up_to_its_allowance_and_not_past_it` (to exactly zero) |
| A15 | `assert_outward` · `ERetired` | `a_retired_soul_cannot_act_outward_even_if_it_was_granted` | `outward_can_be_granted_exercised_and_withdrawn` |
| A16 | `assert_outward` · `ENotThisAgent` | `a_stranger_cannot_borrow_an_outward_permission` | `outward_can_be_granted_exercised_and_withdrawn` |
| A17 | `assert_outward` · `EOutwardNotPermitted` | `an_agent_may_not_act_outward_until_it_is_granted` | `outward_can_be_granted_exercised_and_withdrawn` |
| A18 | `book_earned` · `ERetired` | `nothing_can_be_earned_by_a_retired_soul` | `value_and_cost_book_against_the_open_epoch_and_the_totals` |
| A19 | `book_burned` · `ERetired` | `nothing_can_be_burned_by_a_retired_soul` | `value_and_cost_book_against_the_open_epoch_and_the_totals` |
| A20 | `settle_epoch` · `ERetired` | `a_retired_souls_epoch_cannot_be_settled` | `a_solvent_epoch_raises_the_allowance_by_a_quarter_of_the_surplus` |
| A21 | `settle_epoch` · `EEpochNotOver` | `an_epoch_cannot_be_closed_one_millisecond_early` | `a_solvent_epoch_raises_…` (at exactly one epoch) |
| A22 | `soul_of` · `ENotSouled` | `the_registry_refuses_to_resolve_a_stranger`, `the_registry_refuses_to_resolve_a_retired_agent` | `a_hired_agent_is_recorded_…` |

The soulbound property itself is not in that table and cannot be tested: no function transfers an
`EmployeeSoul`, the struct has `key` without `store`, and it is shared — a test that tried to move
one would not compile. The compiler is the test, and it runs on every build.

### Mutation testing

`engineering:move-mutate`, run against this package with
`protocolx-verify/engine/move-mutate/move-mutate.sh`. The report files it writes are generated
artifacts and are git-ignored; the recorded evidence is in
`work/reports/2026-09-04-engineering-northlatch-soul-package.md`.

---

## This package is NOT published

There is no `Published.toml`, no `deploy/`, no object id, and no `ci-expected-digest` here, because
there is nothing published to guard. **Publishing is a release step, not a build step**: it needs
the change record, the digest ceremony, and the Master's recorded word, through
`northlatch/docs/DELIVERY.md` stages 6 to 8. Nothing in this directory has touched a network.

Before that can happen, three things outside this package are still open:

1. **The adapter** that routes an agent's real spending through `record_spend`. Without it the
   ceiling guards only the transactions that volunteer to ask.
2. **The Mastercontroller address** — the design's open ask to the Master: a fresh address holding
   no cap, no custody and no funds, whose only powers are to bear souls and receive the referral cut.
3. **The books.** `book_earned` and `book_burned` need a process that reads `PaymentSettled` from
   chain, carries the coin type on every row, and counts what an agent costs to run. Nothing on this
   estate counts a token yet.

Licence: BUSL-1.1, Change Date 2029-09-01, Change License Apache-2.0 — the same terms as
`../sui-contracts`. See `LICENSE`.
