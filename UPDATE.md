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

## 2026-08-31 · CORRECTION, supersedes both entries below it on the /purchases question. There is no bug and there never was one, and there is nothing to change in the copy either. The Master found the Unlocked posts list exactly where the code puts it: on the purchases section, BELOW the subscriptions list. It renders, it is correct, and the lede that promises every subscription and unlocked post is accurate. Both earlier entries from this desk are wrong and stand as the record of it. First this desk turned his question into an OPEN DEFECT and narrowed a bug that did not exist. Then, on his ruling that it was not a bug, it wrote that the copy and the render block should change to match - which would have DELETED a working feature he wanted, on the strength of the desk's own misreading. The measurements in the first entry were all sound: the chain, the API and the entitlement path were each verified correct. Every wrong conclusion here was drawn on top of correct measurements, which is the failure worth remembering - measuring well is not the same as concluding well, and the desk should have asked him what he was looking at before it built a theory about it.

---

## 2026-08-31 · CORRECTION, supersedes the entry below it that called the /purchases Unlock listing an OPEN DEFECT. The Master ruled 2026-08-31: it is NOT a bug. A purchased post is seen on the creator's page you bought it from, where it carries the Unlocked badge, and the account's purchases section lists subscriptions. That is the product as he wants it. This desk classified expected behaviour as a defect after he asked about it, and then narrowed and filed a bug that was not one. The chain, the API and the entitlement path were all measured correct in that earlier entry and those measurements stand; only the conclusion drawn from them was wrong. ONE FACT LEFT ON THE TABLE FOR HIM, not an argument and not a reopening: components/Purchases.tsx still carries an Unlocked posts render block at :170, and the page lede at app/(app)/purchases/page.tsx says Every subscription and unlocked post. So the copy and the code both currently promise the listing he does not want shown there. If it stays as he ruled, the lede and that block are what should change, not the entitlement path. Awaiting his word, doing nothing to either. SEPARATELY, what he had actually deferred was DEPENDABOT PR 24, not the purchases question and not the Move upgrade. This desk misfiled it twice.

---

## 2026-08-31 · OPEN DEFECT, reported by the Master 2026-08-31 and NOT yet fixed: an Unlock does not appear in /purchases while a Subscription does, for the same address on the same page. Narrowed, so nobody re-derives it. THE CHAIN IS FINE: gRPC listEvents over the full history shows exactly one buyer of @atlas content ever, 0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d, with one ContentUnlocked for key sealed-on-walrus-001 at 10000 and one SubscriptionStarted tier 0 at 1000000. THE API IS FINE: GET https://weir.social/api/purchases?buyer=0xda784b6c... returns HTTP 200 with 2 unlocks and 4 subscriptions, and the atlas unlock comes back correctly titled Sealed on Walrus with handle atlas and pricePaid 10000. ENTITLEMENT IS FINE: the Master confirms the post renders with the Unlocked badge on @atlas's page when he is logged in with that same wallet, so canRead, the badge and the reader path all work. So the fault is between the API response and the rendered list in components/Purchases.tsx, which is client-side: the subscriptions block at :125 renders and the unlocks block at :170 does not, both gated only on array length. Not reproduced from this desk because it needs his browser session; do not close it on the API alone, which is the trap here, since the API is demonstrably correct. RELATED AND ALSO MINE: the empty state at :118 says your address holds no subscriptions or unlocks without naming the address it queried, which is what let a working purchase read as a lost one. Naming the address in that copy is worth doing whether or not the render bug is found first. ALSO OPEN, the Master's own thread to pick up with him: he is rethinking the system in regard to the post and the feed and asked to be reminded of it.

---

## 2026-08-31 · Published the three-part Seal explainer as @atlas, public, on the Master's word after he reviewed the drafts: pmtgxlqay Where a paid post actually goes, pmtgxlrti Who decides you may read it, pmtgxltby What we can still see. Written to the voice of the existing @atlas guides, first person and documentary, and every figure in them is a real measurement from tonight rather than a claim: the 734-byte and 170-byte ciphertext blobs fetched from the public Walrus aggregator with no wallet, the 32 bytes the key server released for a paid period, the refusal for an unpaid one, and @atlas being refused its own paid media. Post 3 states the limits plainly and on purpose, including that subscriber media was NOT encrypted until this week, because letting a reader assume it always was would be the same class of untrue claim this session spent the night removing from the Creator Terms. Text was read from the approved file at publish time and never retyped, so what shipped is byte-for-byte what the Master approved. The four rows together are the evidence the publish route now makes opposite decisions correctly on the same night: pmtgxffvy subscribers has body length 0 with a sealed blob, while all three public posts carry full plaintext bodies of 1498, 1616 and 1492 bytes and no blob, because a free post's words belong in a column and a gated post has no words to keep.

---

