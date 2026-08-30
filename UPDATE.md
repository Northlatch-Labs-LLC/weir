# WEIR — UPDATE

**READ THIS FILE FROM THE TOP. Newest first.** The entry below the title is the current state
of Weir; everything under it is history, in reverse. Stop reading when you know enough.

**This is the governing document.** Where it disagrees with a plan, an audit, a code comment or
anything a desk told you, **this wins** — and the newer entry wins over the older one. An older
entry that contradicts a newer one is not a conflict to resolve; it was already superseded.

Never edit an old entry to agree with a new one. Never delete one. Add, and say what you
superseded. Append with `operations/watcher/note-update.sh weir "<summary>"`.
Law: `operations/company/UPDATE-FILE-LAW.md`.

---

## 2026-08-30 · Paid media keys handed to Seal — and a live paywall bypass found on subscriber media

**Who:** engineering agent, under Kaela · **Where:** `packages/sdk`, `packages/web`, `db/019`, `sui-contracts/tests/seal_tests.move` · **Ref:** PR #13, OPEN, all seven checks green, NOT merged

The Master ruled **"Build the Seal"** rather than amend the Creator Terms to match the code. Half A is done and proven; Half B is specified and deliberately not built.

**PROVEN:**
- **Identity derivation matches the contract byte-for-byte** — the same three vectors asserted in `sui-contracts/tests/seal_tests.move` AND `packages/sdk/test/seal-identity.test.ts`. Proven in Move, not transcribed and hoped.
- **The Seal hooks are already live on mainnet.** Deployed bytecode read directly: `seal_approve_unlock`, `seal_approve_subscription`, `unlock_identity`, `period_identity` all present. Package `0xc5c833…` is **version 1**, which Seal strictly requires for the namespace.
- **Move untouched in substance** — 113/113 and the built digest is identical to `ci-expected-digest`, so no upgrade is implied.
- **Schema proven against a real PostgreSQL 16**, not asserted: all 19 migrations apply, existing rows keep their columns, backfill correct, re-run idempotent, and all five illegal shapes refused — including a `'seal'` row that kept our plaintext key.
- **A non-entitled reader cannot open the ciphertext** (`test/seal-open.test.ts`): given the entire response they recover nothing; wrong key, wrong nonce and one flipped byte all fail closed on GCM's tag.
- Config fails loud with no defaults, and a test asserts the API key value never appears in a failure message.
- **Verified:** web 997 passed (was 977), sdk 203 (was 157), Move 113 (was 111), `tsc` exit 0. Same 2 pre-existing failures in the same 4 files.

**A measurement lesson worth keeping:** the web test TOTAL is flaky by one and is environment-dependent — a git worktree carries no gitignored `.env.local`, so four files fail to *collect* rather than fail. **Failing-FILE identity is the portable check; the test total is not.**

⚠️ **DEPLOYMENT BLOCKER: there are no open Seal key servers on Sui mainnet.** Every provider is permissioned; the Mysten committee needs Enoki credentials, requiring an account and likely payment — prohibited for any agent. Until configured, sealing fails **loudly** (503 `unconfigured`) with **no silent fallback to platform custody**. No current reader is affected: nothing is sealed until `seal:migrate --commit` runs.

🔴 **A LIVE PAYWALL BYPASS — PRE-EXISTING, NOT INTRODUCED HERE, VERIFIED FIRST-HAND BY THE DESK.**
`app/api/studio/upload/route.ts:131`, in the code's own words: *"subscriber-only media is NOT encrypted before it reaches Walrus, and a Walrus blob is public."* The upload route gates encryption on `access.kind === 'paid'`, so a **subscribers**-tier post's images reach Walrus in the clear. Creator `Blob` objects are public on chain, so the blob id is discoverable and any aggregator serves the bytes. **The entitlement gate is bypassable for that content today.**

