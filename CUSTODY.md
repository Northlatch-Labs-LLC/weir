# Where the money is, and who can move it

This document exists so that "Weir never takes custody" is something a reader can **check**, rather
than something this repository asserts about itself. Everything below is a property of
`sui-contracts/sources/`, and `packages/web/test/custody-guard.test.ts` fails if the code stops
matching it.

Read it with the modules open. Nothing here is a policy, a promise, or a description of intent:
every claim is either a function signature or the absence of a function.

## The shape of the answer

Money at rest in this system lives in **seven stored balances**, each a field of a shared object on
Sui. A balance inside a shared object is unreachable from outside the module that declares it —
Move enforces that, not us — so the complete list of ways value can leave is the complete list of
places a module splits one of those fields.

There are **seven** such places, one per balance. Each is named below with the single function it
sits in and the thing a caller must hold to reach it. The two parenthesised rows are not stored
balances: delegated stake is held as `StakedSui` tranches, and the referral leg is paid out of a
payment still in hand and is never stored at all.

| Balance | Object | What flows in | The only way out | What the caller must hold |
|---|---|---|---|---|
| `liquid` | `StakeVault` | supporter deposits, and stake proceeds returning | `stake_vault::withdraw` | the supporter's **own** `SocialAccount`, authenticated against `ctx.sender()` |
| `rebate_pool` | `StakeVault` | the supporters' share of realised staking yield | `stake_vault::claim_rebate` | the supporter's **own** `SocialAccount` |
| `creator_yield` | `StakeVault` | the creator's share of realised staking yield | `stake_vault::claim_creator_yield` | `StakeCap` — the creator's |
| `platform_yield` | `StakeVault` | the platform's share of realised staking yield | `stake_vault::claim_platform_yield` | `PlatformCap` |
| *(delegated stake)* | `StakeVault.tranches` | `liquid`, one rung at a time | `stake_ladder::stake_one_rung`, and back via harvest or unwind | nothing — it is internal, and `public(package)` |
| `earnings` | `CreatorVault<T>` | a subscription, unlock or tip, less fees | `creator::claim_earnings` | `CreatorCap` — the creator's |
| `platform_fees` | `CreatorVault<T>` | the platform's commission on that payment | `creator::claim_platform_fees` | `PlatformCap` |
| `treasury` | `Platform` | account and vault creation fees | `platform::sweep_treasury` | `PlatformCap` |
| *(referral leg)* | — | never stored | `creator::settle`, transferred as the payment is split | nothing; it is paid out in the same transaction |

## The claim, stated so it can fail

**No capability this company can hold reaches a supporter's principal.**

The two capabilities Weir or a creator can possess are `StakeCap` and `PlatformCap`. Neither
appears in the signature of `withdraw` or `claim_rebate`, and those are the only two functions in
the package that split `liquid` or `rebate_pool`. Both instead take the depositor's own
`SocialAccount` and call `account::assert_authenticates(depositor_account, ctx.sender(), …)`, so
the transaction must be signed by the supporter's own key.

There is no admin path, no pause that redirects funds, no recovery function, and no upgrade-gated
transfer. This is not a claim about restraint. It is that the function does not exist: adding one
would mean adding a `split` of `liquid` inside a function taking a capability, and the guard test
fails on exactly that.

**The platform's fee is segregated, not intermediated.**

`creator::settle` splits an incoming payment three ways *before* anything is stored: the referral
leg is transferred directly to the referrer in the same transaction, the platform's commission
joins `platform_fees`, and the remainder joins `earnings`. Both of those balances live inside **the
creator's own vault object**, per creator, never pooled. So the commission accrues where the
payment landed and is claimed from there; at no point does a payment pass through an account this
company controls. `claim_platform_fees` says why per-vault rather than pooled, in the source: a
creator's earnings and the platform's commission are never in one balance where an arithmetic error
could pay one from the other.

**The remainder is joined, not split.** `settle` takes the referral and platform legs out of the
payment and joins *what is left* to `earnings`, rather than splitting a computed `creator_net` and
destroying a supposedly-zero remainder. Conservation of value is therefore structural: there is no
arithmetic that has to come out exactly even for the money to be accounted for.

## What backs a supporter's deposit

`backing = liquid + staked_principal >= total_principal` is asserted at the end of every path in
`stake_vault` that moves money. A withdrawal that the liquid buffer cannot cover unwinds delegated
tranches, newest first, **inside the same transaction** — there is no queue, no notice period and
no approval step. The yield forgone by unwinding early is the creator's loss, never the
depositor's, because principal is credited back at face value and only the surplus is treated as
yield.

`stake_vault::credit_proceeds` is the one place stake proceeds are split into principal and yield,
and it has exactly two callers: `harvest`, on matured tranches, and `withdraw`, on the emergency
unwind. `packages/web/test/rebate-source-guard.test.ts` holds that caller list exact in both
directions, so the rebate pool cannot come to be fed from anything but staking.

## Keys this company holds, and what they are for

| Key | What it can do | What it cannot do |
|---|---|---|
| `PlatformCap` | set fees within compiled maxima, pause creation or payments, sweep the platform treasury, claim the platform's fee and yield legs | touch `liquid`, `rebate_pool`, `earnings`, or any creator's principal |
| upgrade capability | publish a new version of the package | move funds; an upgrade is a public on-chain transaction, and the current authority is published at weir.social/security |
| the harvest daemon's key | call `harvest`, which is permissionless and pays gas | direct where the proceeds go — the split is computed in the module |

The platform and upgrade capabilities are held in a 2-of-3 multisig. The daemon's key can only
call a function anybody could call.

## What this document does not cover

The agent purse (`packages/purse`, `packages/signer`, `packages/policy`) is an **agent's own** key
spending an agent's own money under its own policy. It is not a user's key, it takes no custody of
a user's funds, and nothing in it can reach any balance in the table above. Its own limits are
documented beside it.

Fiat is not in scope because there is none: settlement is on chain, from the buyer's own key.

## How this stays true

`packages/web/test/custody-guard.test.ts` parses the Move sources and asserts the table above:
the exact set of value-moving sites, the function each one sits in, which balances require the
depositor's own authentication, and that no capability-holding function splits a supporter-owned
balance. A tenth exit, a moved one, or a capability added to `withdraw` fails it.

It also asserts that every function named in this file still exists, so the document cannot quietly
fall behind the code it describes. A rename is meant to fail: the point of the document is that
somebody can follow it into the source.