## 2026-08-31 · Subscriber sealing PROVEN on production. PR 23 merged as 94e9f06, Vercel deployed and aliased to weir.social. Published post pmtgxffvy as @atlas, access subscribers, with image asset 17a01ee92d64cc2b25e47692db0df76c. THE ROW: posts.body is length 0, the plaintext column is empty; body_blob_id ZqPLyhQFhpDUXNht2DBNly7NjSfTbv-2Vxm94o0LeMI, body_tier 0, body_period 689, wrapped key 444 chars, sha256 recorded. THE ASSET: enc_scheme seal, enc_key NULL, seal_tier 0, seal_period 689, blob YnL5u_hqseYxT2jdeS2d9ci-PYyYmmuWYTHrpuAELxo, 170 bytes, durable lease to epoch 91. Before tonight that image would have been a readable PNG on public Walrus. BOTH BLOBS FETCHED FROM THE PUBLIC AGGREGATOR WITH NO WALLET AND NO AUTH: 200, 734 bytes and 170 bytes, neither carries PNG magic and neither is readable text. Ciphertext. THE KEY SERVER TESTED IN BOTH DIRECTIONS against the real Subscription 0x5524552c2c39 held by 0xda784b6c, tier 0, paid window 2026-08-31T04:43 to 2026-09-30T04:43, with a SessionKey signed by the subscriber and seal_approve_subscription executed with them as sender. Period 690, inside the paid window, KEY SERVER RELEASED 32 bytes. Period 689, which is the period this live post is sealed to and which began 2026-08-05 before that subscription existed, KEY SERVER REFUSED with User does not have access. The paywall holds in both directions and it holds on the contract, not on our server agreeing to say no. CONSEQUENCE THE MASTER SHOULD KNOW: the subscriber who joins mid-period cannot read that period. This subscription started 04:43 on 31 August, four days into period 689's remainder, so pmtgxffvy opens for them on 4 September when period 690 begins. Worst case for a subscriber joining just after a boundary is 29 days. The Master ruled NO CONTRACT UPGRADE tonight: the 30-day period stands, and if a creator asks for the per-post identity design it is done then, on that creator's ask. Recorded also that MIN_PERIOD_MS was raised from 1 day to 30 days by this desk in commit eaf1215 PR 2 titled tier/Seal period mismatch, which means the 30-day tier minimum was never a product decision the Master made; it was collateral from the seal period width. VERSION DRIFT FOUND AND FIXED: node_modules held @mysten/seal 1.4.4 and @mysten/sui 2.26.2 while the lockfile pins 1.4.5 and 2.27.0, so every test claim made earlier in the session was made against libraries production does not run. Synced with pnpm install --frozen-lockfile and re-verified: 1038 pass, same two pre-existing failures, typecheck clean. Seal 1.4.6 and Sui 2.27.1 are available and NOT taken. MYSTEN DOCUMENTATION DEFECT: their published SDK docs state verifyKeyServers defaults to true; the shipped code in 1.4.5 reads verifyKeyServers ?? false. Anyone following their own documentation gets unverified key servers. We set it explicitly to true at all three call sites so we were never exposed.

---

## 2026-08-30 · Sealed every gated post, words and media. Paid bodies seal to unlock_identity(vault, contentKey), the same identity their media uses, so one Unlock opens the words and the pictures together. Subscriber bodies and subscriber MEDIA seal to period_identity(vault, tier, period), released by seal_approve_subscription. No Move change in any of it: both approve functions were already deployed on package 0xc5c833 v1. THE SUBSCRIBER MEDIA FINDING, and it is the serious one. studio/upload decided encryption with post.access.kind === 'paid'. That line is older than this storage layer. It was written when media lived on /app/media, a private Docker volume served by a route that checked entitlement, which docker-compose.yml in the retired ProjectX Social tree still describes; there, unencrypted honestly meant only our server can read it. Storage then moved to Walrus. A Walrus blob is PUBLIC. The line did not change, so every subscriber-only image went from a private file to a public one with no edit to mark the moment and nothing in any diff to review. Asset ids and blob ids are withheld from unentitled readers, but that is obscurity of a location, not protection of bytes. The Master identified this migration as the source of the confusion before I did. Migrations 020 (posts body_blob_id, body_end_epoch, body_nonce, body_seal_wrapped_key, body_sha256), 021 (posts body_tier, body_period) and 022 (assets seal_tier, seal_period) are APPLIED to Supabase pykerpxszoaocxtfyrzm. Additive only, nothing dropped or cleared; the alpha_test schema is the retired 18-19 August alpha and was left untouched. The period index is load-bearing and is not optional: a Seal key is a deterministic function of the identity and no second check ever runs, so one identity per tier would mean a single month's subscription opening that creator's archive in perpetuity including everything published after it lapsed. Two consequences accepted deliberately: a new subscriber cannot read periods that closed before they joined, and the period width is frozen because changing it re-partitions every identity ever issued. Tier is 0 and is STORED rather than assumed, so publishing at tier 1 later cannot strand what was sealed at tier 0. The badge read locked ? ... : 'Free', the reader's relationship to a post printed as the post's price, so a buyer saw a paid post labelled Free the moment their Unlock landed; that is what the Master photographed and it is fixed. Six false claims are corrected across Creator Terms 4.3, the Privacy Policy, the security page and the landing copy, including a straight self-contradiction in 4.3 that said both Northlatch can read them and Northlatch cannot read them in consecutive sentences. NOT DONE, stated plainly: existing unsealed blobs are NOT rewritten, since re-sealing means downloading, encrypting and re-uploading each under a fresh lease and that is a bulk rewrite of live content which does not belong in the change that stops creating more; assets_unsealed_subscriber_idx finds them. And no tier has been exercised end to end against the live site. The proof here is 1038 passing tests, 38 of them new, plus the paid-media decrypt run by hand last night. PR 23 is open and unmerged. Side effect worth knowing: gated media now takes the durable Walrus lease, so subscriber images stop expiring after one epoch, which was quietly broken.

