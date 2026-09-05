# `@projectx-social/purse` — `heron-purse`

The one process on Heron's host that holds the hot key.

Heron's address is a **1-of-2 multisig** (the Master's ruling, 2026-09-05). The hot key signs alone
behind the policy; the second member is the brake, made by his hand and never on this laptop or on
the host. There is no co-signing purse and no second droplet. The accepted cost, said plainly: a
leaked hot key can act up to one epoch's allowance until it is swept.

**The purse signs AS the multisig address.** `--multisig policy/heron-multisig.json` names the two
members and the threshold; at start the hot key is wrapped as the one available member
(`multiSigSigner` from the signer package), the transaction's sender is the multisig address, and
every signature the purse returns is the hot key's partial signature inside the multisig envelope,
verified against the multisig public key before it leaves the process. The policy's `agentAddress`
must equal the derived address or the purse refuses to start, which is one check proving three
things: members, threshold and hot key together are the address the pinned policy was written for.
The document carries no pin of its own for that reason (`src/multisig-file.ts`). Without
`--multisig` the purse signs as the hot key's own address, which is a single-key test deployment
and not Heron; the unit passes the flag and `test/units.test.ts` asserts it.

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
                                                  the policy rules
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

**One request at a time.** `handle` runs on a single promise chain, so a request that arrives while
another is in flight waits, and every request is judged against a ledger every earlier one has
already written to. Without it two overlapping beats each read the outflow ceiling before either
had recorded its spend, and two requests that are individually inside the ceiling and together over
it were both signed. The purse signs one transaction every thirty minutes; there is no throughput
to lose.

**A request over 256 KB is refused without being read — and recorded.** It never reaches the
parser, and it carries its own refusal id, `request-too-large`, kept apart from `request-malformed`
so a reader of `audit.jsonl` can tell "somebody sent nonsense" from "somebody streamed at the socket
until it stopped listening". Its audit line reads `intentKind: unread`.

## The statement — the one thing the purse signs that is not a transaction

weir.social takes a creator's writes over HTTP, each proven by a signature over a statement the
SDK builds (`statementFor`): naming a vault to a handle, publishing a post. Heron's address is the
purse's, so those signatures come from here, as a `statement` intent (`src/statement.ts`):

- **Off unless started with all three of** `--api-origin`, `--statements-per-day` and `--vault`.
  A subset refuses at start. Without them every statement is refused `statement-disabled`.
- **Two actions and nothing else:** `name-vault` (Heron's own vault, exactly the one `--vault`
  names and also in the policy's allowed objects, for a coin in the policy's allowed type
  arguments) and `publish` (a handle, one-line title, `public` or `paid`, the content digest, and
  for a paid post the key and a price at or under the policy's daily SUI ceiling). Every field is
  bounded to what the web's routes accept, and a test pins the limits to the routes' own files.
- **The text signed is the SDK's,** built here from the typed action, the purse's address, the
  intent's timestamp (within a minute of the purse's clock) and the one configured origin. Nothing
  handed in is ever signed as bytes.
- **A rolling-day count,** seeded once from the audit chain on disk after the chain verifies, then
  kept in memory: `statement-ceiling` at the limit. A broken chain refuses every statement.
- **Recorded** in the same chain as every transaction, `intentKind: statement`, with the intent's
  hash; the answer is `{ ok, statement, statementSha256, signature, address, timestampMs }`.

Statements have exactly one constructor: `src/publish.ts`, from a validated publish plan. A raw
`statement` intent in the beat's intent file is refused locally by phase two and never reaches the
socket, so the model, which owns that file, chooses words and a price and nothing that is signed.

## The publish plan — what an adopted Heron writes

`runs/<beat-id>/intent.json` may hold `{ "kind": "publish-plan", title, preview, text, access,
priceMist? }`. Phase two reads the creator setup from the API, names the vault once, prices the
content key on chain first for a paid post (the route refuses a paid post whose key has no price),
then asks for a `publish` statement and sends the post with an idempotency key. The price band a
plan may name is 0.01 to 0.1 SUI, bounded in the plan's schema before anything reaches the chain.
Every outcome lands in `state/latest.json`, with `postId`, `handle` and whether the vault was named.

Refusal ids the purse adds for this path, each named in `src/outcome.ts`: `statement-disabled`,
`statement-origin`, `statement-clock`, `statement-object`, `statement-price`, `statement-ceiling`.

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

**The uid ruling: `heron` is 10001, `purse` is 10002.** Fixed, never dynamically allocated — v1's
defect 3 was an allocated uid colliding with DigitalOcean's own `do-agent` at 999. `heron` owns the
model's workspace and the container runs as it; `purse` owns the key, the socket and the audit
chain. The unit runs `User=purse` / `Group=purse`, and the deploy creates that account explicitly:
`getent passwd 10002` must be empty before, then
`useradd --uid 10002 --gid 10002 --system --no-create-home --shell /usr/sbin/nologin purse`, then
`getent passwd 10002` must read `purse`. The same empty-before / resolves-after pair the container's
Dockerfile already runs for 10001. `test/units.test.ts` asserts the numbers in the unit and in this
file, so the two cannot drift apart.

**The policy documents live in `policy/`.** `heron-content.json` for this unit and
`heron-ledger.json` for the `LedgerCap` service — one signer per money path, and the purse refuses
to start on a document that names `settle_epoch` alongside anything else. `policy/README.md` lists
every `<ANGLE_BRACKET>` the deploy fills and where each number came from.

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
