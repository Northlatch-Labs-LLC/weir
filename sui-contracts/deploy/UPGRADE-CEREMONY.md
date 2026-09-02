# The upgrade ceremony

**Read this whole file before running anything.** Every command here is written out; nothing is
invented on the night. Where a step can be checked before it is committed to, it is.

This is the procedure for putting new contract code on Sui mainnet. It is not a description of
what an upgrade is — it is the list of commands, in order, with what to verify after each one.

---

## 0. What is being upgraded, and what is not

| | |
|---|---|
| Package (original) | `0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d` |
| Package (currently live) | `0xfa7eb18bbb29b047ec86434e8a8f4cfba35615bde9680eebd781a187ca3a3694` |
| `UpgradeCap` | `0x895e20c44aed9c884be8dffa42c93d93653b47e86cd3a12d919998d9b1eaed08` |
| `PlatformCap` | `0x23909c63932afd97de2515c142ca5ea082c71c5efab469401a239631acc3b683` |
| Holder of both | `0x00e734d54be45c002579f36698823eaf2410b59eb30a398fd6c8af9e1b111605` — 2-of-3 multisig |

**The original package id never changes.** Type tags, events and the Seal namespace are bound to it
for ever. Only the *latest* id moves, and only the application's configuration needs to follow it.

### This particular upgrade needs no migration

`platform`, `creator` and `stake_vault` each carry a `VERSION` and a `migrate` door. The two
modules changed here — `account` and `key_registry` — **carry neither**, and neither change alters a
stored struct: the referrer fix adds an assertion, and the version fix adds a *dynamic field* beside
`KeyRegistry` rather than a field inside it.

**So no `migrate` call is required, `VERSION` stays at 1, and no creator has to do anything.**
Verify that claim before trusting it:

```bash
grep -c "assert_version\|VERSION" sui-contracts/sources/account.move sui-contracts/sources/key_registry.move
```

Both must read `0`. If either reads anything else, **stop** — this document does not cover that
upgrade, and a version bump with no migration freezes every guarded call.

---

## 1. Before the ceremony — do this in daylight, not on the night

```bash
cd sui-contracts
sui move build              # must be clean
sui move test               # must be 0 failed
sui --version               # record it; every signer should be on the same build
```

Record the digest the new source builds to. It will not match `ci-expected-digest` yet — that file
still pins the *deployed* package, which is the point of it:

```bash
sui move build --dump-bytecode-as-base64 --no-tree-shaking > /tmp/dump.json
python3 -c "import json;print(bytes(json.load(open('/tmp/dump.json'))['digest']).hex())"
```

**Write that digest down.** It is what you check against after the upgrade lands.

---

## 2. Build the transaction — signs nothing, sends nothing

```bash
cd sui-contracts
sui client upgrade \
  --upgrade-capability 0x895e20c44aed9c884be8dffa42c93d93653b47e86cd3a12d919998d9b1eaed08 \
  --sender 0x00e734d54be45c002579f36698823eaf2410b59eb30a398fd6c8af9e1b111605 \
  --gas-budget 500000000 \
  --dry-run
```

**The dry run must succeed before anything is signed.** If it fails, read the error and stop — an
upgrade that cannot simulate cannot execute, and finding that out with two signatures already
collected wastes the ceremony.

Then serialise it:

```bash
sui client upgrade \
  --upgrade-capability 0x895e20c44aed9c884be8dffa42c93d93653b47e86cd3a12d919998d9b1eaed08 \
  --sender 0x00e734d54be45c002579f36698823eaf2410b59eb30a398fd6c8af9e1b111605 \
  --gas-budget 500000000 \
  --serialize-unsigned-transaction > /tmp/upgrade-tx.txt
```

Those bytes are the whole ceremony. **Every signature below is over these exact bytes.** Do not
rebuild between signatures — a rebuild produces different bytes and the signatures will not combine.

---

## 3. Two signatures, from two committee members

The multisig is **2 of 3**. Its address has no private key of its own; it is derived from the three
member public keys, which is why it can never appear in a keystore.

