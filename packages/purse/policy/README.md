# The policy documents

Two documents, one per money path. `test/policy-documents.test.ts` loads both through the real
loader and evaluates real intents against them; nothing here is asserted by restatement.

| File | Deployed to | Key | May call |
|---|---|---|---|
| `heron-content.json` | `heron-purse.service` | `heron-hot` (multisig member 1) | `creator::set_content_price`, `soul::record_spend` |
| `heron-ledger.json` | the `LedgerCap` service | `ledger` | `soul::settle_epoch` |
| `heron-multisig.json` | `heron-purse.service` (`--multisig`) | the members: `hot` and `brake`, weight 1 each, threshold 1 | nothing; it says who the address is made of |

`heron-content-pre-soul.json` is the document the purse runs under **today**, before Heron's soul is
published and before Heron's vault and creator cap exist: no substitution in it, every value real.
It is `heron-content.json` with the entries that do not exist yet left out rather than filled with a
placeholder: `agentAddress` and the one recipient are Heron's address, the one target is
`creator::set_content_price` on the v5 package, and `allowedObjects` is **empty**, so every price
intent is refused by the `object-input` rule until the vault exists and this document is replaced by
the rendered `heron-content.json` (a redeploy, not a reload). The purse is live, hardened and
answering, and it signs nothing; `test/policy-documents.test.ts` loads it and proves the refusal.

`heron-content.mainnet.json` is the render of `heron-content.json` with `heron-values.json`
(`bin/render-policy.ts --pre-soul`): the vault, the cap and the clock as objects, Heron, the
operator and the treasury as recipients, `set_content_price` as the one target; the two soul rows
left out until the soul is published. `test/policy-documents.test.ts` re-renders and compares, so
the committed document cannot drift from its template and values. Heron's SocialAccount is
`0xf5960dca0b3dc8f1113f4ec371e25ef62e5ecb033c7313c6caf8afc936d69cf5` (handle `heron`,
tx `Evi5wTwp…`).

`heron-multisig.json` holds no substitution: two public keys and two integers, real, committed.
The hot member is the key born 2026-09-05 (`0x51704a…10b0`); the brake is the Master's, read from
the chain (`0x4668e5…6c9a`). Together at threshold 1 they derive Heron's address
`0xe8345fea67b57baf5461446852c4badeb8936e2af7cc390fc5c16be0337ddd70`, and
`test/policy-documents.test.ts` derives it with the SDK and compares. A change to any member,
weight or threshold is a different address, so the purse's start-time check against the pinned
policy's `agentAddress` covers this document without a pin of its own.

They are separate files because the caps are separate keys under separate services (executive
decision 6). `src/policy-file.ts` refuses to start a purse on a document that names `settle_epoch`
alongside anything else, so merging them is not a shortcut anybody can take by accident.

## Every `<ANGLE_BRACKET>` is filled by the deploy

Same convention, and the same reason, as `<POLICY_SHA256>` in `systemd/heron-purse.service`: these
are not defaults. A document with an unfilled substitution **fails to load** — `agentAddress` is
checked against a Sui address regex — so a half-finished deploy refuses to start rather than
starting with something plausible.

| Substitution | What it is | Exists yet? |
|---|---|---|
| `<HERON_ADDRESS>` | the 1-of-2 multisig address Heron signs from | **yes:** `0xe8345fea67b57baf5461446852c4badeb8936e2af7cc390fc5c16be0337ddd70` (derived from `heron-multisig.json`) |
| `<LEDGER_ADDRESS>` | the `LedgerCap` service's own address | **yes:** `0x9af1e7ec1344d487245b1a223c59c8c1c771dbf670db5ad5bfbc9abc17b4b666` (`heron-ledger`, born 2026-09-05) |
| `<OPERATOR_ADDRESS>` | the operator, one of the three recipients | **yes:** Kaela's wallet `0x45d107…c30c` (desk decision, 2026-09-05) |
| `<TREASURY_ADDRESS>` | the treasury, one of the three recipients | **yes:** the `PlatformCap` holder `0x00e734…1605`, read from mainnet (desk decision, 2026-09-05) |
| `<HERON_VAULT_ID>` | Heron's `CreatorVault<SUI>` | **yes:** `0x0c3f3a6174293544f3ac61e466d9ebe62edb88cca2f3674cbd9311df8e736b68`, opened 2026-09-05 by `bin/birth-vault.ts` as the multisig (tx `2aksk5Dd…`) |
| `<HERON_CREATOR_CAP_ID>` | Heron's `CreatorCap` | **yes:** `0xea9ba87eb3a50e9113bc08aba8a4fb227d28371335ebcab43a235c316357d0d0`, with the vault |
| `<HERON_SOUL_ID>` | Heron's `EmployeeSoul` | the soul package is unpublished |
| `<SOUL_REGISTRY_ID>` | the shared `SoulRegistry` | unpublished |
| `<LEDGER_CAP_ID>` | the `LedgerCap` object | unpublished |
| `<SOUL_PACKAGE_ID>` | the published soul package | unpublished; no `Published.toml` |
| `<CLOCK_ID>` | `0x6` | fixed, but written as a substitution so the deploy prints it with the rest |

