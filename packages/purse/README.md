# `@projectx-social/purse` — `heron-purse`

The one process on Heron's host that holds the hot key.

Heron's address is a **1-of-2 multisig** (the Master's ruling, 2026-09-05). The hot key signs alone
behind the policy; the second member is the brake, made by his hand and never on this laptop or on
the host. There is no co-signing purse and no second droplet. The accepted cost, said plainly: a
leaked hot key can act up to one epoch's allowance until it is swept.

Everything that makes that bound real lives here.

## The shape

```
container (untrusted)          heron-purse (holds the key)
  writes runs/<id>/intent.json
                     │
  beat-phase2.ts ────┤ validates the intent against the schema
    (root, no key)   │
                     └─► /run/heron/purse.sock ─► build the transaction
                                                  simulate it
                                                  the SDK gate
                                                  the twelve rules
                                                  record, then sign
                     ◄─ { ok, digest, txBytesB64, signature }
                        or { ok: false, refused: { ruleId, reason } }
  submits, and writes state/latest.json on every path
```

The model never supplies transaction bytes. It supplies a fact — "price this key at this much" —
and the purse decides what a transaction expressing that fact looks like. A prompt-injected model
can produce a bad intent and nothing else.

## The one call

`{ "intent": <typed intent> }` in; one JSON object out. There is no second request kind: no key
export, no sign-arbitrary-bytes, no policy reload, no health call that reveals key state. An
unrecognised field at any level is a refusal, not a field ignored.

**A refusal is a value, never a throw and never silence.** That is `policySigner`'s property and
the reason it holds is that the caller is an unattended loop: an exception caught three frames up
becomes a retry, and a retry against a policy denial is a loop hammering a wall.

## The intent — the v2 content arm only

| kind | what it is | what it builds |
|---|---|---|
| `post` | a body was just sealed off-chain; put its content key up for sale | `creator::set_content_price` |
| `price` | reprice a content key that already exists | `creator::set_content_price` |
| `settle_epoch` | close the soul's epoch | `soul::settle_epoch` |

There is no `buy`, no `subscribe` and no transfer to a free-form address — absent from the type, so
no request can name one. The only address in a built transaction is the sender, which is the purse's
own; every recipient the evaluator sees comes from the policy document.

`post` carries the sha256 of the sealed body. It is never sent to the chain; it goes into the intent
hash, so the audit line ties one signature to exactly one body.

Objects arrive as **fully-resolved references** — a shared object with its `initialSharedVersion`, an
owned object with its version and digest. A bare id would make `Transaction.build()` resolve it
against a fullnode, and that resolution is a second observation of the chain: the purse would judge
a policy against one reading of the world and sign bytes assembled from another. `test/build.test.ts`
asserts there is no `UnresolvedObject` input in anything this builds.

## The key

One door. `--key-file <path>`, or `$CREDENTIALS_DIRECTORY/heron-hot` where systemd's
`LoadCredentialEncrypted=` puts it: a per-unit tmpfs at 0400 owned by `purse`, unmounted when the
unit stops, decrypted from a blob sealed to the host and worthless off it.

The purse **refuses to start** if:

- a Sui private key is in `argv` (visible in `ps` to every user on the box);
- a Sui private key is in any environment value (readable from `/proc`, inherited by every child —
  and the keyed MCP is a child), or one of the obvious key-shaped names is set at all;
- the key file is a symlink, or its mode has any group or other bit;
- the policy file's sha256 is not the digest the unit pinned;
- the key controls a different address from the one the policy document is written for;
- `audit.jsonl` already holds a broken chain.

No failure message ever contains the file's contents, its length, or the crypto library's own parse
error. The address is the only thing about the key that ever reaches a log.

## Changing the policy is a redeploy, not a reload

The document is read once, at start, and its sha256 must equal `--policy-sha256`, which lives in the
unit file under root. Someone who can write the policy file can make the purse refuse to start —
loud, and refusing everything. Widening needs the unit changed too, which needs root.

Two hashes are recorded in every audit line, because they answer different questions:
`policyFileSha256` is over the bytes as they sit on disk and is what `sha256sum` reproduces;
`policyHash` is over `canonicalPolicyJson(doc)` and is what `policySigner` writes into its own
entries, so the two chains line up.

## `audit.jsonl`

One line per decision, including the refusals that never reached the signer — a malformed request
and a rejected intent produce no signer entry, and those are exactly the lines that show somebody
probing the socket. Each line carries the previous line's sha256, both policy hashes, the intent
hash and the outcome. Fields are length-prefixed in the preimage, so a crafted `reason` cannot
impersonate a field boundary. The file is 0600 and owned by `purse`.

```
pnpm --filter @projectx-social/purse verify-audit /var/lib/heron/audit/audit.jsonl
```

Exit 0 intact, 1 broken (naming the first line that does not hold), 2 unreadable.

**What the chain does not detect:** an attacker who rewrites the whole file, because they can
recompute every hash after their edit. A hash chain is tamper-*evident* against partial edits, not
tamper-*proof*. Closing that needs an anchor the attacker does not control — the head hash, pulled
to the laptop with `state/latest.json`. That is a deployment decision and it is not made here.

## `spend.jsonl`

One line per **signed** transaction: coin type, outflow magnitude, when. `policySigner`'s
`outflow-ceiling` rule reads it, and without it the ceiling would be a per-transaction size check
that a loop defeats by asking twice. The amount is recorded from the simulation rather than from a
confirmation, which over-counts a signature that never landed and never under-counts one that did.

## `state/latest.json`

Written on every path — `signed`, `refused`, `no-intent`, `error` — because a sink that only records
success cannot detect failure. `refused` and `error` are kept apart: a refusal is the system working
and the fix is a policy decision; an error is the system broken.

## The units

`systemd/heron-purse.service`, `systemd/heron-beat.service`, `systemd/heron-beat.timer`.
`test/units.test.ts` parses them and asserts the hardening, because v1 shipped an SSH hardening file
that sorted after cloud-init's and lost every keyword it set, and nothing read it back.

**`MemoryDenyWriteExecute=yes` and `--jitless` are one decision.** The directive refuses mappings
that are both writable and executable and refuses `mprotect` adding `PROT_EXEC`; V8's optimising
compiler needs exactly that, so a plain `node` under the directive dies at start. `--jitless` runs
the interpreter only. The purse signs one transaction every thirty minutes; there is nothing for a
JIT to earn back. A test asserts the pairing so neither can be dropped alone.

## What is unverified

- **The units have not been loaded by systemd.** They are parsed and asserted by a test on this
  laptop. That `Type=notify` with `NotifyAccess=all` and a `systemd-notify --ready` child works, and
  that `--jitless` satisfies `MemoryDenyWriteExecute`, are read from systemd's documentation and
  from V8's requirements — not run. Step 9's smoke beat is where they are proved.
- **Nothing has run against a chain.** Every test answers the simulation with a recorded response in
  the shape `@mysten/sui` 2.27.1's gRPC transport produced on mainnet on 2026-08-31. The build, the
  translation, the SDK gate, the evaluator, the audit chain and the Ed25519 signature are all real.
- **`soul::settle_epoch` has no client anywhere in the estate** (the CTO's F1). The move call is
  assembled from the Move signature and a test pins the argument order to it. When the soul client
  exists, this builder is replaced by it and the test moves with it.
