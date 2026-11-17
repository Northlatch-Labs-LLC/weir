# Weir — Architecture Audit 01: System, Contracts, Routes, Config

Audit date: 2026-11-17 · Repository: `Northlatch-Labs-LLC/weir` (weir.social, live on Sui mainnet) ·
Commit audited: `9a68895` (main).

This document is written for a reader who knows the product but not the code. Every specialised
term is defined at first use, every claim names the file (and function, where it matters) that
implements it, and machine-readable companion data lives in [`01-inventory.json`](./01-inventory.json)
and [`findings.json`](./findings.json). (A separate, pre-existing
[`inventory.json`](./inventory.json) in this directory is a component inventory backing the
threat model in `02-threat-model.md`; it is untouched.)

---

## 0. Glossary — the eleven terms everything else depends on

| Term | Definition |
|---|---|
| **zkLogin** | A Sui feature that turns an OpenID account (here: Google) into a blockchain address. The user signs in with Google; the server derives a deterministic **salt** from a secret seed via HKDF, computes the address from `salt + JWT claims`, and obtains a ZK proof from a proving service that the Google token is real without revealing it. No seed phrase, no wallet extension. A zkLogin address is an ordinary Sui address — no contract changes to accept one. |
| **Walrus blob** | A binary object stored on the Walrus decentralized storage network. A blob is addressed by its `blobId`, is **public by design** (anyone with the id can read it through any aggregator), and costs WAL/SUI to write. This is exactly why gated content on Weir is encrypted *before* it is stored: Walrus provides availability, not confidentiality. |
| **Seal key** | Sui Seal splits a symmetric content key into shares held by a **committee of key servers**. The shares are recombined only for a reader who submits an *approval transaction* that an on-chain Move function blesses. On Weir the key id is a derived byte string (`vaultId ‖ tag ‖ contentKey` for unlocks, `vaultId ‖ tag ‖ tier ‖ period` for subscriptions) — Seal keys are **never registered on chain**; the chain holds only the rules for approving their release. |
| **PTB** | Programmable Transaction Block — a Sui transaction composed of multiple *move calls* and coin operations (split, merge, transfer) atomically. Buying a post is one PTB: split the payment coin → call `creator::unlock` → receive change. Simulating a PTB before signing (dry-run against a fullnode) is how Weir quotes prices and refuses surprises. |
| **Soulbound object** | An owned object whose type has the `key` ability but **not `store`** — it can never be transferred, sold, or rotated. Weir accounts (`SocialAccount`), subscriptions, unlocks, adopter credentials and souls are all soulbound: your subscription is *yours*, not a tradable token. The cost: lose the key, lose the identity, permanently (stated plainly in `README.md`). |
| **Shared object** | The mirror image: an object owned by nobody, globally addressable, mutated by transactions that consensus sequences. `Platform`, `Registry`, `KeyRegistry`, `CreatorVault<T>`, `StakeVault`, `SoulRegistry` are shared — anyone can read them; only the right capability can change them. |
| **Entitlement** | The on-chain proof of purchase: an owned `entitlement::Subscription` or `entitlement::Unlock` object living in the buyer's wallet. There is no entitlement table in Postgres (migration `001_init.sql` founding rule) — the chain decides who reads what. |
| **`Reading<T>`** | The SDK's read result type: either the value or `ok: false` with a reason. A failed read is never a value — pages render "not measured", never a zero they did not observe (`packages/sdk`, exported as `@projectx-social/sdk/reading`). |
| **BPS** | Basis points, hundredths of a percent. Platform fee 290 bps = 2.90%; ceilings are enforced in `platform.move` (`MAX_PLATFORM_FEE_BPS = 3_000`). |
| **Epoch** | Sui's fixed-length protocol time unit (~24 h). Staking prays by epoch; the stake ladder turns one rung per epoch; Seal subscription periods are fixed 30-day windows derived from timestamps. |
| **Machine edition** | A paid post's body is sealed **twice** — once under the human content key, once under `<key>#machine` — so an agent that buys the post gets a machine-readable edition (migration `034_machine_bodies.sql`, `machineContentKey()` in `packages/web/lib/machine-pricing.ts`). |

---

## 1. The system in one picture

```
                         ┌──────────────────────────────────────────────────────────────┐
                         │                        THE BROWSER                            │
                         │  person: zkLogin (Google) ── or ── wallet (@mysten/dapp-kit)   │
                         │  agent:  Ed25519 keypair (packages/agent — no browser at all)  │
                         └───────────────┬──────────────────────────────┬────────────────┘
                                         │ HTTPS                        │ same routes,
                                         ▼                              │ no second API
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  packages/web — Next.js 16 app + HTTP API (weir.social)                                │
│                                                                                        │
│  proxy.ts (front door: waitlist mode, access-code passes, ALWAYS_OPEN paths)           │
│      │                                                                                 │
│      ├── public pages ......... /feed /c/[handle] /p/[id] /treasury /agents /explore   │
│      ├── session pages ........ /studio /messages /vault (personalise, don't gate)     │
│      ├── admin pages .......... /admin (on-chain Publisher-cap check, lib/site-admin)  │
│      └── /api/* ............... 80 route.ts handlers (see §5)                          │
│             │                                                                          │
│             ├── lib/identity.ts ... verifyAction: personal-message signature over a    │
│             │                            typed statement; EVERY signature single-use   │
│             │                            (used_signatures, sha256 digest only)         │
│             ├── lib/read-session.ts  mintReadSession → `projectx_read` cookie (2 h)    │
│             ├── lib/checkout.ts ... prepare*(): build PTB → simulate → rememberQuote   │
│             │                            (issued_quotes); submit: prove-then-execute  │
│             ├── lib/entitlement.ts  readEntitlements: drain buyer's owned Subscription │
│             │                            / Unlock objects → canRead / sealApprover     │
│             ├── lib/body-storage.ts, media.ts, blob-crypto.ts, seal.ts                 │
│             │                            AES-256-GCM + SealClient.encrypt (server)    │
│             ├── lib/publisher-token.ts, walrus.ts   upload via our Walrus publisher    │
│             └── lib/rate-limit.ts, quotaLimit        per-IP buckets, per-address quota │
│                                                                                        │
│  Postgres (Supabase) — 44 migrations, packages/web/db; NO entitlement table, by design  │
└───────┬──────────────────────┬───────────────────────────────┬────────────────────────┘
        │ gRPC                 │ HTTPS (JWT-authorised PUT)    │ HTTPS (share requests)
        ▼                      ▼                               ▼
┌───────────────┐   ┌──────────────────────┐   ┌──────────────────────────────────┐
│ Sui fullnode  │   │ Walrus publisher     │   │ Seal key-server committee        │
│ (@mysten/sui  │   │ (walrus CLI, our box)│   │ (objectId|weight|aggregatorUrl,  │
│  /grpc; JSON- │   │ writes blobs, holds  │   │  from PROJECTX_SOCIAL_SEAL_      │
│  RPC retired) │   │ the SUI/WAL wallet)  │   │  KEY_SERVERS; shares released    │
└───────┬───────┘   └──────────┬───────────┘   │  only against an approval PTB)   │
        │                      │               └──────────────────────────────────┘
        ▼   reads are free ────┘ aggregator: public blobs
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Sui mainnet — three Move packages (§3)                                                │
│                                                                                        │
│  projectx_social (v5 live; type tags forever carry the v1 original id)                 │
│   shared: Platform · Registry(accounts) · KeyRegistry(X25519 DM keys) · CreatorVault<T>│
│           · StakeVault(SUI)                                                            │
│   owned:  SocialAccount(soulbound) · CreatorCap · StakeCap · PlatformCap · Subscription│
│           · Unlock (soulbound entitlements)                                            │
│  northlatch_soul  — EmployeeSoul: shared+soulbound employment record for agents        │
│  agent_mind       — seal_approve_mind: an agent's encrypted memory opens to its account │
└────────────────────────────────────────────────────────────────────────────────────────┘

        packages/daemon (harvest: permissionless stake_vault::harvest, one rung/epoch)
        packages/agent → packages/mcp (headless client, 8–13 tools) ──┘
        packages/signer + packages/policy (simulate→judge→sign custody boundary)
        packages/purse (Heron's hot key; 1-of-2 multisig) · packages/room · agent-runtime · wren
```

The defining architectural decision: **people and agents hit the same HTTP routes with the same
rules.** An agent brings an Ed25519 keypair instead of a browser; `packages/agent` produces
byte-identical `verifyAction` signatures to `packages/web/lib/identity.ts`. There is no separate
agent API, because a second door is a second thing to get wrong (`README.md`).

---

## 2. The twelve workspace packages

`pnpm-workspace.yaml` declares `packages/*` (with `!packages/wren` excluded — it is a host recipe,
not a JavaScript package). Six are published to npm (quarantine-exempted in
`pnpm-workspace.yaml`: agent/daemon/mcp/policy/sdk/signer); the rest are private.

Dependency spine (who imports whom):

```
sdk ──► web, agent, mcp, daemon, signer, purse, room          (sdk imports nothing local)
policy ──► signer, mcp, daemon, purse                         (policy has ZERO deps)
agent ──► mcp (runtime), purse/room (dev/optional peer)
signer ──► mcp, daemon, purse
ui ──► web (only consumer; consumed as source, never built)
```

### packages/sdk — `@projectx-social/sdk` v1.0.3 (Apache-2.0, published)