For each of two members:

```bash
sui keytool sign --address <MEMBER_ADDRESS> --data "$(cat /tmp/upgrade-tx.txt)"
```

Keep each `suiSignature` value. Then combine:

```bash
sui keytool multi-sig-combine-partial-sig \
  --pks <PK1> <PK2> <PK3> \
  --weights <W1> <W2> <W3> \
  --threshold 2 \
  --sigs <SIG_A> <SIG_B>
```

The public keys, weights and threshold are in `MULTISIG-RECOVERY-CARD.md`. **They are what derive
the address** — if the derivation does not reproduce `0x00e7…1605` exactly, stop. Something is
wrong with the inputs, not with the chain.

---

## 4. Execute

```bash
sui client execute-signed-tx \
  --tx-bytes "$(cat /tmp/upgrade-tx.txt)" \
  --signatures <COMBINED_SIG>
```

Record the transaction digest. **Record the new package id from the output** — that is the value the
application must be pointed at.

---

## 5. After — none of this is optional

**Verify the new package is what you built.** The digest recorded in step 1 must match what the
chain now holds. If it does not, the wrong bytes were published and the next steps must not happen.

**Point the application at the new id.** `PROJECTX_SOCIAL_LATEST_PACKAGE_ID` in the deployment's
environment. `PROJECTX_SOCIAL_PACKAGE_ID` — the original — **does not change.**

**Update `ci-expected-digest` in the same commit** as the id change, and say in the message that it
rides an intended upgrade. Until that commit lands, CI will fail on a real drift that is not one,
which is correct and is why it is not updated in advance.

**Update `deploy/mainnet.json`.** Its own comment warns that it has repeatedly lagged the actual
arrangement. Do not let it lag again.

**Check the site.** `weir.social/agents`, the signed manifest, and one real read. The manifest
reports `latestPackageId` from the chain at request time, so it is the honest check that the
application and the chain agree.

---

## 6. If it goes wrong

**A failed dry run** costs nothing. Fix and start again.

**A failed execution** costs gas and changes nothing else. The old package is still live and still
serving; the application has not been repointed. Start again.

**A successful upgrade you do not want** cannot be undone — the new package is on chain for ever.
But it is not *in use* until the application points at it. **The application's configuration is the
real switch**, and it is reversible in a minute. That is why step 5 is a separate step and not part
of the ceremony: the ceremony publishes code, the configuration adopts it.

So the honest rollback is: **do not repoint, or repoint back.** Nothing on chain needs undoing.

---

## 7. What this document does not cover

- An upgrade that changes a stored struct. Move forbids it; the pattern is a new field via dynamic
  field, or a versioned migration door, and neither is improvised.
- An upgrade that raises `VERSION`. That requires a `migrate` call per guarded object, `PlatformCap`
  for the platform, and **the creator's own cap for each creator vault** — which means creators must
  act, and that is a product decision before it is a technical one.
- Rotating the multisig membership.

If the change in front of you needs any of those, this file is not the procedure. Write the one that
is, before the night of.

---

## 8. This window: v4 of `projectx_social`, then the `agent_mind` package

Two things go out in this window, in this order, as two separate transactions. The second depends
on the first having landed and on `Published.toml` having been updated to say so.

### 8a. v4 of `projectx_social` — six modules, no `VERSION` change, no `migrate`

Since the v3 ceremony commit (`eaf1215`) six modules changed: `account`, `creator`, `entitlement`,
`key_registry`, `platform`, `stake_vault`. None of them raises `VERSION`, so the whole of section 7's
first two exclusions stay excluded: **no `migrate` call, no creator action.** Verify it rather than
trust it — section 0's grep, extended to the three modules that carry a version:

```bash
grep -c "assert_version\|VERSION" sui-contracts/sources/account.move sui-contracts/sources/key_registry.move
grep -n "const VERSION" sui-contracts/sources/platform.move sui-contracts/sources/creator.move sui-contracts/sources/stake_vault.move
```