**Deliberately not fixed.** Sealing it needs a *period* identity, which by the contract's own design binds access to the month of publication — so a later subscriber would lose older media. That changes what a subscriber gets. **HELD FOR THE MASTER.** Both identity kinds are built and tested, so the follow-up is small once he rules.

- **Open:** Half B — post bodies remain plaintext in Postgres, so **Creator Terms §4.3 is still not true for bodies.** Fully specified against real files. Search is unaffected (`db/005_search.sql` indexes title and preview only, and says so). No moderation surface reads bodies. Previews stay plaintext. Server-side rendering of gated bodies would end.
- **Open:** four config variables need adding to `env.example` by hand; the agent's tooling was denied that path. The canonical machine-readable list is `SEAL_ENV` in `packages/sdk/src/config.ts` — **if a doc block and that export ever disagree, the export wins**, because it is what the loader reads.
- **Trap for whoever configures it:** the mainnet Mysten committee is ONE entry from the client's side. Its internal 5-of-8 is enforced by the aggregator and invisible here, so a single committee entry means `THRESHOLD=1`, **not 5**.
- **Note:** the bundled `@mysten/seal` docs are WRONG — they show `.$extend(seal({...}))` and `seal` does not exist in 1.4.4. Write against the installed types.

---

## 2026-08-30 · The waiting-list door is mended — four defects closed

**Who:** front-end agent, under Kaela · **Where:** `packages/web/proxy.ts`, `components/design/Waitlist.tsx` · **Ref:** PR #12, open, not merged

All four were still live; PR #11 had closed none of them.

- **`/security` 307'd back to itself.** It was absent from `ALWAYS_OPEN` in `proxy.ts:62`, so the only outbound link on the only reachable page returned the reader to where they started. Added, after checking the page renders identically signed-out — `Security.tsx:61-71` destructures `signedIn` and `myHandle` and references neither.
- **The stranded ordinal.** `You are number 47 th address to join` → `You are number {n} on the list.`, with `You are on the list.` as the null state. The separator was a **U+2009 thin space**, not a regular space, which is why a plain-text search for the string did not match the file.
- **`Weir is already live and open to read`** was rendered unconditionally to a reader the proxy had just turned away. It now branches: gated reads `— the doors have not opened yet.`
- **The handle field failed silently.** An invalid handle mapped to `malformed`, which had no branch, so the field rendered `Optional.` in dim grey and said nothing. Branch added, bounds imported from the SDK, no literals.

- **Verified:** before 4 files failed / 69 passed, 970 tests passed. After 4 failed / 70 passed, 988 tests passed. +18 tests, all the agent's own; reverting the two source files fails 12 of the 18, which proves they test the change. `tsc` exit 0 both times. Same four pre-existing failures.
- **Note on the baseline:** the agent measured 0 failing *tests* where this desk measured 2, because it worked in a git worktree with no `.env.local`, so four files fail to *collect* rather than fail. Environmental, not code. This desk's figure of "2 failing tests" is correct only in the primary clone.
- **Open:** the uppercase fold. `handleShapeProblem:155` and `canonicalHandle:165` both lower-case before validating, so `Alice` goes green and is stored as `alice` — the contract rejects capitals rather than folding them. The UI now warns; the fold itself changes what gets written and was left alone.
- **Open, needs the Master:** the new sentence has no room for `standing.total`, so `of 1,203 on the list` is gone and that value now has no reader. Say whether the total comes back.

---

## 2026-08-30 · The waiting list stops reserving names the contract will refuse

**Who:** Kaela (desk) · **Where:** `packages/web/lib/waitlist.ts`, `packages/web/test/waitlist.test.ts` · **Ref:** PR #11, merged, main at `9a7af73`

`handleShapeProblem` capped handles at 32. `account.move:43` caps at 30. Every 31- and
32-character handle the list ever accepted is one `account::open` aborts on with
`EHandleLength` — stored, uniquely indexed, and unmintable. The API route reuses the same
function, so browser and server agreed with each other and both disagreed with the chain.

