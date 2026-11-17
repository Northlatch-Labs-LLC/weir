# Weir — Threat Model 02: Trust Boundaries, STRIDE, and Move-Ecosystem Threats

**Scope:** weir.social — a Sui-mainnet creator-monetization application. Seal-encrypted content
on Walrus, SUI and generic `Coin<T>` payments, soulbound accounts, AI-agent access via MCP.
**Method:** STRIDE per trust boundary, extended with Sui/Move-ecosystem threat classes. Every
claim was re-derived from the tree at commit `9a68895` (main); prior art
(`RED-TEAM-REVIEW-APPROACH.md`, `SECURITY.md`, `audit/01-architecture.md`) was verified, not
deferred to. Where the tree and the docs disagreed, the tree won and the disagreement is
recorded.

**Companion artifacts:**
- [`audit/inventory.json`](./inventory.json) — component-id namespace; every register entry's `component` values are ids defined there.
- [`audit/threat_register.json`](./threat_register.json) — 39 threats, ranked by severity, each with `mitigations_to_verify` and a mitigation status.

**Status legend** (applies throughout):

| Status | Meaning |
|---|---|
| **unmitigated** | Nothing in the tree or config prevents this. May be a consciously accepted risk — this model says which. |
| **mitigated-but-untested** | Code exists (often with repo tests) but no mainnet drill, adversarial test, or production verification confirms it works *as deployed*. |
| **mitigated** | Control exists and is exercised: an always-on CI gate (run on every pull request) or a production event has confirmed it. The evidence is named in the register. |
| **unknown-pending-audit** | Undeterminable from the repository; depends on deployment config, key custody, or chain state. |

Prior-art verification notes (re-derived, per the red-team approach's own rule that verdicts come
from checks, not memory): 73/73 `/api` route files carry a limiter call (A6 holds);
67/73 carry `recordFailure` (A1/A4: the doc's 61 has drifted upward — coverage improved, the
claimed number was never re-pinned); no CSP `nonce` exists and `script-src` is Report-Only
(A5 holds). One **new High** was found by phase-01 and adopted here as TR-39: `.env.example`'s
LATEST package id is two upgrades stale against `mainnet.json`.

---

## 1. The system in one picture