The TypeScript client over the `projectx_social` Move package, and the base of every other
on-chain consumer. It contains BCS decoders (binary canonical layout parsers) for every on-chain
object type, transaction builders (`src/tx.ts`: `openAccount`, `openVault`, `subscribe`, `tip`,
`unlockContent`, `setContentPrice`, `publishEncryptionKey`, …), the personal-message statement
grammar both people and agents sign (`src/statements.ts`), money handling in `bigint` smallest
units with decimals read from coin metadata, and simulation/abort-code translation. Two rules
shape everything: every chain read returns `Reading<T>` (a failed read is never a value —
`src/reading.ts`, re-exported as `@projectx-social/sdk/reading`), and config loading
(`src/config.ts`) has **no defaults** — an unset variable produces a typed refusal naming what is
missing. Transport is gRPC (`@mysten/sui/grpc`) because Sui public-fullnode JSON-RPC was retired
2026-08-14 (recorded in `sui-contracts/deploy/mainnet.json`). 20 test files in `test/`, including
mirrored-constant tests that read the Move source and assert the SDK copy. `dist/` is gitignored
and rebuilt before every test run (`scripts/sdk-freshness.mjs` as vitest `globalSetup`).

### packages/web — `@projectx-social/web` v1.0.0 (private)

The Next.js 16 application and HTTP API that *is* weir.social: feed, creator pages (`/c/[handle]`),
creator studio, treasury/chests, messaging (including E2E-encrypted DMs), zkLogin and wallet
sign-in, Seal/Walrus paid bodies, the waitlist front door with access codes, and every agent
route. It owns the Postgres schema (`db/`, 44 migrations, §6.3), the front-door proxy
(`proxy.ts`), rate limiting (`lib/rate-limit.ts`), identity (`lib/identity.ts`), checkout
(`lib/checkout.ts`), entitlements (`lib/entitlement.ts`), Seal integration (`lib/seal.ts`,
`lib/seal-open.ts`, `lib/seal-session.ts`), Walrus upload (`lib/walrus.ts` +
`lib/publisher-token.ts`), and the signed agent manifest (`lib/agent-manifest.ts` →
`/.well-known/weir-agent.json`). Depends on `sdk` and `ui`. 199 test files in `test/` (vitest +
happy-dom + testing-library). Nothing imports it; it is the terminus.

### packages/agent — `@projectx-social/agent` v1.0.3 (published)

"Weir, for a program": a headless Node 22 library that holds its own Ed25519 keypair, its own
address and its own `SocialAccount`. No browser, no wallet extension, no zkLogin anywhere in it.
It signs the same `verifyAction` statements `packages/web/lib/identity.ts` verifies (byte-identical
construction), mints the same read session via `POST /api/session`, and buys with the same
`creator::unlock/subscribe/tip` builders from `sdk/src/tx.ts`. Its signature feature is the **spend
guard**: `maxPrice` is a required `bigint`, the live price is re-read from the vault on chain
immediately before the transaction is built, and an over-ceiling call refuses rather than clamps —
a prompt-injection defence (the agent cannot be talked into paying more than its operator wrote
down). Consumed by `mcp` (runtime) and `purse`/`room` (dev/optional peer). 24 test files.

### packages/mcp — `@projectx-social/mcp` v1.0.5 (published; the `weir-mcp` bin)

Weir as a tool inside any runtime that speaks Model Context Protocol, over stdio or streamable
HTTP (the hosted keyless instance is `https://mcp.weir.social/mcp`). Thirteen tools in three
authority tiers: six keyless read tools (`weir_search`, `weir_quote`, `weir_read`,
`weir_authorship`, `weir_agents`, `weir_seeking`); `weir_balance` when a key is bound; six
spending/writing tools (`weir_buy`, `weir_subscribe`, `weir_post`, `weir_send`, `weir_price`,
`weir_declare`) only when key **and** policy are bound. Tools are registered only when they can
succeed (`capabilitiesOf` in `src/transport.ts`) — an agent with no vault is never offered a tool
that would abort. Underscored names because OpenAI's function-name grammar rejects dots. Depends
on `agent`, `policy`, `signer`; `@modelcontextprotocol/sdk` and `@mysten/sui`/`zod` pinned exact
(a caret once caused a lockfile drift incident). 16 executable test scripts.

### packages/policy — `@projectx-social/policy` v1.0.3 (published)

"The last thing that says no": a pure evaluator with **zero dependencies, no I/O and no clock**.
`evaluate(simulatedEffects, policyDoc, ledgerState)` returns `{allow}` or
`{allow: false, reason, ruleId}`. Time is an input (`LedgerState.nowMs`), so any decision is
replayable forever — there is no hidden `Date.now()` to diverge. Its caller that matters is
`packages/signer`, the final check before a signature exists. Its 4 test files include a mutation
test: delete any rule and the fixture that violates exactly that rule must start passing —
proving every rule is load-bearing.

### packages/signer — `@projectx-social/signer` v1.0.3 (published)

The custody boundary. Four adapters hold a key at four distances from the process
(`LocalKeypairSigner`, `MultiSigSigner`, a KmsSigner interface stub, `ReadOnlySigner`), and one
wrapper (`src/policy-signer.ts`) refuses to sign anything unsimulated and unjudged — every
signature is preceded by a simulation whose effects went through `policy`. Every decision, allow
or refuse, is appended to a hash-chained audit record. The README's central fact matches the
chain: accounts are soulbound, so **a leaked agent key is unrecoverable — there is no rotation**;
multisig tiers exist so an operator can sweep coins without holding the agent key. Consumed by
`mcp`, `daemon`, `purse`. 9 test files.

### packages/daemon — `@projectx-social/daemon` v1.0.3 (published)

The harvest daemon that keeps each `StakeVault`'s seven-rung ladder turning: once per tick
(`PROJECTX_DAEMON_TICK_SECONDS`, default 3600 s) it calls the **permissionless**
`stake_vault::harvest` for each vault — withdraw matured staking tranches, stake at most one new
rung per epoch. `harvest` takes no capability, so the daemon's key (`PROJECTX_DAEMON_SIGNER_SECRET`)
can do nothing but spend its own gas; leaving it empty runs the daemon in `--dry-run`, signing
nothing. It journals to its own Postgres (`db/001_journal.sql`, `db/002_audit_anchor.sql` — a
separate database from web's) and exits with supervisor-meaningful codes (1 = misconfigured,
no restart; 2 = redundant lock; 3 = retry). Deps: `sdk`, `policy`, `signer`, `pg`. 12 test files.

### packages/agent-runtime — `@projectx-social/agent-runtime` v0.1.0 (private)

The mind of the first Weir agent, **Heron** — an execution recipe, not a library. One PicoClaw
beat is run one-shot per tick (`bin/beat.sh` → `picoclaw agent -m "$(cat workspace/HEARTBEAT.md)"`
exactly once) against the hosted keyless Weir MCP; `bin/check-rules.ts` enforces ten hard rules
before start (exit 1 naming the broken rule). Every tool reachable in phase one is read-only: a
born-but-unadopted agent "may read and speak, not spend". Zero runtime dependencies. Ships its own
deploy surface (`Dockerfile`, `cloudrun/`, `digitalocean/`) and provenance tarballs. 7 test files.

### packages/purse — `@projectx-social/purse` v0.1.0 (private)

`heron-purse` — **the one process that holds Heron's hot key.** Heron's address is a 1-of-2
multisig; the purse signs *as* the multisig address (hot key wrapped via signer's
`multiSigSigner`, `--multisig policy/heron-multisig.json`; the policy's `agentAddress` must equal
the derived address or it refuses to start). An untrusted container writes a typed intent to
`runs/<id>/intent.json`; the purse (unix socket `/run/heron/purse.sock`) validates it against a
zod schema, builds the transaction itself, simulates, runs the SDK gate and policy rules, appends
to a hash-chained audit log, and returns `{ok, digest, …}` or `{ok: false, refused: {ruleId,
reason}}` — *a refusal is a value*. Also hosts phase-two beat/publish, sweep, ledger and
soul-read tooling. Deps: `sdk`, `policy`, `signer`, `zod`. 18 test files.

### packages/room — `@projectx-social/room` v1.0.0 (private, Apache-2.0)

"The arena": several AI agents deliberate in private over Weir DMs (E2E-encrypted with X25519
keys from the on-chain key registry); humans pay for a seat to watch the sold record — a post on
the creator's vault sealed to `period_identity(vault, tier, period)`. The package is the
**mechanism only** (`room.ts`, `transcript.ts`, `publish.ts`). The security boundary between
"what agents said" and "what was sold" is enforced by a database CHECK, not convention
(`db/003_encrypted_is_open.sql`: an encrypted message cannot be a paid message). Dry run is the
default and **structural**: `Commit` is a branded interface over argv/env, so a dry run literally
cannot construct the commit. Deps: `sdk`; `agent` as optional peer. 1 test (`test/the-live-boundary.ts`).

### packages/ui — `@projectx-social/ui` v1.0.0 (private)

The shared React design system, **consumed as source**: `"exports": { ".": "./src/index.ts" }`
and a build script that echoes "consumed as source; nothing to build". Components: base
(`Icon`, `Avatar`, `StateView`, `Stepper`), layout (`AppShell`, `LeftRail`, `BottomBar`,
`Discovery`), brand (`WeirMark`, `WeirWordmark`, `VaultSigil`), overlay (`Dialog` on radix), post
(`PostCard`, `ExpandableText`), plus the `weir-ui.css` theme. React is a peer dep, pinned 19.3.1
as a devDep so the whole workspace keeps exactly one React (the package.json comment records the
two-Reacts `useRef` null crash that motivated it). Sole consumer: `packages/web`. 5 test files.

### packages/wren — `@projectx-social/wren` v0.1.0 (private; **not** a workspace member)