Not fixed by writing 30. `MIN_HANDLE_LEN` and `MAX_HANDLE_LEN` are imported from the SDK, which
`packages/sdk/test/drift.test.ts` already asserts against `account.move`. Chain of custody is
now Move source → SDK constant → validator, with no literal in between, and the bounds are
interpolated into the messages so the copy cannot disagree with the check.

**The test was why this lived.** `test/waitlist.test.ts` asserted a 32-character handle was
valid, under the name "accepts what the contract accepts". It did not miss the defect — it
certified it. A second test now pins the ceiling to 30 explicitly, so if it ever moves a human
reads the diff.

- **Verified:** `tsc --noEmit` clean; `vitest test/waitlist.test.ts` 15 passed; full suite 977
  passed / 2 failed / 4 files failed against a stashed baseline of 976 / 2 / 4 — one added
  passing test, nothing broken. The 4 failing files (relay, replay, creator-profile,
  vault-denomination) are PRE-EXISTING and untouched.
- **Open:** the list silently lower-cases a handle while the contract REJECTS uppercase rather
  than folding — so we can store a different handle than the person typed. Not fixed.

---

## 2026-08-30 · Platform read live from mainnet — creation is OPEN

**Who:** Kaela (desk) · **Where:** chain read, no code changed · **Ref:** object `0x3f695b2c…50f36`

`sui-contracts/deploy/mainnet.json` says `PlatformCap` was moved to a hot key on 2026-08-28 to
**re-pause vault creation**. If true, no creator could open an account or mint a handle, and the
Founding 100 campaign would be unbuildable. Read the live object rather than the file:

```
creation_paused  false      payments_paused  false
fee_bps          290        creation_fee_mist 29000000000  (29 SUI)
referral_share   500 bps    accounts_created  9    vaults_created 17
treasury         29000000000
```

- **Verified:** `sui client object 0x3f695b2c32714e2359c4bb9515598d8dd765b216148c5b8fa818073d52b50f36 --json`, mainnet, 2026-08-30.
- **Supersedes:** `mainnet.json`'s `verifiedOnChain.creationFeeMist: 0` (dated 14 Aug) — the
  creation fee is **29 SUI**, not zero. Also supersedes any assumption that creation is paused.
- **Open:** 17 vaults exist but the treasury holds exactly one creation fee. Probably because
  most were created before the fee was set. Not confirmed.
- **Open:** nothing in the product tells a creator about the 29 SUI before they commit.

---

## 2026-08-30 · Marketing brief fact-checked against the code — three headline claims are false

**Who:** verification agent, under the desk · **Where:** read-only across `packages/web`, `packages/sdk`, `sui-contracts`, `content/legal`

A Founding 100 campaign brief was produced by an outside tool. Checked line by line before any
copy was written on it.

**TRUE and verified, use freely:** the 2.9% fee is real (`fee_bps 290` on chain) and applies
identically to subscriptions, unlocks and tips through one `settle` path; the creator's cut
lands in their vault in the same transaction with no hold and no admin path to the balance
(`creator.move:496-531`, `claim_earnings` at `:698`); subscribers hold non-transferable owned
objects (`entitlement.move:46,67`); zkLogin means no wallet at signup.

**FALSE — never repeat these:**
1. *"Post bodies are stored on Walrus"* — bodies are **plaintext in Postgres**
   (`db/001_init.sql:30-32`). Walrus holds **media only** (`db/010_media_to_walrus.sql`).
2. *"Gated bodies are encrypted client-side with Seal; Northlatch cannot read them"* — Seal is
   **not integrated** on the web side at all. Media is encrypted **server-side under a key we
   hold** (`lib/blob-crypto.ts:18-23`). Contract hooks exist and are unused
   (`entitlement.move:349,368`).