The first must print `0` for both files. The second must print exactly three lines, each ending in
`const VERSION: u64 = 1;`. Anything else, stop: this section does not cover it.

The digest the ceremony must see, from section 1's dump command with the pinned compiler
(`./assert-toolchain.sh` first), is the content of `sui-contracts/ci-next-digest`:

```
e1254bc4cbb1a5a83e143047386aa2bc30b17ef7bb3d08da75a44f9c0d0a94cd
```

If the dump on the night prints anything else, the source in front of you is not the reviewed
source. Stop and find out why before section 2.

Sections 2 to 5 then apply unchanged. The post-upgrade commit copies `ci-next-digest` into
`ci-expected-digest`, deletes `ci-next-digest`, bumps `Published.toml` (`published-at`, `version = 4`)
and repoints `PROJECTX_SOCIAL_LATEST_PACKAGE_ID`.

### 8b. The `agent_mind` package — a publish, not an upgrade, and a separate step

`sui-contracts-mind/` is a NEW package. It is not touched by the `UpgradeCap`; it has no cap of its
own to worry about yet, and it depends on `projectx_social` through `../sui-contracts` — so it must be
built **after** 8a's `Published.toml` change, because the dependency's published-at address is baked
into the package and into its digest.

Build, test, and record the digest with the pinned compiler:

```bash
cd sui-contracts-mind
sui move build
sui move test                      # 4 tests, 0 failed
sui move build --dump-bytecode-as-base64 --no-tree-shaking > /tmp/mind-dump.json
python3 -c "import json;print(bytes(json.load(open('/tmp/mind-dump.json'))['digest']).hex())"
```

Write that digest into `sui-contracts-mind/ci-next-digest` (it supersedes the value recorded on the
branch, which was built against v3 — see `sui-contracts/DIGESTS.md`). It is what the published
package must match.

Dry-run the publish. The sender is chosen at the ceremony; both forms are written out. The
**publisher/dev address** form signs and executes in one step from the keystore that holds it:

```bash
sui client publish --gas-budget 500000000 --dry-run
```

The **multisig** form serialises for the same two-signature path as sections 2 to 4:

```bash
sui client publish --gas-budget 500000000 \
  --sender 0x00e734d54be45c002579f36698823eaf2410b59eb30a398fd6c8af9e1b111605 \
  --dry-run
sui client publish --gas-budget 500000000 \
  --sender 0x00e734d54be45c002579f36698823eaf2410b59eb30a398fd6c8af9e1b111605 \
  --serialize-unsigned-transaction > /tmp/mind-publish-tx.txt
```

The dry run must succeed. Then the real publish — the first form without `--dry-run`, or the
multisig form signed and combined exactly as sections 3 and 4 do it and executed with
`sui client execute-signed-tx`. Record the transaction digest, the new package id, and the
`UpgradeCap` the publish mints (it goes to the sender; where it is kept afterwards is decided at the
ceremony and written down, not left to the keystore that happened to sign).

Then the record, in one commit:

1. **`sui-contracts-mind/Published.toml`** — create it in the same shape as
   `sui-contracts/Published.toml`, with `chain-id = "35834a8a"`, `published-at` and `original-id`
   both the new package id, `version = 1`, `toolchain-version = "1.78.1"`,
   `build-config = { flavor = "sui", edition = "2024" }`, and the `upgrade-capability` id.
2. **`sui-contracts/deploy/mainnet.json`** — a new top-level key `agentMindPackage` holding the
   package id, the publish transaction digest and the sender.
3. **`sui-contracts-mind/ci-expected-digest`** — the digest from above; delete
   `sui-contracts-mind/ci-next-digest`.
4. **`PROJECTX_SOCIAL_MIND_PACKAGE_ID`** — set to the new package id in the web and the agent
   environments. The SDK reads it through `loadMindPackageId`; unset, the mind feature reports
   itself unconfigured and nothing else is affected.

Verify as section 5 does: the digest on chain matches, and one real `seal_approve_mind` dry run with
an account holder as sender succeeds while the same identity with a different sender aborts with
`EWrongIdentity` (1) or a missing-object error.