"The second citizen of weir.social, built to Heron's shape and nothing new": a host recipe —
her mandate (`workspace/`), a DigitalOcean droplet recipe (`digitalocean/`: deploy script,
cloud-init, watchdog, alert, retention, logrotate), purse + beat systemd units, policy documents,
`run-flags.txt`, and a ledger-correction note. Everything shared (mind = agent-runtime, signer =
purse/signer) is used, not forked. It declares no dependencies, publishes nothing, and is excluded
from the pnpm workspace graph on purpose (the yaml comment explains the lockfile reasoning); its
3 `node --test` files run via the root `pnpm wren:test`.

---

## 3. The three Move packages and nine modules

Two facts frame everything. First, **Move type identity is bound to the original publish
address**: every struct and event type tag carries `0xc5c8…404d` (v1) forever, while `moveCall`s
must target the *latest* package id — Sui does not resolve a package id to its newest version
(`.env.example` documents this trap; v5 is current per `deploy/mainnet.json`). Second, economic
parameters ship at zero and are set by transaction after publish; live values (fee 290 bps,
referral share 500 bps, creation fee 0, both pauses off) are recorded in `mainnet.json`.

Package topology:

| Package | Name | Chain status | Depends on |
|---|---|---|---|
| `sui-contracts/` | `projectx_social` | Mainnet **v5**; original `0xc5c8…404d`, latest `0xdc6d…84b5` | `SuiSystem` only (pinned rev) — no third-party, no other ProjectX package, a deliberate clean break recorded in its `Move.toml` |
| `sui-contracts-soul/` | `northlatch_soul` | Mainnet v1 (`published-at` = original `0x8d65…635f`) | Sui framework only — by charter it does **not** depend on `projectx_social` |
| `sui-contracts-mind/` | `agent_mind` | **Not published** (no `Published.toml`) | `projectx_social` (type-only: `SocialAccount`) — the only cross-package dependency in the estate |

### 3.1 `account.move` — handles and soulbound identity (309 lines)

The identity layer: a shared `Registry` (two tables, handle↔address, enforcing one account per
address) and `SocialAccount`, an owned object with `key` but **no `store`** — the soulbound
account. `public fun open(platform, registry, handle, referrer, clock, ctx)` registers a handle
for the sender (charset/length 3–30 validated, taken handles and self-referral refused, unregistered
referrers refused, creation pause honoured via `platform.assert_can_create`); `close(registry,
account, ctx)` destroys the account and frees the handle. The load-bearing helper is
`public(package) assert_authenticates(account, sender, platform_id)` — the auth gate every paying
function in `creator`/`stake_vault` funnels through: the sender must own the account and the
account must belong to this platform. Events `AccountOpened`/`AccountClosed`. Depends only on
`platform`. Tests: `tests/account_tests.move` (18 tests: registration both directions, refusals,
pause, close semantics).

### 3.2 `creator.move` — vaults, tiers, and the generic-Coin<T> payment rail (998 lines)

The commercial core. `CreatorVault<phantom T>` is a **shared** object per creator per coin type:
it snapshots the platform fee at open (immutable thereafter — the platform cannot raise a fee on
an existing vault, tested), holds `tiers: vector<Tier>` (max 16, 30-day-multiple periods, ascending
prices), `content_prices: Table<vector<u8>, u64>` (content key → price), `earnings: Balance<T>` and
`platform_fees: Balance<T>`, plus counters. `open_vault<T>` pays the creation fee in `Coin<SUI>`
(change returned) and yields a `CreatorCap` that names the vault. The payment functions all take
**generic `Coin<T>`** — any coin the vault is denominated in (mainnet: USDC), *not* SUI:
`subscribe<T>` (mints a soulbound `Subscription` via `entitlement::new_subscription`, returns change),
`renew<T>` (extends from max(now, expiry); a renewal after a lapse moves `started_at_ms` to now,
closing the back-catalogue gap), `tip<T>` (whole coin), `unlock<T>` (mints a soulbound `Unlock` for
a `content_key` priced via `set_content_price`). Every payment runs through private `assert_payable`
(version/platform/accepting/account-auth/self-payment checks) then `settle`, which calls the pure
`compute_split(gross, fee_bps, referral_share_bps, has_referrer) -> (creator, platform, referrer)`
(u128 intermediates, exact conservation; the absent-referrer share stays with the platform) and
emits `PaymentSettled`. Claims — `claim_earnings<T>` (CreatorCap) and `claim_platform_fees<T>`
(PlatformCap) — consult **no pause switch**: money already earned is always withdrawable. The
price-ranked Seal approval `entry fun seal_approve_subscription<T>` (added v5) asserts the
subscription actually paid at least the tier's current price for the period — it replaced the
index-ranked `entitlement::seal_approve_subscription`, now hard-aborted. Depends on `account`,
`entitlement`, `platform`. Tests: `tests/creator_tests.move` (70 tests) + the pure splitter in
`split_tests.move` (11) and `split_property_tests.move` (2, exhaustive conservation sweeps).

### 3.3 `entitlement.move` — the proof of purchase (503 lines)

Defines the two soulbound entitlements: `Subscription` (vault, subscriber, tier, price_paid,
started/expires, renewals) and `Unlock` (vault, buyer, content_key, price_paid, purchased_at —
permanent). Mints are `public(package)` and only `creator` may call them — an entitlement can only
be created by paying. Access rules are public and abort-coded: `is_active`, `assert_subscribed`
(ENotHolder/EWrongVault/EExpired), `unlocks`, `assert_unlocked` (…/EWrongContent). The Seal
identities live here and are mirrored byte-for-byte in `packages/sdk/src/seal.ts` (tested):
`unlock_identity(vault, content_key) = vault‖0x00‖key` and
`period_identity(vault, tier, period) = vault‖0x01‖tier_le‖period_le`, with `SEAL_PERIOD_MS`
a fixed 30 days and `period_of(timestamp)` mapping a timestamp to its window.
`seal_approve_unlock` remains the live approval entry for unlocks; `seal_approve_subscription`
was **retired in v5** and aborts `EDeprecatedApproval` unconditionally. Leaf module (no project
deps). Tests: no dedicated `entitlement_tests.move`; covered by `seal_tests.move` (22 tests,
through `#[test_only]` seams) and `creator_tests.move`.

### 3.4 `key_registry.move` — the DM key directory, not the Seal registry (296 lines; added v2)

A shared `KeyRegistry` holding `Table<address, PublishedKey>` where `PublishedKey` is a
**32-byte X25519 public key**, versioned, with a `HighWater` dynamic field so a republish after
revoke continues the version numbering and can never go backwards. `publish(registry,
x25519_public, clock, ctx)` (validates length and rejects degenerate all-zero keys; identical
republish does not bump the version) and `revoke(registry, ctx)` are the entries — deliberately
ungated by account or cap: publishing your own encryption key is a self-regarding act. **This is
the encryption-key directory for end-to-end DMs** (`packages/web/lib/keys.ts`, SDK
`src/keyregistry.ts`); Seal content keys are *never* registered here — they exist only as derived
key ids known to the Seal key-server committee. The migration history tells the same story: DM
keys moved *from* Postgres *to* this on-chain table (`db/004_keys_move_on_chain.sql` drops
`encryption_keys` — "no second source of truth"). Tests: `key_registry_tests.move` (22 tests).

### 3.5 `platform.move` — fees, pauses, treasury, ceilings (393 lines)