```
                                ┌───────────────────────────┐
                                │  Browser (untrusted)      │
                                │  wallet keys · zkLogin    │
                                │  Seal decrypt · E2E DMs   │
                                └─────────┬─────────────────┘
                     signed statements    │ HTTPS (CSP Report-Only for scripts)
                     single-use, 10 min   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Next.js API (packages/web/app/api — 73 route handlers)                  │
│  lib/identity.ts   verifyAction → prove → SPEND → sweep                  │
│  lib/rate-limit.ts in-process Map · DB shared buckets · address quotas   │
│  lib/checkout.ts   builds PTBs · quotes · issued_quotes relay allowlist  │
│  lib/sponsor.ts    gas sponsor key · 50 seats/slots · shape asserts      │
│  lib/media.ts      upload · AES-GCM · Seal-wrap · legacy server-decrypt  │
└───────┬──────────────────────┬───────────────────┬───────────────────────┘
        │ SQL (pg Pool, 8s     │ builds/simulates  │ publisher JWT (60s)
        │ statement timeout)   │ PTBs, relays      ▼
┌───────▼──────────┐   ┌───────▼─────────────────┐   ┌────────────────────┐
│ Postgres         │   │ Sui mainnet (trusted    │   │ Walrus             │
│ (Supabase)       │   │ for consensus, not for  │   │  aggregator (reads)│
│ used_signatures  │   │ our logic)              │   │  publisher (spends)│
│ issued_quotes    │   │ 9 modules, 3 packages:  │   └────────────────────┘
│ agent_quotas     │   │ account·creator·        │
│ assets+enc_key   │   │ entitlement·platform·   │   ┌────────────────────┐
│ posts·messages   │   │ stake_vault·stake_ladder│   │ Seal key servers   │
│ read_sessions    │   │ key_registry (+soul,    │◄──│ committee executes │
│ error_events     │   │  agent_mind)            │   │ seal_approve_* as  │
└──────────────────┘   └───────┬─────────────────┘   │ the reader; release│
                               │ events/reads        │ threshold shares   │
                               ▼                     └────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│  Headless agent estate                                                   │
│  packages/agent      headless client, own Ed25519 key, self-built PTBs   │
│  packages/mcp        15 tools; HTTP mode keyless; stdio policy-gated     │
│  packages/agent-runtime beat sandbox, 10 startup-refusal rules           │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│  Custody boundary (company + agent keys, packages/signer + purse)        │
│  policySigner gate: simulate → 13 policy rules → hash-chained audit →    │
│  sign. Daemon harvest key (gas-only). Purse hot key (1-of-2 + brake).    │
│  Sponsor key (gas-only, shape-asserted). PlatformCap/upgrade in 2-of-3.  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Eight trust boundaries**, each crossed by named flows (§3), each with a STRIDE table (§4):
browser · web-api · postgres · sui-chain · walrus · seal-keyservers · agent-runtime · custody.

---

## 2. What the boundaries actually protect

Before the tables: the four assets whose loss is unrecoverable, because everything else in the
model is ranked against them.

1. **Depositor principal** in `StakeVault` — promised redeemable 1:1 at any time
   (`stake_vault.move`: `assert_solvent` on every mutating call; `withdraw` consults no pause).
2. **Creator earnings** in `CreatorVault.earnings` — claimable only through a `CreatorCap`
   (`creator.move:767`), never through any platform-held capability (CUSTODY.md:37-48, verified
   against every function signature in `stake_vault.move` and `creator.move`).
3. **Sealed content keys** — once a Seal key is derived it cannot be revoked, so *every*
   over-grant is permanent. This asymmetry drives the design of `entitlement.move` (identity
   tags, `covers_period` judged at period start, lapsed-renewal fix) and is why TR-04/TR-28 are
   permanent-damage entries.
4. **The zkLogin seed** — irrotatable by design; every zkLogin address is derived from it
   (TR-02).

A fifth class — **availability of the yield machine** — is recoverable-but-invisible: the
harvest daemon stopping loses yield, not principal (TR-09/TR-10).

---

## 3. Cross-boundary flows

| # | Flow | Path | Boundary crossings | Guard at each crossing |
|---|---|---|---|---|
| F1 | **Read session** | browser → `POST /api/session` → postgres `read_sessions` → cookie/Bearer | browser→web-api→postgres | single-use `read-content` signature; 32-byte random token stored sha256, 2h TTL |
| F2 | **Social write** (post/comment/follow/DM) | browser → signed statement → route → postgres | browser→web-api→postgres | statement head binds address+timestamp+origin; 10-min window; signature spent in `used_signatures` (deferred routes spend inside the write transaction) |
| F3 | **Payment** (subscribe/tip/unlock) | browser → `/api/checkout/prepare` (server builds PTB, simulates, quotes) → wallet signs → `/api/checkout/submit` (relay) → Sui | browser→web-api→sui-chain | `issued_quotes` digest allowlist (30 min) + `Idempotency-Key` (`agent_requests`); chain-side `assert_payable`/`take_price` re-check everything |
| F4 | **Publish paid content** | browser signs `publish`+`upload` → `/api/studio/upload` → AES-GCM encrypt → Seal-wrap → publisher JWT → Walrus PUT → blob object to creator; asset row in postgres | browser→web-api→walrus→postgres→(sui: blob object) | uploader must equal on-chain `vault.owner`; magic-byte sniff; fresh random content key per post |
| F5 | **Paid read** | browser → `/api/media/:post/:asset` → postgres + sui entitlement reads → ciphertext → Seal committee → client AES-GCM decrypt | web-api→postgres→sui-chain→seal-keyservers→browser | asset must be in post's list; on-chain `Subscription`/`Unlock` read per reader (fail-closed on truncation); committee executes `seal_approve_*` with reader as sender; sha256 verified client-side |
| F6 | **DM** | browser derives X25519 key from wallet signature → `key_registry::publish` (on-chain) → sender wraps per-recipient → `/api/messages` stores ciphertext+envelopes | browser→sui-chain (pubkey)→web-api→postgres | registry substitution structurally absent (`publish` has no owner param); signature over ciphertext digest; Idempotency-Key |
| F7 | **Stake + harvest** | browser deposits/withdraws via PTB; daemon ticks: discover → decide → build → simulate → policy gate → sign → `stake_vault::harvest` | sui-chain←custody | daemon key in `allowedTargets=[stake_vault::harvest]`, `allowedObjects=[vault,0x5]`; one rung per epoch on-chain; `assert_solvent` |
| F8 | **Agent declaration + sponsorship** | agent signs `declare-agent` (+operator `declare-operator`) → `/api/agents/declare`; `/api/agents/sponsor` builds `account::open`, sponsor key co-signs | browser/agent→web-api→custody→sui-chain | two signatures on declare; sponsor refuses caller-supplied bytes, shape-asserts exactly one `MoveCall`, simulates before signing |
| F9 | **Agent mind** | agent encrypts memory to account-derived key → `/api/agents/mind` (Walrus) → reads via `agent_mind::seal_approve_mind` | browser/agent→web-api→walrus→seal-keyservers→sui-chain | statement binds ciphertext sha256; declared-agent check; mind identity = account-id‖0x02 bound to the soulbound account object |
| F10 | **Company administration** | PlatformCap: fees/pauses/treasury/migrate; soul MasterCap/LedgerCap: allowance metabolism | custody→sui-chain | fee ceilings compiled in (30%/50%-of-cut/100-SUI); pauses cannot block claims; LedgerCap bounded by MAX_RAISE_FACTOR=2 per settlement |

---

## 4. STRIDE per trust boundary

Each table: the boundary, the components on it, and the standing threats. IDs refer to
`audit/threat_register.json`. Rows marked **●** are the ones this model assesses as currently
exposed; rows marked **○** are covered by controls whose deployment still needs verification.

### 4.1 Browser (untrusted client; wallet + keys live here)

Components: `sdk.statements`, `sdk.money`, `sdk.seal`, `sdk.e2e`, `sdk.keyregistry`, rendered surfaces (posts, agent purpose strings, handles).

| Threat | Assessment | Ref |
|---|---|---|
| **S** Account/session spoofing | ○ Statements bind origin+address+timestamp; server verifies with fullnode. But the *first use* of a signed statement always succeeds — a phished signature is valid for 10 min. | TR-24, TR-36 |
| **T** Tampering with rendered content | ● CSP `script-src` is Report-Only (B-07 operator-blocked). Any injection point (markdown, purpose strings) executes. The four break-proof directives are enforced; scripts are not. | TR-06 |
| **R** Replay of captured statements | ○ Single-use ledger on every write route — the two agent surfaces spend their signatures too since 2026-11-17 (TR-12); TR-25 caps forensic retention. | TR-12, TR-24, TR-25 |
| **I** Secrets in the browser | ○ Seal keys never traverse the server (client-side AES-GCM); DM private keys derived from wallet signature, never transmitted; legacy platform-scheme media is the exception (server-side decrypt). | TR-08, TR-11 |
| **D** DoS by client | ● In-process rate-limit Maps are per-instance; IP keying collapses to one bucket off-Cloudflare. | TR-05 |
| **E** Privilege rise from the browser | ○ No admin surface in the browser; waitlist gate (`proxy.ts`) is page-level only and carries no API authority. | — |

### 4.2 Next.js API (packages/web/app/api + lib)

Components: `web.api.*` (73 routes), `web.lib.identity`, `web.lib.rate-limit`, `web.lib.checkout`, `web.lib.sponsor`, `web.lib.media`, `web.lib.read-session`, `web.lib.zklogin-server`, `web.lib.publisher-token`, `web.next-config`.

| Threat | Assessment | Ref |
|---|---|---|
| **S** Auth bypass | ○ Every write verifies a fresh signature; zkLogin verifies Google JWKS with `clockTolerance:0` and nonce equality. Unknown: Vercel env integrity for `PROJECTX_SOCIAL_ZKLOGIN_SEED` (irrotatable) and prover key. | TR-02 |
| **S** Sponsor-path impersonation | ○ The vault action still takes no signature, but its slot now holds for 15 minutes and frees unless the chain confirms a vault (`confirmVaultClaimsFromChain` writes `vault_id`); one-per-address-ever survives slot recycling, so each burn attempt costs a fresh funded account. Fixed 2026-11-17; DB-run sponsor tests pending CI verification. | TR-07 |
| **T** Transaction tampering in relay | ○ `issued_quotes` binds relayed submissions to exact quoted digests within 30 min. Residual: clients may bypass the relay entirely and submit any PTB to a fullnode — the chain, not the API, is the money guard (correct layering). | TR-35 |
| **T** Stale bytecode targeting | ● LATEST package id in `.env.example` is two upgrades stale (phase-01 High). PTBs built from it execute old guards. | TR-39 |
| **R** Signature replay | ○ `used_signatures` PK on signature digest, `ON CONFLICT DO NOTHING`, atomic with writes on deferred routes, fail-closed on DB outage. | TR-24 |
| **I** Secrets at rest in API land | ● `PROJECTX_WALRUS_PUBLISHER_JWT_SECRET` alone authorises spending the publisher wallet; legacy `enc_key` sits in Postgres reachable by the app role. | TR-03, TR-08 |
| **D** Rate-limit evasion / self-DoS | ● IP keying spoofable or collapse-to-one-bucket (B-06 operator-blocked); error-intake endpoints are unauthenticated write surfaces. | TR-05, TR-33 |
| **E** Idempotency/quote key abuse | ○ `agent_requests` PK (address,key) + body-hash; same key different body → 409; fail-closed. | TR-35 |

### 4.3 Postgres (Supabase)

Components: `web.db` (44 migrations), `external.postgres`.

| Threat | Assessment | Ref |
|---|---|---|
| **S** Authz via DB | ○ RLS enabled + REVOKE from anon/authenticated (db/029, db/044) — but the app role bypasses by design; the real authz boundary is the API, correctly. | — |
| **T** Row tampering | ● A SQL-level rewrite of `assets.blob_id` silently substitutes content; detection is only the sha256 checks at read time. No DB-level tamper evidence. | TR-38 |
| **R** Replay ledger itself | ○ `used_signatures` is the replay control; retention = validity window (deliberate; forensics trade documented). | TR-25 |
| **I** Plaintext of legacy media | ● `assets.enc_key` makes the server able to decrypt legacy paid content; contradicts the "the platform can no longer decrypt" claim (phase-01 Medium). | TR-08 |
| **D** Availability coupling | ○ Limiters, idempotency, and the single-use ledger all fail **closed** (503) when the DB is unreachable — an outage is safe, just total. Pool max 3, 8s statement timeout. | — |
| **E** Overflow/growth | ○ Sweepers bound `used_signatures` (≤500/write) and quote expiry; `error_events` has field caps but **no row cap** (TR-33). | TR-33 |

### 4.4 Sui chain (trusted for consensus; our logic must be correct on it)

Components: `move.account`, `move.platform`, `move.creator`, `move.entitlement`, `move.stake_vault`, `move.stake_ladder`, `move.key_registry`, `move.soul`, `move.agent_mind`, `external.sui-fullnode`.

| Threat | Assessment | Ref |
|---|---|---|
| **S** Capability theft/forgery | ○ Caps (`CreatorCap`/`StakeCap`/`PlatformCap`/`MasterCap`/`LedgerCap`) are `key, store` — transferable by design; consequences itemised. Soulbound identity types are `key` without `store` and their modules publish no transfer — cannot be moved by any PTB. | TR-17, TR-18, TR-37 |
| **T** Arithmetic/state corruption | ○ Split arithmetic is structural (join-the-remainder, u128 intermediates, exact-sum identities tested); overflow traps closed by ordering, not clamps; ladder invariants enforced on-chain. | TR-23, TR-26 |
| **R** Double-spend / double-claim | ○ Payments consume the `Coin`; claims split stored balances (cannot exceed value); harvest is idempotent per epoch by the one-rung rule; a leaked quote digest relays exactly once. | TR-27, TR-35 |
| **I** Information release on-chain | ● Everything on a public chain is public: handles, vault figures, payment events, DM *key publication* (not messages), agent minds' *metadata* is off-chain but ciphertext is public on Walrus. Accepted-by-design; worth saying once. | — |
| **D** Liveness withholding | ● `harvest` is permissionless (good), but nobody is paid to call it — the daemon is the liveness guarantee and its death is silent until B-04 is configured. Registry shared-object contention can price out registrations. | TR-09, TR-10, TR-31 |
| **E** Fee/pause misuse via caps | ○ Ceilings compiled in; pauses cannot block claims/withdrawals (stated invariant, verified by reading every claim path). | TR-18 |

### 4.5 Walrus (aggregator reads; publisher writes)

Components: `external.walrus-aggregator`, `external.walrus-publisher`, `web.lib.walrus`.

| Threat | Assessment | Ref |
|---|---|---|
| **S** Unauthorized writes | ○ Publisher requires HS256 JWT (60s, jti). The secret is a single factor controlling a wallet. | TR-03 |
| **T** Blob substitution | ○ Aggregator responses are content-addressed and cross-checked against recorded sha256 (plaintext at `lib/media.ts:181-184`, sealed client-side at `seal-open.ts:382-390`). | TR-38 |
| **R** Upload replay | ○ `jti` random per token; `alreadyCertified` handled without re-spend. | — |
| **I** Ciphertext enumeration | ○ Gated content is encrypted with a fresh random key before upload, so identical plaintexts never collapse to the same blob id. | — |
| **D** Aggregator/publisher outage | ○ Reads time out (15s) and fail; uploads fail closed when publisher unset. Availability is external dependency risk, accepted. | — |
| **E** Ownership disputes | ● Blob *storage objects* go to the creator (`send_object_to`), content-binding lives in Postgres — two truths that can disagree, with no on-chain registry to arbitrate. | TR-38 |

### 4.6 Seal key servers (the committee)

Components: `external.seal-keyservers`, `sdk.seal`, `web.lib.seal`, `move.entitlement` (policy), `move.creator`, `move.agent_mind`.

| Threat | Assessment | Ref |
|---|---|---|
| **S** Key release without entitlement | ● The `seal_approve_*` entry functions are only as strong as the committee executing them. Collusion/compromise/misconfigured threshold = all keys, no entitlements. Deployed committee shape is not in the tree. | TR-01 |
| **T** Policy bypass via stale package | ● Client approval PTBs target whatever package id the config carries; stale id = old (retired/aborted or pre-fix) policy on that path. | TR-39, TR-04 |
| **R** Share-request replay | ○ Session keys are 10-min, signature-derived; approvals are pure asserts, idempotent. | — |
| **I** Over-grant by identity collision | ○ Identity namespaces carry the vault id + disjoint tag bytes (0x00/0x01/0x02); the tag exists precisely because `content_key` is attacker-chosen — documented with the attack it prevents (`entitlement.move:299-317`). | TR-37 |
| **D** Committee unavailable | ○ Client surfaces 503 "committee" as a distinct failure (`classifySealFailure`); threshold t-of-n absorbs individual server loss. | — |
| **E** Key mismanagement (rotation) | ○ Seal keys are permanent — the system's honest answer is under-granting policies + selling missing periods as Unlocks (documented in `extend`/`covers_period`). DM keys are a separate registry with version high-water marks preventing downgrade after revoke. | TR-04, TR-28, TR-29 |

### 4.7 Agent runtime (packages/agent, mcp, agent-runtime)

Components: `agent.client`, `agent.tx`, `mcp.transport`, `mcp.tools`, `runtime.check-rules`.

| Threat | Assessment | Ref |
|---|---|---|
| **S** Rogue spending by injected instructions | ○ Layered: HTTP MCP is keyless by construction; stdio requires signer+policy; `maxPrice` mandatory and chain-read (refuse, never clamp); policy ceilings + outflow windows; single-use statements. Within-ceiling injection purchases remain possible by design. | TR-21 |
| **T** Malicious tool client | ○ Host/Origin allowlists, cookie refusal, idempotency ledger; `weir_accept` signs terms read back from the register, never caller-supplied. | TR-21 |
| **R** Tool-call replay | ○ Per-request-id dedupe in MCP; statements single-use server-side. | TR-24 |
| **I** Prompt-injection data flow | ○ All third-party text wrapped `untrusted: true`; `weir_read` never opens paid posts even if entitled. Residual: the model still *reads* the text. | TR-21 |
| **D** Sandbox escape surfaces | ○ 10 startup-refusal rules (no exec/web/spawn, loopback gateway, sha256-pinned non-interpreter stdio MCP, no channels/cron, model-host allowlist). | — |
| **E** Mind theft | ○ Mind bound to the soulbound account *object* (`agent_mind.move`); rotation of agent keypairs does not move it. Ciphertext metadata is enumerable unauthenticated (traffic analysis only). | TR-32 |

### 4.8 Custody (packages/signer, purse, daemon signing, sponsor key)

Components: `signer.policy-signer`, `signer.adapters`, `signer.register`, `policy.rules`, `purse.server`, `purse.sweep`, `daemon.signer`, `daemon.journal`, `daemon.engine`, `daemon.discovery`, `daemon.supervisor`, `web.lib.sponsor`.

| Threat | Assessment | Ref |
|---|---|---|
| **S** Unauthorized signing | ○ The gate signs only what it simulated and policy-judged; signing-site register is CI-enforced (`the-only-path-claim.test.ts`); no blind-signing path exists anywhere (verified per path). | TR-19, TR-20, TR-27 |
| **T** Policy/pin tampering | ○ Policy pinned by sha at start; purse policy is redeploy-not-reload; audit chain is hash-chained and anchored per run. Residual: full-file rewrite of `audit.jsonl` is tamper-evident only against the anchored head. | TR-19 |
| **R** Duplicate harvest/seat races | ○ Chain makes a second same-epoch harvest inert; advisory lock is per-DB (two daemons on different DBs = gas waste, not double-claim); journal fail-closed (exit 3, tested). | TR-27 |
| **I** Key exposure | ● Purse key hygiene is exemplary (file-only, refuses env/argv); **sponsor and daemon keys load from env vars** — a weaker standard the same estate proved it knows better than. Publisher JWT secret is a wallet key in an env var. | TR-03, TR-34 |
| **D** Silent daemon death | ○ The journal alarm (hourly, `error-alarm.yml`) replaces the unset heartbeat URL: newest `daemon_runs` row is the heartbeat, and it fired on a real outage 2026-11-17 (issue #253 — the daemon has never written a run; the host work is operational). Discovery truncation past 1000 vaults is still flagged but unwatched. | TR-09, TR-10 |
| **E** Hot-key blast radius | ● Purse hot key is 1-of-2: a leak spends up to one epoch's allowance (accepted, documented). If the socket is bypassed, the *wallet balance* — not the policy — is the bound. | TR-19, TR-20 |

---

## 5. Move/Sui-ecosystem threat narratives

These are the classes STRIDE does not name. Each section explains the attack in plain language,
then answers: is this architecture exposed, and where does the answer live in named files?

### 5.1 Capability handling — could CreatorCap, AdminCap, or key-registry authorities be transferred, faked, or obtained by the wrong party?

**The attack.** On Sui, a *capability* is an owned object whose mere presence authorises an
action. Three ways to get one wrongly: (a) **transfer** — if the type has `store`, anyone
holding it can `public_transfer` it (or a victim can be socially engineered into transferring
it); (b) **fake** — compose a PTB that makes some other object *look* like the authority, or
call an entry function that doesn't check; (c) **borrow** — call a function that takes the
capability by reference alongside attacker-chosen arguments.

**This architecture, verified by type:**

- *Cannot be transferred, ever:* `SocialAccount`, `Subscription`, `Unlock`,
  `AdopterCredential` are `key` **without** `store`
  (`account.move:83`, `entitlement.move:46/67`, `soul.move:288`). `public_transfer` requires
  `store`, so no PTB can move them, and no module function does — `account::close` *destroys*
  the account rather than moving it (`account.move:212`). `EmployeeSoul` goes further: it is
  **shared**, and a shared object cannot be transferred by anybody
  (`soul.move:25-40` makes this the design's centrepiece).
- *Faking is closed at the authentication gate:* every paying function calls
  `account::assert_authenticates(account, sender, platform_id)`
  (`account.move:265-272`): owner==sender AND platform==issuer. A staging account does not
  authenticate on mainnet; a borrowed account does not authenticate at all. The Seal approvals
  re-check `holder == ctx.sender()` (`entitlement.move:375-378`,
  `creator.move:896-910`).
- *Borrowing cannot exceed the type:* the approvals take `&Subscription` / `&Unlock` by
  reference and re-bind the requested identity to bytes the *entitlement* determines
  (`EWrongIdentity`), so a holder of something cheap cannot name something expensive.
- *What IS transferable, deliberately:* `CreatorCap`, `StakeCap` (`key, store`) —
  `creator.move:169`, `stake_vault.move:102`. The codebase is candid that this is a real
  exposure ("it can be transferred, sold, or simply lost" — `creator.move:813`) and built
  `migrate_as_platform` on both vault types *because* caps get lost, not because the platform
  gains authority (version is the only field it touches). `PlatformCap`, `MasterCap`,
  `LedgerCap` are also `key, store`; `LedgerCapIssued` events exist precisely so the set of
  live bookkeeping keys is reconstructible (`soul.move:426-434`, finding A11).
- *Key-registry authority:* there is none to steal — `key_registry::publish` has no `owner`
  parameter; "the substitution attack is absent from the interface rather than rejected by a
  check inside it" (`key_registry.move:113-117`).

**Residual exposure:** a phished or sold `CreatorCap` permanently moves earnings authority
(TR-17); custody *composition* of PlatformCap/MasterCap (multisig membership) is asserted in
CUSTODY.md but not verifiable from the tree (TR-18). The soulbound property itself is a
type-system fact — see TR-37 for the verification plan (bytecode ability diff + a PTB
TransferObjects regression attempt).

### 5.2 Decimal mismatch — SUI (9 decimals) through generic `Coin<T>` paths (`take_price`, `split`)

**The attack.** A coin's on-chain amounts are unitless integers. "0.5" means half a *whatever*;
if any code converts human strings to units assuming 9 decimals (SUI) but the coin has 6
(USDC-style), every price is wrong by 10³. On a generic `Coin<T>` rail this bites in three
places: tier prices, content prices/min-tip, and displayed earnings.

**This architecture:** the contract layer is **unit-blind by construction and says so**
(`creator.move:31-36`): every amount is `u64` in `T`'s smallest unit; the split is proportional
so it is exact at any scale; `compute_split` widens to `u128` and its comment quantifies the
overflow horizon ("reachable for a six-decimal coin at around 6.1 billion units" —
`creator.move:288-291`). `take_price` (`creator.move:638-641`) splits exactly `price` from the
payment and aborts on shortfall; `settle` joins the remainder rather than computing both sides,
so conservation is structural. Nothing on-chain can be confused about units.

The exposure is entirely **client-side**, and the tree shows both the right pattern and the
audit gap. Right: `sdk/money.ts` does string-exact parsing with per-coin decimals (0..38) and
refuses excess precision; `sdk/client.ts:126-138` **refuses to guess** when `CoinMetadata` is
unpublished ("assuming a common value is how an amount ends up wrong by a factor of a
thousand" — the codebase quoting its own rule). Gap: `lib/checkout.ts` asserts "whole number of
MIST" on SUI paths (checkout.ts:132/177/264/983), which is correct *for SUI only* — the generic
`Coin<T>` form paths depend on each caller having fetched metadata. No sweep proves every form
and display in `packages/web`/`packages/ui` routes through `parseAmount` with fetched decimals.

**Verdict:** contract-level — not exposed. Client-level — mitigated-but-untested (TR-13), with
a concrete verification plan (grep sweep for `1e9`/`toFixed`/`Number(` near price fields;
property-test a 6-dec price through every display path).

### 5.3 PTB composition attacks — a malicious block builder assembling entry functions with unexpected objects

**The attack.** Sui's programmable transaction blocks let *anyone* chain any public/entry
functions with any objects they can legitimately name, in one atomic transaction. The attack is
not "injecting your contract into someone's PTB" (impossible — entry functions execute on the
objects passed); it is **interleaving**: `deposit → harvest → withdraw` in one block so command
N+1 reads state command N wrote, in a sequence the authors never reasoned about. (Note: "block
builder" ordering attacks as in MEV are largely neutralised by Sui's consensus-ordered
execution; the live risk is the *composer*, typically the user's own compromised client or a
malicious SDK.)

**This architecture, property by property:**

1. *Ownership is unforgeable:* owned-object parameters (`SocialAccount`, `Subscription`,
   `Unlock`, caps) can only be referenced by their owner. A composer cannot hand someone else's
   entitlement to `seal_approve_unlock`.
2. *Soulbound types cannot be moved by composition:* no `store`, no public transfer — the
   interleaving `subscribe → transfer-to-attacker` fails at type check.
3. *The classic same-tx rebate attack is closed:* deposit+harvest+withdraw in one block was the
   historical defect; `FreshEntry` maturity markers, the harvest-counter gate
   (`stake_vault.move:826-854`), and `shrink_fresh` close it, with the mechanism documented
   attack-by-attack.
4. *Money conservation is structural:* `settle` joins the remainder (`creator.move:582-598`);
   `credit_proceeds` principal-first (`stake_vault.move:741-778`). No interleaving changes the
   split, because the split reads only snapshot fields and the payment itself.
5. *Price-from-vault:* `unlock` reads the price from the vault, not the caller
   (`creator.move:726-730`), so a composer cannot re-price mid-block; re-pricing *is* possible
   via the creator's own `set_content_price` earlier in the same block, but the entitlement
   identity (`vault‖0x00‖content_key`) binds the unlock to the key, not the price — the buyer
   gets what they bought or an abort, never a cheap unlock re-targeted at expensive content.

**Residual exposure:** none of these five properties is enforced by a machine check — they are
facts a reviewer must re-verify for *every new entry function*. The register carries the class
as mitigated-but-untested (TR-23) with the adversarial-PTB test list that would make it tested.
One honest caveat found while verifying: `migrate_as_platform` and `set_fees` show the codebase
itself composing multi-step flows (sponsor path builds `coin::zero` + `open_vault` +
`TransferObjects` — `sponsor.ts:390-400`), i.e. composition is a first-class tool here, which
is exactly why the test list matters.

### 5.4 Stake economics — rung arithmetic, epoch transitions, the harvest daemon failing open or double-claiming

**The attack surface has four layers:**

- **Rung arithmetic** (`stake_ladder.move`): the zero-yield failure mode is documented from two
  real protocols ("withdrawing too early" — activation-epoch exchange-rate identity; "a ladder
  that is not laddered" — seven tranches sharing epoch 1209 on mainnet elsewhere). The guards:
  `is_matured` is strictly `activation + 6 <= current` (`:101-103`); `staked_this_epoch` is
  **derived, not stored** — a tranche with activation > current epoch proves this epoch already
  staked (`:114-121`), so the ladder cannot silently collapse; `rung_size` floors at Sui's
  minimum so small vaults degrade to fewer larger rungs rather than aborting (`:127-130`).
- **Epoch transitions:** tranches mature one per epoch; `unwind_newest` forfeits the *creator's*
  yield, never the depositor's principal (Sui returns full principal for unactivated stakes,
  asserted `EStakeAccountingViolation`, `:85-88`). The no-loss invariant
  `liquid + staked >= total_principal` is asserted after every principal-moving operation
  (`stake_vault.move:541-544`).
- **Rebate accounting** (the historically buggy part, per the module's own confession):
  fresh-deposit exclusion from both sides of the accumulator, the harvest counter that only
  advances on realised yield **or** an actually-staked rung (`:826-854` — including the
  documented failed fix "gating on yield alone was tried and is wrong"), the stale-acc re-read
  fix in `withdraw` (`:648-671`), and the deliberate clamp-and-report instead of abort in
  `accrue_on` (`:505-529`, `RebateAccountingAnomaly`) so principal always stays reachable.
  Every error direction here is **under-credit**, never theft — the module states and its
  balances enforce it (`rebate_pool` is a separate balance).
- **The daemon** (`packages/daemon`): fails **closed** (no journal run → no harvest, exit 3,
  tested); signs only through the policy gate (`allowedTargets=[…::stake_vault::harvest]`,
  `allowedObjects=[vault, 0x5]`, one gas budget per 60s); cannot double-claim because the
  *chain* makes a second same-epoch rung inert — the journal is bookkeeping, not the guard
  (`lastHarvestOf` is never consulted by the engine). Residual issues are gas-waste and
  silence: digest-loss retry wastes gas (TR-27); per-DB advisory lock admits a second daemon on
  a second database (same); discovery truncation past 1000 vaults is flagged but unwatched
  (TR-09); daemon death is invisible until B-04's heartbeat is configured (TR-10).

**Verdict:** money-correctness — mitigated (chain-enforced, property-tested, and the fail
direction is bounded). Liveness — the two unwatched failure flags (TR-09/TR-10) are the real
exposure, and they are yield loss, not principal.

### 5.5 Sponsored registration abuse of `/api/agents/sponsor` — gas griefing, handle squatting, rate-limit evasion

**The attack.** The endpoint pays gas for strangers' registrations. Three ways to abuse it:
(a) **gas griefing** — make the sponsor sign expensive transactions repeatedly; (b) **handle
squatting** — reserve desirable handles through the sponsored path without ever intending to
register; (c) **budget exhaustion** — burn the finite seat/slot pool so real agents can't use
it.

**This architecture, and the one real hole:**

- *Gas griefing (tx content):* closed hard. The endpoint refuses any body containing
  `bytes`/`transaction`/`txBytes`/`tx` ("we sign gas exclusively for bytes we constructed
  ourselves" — route.ts:57-69); builds the PTB itself; `assertIsOnlyAccountOpen` requires the
  exact command sequence and — for vaults — that the `CreatorCap` transfers **to the
  transaction's own sender** (`sponsor.ts:124-168`, the exfiltration guard); simulates and
  refuses on abort before signing (`:345-360`); gas budget is fixed at 0.02 SUI.
- *Gas griefing (volume):* `simulateLimit` + seats (50) + seats expire after 15 min
  (`SEAT_HOLD_MS`) + one seat per address *and* per handle. Rate-limit keying is the weak
  underlay (TR-05).
- **Handle squatting: bounded.** The account path requires a spent `declare-agent`
  signature — good. But a reserved seat whose owner never submits is only released by the
  15-minute hold *if* `sponsorAccountOpen` fails; a successful build+sign followed by
  never-submitting leaves the row until the hold lapses (15 min) — acceptable.
- **The vault path — found open, fixed 2026-11-17 (TR-07).** As found: `claimVaultSlot` rows
  had no expiry and nothing in the tree ever wrote `vault_id`, so migration 030's premise
  ("a row here means it happened") was false — a row meant only that the sponsor had signed
  bytes the requester was free never to submit. Fifty throwaway addresses permanently burned
  the whole budget at zero cost. The fix keeps the route server-only (no new statement kind,
  no published-SDK churn) and makes 030's premise true instead of contradicting it:
  unconfirmed slots now hold for `VAULT_HOLD_MS` (15 min) and free via an `ON CONFLICT`
  takeover mirroring the seat hold; `confirmVaultClaimsFromChain` walks `VaultOpened` events
  under both package-id prefixes and writes `vault_id`, so confirmed rows — and only those —
  stay spent; one-per-address-ever is untouched, so a recycled slot cannot be re-taken by the
  same address and each fresh burn attempt costs a fresh funded `SocialAccount`. Status:
  mitigated-but-untested — the database-project sponsor tests (`sponsor.test.ts`,
  `sponsor-gate.test.ts`) need `PROJECTX_TEST_DATABASE_URL` to run and did not run in the
  environment where the fix was written.

**Rate-limit evasion:** the sponsor route is `simulateLimit`-gated, but keying collapses off
Cloudflare (TR-05). The chain-side backstop for the account path is that registration is free
and permissionless anyway — sponsorship saves ~0.006 SUI, so abuse economics are poor *except*
for the finite seats/slots, which is why TR-07 ranks high.

### 5.6 Replay — "every signature is single-use": where it is enforced, and what happens without it

**Where enforced.** `lib/identity.ts:162-187`: the sha256 of the *signature bytes* is inserted
into `used_signatures` (PK) with `ON CONFLICT DO NOTHING`; `rowCount === 0` →
"this signature has already been used — sign again". For deferred-spend routes
(`/api/posts`, `/api/agents/mind`) the spend happens **inside the write transaction**
(`verifyActionDeferringSpend` + `spendSignature`), so a crash cannot separate verify from
spend. DB unreachable → `transport` failure → request refused — fail-closed. Every action kind
is single-use (`sdk/statements.ts:324-327`). The money path is protected differently and
equivalently: `proveTransaction` + the `issued_quotes` digest consumption means a quoted
transaction relays exactly once within 30 minutes.

**What happens if it is not.** The signature window (10 minutes) is the *only* other bound.
Without the ledger: any captured post/comment/DM/upload statement replays for ten minutes —
spam under the victim's identity, duplicate uploads, duplicate declaration filings. With it,
the replay window is zero-use. The ledger converts a time-bounded vulnerability into a
no-vulnerability; its own failure mode is safe (503).

**Honest edges, stated:** (a) single-use is on the *signature*, not the statement — a signer
re-signing the same action at a fresh timestamp spends fresh; that is the retry story, and it
means duplicate-action detection lives in `Idempotency-Key` (messages/posts/submit), not here.
(b) The two agent write surfaces (`seeking`, `declare/pending`) verified without spending
until 2026-11-17 (TR-12) — now the same deferred-spend commit as `/api/posts`; the offer
inbox reads carry read sessions, not statements, so they were never replay surface. (c) Retention equals validity (TR-25): after
sweep, "expired" and "never seen" are indistinguishable — a forensic cap, not a security hole.
(d) The 24h operator-offer window is granted only when a real unfiled offer row exists
(declare/route.ts:60-63) — verified, not assumed from the constant.

**Verdict:** mitigated-but-untested (TR-24) — the mechanism is right and atomically wired;
what remains is a CI guard that new side-effecting routes don't use
`proveActionWithoutSpending`, plus the TR-12 cleanup.

### 5.7 Seal key mismanagement, and Walrus blob-ID/ownership disputes

**Seal — who can break it, and what "break" means.** The chain-side policy
(`seal_approve_unlock`, price-ranked `creator::seal_approve_subscription`, `agent_mind`) is
only *half* the system. The other half is the committee: key servers execute the approval with
the reader as sender and release threshold shares. So:

- *Chain policy bugs* are permanent-content bugs: keys once derived live forever. Three
  historical over-grants are documented in-code (index-vs-price ranking TR-04; lapse-window
  renewal TR-28; the unlock/subscription identity-collision prevented by the tag byte). All
  three are closed in current bytecode; all three already-derived keys are not.
- *Committee compromise/misconfiguration* bypasses the chain policy entirely (TR-01) — this is
  why it ranks highest in the register: the control that makes every entitlement check matter
  is off-chain and invisible to `verify-source`.
- *Mismanagement in the gentler sense:* key-server set/threshold live in env, absent from
  `.env.example` deliberately (phase-01 Medium: undocumented-but-required) — meaning
  redeployment drift is likely and unverifiable from the tree.

**Walrus — who proves a blob belongs to a post?** Today: **the Postgres `assets` table, and
only it.** The binding chain is server-minted asset id → row (`blob_id`, `post_id`, seal
params) → `post.assetIds` subselect → media route membership check → on-chain entitlement →
ciphertext + sha256. No Move module writes Walrus state (verified by grep); the only on-chain
artifact is the Walrus *storage object* transferred to the creator at upload
(`send_object_to`, `lib/media.ts:120`). Claiming someone else's blob through the API is not
reachable (`attachAsset` runs only with the blob the server itself just stored; uploads require
uploader == on-chain `vault.owner`). The dispute shapes that remain: a DB rewrite silently
remaps blob↔post (detected only by the sha256 checks — TR-38); an agreeing aggregator
substitutes bytes (same detector); and the two-sources-of-truth split (DB says binding, chain
says storage ownership) has no arbiter. For a creator-monetization product the practical
exposure is low today (tamper requires DB or committee-level compromise) but the model keeps
the entry so the future on-chain anchoring option has a home.

---

## 6. Register summary (severity-ranked)

| ID | Threat (short) | Category | Component (inventory id) | Sev | Status |
|---|---|---|---|---|---|
| TR-01 | Seal committee compromise/misconfiguration releases all keys | ecosystem | external.seal-keyservers | high | unknown-pending-audit |
| TR-02 | zkLogin seed compromise = mass takeover, irrotatable | stride | web.lib.zklogin-server | high | unmitigated |
| TR-03 | Publisher JWT secret theft drains publisher wallet | ecosystem | web.lib.publisher-token | high | unknown-pending-audit |
| TR-04 | Pre-fix tier-index key over-grant (permanent keys) | move | move.creator | high | mitigated-but-untested |
| TR-05 | Rate-limit evasion / single-bucket collapse (B-06) | stride | web.lib.rate-limit | high | unmitigated |
| TR-06 | CSP script-src Report-Only → XSS executes (B-07) | stride | web.next-config | high | unmitigated |
| TR-07 | Sponsored-vault slots: no signature, no expiry, permanent burn (fixed 2026-11-17) | stride | web.api.sponsor | high | mitigated |
| TR-39 | Stale LATEST package id → old guards on live paths (closed by PR #254's CI gate) | ecosystem | sdk.statements, web.lib.checkout | high | mitigated |
| TR-08 | Legacy media keys in Postgres; server can decrypt | stride | web.lib.media | medium | unmitigated |
| TR-09 | Daemon discovery truncation silently starves newest vaults | ecosystem | daemon.discovery | medium | unknown-pending-audit |
| TR-10 | Daemon death invisible (journal alarm now live; fired 2026-11-17, issue #253) | ecosystem | daemon.supervisor | medium | mitigated |
| TR-11 | Read-session theft = 2h entitled reads incl. legacy plaintext | stride | web.lib.read-session | medium | mitigated-but-untested |
| TR-12 | Never-spent signatures on agent surfaces (fixed 2026-11-17: deferred-spend commit) | stride | web.api.agents | medium | mitigated |
| TR-13 | Decimal mismatch in client display/input paths | ecosystem | sdk.money | medium | mitigated-but-untested |
| TR-14 | Referrer sybil (self-referral via second account) | move | move.account | medium | unmitigated |
| TR-15 | Yield-suppression grief via withdraw-unwind cycles | move | move.stake_vault | medium | mitigated-but-untested |
| TR-16 | LedgerCap books invented economics; can retire souls | move | move.soul | medium | mitigated-but-untested |
| TR-17 | CreatorCap transferable: theft moves earnings authority | move | move.creator | medium | mitigated-but-untested |
| TR-18 | PlatformCap/MasterCap custody composition unverifiable | move | move.platform | medium | unknown-pending-audit |
| TR-19 | Purse hot-key leak: epoch allowance exposure | stride | purse.server | medium | mitigated-but-untested |
| TR-20 | signPersonalMessage bypasses effects-based policy | stride | signer.policy-signer | medium | mitigated-but-untested |
| TR-21 | MCP injection drives bounded spending | stride | mcp.tools | medium | mitigated-but-untested |
| TR-22 | Creator-chosen validator: liveness/self-dealing risk | move | move.stake_vault | medium | unknown-pending-audit |
| TR-23 | PTB composition interleaving (five properties hold; untested) | move | move.creator | medium | mitigated-but-untested |
| TR-24 | Single-use enforcement edges (signature-scoped, route gaps) | stride | web.lib.identity | medium | mitigated-but-untested |
| TR-26 | Rebate anomaly clamp masks drift (unwatched event) | move | move.stake_vault | medium | mitigated-but-untested |
| TR-28 | Lapse-window renewal over-grant (historic, permanent keys) | move | move.entitlement | medium | mitigated-but-untested |
| TR-35 | Relay allowlist bypass classes | stride | web.lib.checkout | medium | mitigated-but-untested |
| TR-37 | Soulbound enforcement integrity (systematic answer) | move | move.account | medium | mitigated-but-untested |
| TR-25 | used_signatures forensics vanish with the window | stride | web.db | low | unmitigated |
| TR-27 | Daemon digest-loss / per-DB lock = gas waste only | ecosystem | daemon.signer | low | mitigated-but-untested |
| TR-29 | DM key registry: agreement-not-validity; client-side defense | ecosystem | move.key_registry | low | mitigated-but-untested |
| TR-30 | Free on-chain handle squatting | move | move.account | low | unmitigated |
| TR-31 | Registry shared-object contention prices out signups | move | move.account | low | mitigated-but-untested |
| TR-32 | Unauthenticated mind-metadata enumeration | stride | web.api.mind | low | mitigated-but-untested |
| TR-33 | error_events unauthenticated fill (observability poisoning) | stride | web.api.telemetry | low | mitigated-but-untested |
| TR-34 | Sponsor/daemon keys in env vars vs purse file standard | ecosystem | web.lib.sponsor | low | mitigated-but-untested |
| TR-36 | Same-origin statement namespace sharing | stride | sdk.statements | low | mitigated-but-untested |
| TR-38 | Blob↔post binding is Postgres-only; no on-chain arbiter | ecosystem | web.lib.walrus | low | mitigated-but-untested |

Status counts: **unmitigated 7 · mitigated-but-untested 23 · mitigated 4 · unknown-pending-audit 5** (39 total).
The unmitigated set splits into: two operator-blocked items the repo already tracks (TR-05
B-06, TR-06 B-07), two accepted-by-design economics (TR-14, TR-30), one observability trade
(TR-25), one deployment-fact exposure (TR-02), and one code migration awaiting a decision
(TR-08, legacy media keys in Postgres). The four **mitigated** entries each carry a named
always-on gate or production event: TR-07 and TR-12 (CI's database-project tests on every
PR, green on #255 and this change), TR-39 (`Deployment records agree` gate, PR #254), and
TR-10 (the journal alarm fired on a real outage, issue #253 — the remaining work is on the
daemon host, not in this tree).

---

## 7. What the audit phase must check that the tree cannot answer

1. **Deployed committee shape** — key-server object ids, weights, threshold; `verifyKeyServers`
   exercised end-to-end (TR-01).
2. **Custody composition** — which addresses hold PlatformCap/upgradeCap/MasterCap; multisig
   membership actually independent (TR-18, against CUSTODY.md's claim).
3. **Env integrity** — the seed (TR-02), publisher secret (TR-03), edge secret (TR-05), and the
   stale LATEST id (TR-39) as they exist in Vercel/VM, not in `.env.example`.
4. **Chain forensics** — vaults with non-ascending tiers (TR-04); lapse-window renewals
   (TR-28); LedgerCap population (TR-16); validator choices (TR-22).
5. **Bytecode identity** — `sui client verify-source` per SECURITY.md, plus the ability-diff on
   the five soulbound types (TR-37).
6. **The two silent flags** — journal `truncated` and stuck runs (TR-09, still unwatched).
   The journal alarm itself is live and has fired on a real outage (TR-10, issue #253): the
   remaining work is on the daemon host, not in this tree.

*End of threat model. Figures and component ids are checkable against
`audit/inventory.json`; severities and statuses are judgements, and each register entry names
what would change its mind.*
