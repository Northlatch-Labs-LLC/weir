import { opaqueDetail } from './opaque';
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

/**
 * A second price on the same post, for machine buyers — with no Move change of any kind.
 *
 * # The mechanism, and why the contract needs nothing added to it
 *
 * A paywall on this platform is keyed by `content_key`, and nothing else:
 *
 * - `creator::set_content_price(vault, cap, content_key, price)` writes one row into
 *   `content_prices: Table<vector<u8>, u64>`. Its only constraints are `content_key.length() > 0`
 *   and `price > 0` — no charset, no length ceiling, no uniqueness beyond the table's own.
 * - `creator::unlock` reads the price for the key the buyer names and mints
 *   `entitlement::new_unlock(vault, payer, content_key, price, …)`, so the `Unlock` object carries
 *   the key it was bought under.
 * - `entitlement::unlock_identity(vault, content_key)` is `vaultBytes ‖ 0x00 ‖ content_key`, and
 *   `seal_approve_unlock` asserts `id == unlock_identity(unlock.vault, unlock.content_key)`.
 *
 * Follow those four facts and a *second content key on the same bytes* is already a complete,
 * separately-priced edition: a different key is a different price row, a different `Unlock`, a
 * different Seal identity, and therefore a different key released by the key servers. Nothing in
 * the deployed package treats one key as "the post's" key. The post is a row in our database; the
 * chain only ever sees keys.
 *
 * This is not a theory about the contract. The live `@atlas` vault
 * `0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d` already holds **two**
 * priced keys in one `content_prices` table (`0x699165d4…`, size 2): `sealed-on-walrus-001` at
 * 10000 minor units and `mistakes-setting-up` at 250000, each its own `dynamic_field::Field<
 * vector<u8>, u64>` child. The multi-key shape is deployed, paid for and in use today. The only
 * thing this module adds is *which second key*, decided by a rule rather than by a creator typing
 * one twice.
 *
 * # The derivation rule, stated plainly
 *
 * ```
 * machine key = human key ‖ "#machine"
 * ```
 *
 * UTF-8, appended, no separator beyond the marker itself, and the human key must not contain the
 * marker anywhere — {@link machineKeyProblem} is the refusal that enforces it.
 *
 * # Why it cannot collide with a creator-chosen key
 *
 * The whole proof rests on the refusal, so it is worth writing out rather than asserting.
 *
 * Let `M` be the marker and `H` be the set of keys this system accepts from a creator: every key
 * with **no occurrence of `M`**. Define `f(k) = k ‖ M` on `H`.
 *
 * 1. **`f` is injective.** `f(a) = f(b)` implies `a = b`, by removing the last `|M|` bytes.
 * 2. **`f`'s image is disjoint from `H`.** Every `f(k)` contains `M`; no member of `H` does. So a
 *    machine key can never *be* a human key — not the one it was derived from, and not anybody
 *    else's on the same vault.
 * 3. **Therefore no two priced keys on one vault can be the same key by accident**, and in
 *    particular the machine edition of `k` is never the human edition of some other post.
 *
 * Drop the refusal and the collision is immediate and cheap: a creator prices `post-7` and a
 * second post under the literal key `post-7#machine`, and one purchase now opens two things that
 * were priced separately — the machine edition of the first post and the human edition of the
 * second. That is the defect the refusal exists to make unreachable, and it is why
 * {@link machineKeyProblem} must be called at **every** door that accepts a creator-supplied key,
 * not only at the one this module currently ships behind.
 *
 * # Why the marker is ordinary text and not an unrepresentable byte
 *
 * The tempting version is a suffix that *cannot* be typed — `0xFF`, which never appears in valid
 * UTF-8, or `0x00`. Both were rejected, on measurement rather than taste:
 *
 * - `content_key` is `vector<u8>` on chain, but every path in this application carries it as a
 *   **string**: `/api/studio/price` and `/api/checkout/unlock` take it in a JSON body,
 *   `db/001_init.sql` stores it as `content_key text`, and `lib/purchases.ts` decodes a buyer's
 *   `Unlock` back with `TextDecoder`. A key containing `0xFF` is not valid UTF-8 and does not
 *   survive that round trip; a key containing `0x00` cannot be stored in a Postgres `text` column
 *   at all.
 * - So an unrepresentable byte would buy an unfalsifiable proof at the cost of a key the rest of
 *   the system cannot record — and an `Unlock` we cannot name back is an entitlement we cannot
 *   honour.
 *
 * The marker is therefore printable, greppable, and legible in `/purchases`, where the raw content
 * key is rendered to a buyer when a title is unknown (`components/Purchases.tsx:179`). A reader who
 * bought a machine edition sees a key that says so.
 *
 * # What this module deliberately does not do
 *
 * It sets no price and it names no number. Two prices for one post is a mechanism; what the second
 * one *is* — a discount, a premium, per-token, free — is the owner's economic decision and is not
 * encoded anywhere in this file.
 */