3. *"Content lives on Walrus permanently"* — storage is a **lease**, at most 53 epochs. Our own
   `lib/walrus.ts:23-25`: *"Nothing here may promise 'for ever'."*
4. The waitlist *"reserves"* a handle — `db/014_waitlist.sql:42-44`: it "reserves **NOTHING** on
   chain and **must never be presented as though it does**." It has no address column.
5. The waitlist handle is a Weir handle `[a-z0-9_]`, **not** a `.sui` name. Those are SuiNS and
   a separate purchase.

**One admin capability the brief denies exists:** `platform::set_payments_paused`
(`platform.move:246-251`) halts all new payments to every vault, platform-wide. It cannot touch
a balance, so "cannot freeze or seize your balances" is true — "cannot freeze" is not.

- **Open, and it outranks the campaign:** our own **Creator Terms §4.3 and §4.4**, and **ToS
  §5.4**, tell creators bodies are Seal-encrypted and content cannot be deleted. Both are
  untrue of the code. That is a live representation, not a slide. The Master ruled **"Build the
  Seal"** — see the next entry down when it lands.
- **Open:** Creator Terms §8.4 is a *forfeiture-on-breach* clause, not authorisation for a
  rebate programme. It cannot be the legal basis for a founder fee offer.

---

## 2026-08-30 · Founding 100 campaign kit written — 13 weeks, four gates, nothing sent

**Who:** growth desk, under Kaela · **Where:** `operations/campaign-kit/weir-founding-100/`

Four documents: `OPERATING-PLAN.md`, `FOUNDER-MECHANICS.md`, `MEASUREMENT.md`,
`RISK-REGISTER.md`. Thirteen weeks, not twelve — 31 Aug to 1 Dec is thirteen weeks and a day;
the slack week is W12, a publishing sprint. Four gates with numeric pass conditions and a
kill rule each.

Not deliverable from today's product, and named as such rather than assumed: the founder badge
(nothing on chain mints one), the commemorative object (no mint module exists), the directory's
avatars (`profiles` has no avatar column), and the referral loop as briefed (`settle` passes
`buyer.referrer()` — inviting a *creator* earns nothing; inviting a *supporter* earns 0.145% of
their spend).

- **Open, needs the Master's word:** go date · the 29 SUI fee and whether creators are told ·
  the founder fee shape AND rate · the badge shape · the invite ceiling · the counter threshold
  · **whether 1 December is real at all** — that date appears in no source, config or legal
  text anywhere in this repo.
- **Nothing has been sent, published, deployed or committed from this kit.**

---

## 2026-08-30 · Copy audit — 31 defects on the live site

**Who:** Lexi · **Where:** `operations/copy-audit-weir-2026-08-30.md`

Tier 1 (waiting list) 9 · Tier 2 (signed-in alpha) 12 · Tier 3 (public at open) 10. The waiting
list outranks everything because `proxy.ts:62` admits only `/waitlist`, `/signin`,
`/auth/callback`, `/api/`, `/legal`, `/opengraph-image`.

The two worst: every successful signup reads `You are number 47 th address to join` — a stranded
ordinal (`components/design/Waitlist.tsx:366-371`); and the handle field **fails silently** —
an invalid handle maps to `malformed`, which has no branch, so the field renders `Optional.` in
dim grey and the person is never told what is wrong.

Also: *"Read the contracts"*, the only outbound button on the only reachable page, points at
`/security`, which is not in `ALWAYS_OPEN` and 307s straight back.

- **Open:** an agent is working D1–D4 now. The rest of the 31 are unstarted.
- **Note:** the shipped tagline is `Support that stays yours.` (`app/layout.tsx:37`) while the
  brand pack rules `Your favorite notification`. Both are ours; they disagree. Master's call.

---

*Entries before 2026-08-30 were never recorded — this file did not exist. The history is in
`git log`, `operations/HANDOFF-*.md` and `operations/copy-audit-weir-2026-08-30.md`. Read those
knowing everything above may have overtaken them.*