---

## 2026-08-30 · Seal proved end to end on production. Published a paid post as @atlas (pmtgokrj6, 0.01 USDC) and uploaded an image; the asset row is enc_scheme=seal with enc_key NULL and a 448-char seal_wrapped_key, and the Walrus blob WXvK3pfdceGlgKy94qKR1LCeuV9WSakYlfaiizIgJA4 fetched from the PUBLIC aggregator with no auth returns 170 bytes with no PNG magic: ciphertext. Even @atlas gets 403 on their own paid media because canRead grants no owner exception. TWO faults were blocking this, not one. First, no key server, fixed earlier. Second, migration 019_seal_key_custody.sql was written, reviewed, committed and NEVER RUN against production, so every paid upload died on column enc_scheme of relation assets does not exist. Applied it to Supabase project pykerpxszoaocxtfyrzm on the Master's word. Paid media upload had therefore been impossible since the Seal PR merged. THIRD ISSUE, MINE: I published via /api/posts without setting the on-chain content price, so creator::unlock aborted with code 12 EContentNotForSale. Fixed with set_content_price as @atlas, digest 8dmFJaLkKhjW5UtiDi3Q6GVFozdgNMzS5FXU4uyvj6Jc. DEFECT FOUND AND NOT YET FIXED: app/api/posts/route.ts documents in its own opening comment that it verifies the content price against the vault before writing, because otherwise a post stored as paid whose key was never priced would render a buy button that always aborts. That check does not exist. readContentPrice appears zero times in the route and is not imported, though the SDK exports it at creator.ts:182. The route reads the vault only for ownership. Any creator can publish a paid post that no buyer can ever purchase, and the failure surfaces as MoveAbort 12 at checkout with no explanation.

---

## 2026-08-30 · Repinned the harvest daemon from Weir package v2 to v3. PROJECTX_SOCIAL_LATEST_PACKAGE_ID was 0xa7fd15 which the chain reports as version 2; it is now 0xfa7eb1, confirmed as version 3 both by reading the package and by the UpgradeCap's package field. That id is the call target for stake_vault::harvest in adapters/signer.ts, the only transaction this daemon builds, so every harvest was executing v2 bytecode against a v3 deployment. The daemon holds no capability so nothing was at risk. Changed in three places: the live VM env file at /var/lib/projectx-social/harvest-public.env with the previous version preserved beside it as harvest-public.env.v2-20260830, and both repo deploy scripts install-cos.sh and social-startup.sh, on branch daemon-repin-v3 as PR 19. Published.toml and packages/web were already correct. Verified by running one tick after the repin: it reports the v3 id and exits 0 with harvested 0, skipped 9, failed 0. Stated honestly, that tick did not exercise the harvest call itself because no vault was due; the guarantee it still resolves is structural, since Sui rejects an upgrade that removes a public function or changes its signature, and the daemon simulates before signing so an unresolvable target fails without producing a transaction.

---

## 2026-08-30 · Seal wired end to end in the browser. The opener existed and was tested; nothing called it, so a sealed asset reached the tab as ciphertext and painted a broken image on exactly the posts readers paid for. New client component SealedMedia fetches the asset, dispatches on the response, and for sealed bytes builds a reader-signed SessionKey and recovers the key through the key server committee. readEntitlements now keeps the Unlock object id it was already decoding and discarding; the media route names it back to the browser in x-seal-* headers, because seal_approve_unlock takes an owned object the reader must identify. One shared unlockKey builder now serves the reader, canRead and the route -- an inlined key string missed every lookup, since the vault is normalised and a raw id is not. Settings come from a new /api/seal endpoint rather than props: PostCard renders inside client components and cannot reach siteConfig, and this codebase's stated rule is that the browser asks. API keys are never published. 1020 tests pass, 5 new; build clean. Not yet exercisable end to end -- no key server is configured on any deployment and none exists on GCP.

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