import { fail, ok, unlockIdentity, type Reading } from '@projectx-social/sdk';

/**
 * The reserved marker. One string, exported, and every check below is written against this
 * constant rather than a literal — a marker spelled twice is a marker that drifts, and a drifted
 * marker means keys derived last month stop being recognised as machine keys this month, while the
 * `Unlock` objects sold under them stay valid for ever.
 */
export const MACHINE_EDITION_MARKER = '#machine';

/**
 * The sentence a creator reads when a machine edition cannot be sold.
 *
 * Read by `studio/price` (the 409), by the composer (in place of the price field) and by the test
 * that pins both, so the refusal is one sentence everywhere and not three paraphrases. It follows
 * the quoted human key. Here rather than in the route because the composer is a client component
 * and must not import a route module.
 */
export const NO_MACHINE_BODY =
  'was published before machine editions existed; its words were never sealed to this key and ' +
  'cannot be now — republish it, and the new post carries both editions.';

/**
 * Why this key may not be used as a human (creator-chosen) content key, or `null` if it may.
 *
 * Returns a sentence for a creator, not an error code: the composer prints it under the field and
 * the route returns it as `error`, so it must read as an explanation of a reservation rather than
 * as a validation failure they caused.
 *
 * Note what is checked: **containment**, not suffix. `a#machineb` is refused too. The proof above
 * needs `H` to hold no occurrence of the marker anywhere, and a suffix-only check would admit
 * `a#machineb`, whose own machine edition `a#machineb#machine` is fine — but which makes the set of
 * keys carrying the marker no longer the set of derived keys, so `isMachineContentKey` would stop
 * meaning what it says.
 */
export function machineKeyProblem(humanKey: string): string | null {
  const key = humanKey.trim();
  if (key === '') {
    // The contract refuses an empty key with `EEmptyName`, so it can never carry a price — said
    // here so the composer does not spend a chain read to be told the same thing.
    return 'A content key cannot be empty.';
  }
  if (key.includes(MACHINE_EDITION_MARKER)) {
    return (
      `"${MACHINE_EDITION_MARKER}" is reserved: it is how the machine edition of a key is named, ` +
      `and it is appended for you. A key containing it could collide with another post's machine ` +
      `edition, and an Unlock cannot be withdrawn once someone holds it.`
    );
  }
  return null;
}

/** Whether a key is a derived machine key rather than one a creator chose. */
export function isMachineContentKey(contentKey: string): boolean {
  return contentKey.trim().endsWith(MACHINE_EDITION_MARKER);
}

/**
 * The machine edition's content key for a human key.
 *
 * A `Reading` rather than a throw, and rather than a silently-idempotent append. Appending to a key
 * that already ends in the marker would produce `k#machine#machine`, a third key nobody priced,
 * whose Seal identity opens nothing and whose buy button aborts with `EContentNotForSale` — a
 * failure that surfaces at a stranger's checkout rather than at the callsite that made it.
 */
export function machineContentKey(humanKey: string): Reading<string> {
  const problem = machineKeyProblem(humanKey);
  if (problem !== null) return fail('malformed', 'machine edition key', problem);
  return ok(`${humanKey.trim()}${MACHINE_EDITION_MARKER}`);
}

/** The human key a machine key was derived from. The inverse of {@link machineContentKey}. */
export function humanContentKey(machineKey: string): Reading<string> {
  const key = machineKey.trim();
  if (!isMachineContentKey(key)) {
    return fail('malformed', 'machine edition key', `"${key}" is not a machine edition key`);
  }
  return ok(key.slice(0, key.length - MACHINE_EDITION_MARKER.length));
}

export interface EditionIdentities {
  /** `unlock_identity(vault, humanKey)` — what the human edition's key is sealed to. */
  human: Uint8Array;
  /** `unlock_identity(vault, humanKey ‖ "#machine")` — what the machine edition's key is sealed to. */
  machine: Uint8Array;
}