The one id that is **not** a substitution is the projectx_social package,
`0xdc6dbb96885ba049c5d860d0b775b9e968cf9053a227861ae006f22e352884b5` — v5, published on mainnet,
read from `sui-contracts/Published.toml` on this branch. `build.ts` emits the target from
`chain.latestPackageId`, so the pin and the built call must be the same value; a chain config
pointing anywhere else refuses at `move-call-target` rather than signing against the wrong package.

## The numbers, and where each comes from

**`maxPerPeriod` 400000000 MIST (0.4 SUI).** The epoch allowance. The CISO's draft said 0.5 and
Plan One said 0.4; `2026-09-05-engineering-heron-v2-runtime-and-host.md` rules that 0.4 governs.
On SUI gas counts inside this figure — the rule says so in its own refusal text — so 0.4 SUI is a
gas budget, not a purchase budget. That is deliberate: Heron sells and does not buy at v2, and
`weir_buy`, `weir_subscribe` and `creator::unlock` are refused outright.

**`periodMs` 86400000 (seven days).** The policy window is *rolling*, `[now - periodMs, now]`, not
a calendar epoch, so it has no boundary to wait for. Seven days is the soul package's `EPOCH_MS` as
built. **Closed 2026-09-06:** the two soul trees no longer disagree. `weir/sui-contracts-soul` now holds the deployed contract — a release build there reproduces mainnet module `0x8d6567ed…635f` byte for byte, proved by `check-matches-mainnet.sh --chain` — and the copy that carried `EPOCH_MS = 604_800_000` is gone. The chain's own epoch is the epoch.
deletes it and uses the chain epoch instead. If the published soul settles on chain epochs, this
number is wrong and must move with it. Named in the branch's report rather than left to be found.

**`maxGasBudgetMist` 20000000 MIST (0.02 SUI).** Neither Plan One nor the CISO gave a number; both
required one be stated. This is it, and here is its derivation: a recorded mainnet
`creator::set_content_price` simulation costs 1,188,000 MIST, so the ceiling is roughly sixteen
times the observed cost — enough headroom for a storage-cost change or a busier network, and one
twentieth of the epoch ceiling, so a runaway gas price cannot drain the allowance in a single beat.
`build.ts` sets the budget *from* this field, so the transaction is never built asking for more than
the policy would allow, and `gas-budget` refuses anything that arrives above it.

**`allowedRecipients`, three entries.** Heron, the operator, the treasury — the enumerated set from
Plan One. An intent has no recipient field at all (`intent.ts`), so this list bounds only what a
simulation may show, which is the case that matters: change transferred anywhere but these three is
refused by name.

**`allowedTypeArguments`, SUI only** on the content document, and **empty** on the ledger document,
because `soul::settle_epoch` is not generic.

## Changing one is a redeploy

The document is read once, at start, and its sha256 must equal `--policy-sha256` in the unit file,
which is under root. Someone who can write the file can make the purse refuse to start — loud, and
refusing everything. Widening needs the unit changed too. There is no reload call and no watcher.


**Epoch length, ruled 2026-09-05 by the executive:** the soul as built at `northlatch/contracts/soul` settles on the chain's own epoch (`ctx.epoch()`, 24 hours); `EPOCH_MS` was deleted from it. Both documents therefore carry `periodMs` 86400000, one Sui epoch, and the seven-day figure is gone.