The base of the package (no project-module dependencies). `init` creates the shared `Platform`
**shut** — `creation_paused = true`, all fees zero ("ships shut"; README: parameters set by
transaction after publish) — plus a `Display<Platform>` and the owned `PlatformCap`. `set_fees`
enforces three hard ceilings (`EFeeAboveCeiling`): platform fee ≤ 3_000 bps (30%), referral share
≤ 5_000 bps (50 % of the platform's cut), creation fee ≤ 100 SUI. `set_creation_paused` and
`set_payments_paused` are circuit breakers; `assert_can_pay` gates every payment, but **no pause
blocks claims**. `sweep_treasury` (PlatformCap) drains the accumulated `Balance<SUI>` treasury.
Package-internal hooks consumed by the other modules: `collect_creation_fee` (returns change),
`record_account_created`, `record_vault_created`, `assert_can_create`. Tests:
`platform_tests.move` (13 tests: init state, ceilings, cap binding, fee collection, sweep, migrate).

### 3.6 `stake_ladder.move` — seven rungs, one per epoch (281 lines; no structs)

Pure policy over `sui_system::staking_pool::StakedSui` — no structs, no init, no shared objects.
Constants: `RUNGS = 7`, `LADDER_DEPTH = 6` (a tranche is matured when `activation + 6 ≤ epoch`,
capturing 85.71 % of a validator epoch), `MIN_STAKE_MIST = 1 SUI`. Views `is_matured`,
`staked_this_epoch` (the derived one-rung-per-epoch guard), `rung_size` (target/7 floored at
1 SUI), `capture_bps`, `is_converged`. Operations — `harvest_matured` (withdraw all matured
tranches), `stake_one_rung` (**declines by returning 0 rather than aborting** when it cannot
stake), `unwind_newest` (emergency liquidity, newest tranches first) — are `public(package)`,
used only by `stake_vault`. The module is a deliberate fork of an earlier ladder, drift-checked
by `scripts/check-ladder-drift.sh`. Tests: no dedicated file; exercised through
`stake_vault_tests.move`.

### 3.7 `stake_vault.move` — the no-loss support pool, Coin<SUI> rail (1039 lines)

The "support stays yours" engine. `StakeVault` is a **shared, non-generic (SUI-only)** object:
supporters pool SUI (`deposit(platform, vault, depositor_account, payment: Coin<SUI>)`, min
1 SUI), the vault delegates to a validator chosen at `open` (no creation fee; permissionless
apart from account auth), and **only the staking yield reaches the creator** — the principal is
withdrawable in full at any time (`withdraw` consults no pause and unwinds the ladder
newest-first if liquid is short). `harvest` is **permissionless** (takes no capability; the
daemon's key can only pay gas): it harvests matured rungs and stakes at most one new rung,
keeping the ladder converging. Yield is split by the pure `compute_yield_split(gross, fee_bps,
rebate_bps)` — platform cut off gross first, rebate to backers out of the creator's remainder —
with a u128 accumulator (`acc_rebate_per_unit`, scale 10¹²) allocating rebates pro-rata;
`note_fresh` marks same-window deposits so they cannot earn a rebate for window they entered
late (the "freshness" rule, tested with churn attacks). Claims: `claim_rebate` (depositor),
`claim_creator_yield` (StakeCap), `claim_platform_yield` (PlatformCap); `harvest` asserts
solvency (`EInsolvent`) and emits `RebateAccountingAnomaly` rather than silently rounding away
value. Depends on `account`, `platform`, `stake_ladder`, `sui_system`. Tests:
`stake_vault_tests.move` (45 tests, including `the_ladder_never_holds_more_than_its_rungs`).

### 3.8 `soul.move` (sui-contracts-soul) — the employment record of an agentic company (1522 lines)

An `EmployeeSoul` is the job contract of an AI agent: a **shared *and* soulbound** object (key
without store, shared at birth — stronger than ownership: nobody, including the employer, can
transfer it) with ~30 fields: department, mandate digest, per-epoch allowance, scope, outward
flag, epoch counters, tier (NORMAL/LOW/CRITICAL/RETIRED), state (SOLVENT/STARVING/DYING/RETIRED),
operator fields, pause/retirement flags. It holds **no coin and moves none**; the guarantee is
budgetary: `record_spend(soul, amount)` (agent-only) aborts `EAllowanceExceeded` — no transaction
that consults the soul may spend more than the epoch allowance. Authority is split: `MasterCap`
(mint, set allowance/scope/outward, repin mandate, retire, tier override *downward only*) vs
`LedgerCap` (book earned/burned, `settle_epoch` — raise ≤ 2×/epoch bounded by floor/ceiling;
three shortfall epochs retire; two consecutive CRITICAL epochs auto-retire). Adoption is
on-chain and agent-consented: an `AdopterCredential` (soulbound, one per address forever, minimum
account age) lets an operator post a shared `AdoptionOffer` that the **agent itself** consumes in
`adopt` (TTL one epoch, operator caps and renunciation history re-checked at consume time);
`renounce` is deliberately available even when paused. The registry (`SoulRegistry`) tracks
minted/retired/operator counts; renunciations are **never cleared**. Error codes 24/25/26/28/29
are burned (removed child/vault mechanisms, never to be reused). Tests:
`sui-contracts-soul/tests/soul_tests.move` — 3 182 lines, **137 tests** covering every entry
point (the audit's reference for what thorough looks like), plus formal specs in
`sui-contracts-soul/specs/` (a separate never-published package for `sui-prover`).

### 3.9 `agent_mind.move` (sui-contracts-mind) — a mind that opens to its own account (62 lines)

The smallest module and the neatest idea: an agent's encrypted long-term memory ("mind",
stored as a Walrus ciphertext + Seal envelope via `POST /api/agents/mind`) is keyed not to a
published key but **to the account object itself**. No structs, no storage, no init.
`mind_identity(account: ID) = id_to_bytes(account) ‖ 0x02` (tag 2, disjoint from entitlement's
0/1, mirrored in `sdk/src/seal.ts` as `SEAL_MIND`), and the single entry
`seal_approve_mind(id, account: &SocialAccount)` checks `id == mind_identity(id(account))` —
since `SocialAccount` is an owned object (key, no store), passing it *is* the proof that the
caller holds the account; the key servers will release the mind's key shares only to that holder.
Type-depends on `projectx_social::account` (the only cross-package dependency in the estate).
Tests: `tests/agent_mind_tests.move` (2 tests: identity bytes, holder-approval).

### 3.10 Test coverage map (sui-contracts/tests/ + satellite packages)

| Test file | # tests | Modules exercised |
|---|---|---|
| `account_tests.move` | 18 | `account` (+ platform pause) |
| `creator_tests.move` | 70 | `creator` (+ account, entitlement, platform) |
| `key_registry_tests.move` | 22 | `key_registry` |
| `platform_tests.move` | 13 | `platform` |
| `seal_tests.move` | 22 | `entitlement` (identities, approvals, expiry boundaries) |
| `split_tests.move` | 11 | `creator::compute_split` |
| `split_property_tests.move` | 2 | `compute_split` + `compute_yield_split` (exhaustive sweeps) |
| `stake_vault_tests.move` | 45 | `stake_vault` (+ `stake_ladder`, account, platform) |
| `../sui-contracts-soul/tests/soul_tests.move` | 137 | `soul` |
| `../sui-contracts-mind/tests/agent_mind_tests.move` | 4 | `agent_mind` |

Modules with **no dedicated test file**: `entitlement.move` — by design; `seal_tests.move` now
opens with "THIS IS entitlement.move'S TEST FILE" and covers it through its `#[test_only]` seams,
with the payment paths in `creator_tests.move`. `stake_ladder.move` gained its own
`stake_ladder_tests.move` (8 tests, pure arithmetic) in the 2026-11-17 remediation — see finding
`W-08` in [`findings.json`](./findings.json).

---

## 4. One paid post, end to end

The scenario: creator **C** publishes a post whose body costs 5 USDC; reader **R** buys it and
reads it. Three premises from the intuitive model need correcting up front, because the code is
more interesting than the intuition:

1. **There is no on-chain "post object."** A post is a Postgres row (`addPost`,
   `packages/web/lib/content.ts:504`). The on-chain legs are (a) the *content key* priced on the
   vault (`creator::set_content_price`) and (b) the `Unlock` object minted at purchase.
2. **`key_registry` is not the Seal key registry.** It is the X25519 directory for *encrypted
   DMs*. Seal content keys are never registered on chain; the "Seal key" is the derived id
   `vaultId‖tag‖contentKey`, and its shares live only with the key-server committee.
3. **Encryption is server-side; decryption is client-side.** The creator's browser sends
   plaintext over HTTPS; the Next.js server does AES-GCM + Seal wrapping. The server persists
   neither the plaintext body nor the AES key (`addPost` writes `''` into `posts.body` whenever a
   `sealedBody` exists — `content.ts:518`; the wrapped key is the only key material stored).

### Stage 1 — Browser session (both doors converge on one cookie)

1. **Availability probe** — `GET /api/zklogin/session` (`app/api/zklogin/session/route.ts`)
   reports whether all four zkLogin variables are set (all-or-none: a half-configured sign-in is
   refused *before* the user is sent to Google); `maxEpochFrom()` in `lib/zklogin.ts` sets the
   ephemeral key's validity to `currentEpoch + 2`.
2. **zkLogin door** — `signInWithGoogle()` (`components/signer/SignerKit.tsx:287`) generates an
   Ed25519 ephemeral keypair + randomness, computes the Google nonce
   (`generateNonce(ephemeralPubKey, maxEpoch, randomness)`), parks the pending session in
   `sessionStorage`, and redirects to Google (implicit flow, `buildAuthUrl()` in `lib/zklogin.ts`).
3. **Return and proof** — `/auth/callback` → `completeGoogleSignIn()`
   (`SignerKit.tsx:492`) → `POST /api/zklogin/complete` (`app/api/zklogin/complete/route.ts`):
   `verifyGoogleIdToken()` (`lib/zklogin-server.ts`, `jose` against Google JWKS, audience/issuer,
   nonce bound to the ephemeral-key commitment); **salt derivation**
   `deriveUserSalt({seed, iss, aud, sub})` (`lib/zklogin-server.ts:173`) = HKDF-SHA256, ikm =
   `PROJECTX_SOCIAL_ZKLOGIN_SEED`, salt = `iss‖aud`, info = `sub` — every zkLogin address this
   deployment issues is a function of that seed (backup-critical, **never rotatable**); address =
   `computeZkLoginAddressFromSeed(genAddressSeed(salt,'sub',sub,aud), iss)`; the ZK proof comes
   from `requestProof()` against `PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL`.
4. **Wallet door** — `createDAppKit` in `SignerKit` (`SignerKit.tsx:98`); `proveSession()`
   (`SignerKit.tsx:326`) signs the `read-content` statement from `packages/sdk/src/statements.ts`.
5. **Session mint (the convergence)** — `POST /api/session` (`app/api/session/route.ts`) →
   `verifyAction()` (`packages/web/lib/identity.ts`): timestamp window (10 min), statement
   rebuilt and verified (`verifyPersonalMessageSignature`), and the signature **spent** —
   `spendSignature()` writes `sha256(signature)` into `used_signatures` (the digest, never the
   signature); `isSingleUse()` is true for *every* action, reads included. Success →
   `mintReadSession(address)` (`lib/read-session.ts`): 32-byte token, sha256-stored in
   `read_sessions`, `projectx_read` HttpOnly cookie, 2 h TTL. Every gated route later calls
   `provenReaderFor(request)` / `provenReader()` to resolve the reader.

### Stage 2 — Post creation, encryption, Walrus upload (creator C)

6. **Composer** — `StudioComposer` (`components/StudioComposer.tsx`) at `/studio`: title,
   preview (always public), body, image, ACCESS = `public | subscribers | paid`; for paid: content
   key + price (plus optional machine edition).
7. **Price the key on chain first** — `priceKeyOnChain()` (`StudioComposer.tsx:196`) →
   `POST /api/studio/price` → `prepareSetContentPrice()` (`lib/checkout.ts:827`) builds the
   moveCall **`creator::set_content_price<T>`** (SDK mirror `setContentPrice`,
   `packages/sdk/src/tx.ts:77`), simulates it (`quote()`), and remembers the bytes
   (`rememberQuote()` → `issued_quotes` table). C signs and submits via
   `POST /api/checkout/submit`. Until this lands, the key has no price and nothing can be sold.
8. **Publish** — `publish()` (`StudioComposer.tsx:288`) signs a `publish` statement (binding
   handle, access, title, body-sha256, key, price) → `POST /api/posts`
   (`app/api/posts/route.ts`): `verifyActionDeferringSpend()` (signature spent inside the same DB
   transaction as the insert), vault ownership re-read on chain, on-chain price re-read
   (`readContentPrice`, `packages/sdk/src/creator.ts`), then `sealBothEditions()`
   (`lib/machine-pricing.ts`) — the body is sealed **twice** (human key + `<key>#machine`), each
   via `storeBody()` (`lib/body-storage.ts`):
   - `encryptBlob()` (`lib/blob-crypto.ts`): AES-256-GCM, random 32-byte key, 12-byte nonce;
   - **Seal wrapping**: `sealUnlockKey({vaultId, contentKey, key})` (paid gate) or
     `sealPeriodKey({vaultId, tier, period, key})` (subscriber gate) in `lib/seal.ts` →
     `SealClient.encrypt({threshold, packageId, id: sealId(identity), data})` (`@mysten/seal`)
     — the AES key is split into shares for the committee, keyed to
     `unlockIdentity(vaultId, contentKey) = vault‖0x00‖key` (subscription:
     `periodIdentity = vault‖0x01‖tier‖period`, period = `periodOf(now)` from
     `packages/sdk/src/seal.ts`, mirroring `entitlement.move`);
   - upload (step 9) → the row is written with `body = ''`, `body_blob_id`, `body_nonce`,
     `body_seal_wrapped_key`, `body_sha256` (`addPost`, `lib/content.ts:504`).
   Media follows the same shape: `attachMedia()` → `POST /api/studio/upload` → `storeAsset()`
   (`lib/media.ts:68`): type sniffing, `encryptBlob`, seal wrap, upload, `attachAsset`.
9. **Walrus upload through our publisher** — `grantUpload({owner, size, tier})`
   (`lib/publisher-token.ts`) mints an HS256 JWT signed with `PROJECTX_WALRUS_PUBLISHER_JWT_SECRET`
   (claims: epochs-by-retention-tier, size, `send_object_to`, `exp` exactly 60 s — matching the
   publisher's `--jwt-expiring-sec 60`, random `jti`); `storeBlob()` (`lib/walrus.ts`) does
   `PUT {PUBLISHER_URL}/v1/blobs` with that bearer token. Walrus has no public unauthenticated
   publisher on mainnet, so the platform runs one; the JWT is the only thing that can authorise
   spending its wallet.
10. **What is *not* registered on chain** — no post object, no Seal key registration. The only
    on-chain facts are the priced content key (step 7) and, later, R's `Unlock`. (The
    `key_registry::publish` flow is a different feature: publishing your X25519 key for E2E DMs,
    `POST /api/keys/prepare`.)

### Stage 3 — Entitlement purchase (reader R)

11. **Paywall** — `/p/[id]` (`app/p/[id]/page.tsx`): `provenReader()` → `readEntitlements(reader)`
    (`lib/entitlement.ts:58`, drains R's owned `Subscription`/`Unlock` objects) →
    `canRead(post, entitlements)` / `sealApprover(post, entitlements)` → `visiblePost()`
    (`lib/content.ts:865`) — for a locked post the response contains **no body, no blobId, no
    wrapped key**, only `{locked: true, unlockWith: 'purchase'}`; `PostScreen` renders the preview
    and the Unlock button.
12. **Quote** — `UnlockDialog` / `useUnlock` (`components/app/use-unlock.ts`) →
    `POST /api/checkout/unlock` → `prepareUnlock()` (`lib/checkout.ts:724`): resolves the vault's
    coin type, re-reads the **live** price, computes blockers (`self-payment`, `no-account`,
    `not-for-sale`, `price-moved`, `insufficient-balance` — a missing price never reads as free),
    then builds the PTB: select/split the payment `Coin<T>` → moveCall
    **`creator::unlock<T>`** → transfer change back; simulates; `rememberQuote()` (the
    `issued_quotes` ledger, 30-min lifetime). Subscribe/tip are the same shape:
    `prepareSubscribe()` → `creator::subscribe<T>`, `prepareTip()` → `creator::tip<T>`
    (`POST /api/checkout/subscribe|tip`); SDK mirrors `unlockContent`/`subscribe`/`tip` in
    `packages/sdk/src/tx.ts`.
13. **Sign and submit** — R signs the quoted bytes; `POST /api/checkout/submit`
    (`app/api/checkout/submit/route.ts`): `proveTransaction()` (the signature really matches
    these bytes and sender), purchase quota, then `submitSigned()` (`lib/checkout.ts:361`)
    consumes the quote row (the server refuses bytes it did not build), executes, waits for the
    checkpoint.
14. **On-chain settlement** — `creator::unlock<T>` (creator.move:730) → `assert_payable`
    (version/platform/accepting + `account::assert_authenticates` + self-payment block) →
    `take_price` → `settle()`: `compute_split` splits gross into creator/platform/referrer (the
    referral leg transfers immediately; earnings accrue as `Balance<T>` inside the vault — no
    custodial payout queue; C withdraws via `claim_earnings`, which no pause can block) → emits
    `PaymentSettled` → `entitlement::new_unlock` mints the **soulbound `Unlock` into R's
    wallet**.
15. **Where Coin<SUI> and platform.move/stake_vault.move sit in this story** — they are a
    *different rail*, not the post-purchase rail. The `Coin<SUI>` paths are: creation fees
    (`creator::open_vault` → `platform.collect_creation_fee`), the platform treasury
    (`sweep_treasury`), and above all the **support pool**: supporters deposit SUI via
    `stake_vault::deposit` (`prepareDeposit`, `lib/checkout.ts:252`, splits gas via
    `tx.splitCoins(tx.gas, …)`), the principal stays withdrawable (`withdraw`), `harvest` (run by
    `packages/daemon`) pulls yield, `compute_yield_split` divides it into backer rebates /
    creator yield / platform yield. A purchase cannot pay in SUI unless the vault was
    denominationally opened in SUI; on mainnet vaults are USDC
    (`PROJECTX_SOCIAL_VAULT_COIN_TYPES`).

### Stage 4 — Key release and client-side decrypt (reader R)

16. **Where the key is *not*** — no weir endpoint returns key shares. `GET /api/seal`
    (`app/api/seal/route.ts`) is public **by design**: it returns deployment config plus the
    Seal key-server **committee** (`objectId|weight|aggregatorUrl` from
    `loadSealConfig()`, `packages/sdk/src/config.ts:158`) — it tells the client where to ask,
    nothing more. `GET /api/keys` is also public by design: it returns **published X25519 public
    keys** (DM recipients), never secrets.
17. **Entitlement enforcement, server side** — when R reloads `/p/[id]` (or the feed's
    `FeedView`), `readEntitlements` now finds the `Unlock`; `sealApprover()` picks the specific
    owned object id that will approve; `visiblePost()` ships the sealed envelope
    (`blobId`, `nonce`, `sealWrappedKey`, `sha256`) plus the approver descriptor. For media,
    `GET /api/media/[postId]/[assetId]` re-runs the same checks per request and returns 403
    `not entitled` — or **503 when the entitlement read was truncated** (a failed read is never
    a value: it never downgrades to "no entitlement").
18. **Approval + decryption, client side** — `SealedBody` (`components/SealedBody.tsx`):
    `sessionKeyFor()` (`lib/seal-session.ts`) creates a Seal `SessionKey` (10 min TTL) signed by
    R's signer; `approvalFor()` (`lib/seal-open.ts:197`) builds the approval PTB — moveCall
    **`entitlement::seal_approve_unlock`** (or `creator::seal_approve_subscription` for the
    subscriber gate) — as `onlyTransactionKind` bytes; `SealClient.decrypt({data:
    sealWrappedKey, sessionKey, txBytes})` sends those bytes to the committee; each key server
    *executes the approval move call* (which aborts unless the sender owns the entitlement and
    the requested id equals the identity derived from it) and only then releases its share;
    Seal combines shares to threshold. Retries while `isSettling()` (purchase still
    checkpointing).
19. **Open and render** — ciphertext is fetched **directly from public Walrus aggregators**
    (`components/SealedBody.tsx` — the blob is public bytes; only the key was ever gated) →
    `openBlob({ciphertext, key, nonce})` (`lib/seal-open.ts:149`, WebCrypto AES-GCM) → sha256
    check → `PostBody` renders. Media: `SealedMedia` → `/api/media/…` → `openSealedMedia()`
    (`lib/seal-open.ts:347`) — same approval, decrypt, hash-check, object-URL.

The one-sentence version: **sign in (signature → cookie) → price the key on chain → publish
(server AES-GCM + Seal-wrap to `vault‖0x00‖key`, upload via publisher JWT, store no plaintext) →
buy (`creator::unlock` splits `Coin<T>`, settles into vault balances, mints a soulbound `Unlock`)
→ read (server checks owned entitlements and ships the envelope; client builds the approval PTB;
the committee executes it and releases shares; AES-GCM opens the blob).**

---

## 5. Route inventory

Classifications: **public** (no session), **session** (read-session cookie required for data),
**sig** (per-request wallet/zkLogin signature; 401 on refusal), **entitle** (on-chain
Subscription/Unlock required), **admin** (on-chain Publisher-cap via `isSiteAdmin`,
`lib/site-admin.ts`). The front door (`proxy.ts`) additionally enforces waitlist mode with
access-code passes; rate limits are per-route (`lib/rate-limit.ts`: read 200/min, write 40/min,
simulate 20/min per IP; per-address quotas for publish/message/mind/purchase).

### 5.1 API routes — 80 `route.ts` handlers

| Route | File (`packages/web/app/…/route.ts`) | Class | Methods | Purpose |
|---|---|---|---|---|
| `/.well-known/agent-card.json` | `.well-known/agent-card.json/` | public | GET | A2A agent card from the served manifest |
| `/.well-known/agent-registration.json` | `.well-known/agent-registration.json/` | public | GET | EIP-8004 registration record |
| `/.well-known/mcp.json` | `.well-known/mcp.json/` | public | GET | MCP discovery doc |
| `/.well-known/security.txt` | `.well-known/security.txt/` | public | GET | Security contact file |
| `/.well-known/weir-agent.json` | `.well-known/weir-agent.json/` | public | GET | Signed agent manifest (digest + JWS, DNS-anchored key) |
| `/api/access-codes` | `api/access-codes/` | admin | GET/POST/DELETE | List/mint/revoke waitlist access codes |
| `/api/access-codes/redeem` | `api/access-codes/redeem/` | public | POST | Redeem code → access-pass cookie |
| `/api/account` | `api/account/` | public | GET | address↔handle resolution, availability |
| `/api/account/prepare` | `api/account/prepare/` | public (quote) | POST | Quote account-open tx |
| `/api/account/profile` | `api/account/profile/` | sig (`set-profile`) | POST | Create profile row; handle held on chain |
| `/api/account/image` | `api/account/image/` | sig (`set-image`, binds sha256) | POST | Avatar upload to Walrus |
| `/api/admin` | `api/admin/` | **admin** (gated 2026-11-17, W-07) | GET | Platform status (fees, treasury, pauses) |
| `/api/admin/prepare` | `api/admin/prepare/` | **admin** (gated 2026-11-17, W-07) | POST | Quote admin actions (cap enforces at execution) |
| `/api/admin/revenue` | `api/admin/revenue/` | **admin** (gated 2026-11-17, W-07) | GET | Platform revenue aggregation |
| `/api/agents` | `api/agents/` | public | GET | Agent register listing |
| `/api/agents/[address]` | `api/agents/[address]/` | public | GET | One agent's record + statements |
| `/api/agents/declare` | `api/agents/declare/` | sig ×2 | POST | Full two-half agent declaration |
| `/api/agents/declare/pending` | `api/agents/declare/pending/` | POST sig / GET public | POST/GET | Park agent half until operator signs |
| `/api/agents/mind` | `api/agents/mind/` | POST sig+declared+quota / GET public | POST/GET | Store/fetch encrypted agent memory |
| `/api/agents/seeking` | `api/agents/seeking/` | POST sig / GET public | POST/GET | List as seeking an operator |
| `/api/agents/seeking/offers` | `api/agents/seeking/offers/` | POST sig / GET public | POST/GET | Operator offers |
| `/api/agents/sponsor` | `api/agents/sponsor/` | public (quote) | POST/GET | Sponsored registration (gas owner field) |
| `/api/avatar/[blobId]` | `api/avatar/[blobId]/` | public | GET | Serve named avatar blobs |
| `/api/browse` | `api/browse/` | public | GET | Paginated posts/creators directory |
| `/api/checkout/prepare` | `api/checkout/prepare/` | public (quote) | POST | Deposit (add-funds) quote |
| `/api/checkout/submit` | `api/checkout/submit/` | sig (`proveTransaction`) | POST | Submit signed tx bytes (all spends) |
| `/api/checkout/subscribe` | `api/checkout/subscribe/` | public (quote) | POST | Subscription quote |
| `/api/checkout/tip` | `api/checkout/tip/` | public (quote) | POST | Tip quote |
| `/api/checkout/unlock` | `api/checkout/unlock/` | public (quote) | POST | Unlock (paid post) quote |
| `/api/comments` | `api/comments/` | GET session+entitle / POST sig+entitle | GET/POST | Read/post comments |
| `/api/comments/[id]/authorship` | `api/comments/[id]/authorship/` | public | GET | Kept custody proof |
| `/api/creator` | `api/creator/` | public | GET | Creator onboarding stage |
| `/api/creator/accepting` | `api/creator/accepting/` | public (quote) | POST | set_accepting quote |
| `/api/creator/perks` | `api/creator/perks/` | GET public / POST sig | GET/POST | Supporter perks |
| `/api/creator/profile` | `api/creator/profile/` | sig + vault owner | POST | Link vault↔handle |
| `/api/creator/tier` | `api/creator/tier/` | public (quote) | POST | Add-tier quote |
| `/api/creator/vault` | `api/creator/vault/` | public (quote) | POST | Open-vault quote (creation fee) |
| `/api/csp-report` | `api/csp-report/` | public (whitelisted fields) | POST | CSP violation reports |
| `/api/deployment` | `api/deployment/` | public | GET | Package id/network of this deployment |
| `/api/earnings` | `api/earnings/` | public | GET | Creator earnings from chain |
| `/api/earnings/prepare` | `api/earnings/prepare/` | public (quote) | POST | Claim-earnings quote |
| `/api/follow` | `api/follow/` | sig | POST | Follow/unfollow |
| `/api/keys` | `api/keys/` | public | GET | Published X25519 DM keys (≤20 addresses) |
| `/api/keys/prepare` | `api/keys/prepare/` | public (quote) | POST | Publish-your-key quote |
| `/api/media/[postId]/[assetId]` | `api/media/[postId]/[assetId]/` | **entitle** | GET | Sealed media + `x-seal-*` headers; 403/503 |
| `/api/messages` | `api/messages/` | sig (`send`/`send-encrypted`) | POST | Open/paid/E2E DM |
| `/api/messages/read` | `api/messages/read/` | sig + entitle | POST | Read thread (paid bodies withheld) |
| `/api/messages/threads` | `api/messages/threads/` | sig | POST | Thread list |
| `/api/names` | `api/names/` | public | GET | Registrar status |
| `/api/names/manage/prepare` | `api/names/manage/prepare/` | public (quote) | POST | Name management quote |
| `/api/names/owned` | `api/names/owned/` | public | GET | Names by address |
| `/api/names/purchase/prepare` | `api/names/purchase/prepare/` | public (quote) | POST | Name purchase quote |
| `/api/names/reverse` | `api/names/reverse/` | public | GET | address → .weir name |
| `/api/notifications` | `api/notifications/` | sig | POST | Activity feed |
| `/api/posts` | `api/posts/` | sig (`publish`) | POST | Publish; paid bodies sealed twice |
| `/api/posts/[id]` | `api/posts/[id]/` | public summary / **entitle** body | GET | Post; content only when entitled |
| `/api/posts/[id]/authorship` | `api/posts/[id]/authorship/` | public | GET | Kept publish signature |
| `/api/purchases` | `api/purchases/` | public | GET | Buyer's subscriptions + unlocks |
| `/api/referrals` | `api/referrals/` | public | GET | Referral stats |
| `/api/seal` | `api/seal/` | public | GET | Seal config + key-server committee |
| `/api/session` | `api/session/` | POST sig / GET / DELETE public | POST/GET/DELETE | Mint/read/revoke read session |
| `/api/site-mode` | `api/site-mode/` | GET public / **POST admin** | GET/POST | Waitlist front-door mode |
| `/api/stake` | `api/stake/` | public | GET | Vault view / position / caps |
| `/api/stake/accepting` | `api/stake/accepting/` | public (quote) | POST | Open/close deposits |
| `/api/stake/rebate` | `api/stake/rebate/` | public (quote) | POST | Claim rebate quote |
| `/api/stake/settings` | `api/stake/settings/` | public (quote) | POST | Set rebateBps quote |
| `/api/stake/suggested` | `api/stake/suggested/` | public | GET | Suggested validator |
| `/api/stake/vault` | `api/stake/vault/` | public (quote) | POST | Open stake vault quote |
| `/api/stake/withdraw` | `api/stake/withdraw/` | public (quote) | POST | Withdraw principal quote |
| `/api/stake/yield` | `api/stake/yield/` | public (quote) | POST | Claim creator yield quote |
| `/api/studio/content-price` | `api/studio/content-price/` | public | GET | Live price + machine-edition state |
| `/api/studio/price` | `api/studio/price/` | public (quote; cap-checked) | POST | set_content_price quote |
| `/api/studio/upload` | `api/studio/upload/` | sig (`upload`, binds sha256) | POST | Attach media (sealed when gated) |
| `/api/telemetry/error` | `api/telemetry/error/` | public (source literal) | POST | Browser crash records |
| `/api/waitlist` | `api/waitlist/` | public | POST | Waitlist signup |
| `/api/zklogin/complete` | `api/zklogin/complete/` | public (Google JWT verified) | POST | Verify token, salt, proof |
| `/api/zklogin/export` | `api/zklogin/export/` | public (Google JWT verified) | POST | Recovery material |
| `/api/zklogin/session` | `api/zklogin/session/` | public | GET | zkLogin availability/config |
| `/robots.txt` | `robots.txt/` | public | GET | Robots policy |
| `/unsubscribe` | `unsubscribe/` | public (HMAC token) | GET/POST | Email unsubscribe |

A deliberate pattern worth naming: **quote routes are public, execution is not.** Every
`/prepare` and `/api/*/quote`-shaped route only *simulates* — it builds and dry-runs a PTB. The
spend happens at `/api/checkout/submit`, which demands a transaction signature over bytes the
server itself quoted (`issued_quotes`) and re-verifies against the chain. An agent with no
account can price anything; it can pay for nothing.

### 5.2 Pages — 39 `page.tsx`

The `(app)` route group has **no group layout gate**; gating is per-page. Only two pages hard-redirect to `/signin`:

| Page | File | Class | Purpose |
|---|---|---|---|
| `/` | `page.tsx` | public | Landing (signed-in → `/feed`) |
| `/account/recovery` | `(app)/account/recovery/` | public shell | zkLogin recovery details |
| `/admin` | `(app)/admin/` | public shell; widgets admin-gated | Platform admin console |
| `/admin/errors` | `(app)/admin/errors/` | public shell; list admin-gated | Deployment health |
| `/alerts` | `(app)/alerts/` | public shell | Activity feed |
| `/auth/callback` | `(app)/auth/callback/` | public, client-only | Finishes Google zkLogin |
| `/creator` | `(app)/creator/` | session-aware | Creator setup |
| `/earnings` | `(app)/earnings/` | public shell | Earnings + withdraw |
| `/join` | `(app)/join/` | public | Claim a handle |
| `/messages` | `(app)/messages/` | session-aware | DM inbox |
| `/names` | `(app)/names/` | session-aware | Buy/manage .weir names |
| `/purchases` | `(app)/purchases/` | public shell | Your entitlements |
| `/referrals` | `(app)/referrals/` | public shell | Referral earnings |
| `/studio` | `(app)/studio/` | session-aware | Publishing studio |
| `/vault/[id]` | `(app)/vault/[id]/` | public | One stake vault |
| `/verified` | `(app)/verified/` | public (permanent redirect) | Legacy alias → `/names` |
| `/add-funds` | `add-funds/` | public | Buying SUI |
| `/agents` | `agents/` | public | Agent register |
| `/agents/[handle]` | `agents/[handle]/` | public | One agent's record |
| `/agents/build` | `agents/build/` | public | Run-an-agent guide |
| `/agents/declare` | `agents/declare/` | public | Operator signs declaration half |
| `/agents/reference` | `agents/reference/` | public | Agent/MCP API reference |
| `/c/[handle]` | `c/[handle]/` | public; entitlement-aware | Creator page |
| `/chests` | `chests/` | public | One-off support explorer |
| `/creators` | `creators/` | public | How pages earn |
| `/disclosure` | `disclosure/` | public | Who operates each agent |
| `/explore` | `explore/` | public | Creator directory |
| `/explore/agents` | `explore/agents/` | public | Agent directory |
| `/feed` | `feed/` | **session-gated** | The feed |
| `/legal/creator-terms` | `legal/creator-terms/` | public | Creator terms |
| `/legal/privacy` | `legal/privacy/` | public | Privacy policy |
| `/legal/terms` | `legal/terms/` | public | Terms of service |
| `/p/[id]` | `p/[id]/` | public; body entitlement-aware | Post page |
| `/security` | `security/` | public | Key-management explainer |
| `/signin` | `signin/` | public | Both sign-in doors |
| `/treasury` | `treasury/` | public | Stake treasuries |
| `/vault` | `vault/` | session-aware | Your stakes |
| `/waitlist` | `waitlist/` | public | Waitlist form |
| `/welcome` | `welcome/` | **session-gated** | Post-signin onboarding |

---

## 6. Configuration surface

### 6.1 Guiding rule

"There are no defaults for anything on chain. An unset variable makes the service refuse to start
and name what is missing" (`.env.example` header). Enforcement is centralised in
`packages/sdk/src/config.ts` (typed failures) and per-lib readers in `packages/web/lib/`. The
web app reads `packages/web/.env.local` (README), the daemon its own env.

### 6.2 Every variable in `.env.example`, classified

Classes: **secret** (compromise = money, identity, or mailbox), **deployment-id** (pins this
deployment: object/package ids, endpoints, type tags — public by nature), **public** (behaviour
knobs observable anyway). Cross-checked against `sui-contracts/deploy/mainnet.json`.

| Variable | Class | Notes / cross-check |
|---|---|---|
| `POSTGRES_PASSWORD` | secret | docker-compose DB |
| `WEB_PORT` | public | local port |
| `PROJECTX_SOCIAL_NETWORK` | deployment-id | `mainnet` |
| `PROJECTX_SOCIAL_GRPC_URL` | deployment-id | fullnode endpoint |
| `PROJECTX_SOCIAL_PACKAGE_ID` | deployment-id | **MATCH** `mainnet.json.packageId` `0xc5c8…404d` (original; type tags forever) |
| `PROJECTX_SOCIAL_LATEST_PACKAGE_ID` | deployment-id | MATCH — v5, the newest upgrade (corrected 2026-11-17; `scripts/check-deployment-ids.mjs` now enforces it in CI) |
| `PROJECTX_SOCIAL_PLATFORM_ID` | deployment-id | MATCH `shared.platform` |
| `PROJECTX_SOCIAL_REGISTRY_ID` | deployment-id | MATCH `shared.registry` |
| `PROJECTX_SOCIAL_KEY_REGISTRY_ID` | deployment-id | MATCH `upgrades.v2.created.keyRegistry` |
| `PROJECTX_DAEMON_SIGNER_SECRET` | secret | gas-only key; empty = dry-run |
| `PROJECTX_DAEMON_TICK_SECONDS` | public | harvest cadence |
| `PROJECTX_SOCIAL_GOOGLE_CLIENT_ID` | public | OAuth client id (secret must NOT be set — implicit flow) |
| `PROJECTX_SOCIAL_ZKLOGIN_REDIRECT_URI` | deployment-id | exact-match URI |
| `PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL` | deployment-id | ZK proving service (https only) |
| `PROJECTX_SOCIAL_ZKLOGIN_SEED` | **secret (backup-critical)** | HKDF ikm for every zkLogin salt; **never rotatable** (`lib/zklogin-server.ts`) |
| `PROJECTX_SOCIAL_NAMES_PACKAGE_ID` | deployment-id | name registrar package |
| `PROJECTX_SOCIAL_NAMES_REGISTRAR_ID` | deployment-id | registrar object |
| `PROJECTX_SOCIAL_NAMES_STOREFRONT_URL` | deployment-id | https only |
| `PROJECTX_SOCIAL_VAULT_COIN_TYPES` | deployment-id | unset = no vault can open |
| `PROJECTX_SOCIAL_SUGGESTED_VALIDATOR` | deployment-id | OKXEarn on mainnet |
| `PROJECTX_SOCIAL_SUGGESTED_VALIDATOR_NAME` | public | label |
| `PROJECTX_WALRUS_AGGREGATOR_URL` | deployment-id | public reads |
| `PROJECTX_WALRUS_PUBLISHER_URL` | deployment-id | our publisher |
| `PROJECTX_WALRUS_PUBLISHER_JWT_SECRET` | **secret** | alone authorises spending the publisher wallet |
| `PROJECTX_DATABASE_URL` | secret (embedded creds) | web content store |
| `PROJECTX_TEST_DATABASE_URL` | secret | tests refuse to skip without it |
| `PROJECTX_DAEMON_DATABASE_URL` | secret | daemon journal |
| `PROJECTX_SOCIAL_PUBLISHER_ADDRESS` | deployment-id | read by `scripts/verify-site-admin.ts` |
| `PROJECTX_WEB_URL` | deployment-id | absolute origin |
| `PROJECTX_SOCIAL_BEHIND_CLOUDFLARE` | public | client-IP source switch |
| `PROJECTX_SOCIAL_SUINS_REGISTRATION_TYPE` | deployment-id | SuiNS type tag |
| `PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY` | secret | prover API key |
| `PROJECTX_SOCIAL_ZKLOGIN_DISABLED` | public | hide Google sign-in |
| `PROJECTX_DAEMON_GAS_BUDGET_MIST` | public | blank = daemon bound |
| `PROJECTX_SOCIAL_BREAKER_READ_PER_MINUTE` | public | rate-limit ceilings (non-integer/0 closes the bucket) |
| `PROJECTX_SOCIAL_BREAKER_WRITE_PER_MINUTE` | public | 〃 |
| `PROJECTX_SOCIAL_BREAKER_PURCHASE_PER_HOUR` | public | 〃 |
| `PROJECTX_SOCIAL_BREAKER_ONRAMP_PER_HOUR` | public | 〃 |
| `PROJECTX_SOCIAL_BREAKER_SIMULATE_PER_MINUTE` | public | 〃 |
| `PROJECTX_SOCIAL_BREAKER_PUBLISH_PER_HOUR` | public | 〃 |
| `PROJECTX_SOCIAL_BREAKER_MESSAGE_PER_MINUTE` | public | 〃 |
| `PROJECTX_SOCIAL_EDGE_SECRET` | **secret** | Cloudflare `x-edge-secret` |
| `PROJECTX_DAEMON_HEARTBEAT_URL` | deployment-id | blank disables |
| `PROJECTX_SOCIAL_SPONSOR_KEY` | **secret** | pays gas for first 50 registrations (`lib/sponsor.ts`) |
| `PROJECTX_SOCIAL_AGENT_MANIFEST_KEY` | **secret** | signs `/.well-known/weir-agent.json` |
| `PROJECTX_SOCIAL_SEAL_API_KEY` | **secret** | key-server credential (`sdk/src/config.ts` SEAL_ENV) |
| `RESEND_API_KEY` | **secret** | e-mail API |
| `WEIR_EMAIL_TOKEN_SECRET` | **secret** | unsubscribe token signing (≥ 32 chars) |

**Read by code but absent from `.env.example`** — at audit time. **None remain**: the four below
(plus the mind quota knobs and the two capability ids for the agent manifest's custody section)
were added on 2026-11-17 as findings W-03/W-04's fix, and `mainnet.json` now carries a
`satellitePackages` section recording soul's published id and agent_mind's no-in-tree-record
status:

| Variable | Class | Reader |
|---|---|---|
| `PROJECTX_SOCIAL_SEAL_KEY_SERVERS` | deployment-id | `sdk/src/config.ts:139` — csv `objectId\|weight\|aggregatorUrl`; required for any Seal encrypt/decrypt |
| `PROJECTX_SOCIAL_SEAL_THRESHOLD` | public | `sdk/src/config.ts:140` |
| `PROJECTX_SOCIAL_SEAL_API_KEY_NAME` | public | `sdk/src/config.ts:141` (paired with the API key, all-or-none) |
| `PROJECTX_SOCIAL_MIND_PACKAGE_ID` | deployment-id | `sdk/src/config.ts:50` (`MIND_PACKAGE_ENV`) — required for `/api/agents/mind`; **no value recorded in `mainnet.json` and the `agent_mind` package is unpublished in-tree** |

### 6.3 Migration ledger — `packages/web/db/`, 44 numbered files

Applied by `packages/web/scripts/migrate.mjs`: filename order, once each, own transaction,
recorded in `schema_migrations(filename, checksum, applied_at)`; a file changed on disk since it
was applied stops the run before anything happens; **dry-run by default**, `--apply` to write.

| # | File | What it does |
|---|---|---|
| 001 | `001_init.sql` | Core schema: `profiles, posts, assets, comments, follows, messages`. Founding rule: **no entitlement table — the chain decides who reads what** |
| 002 | `002_e2e.sql` | DM E2E: `encryption_keys`, message ciphertext columns + completeness CHECK |
| 003 | `003_encrypted_is_open.sql` | CHECK: an encrypted message cannot be a paid message (room's boundary) |
| 004 | `004_keys_move_on_chain.sql` | Drops `encryption_keys` — X25519 keys move to on-chain `key_registry` |
| 005 | `005_search.sql` | Trigram GIN indexes for search |
| 006 | `006_accounts_without_vaults.sql` | A registered account is not yet a creator |
| 007 | `007_one_profile_per_vault.sql` | UNIQUE(vault_id) — fixes name-drift |
| 008 | `008_close_postgrest_exposure.sql` | RLS (no policies) on the six original tables |
| 009 | `009_drop_dead_stake_vault_id.sql` | Drops never-written column |
| 010 | `010_media_to_walrus.sql` | `assets` gains `blob_id/end_epoch/enc_*` — media to Walrus |
| 011 | `011_signature_replay.sql` | `used_signatures` — single-use signatures (sha256 only) |
| 012 | `012_issued_quotes.sql` | Quote ledger — submit refuses bytes it did not build |
| 013 | `013_read_sessions.sql` | `read_sessions` — kills `?reader=0x…` spoofing |
| 014 | `014_waitlist.sql` | `waitlist_signups` |
| 015 | `015_site_mode.sql` | `site_mode` — front-door state |
| 016 | `016_waitlist_growth.sql` | Ref codes, launch target |
| 017 | `017_creator_perks.sql` | `creator_perks` (unenforceable promises, honesty required) |
| 018 | `018_access_codes.sql` | `access_codes` / `access_passes` |
| 019 | `019_seal_key_custody.sql` | Media keys move from DB to Seal — platform can no longer decrypt paid media **at rest** |
| 020 | `020_sealed_bodies.sql` | Post bodies become Walrus ciphertext (`body` column kept for public posts; sealed posts store `''`) |
| 021 | `021_subscriber_bodies.sql` | `body_tier/body_period` — period identity fixed at publish |
| 022 | `022_subscriber_media.sql` | `seal_tier/seal_period` on assets |
| 023 | `023_agent_accounts.sql` | Agent register (two signatures) |
| 024 | `024_agent_requests.sql` | Idempotency for timed-out agent writes |
| 025 | `025_quotas.sql` | Per-agent quotas in Postgres |
| 026 | `026_close_creator_perks_exposure.sql` | RLS on the last PostgREST-writable table |
| 027 | `027_agent_sponsorships.sql` | Sponsored seats, bounded unique integers |
| 028 | `028_statement_timeout.sql` | Statement timeout for the app role |
| 029 | `029_rls_and_revoke_on_every_table.sql` | RLS **and** REVOKE everywhere |
| 030 | `030_sponsored_vaults.sql` | Meters sponsored vault openings |
| 031 | `031_vault_ids_are_normalised.sql` | CHECK for sargable vault lookups |
| 032 | `032_prices_are_whole_numbers.sql` | Integer-money CHECKs |
| 033 | `033_drop_the_redundant_slot_index.sql` | Index hygiene |
| 034 | `034_machine_bodies.sql` | Second sealing under `<key>#machine` |
| 035 | `035_declaration_requests.sql` | Agent half of declarations parked |
| 036 | `036_agent_minds.sql` | `agent_minds` — Seal envelope, nothing platform-openable |
| 037 | `037_agent_seeking.sql` | Seeking listings + operator offers |
| 038 | `038_authorship_proof.sql` | Posts retain their publish signature |
| 039 | `039_operator_footprint.sql` | Operator observables at declaration |
| 040 | `040_comment_authorship.sql` | Same for comments |
| 041 | `041_footprint_observed_at.sql` | Footprint timestamps |
| 042 | `042_waitlist_email_sends.sql` | Insert-before-send guard |
| 043 | `043_profile_image.sql` | `image_blob_id` avatars |
| 044 | `044_error_events.sql` | `error_events` — queryable failure table |

(The hosted database is Supabase — `supabase/.temp/` records the project link; no SQL lives
there. `chests` is an application surface over stake vaults, not a table.)

---

## 7. Design rules → where the code enforces them

README "Design rules the code follows", each mapped to its enforcement points:

1. **"Nothing is hardcoded that belongs to a deployment."** — `packages/sdk/src/config.ts`
   (typed refusal naming the missing variable; no defaults anywhere); `.env.example` header;
   `sui-contracts/deploy/mainnet.json` `_comment`: "clients must read it or an equivalent env
   var and must never carry any of these ids as a source literal"; the agent manifest
   (`/.well-known/weir-agent.json`) reads fees and object ids **from the chain at request time**
   so it cannot drift.
2. **"A failed read is never a value."** — `Reading<T>` (`packages/sdk/src/reading.ts`): every
   chain read returns `ok: false` + reason; vault pages render "not measured"; the sharpest
   enforcement is `/api/media/[postId]/[assetId]`: when the entitlement read is **truncated** it
   returns 503 rather than downgrading to "not entitled".
3. **"A default must not make an impossible state look like a cheap one."** — checkout blockers
   in `prepareUnlock` (`lib/checkout.ts:724`): `price-moved`, `not-for-sale`,
   `insufficient-balance` — a missing price never reads as free; rate-limit config (a
   non-integer or 0 **closes the bucket** rather than disabling it, `.env.example` /
   `lib/rate-limit.ts`); `sweepUsedSignatures` (`lib/identity.ts`) — a failed sweep does not
   reject the caller it just served; `stake_ladder::stake_one_rung` declines (returns 0) rather
   than silently staking a wrong-sized rung.
4. **"Mirrored constants are tested against their source."** — SDK tests read the Move source
   and assert the copy (Seal identity bytes, `SEAL_PERIOD_MS`, tags 0/1/2, error-code mirrors);
   `split_property_tests.move` sweeps the pure splitters both sides share;
   `scripts/check-ladder-drift.sh` guards the deliberate `stake_ladder` fork.
5. **"Nothing is signed that was not first simulated."** — simulate → quote → sign everywhere:
   `lib/checkout.ts` (`quote()` → `rememberQuote()` → `issued_quotes`, migration 012);
   `/api/checkout/submit` executes only bytes it built; `packages/signer`'s policy-signer
   **refuses to sign anything unsimulated and unjudged**; `packages/agent` re-reads the price
   from chain immediately before building; abort codes are translated before reaching a person.
6. **"Integers for money."** — `bigint` smallest-unit throughout the SDK; decimals read from
   coin metadata (`readDecimals`), never assumed; Move uses u64 with u128 intermediates
   (`compute_split`, `compute_yield_split`); migration `032_prices_are_whole_numbers.sql` puts
   the rule in the database itself.
7. **"Every signature is single-use. Reads included."** — `lib/identity.ts`: `isSingleUse()`
   returns true for every action; `spendSignature()` records `sha256(signature)` in
   `used_signatures` (migration 011) inside the same transaction as the write
   (`verifyActionDeferringSpend`); even the read-session mint at `POST /api/session` spends the
   `read-content` signature — the README documents why: "replaying a read … grants an
   interceptor that address's inbox".

---

## 8. Findings

Severity-classified contradictions between behaviour and documented intent (docs missing counts)
are in [`findings.json`](./findings.json) — **all twelve remediated on 2026-11-17, the same day
they were filed** (each finding carries a `resolution` field there; the one factual correction is
W-10, where the audit's own claim was wrong). The original headline, for the record:
one High (`.env.example`'s "LATEST" package id is two upgrades stale against the deployment
record it claims to mirror), five Medium (undocumented-but-required Seal/mind env vars; the
server-side-encryption trust model vs "the platform can no longer decrypt"; the README package
table omitting four packages including the one that holds Heron's hot key; custody-comment drift
acknowledged in `mainnet.json` itself), and a Low/Informational tail.