/**
 * Both Seal identities for one post, derived from the contract's own layout.
 *
 * # The prefix relationship is not a weakness, and it is worth naming before somebody "fixes" it
 *
 * `unlock_identity` concatenates with no length prefix, so `identity(machine)` is literally
 * `identity(human) ‖ "#machine"` — one is a proper prefix of the other. That grants nothing. Seal
 * is identity-based encryption: the key servers derive a key from the *whole* identity string as an
 * opaque byte sequence, and there is no structure by which a key for a prefix helps produce a key
 * for an extension. What the prefix does mean is that the two identities are **unequal**, which is
 * the only property the paywall needs — `seal_approve_unlock` compares identities for equality, and
 * an `Unlock` whose `content_key` is the human key can only ever satisfy that comparison for
 * `identity(human)`.
 *
 * Because the vault id is a fixed 32 bytes and the tag a fixed 1 byte, identity equality holds if
 * and only if key equality holds. Collision-freedom of the *keys*, proven at the top of this file,
 * is therefore collision-freedom of the *identities*, with nothing lost in between.
 */
export function machineEditionIdentities(
  vaultId: string,
  humanKey: string,
): Reading<EditionIdentities> {
  const machineKey = machineContentKey(humanKey);
  if (!machineKey.ok) return machineKey;

  const encoder = new TextEncoder();
  try {
    return ok({
      human: unlockIdentity(vaultId, encoder.encode(humanKey.trim())),
      machine: unlockIdentity(vaultId, encoder.encode(machineKey.value)),
    });
  } catch (error) {
    /*
      `unlockIdentity` throws on malformed hex. Turned into a `Reading` because every caller of this
      module already has one, and a throw crossing a route handler is a 500 with no `kind`.

      What it does NOT do, measured rather than assumed: it does not refuse a *short* id. Its own
      comment says "Refused rather than padded", but `normalizeSuiObjectId` left-pads, so `0x01`
      becomes `0x00…01` and seals happily to a vault nobody owns. That belongs to the SDK and is not
      corrected here; `test/machine-pricing.test.ts` pins the real behaviour so the next reader is
      not misled by the comment.
    */
    return fail(
      'malformed',
      'machine edition identity',
      opaqueDetail('machine pricing', error),
    );
  }
}

export interface Edition<T> {
  /** The content key this edition is priced and sealed under. */
  contentKey: string;
  /** Whatever the sealer produced for it — a `SealedBody`, a wrapped key, a test double. */
  sealed: T;
}

export interface BothEditions<T> {
  human: Edition<T>;
  machine: Edition<T>;
}

/**
 * Seal one body twice: once for human buyers, once for machine buyers.
 *
 * # Why the sealer is injected rather than imported
 *
 * `lib/body-storage.ts` and `lib/seal.ts` both carry `import 'server-only'`. Importing either here
 * would make this module server-only too, and the composer — a client component — could no longer
 * derive the machine key to show a creator what they are about to price. The rule and the transport
 * are separate concerns and this file owns only the rule.
 *
 * It also makes the property below testable without a key server committee, which is the property
 * that actually matters: **the same plaintext, two identities, two ciphertexts.**
 *
 * # The same `body` object reaches both calls
 *
 * Deliberately, and it is the reason this takes the body at all rather than a pair of thunks. Two
 * callsites each encoding "the body" is two chances to seal a machine buyer something a human buyer
 * did not get — a stale draft, a trimmed version, a summary somebody thought was equivalent. One
 * value, passed twice, cannot drift.
 *
 * # Sequential, and what a half-failure leaves behind
 *
 * The machine edition is sealed only after the human edition succeeded, and a failure of either
 * fails the whole reading. If the second call fails, the first has already stored a ciphertext —
 * a Walrus blob under a paid lease, referenced by nothing. That is the deliberate choice: an
 * orphaned blob costs a lease and is invisible, whereas a post row written with only one of its two
 * editions sells a machine buyer an `Unlock` for a key whose ciphertext does not exist. **The
 * caller must not write the post row unless this returns `ok`.**
 */
export async function sealBothEditions<T>(
  input: {
    /** The creator's key. Refused if it carries the reserved marker. */
    humanKey: string;
    /** The plaintext. One value, sealed twice — see above. */
    body: string;
  },
  sealOne: (gate: { contentKey: string; body: string }) => Promise<Reading<T>>,
): Promise<Reading<BothEditions<T>>> {
  const machineKey = machineContentKey(input.humanKey);
  if (!machineKey.ok) return machineKey;

  const humanKey = input.humanKey.trim();

  const human = await sealOne({ contentKey: humanKey, body: input.body });
  if (!human.ok) return human;

  const machine = await sealOne({ contentKey: machineKey.value, body: input.body });
  if (!machine.ok) return machine;

  return ok({
    human: { contentKey: humanKey, sealed: human.value },
    machine: { contentKey: machineKey.value, sealed: machine.value },
  });
}
