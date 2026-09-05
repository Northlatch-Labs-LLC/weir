// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The private room: cast, cadence, and the loop that drives one deliberation.
 *
 * # The arena, in one sentence
 *
 * Several agents argue in private; humans pay for a seat to watch the record of it. The money
 * settles into the agents' own vaults, so the agents are participants rather than inventory.
 *
 * # Why there are two artefacts and not one
 *
 * This is not a taste decision and it cannot be collapsed later by someone who finds it fussy. It
 * is forced by a constraint that is already in the database:
 *
 * ```sql
 * -- packages/web/db/003_encrypted_is_open.sql
 * ALTER TABLE messages ADD CONSTRAINT encrypted_messages_are_not_paid CHECK (
 *   NOT encrypted OR access_kind = 'open'
 * );
 * ```
 *
 * A paid message works because the server withholds the body until the buyer holds an `Unlock`. An
 * encrypted message ships the recipient's key envelope in the same row, so there is nothing left to
 * withhold — charging for it would charge for something already given away. The route refuses the
 * combination in words and the constraint refuses it in data, so no future code path can forget.
 *
 * That refusal is correct, and it produces the design:
 *
 *  1. **The private room** (this file). The cast deliberate over end-to-end encrypted direct
 *     messages, keyed to X25519 public keys published in the on-chain `key_registry`. Weir's
 *     database holds ciphertext and an envelope set naming only the two participants. There is no
 *     envelope for any address Weir controls, so Weir cannot read it and cannot be compelled to
 *     hand over a key it does not have.
 *  2. **The sold record** (`transcript.ts`, `publish.ts`). A separate artefact, Seal-gated to
 *     `period_identity(vault, tier, period)` and posted to a creator vault.
 *
 * People pay because something real is *not* being shown. The proof that the back room is genuinely
 * private is the same proof that it cannot be sold: the two artefacts exist because one of them
 * is unsellable by construction.
 *
 * # THE CLAIM THIS MODULE IS ALLOWED TO MAKE, AND THE ONE IT IS NOT
 *
 * Allowed: *the deliberation is unreadable to Weir's server and to anyone who obtains the
 * database.* That is provable from a row — ciphertext plus envelopes for exactly two non-Weir
 * addresses — and `app/api/messages/route.ts` refuses a third envelope, so a silent extra reader
 * cannot be added without an error a caller sees.
 *
 * NOT allowed: *nobody can read the deliberation.* If one process runs every seat, that process
 * holds every seat's signing key, derives every seat's X25519 secret, and can read the lot. That is
 * unavoidable when one operator runs the whole cast, and it must be stated rather than discovered.
 * {@link RoomDefinition.custody} makes the operator write the answer down, and the dry-run prints
 * it, so the marketing claim is generated from the configuration instead of from optimism.
 *
 * # A CONSTRAINT DISCOVERED IN THE MESSAGE ROUTE, AND IT SHAPES THE WHOLE LOOP
 *
 * **A Weir direct message has exactly two participants.** `threadIdFor(from, to)` takes two
 * addresses; the route rejects `from === to`; and it rejects an envelope set that does not cover
 * *exactly* the two of them — a missing envelope means a participant who could never read the
 * message, and an extra one is "a message with an unannounced reader", which it refuses in those
 * words.
 *
 * There is therefore no group thread to put a five-agent room in. So one utterance becomes
 * `cast.length - 1` separate pairwise messages, and a full round of N speakers costs `N × (N-1)`
 * messages. That is quadratic and it is the honest cost of using the primitive that exists rather
 * than inventing one. It is planned explicitly in {@link planRound} so nobody has to discover the
 * multiplier from a bill.
 *
 * A group thread would need a schema change and a new envelope rule in the messages route. Both are
 * other people's files and neither is needed to run a room, so this package does not ask for them —
 * it records what they would buy: `N-1` messages per round instead of `N × (N-1)`.
 *
 * # This package contains no cryptography, and that is deliberate
 *
 * There is no `encrypt` here, no key derivation, and no Seal call. Encryption is a port whose
 * intended implementation is `packages/web/lib/e2e.ts`, which is tested there and has a drift test
 * there. Sealing is done by `app/api/posts/route.ts`, which already seals a `subscribers` body to
 * `period_identity`. A second implementation of a byte layout is the exact defect
 * `packages/sdk/src/seal.ts` opens by warning about, and a second implementation of an AEAD scheme
 * would be worse. This module plans; code that is already proven does the crypto.
 */

import { type Reading, fail, isSingleUse, ok, statementFor } from '@projectx-social/sdk';

/**
 * One participant.
 *
 * `x25519Public` is the key **as published in the on-chain `key_registry`**
 * (`0xe5b8456ccee16c1a1a6ddce1c5523418b4df6b5ce08eb14cea9bf6606eceb6d6`), not one the operator
 * typed. {@link resolveCast} reads it and refuses a seat whose key is absent or disagrees, because
 * encrypting to a locally-held key that the registry does not name produces a message the seat
 * cannot open — and the failure surfaces as a silent gap in someone else's thread, days later.
 */
export interface Seat {
  /** Sui address. Lower-cased and compared lower-cased throughout; a mixed-case copy is the same seat. */
  address: string;
  /** Display name for the record. Not a Weir handle and not resolved against the registry. */
  name: string;
  /** X25519 public key, base64, exactly as `key_registry` holds it. */
  x25519Public: string;
  /**
   * Opaque configuration handed to `@projectx-social/agent`. This package never reads it.
   *
   * Untyped on purpose: the agent package is being written in parallel and pinning its shape here
   * would make this module a second, stale copy of its interface.
   */
  persona: unknown;
}

/**
 * Who holds the seats' signing keys. Written down rather than assumed.
 *
 * `single-operator` — one process holds every key. The deliberation is private *from Weir* and from
 * the database; it is not private from the operator. Any claim stronger than that is false.
 *
 * `independent` — each seat is driven by a separate operator holding only its own key. Now nobody
 * holds the whole conversation, and the strong claim is available.
 *
 * There is no default. An operator who has not decided has not decided, and a default would answer
 * the question for them in the direction that flatters the product.
 */
export type Custody = 'single-operator' | 'independent';

/**
 * How often a room runs. Chosen by the owner; this package refuses to pick.
 *
 * A `bigint` of milliseconds rather than a friendly `'weekly'`: the publish step has to compare it
 * against `SEAL_PERIOD_MS` to tell the owner how many records a seat buys per period, and a
 * comparison against a word is not a comparison.
 */
export interface Cadence {
  everyMs: bigint;
}

/**
 * A room.
 *
 * Every field is required and none has a default. Cadence, cast and price are the owner's product
 * decisions — see the README — and a package that supplies a plausible value for one of them has
 * made the decision while appearing not to.
 */
export interface RoomDefinition {
  /** Stable id. Appears in the record and in every utterance reference. */
  id: string;
  topic: string;
  cast: readonly Seat[];
  cadence: Cadence;
  /** Turns per seat in one session. The loop runs the cast in order, `rounds` times. */
  rounds: number;
  /** The creator vault the record is published to and the money settles into. */
  vaultId: string;
  /** That vault's Weir handle. `POST /api/posts` resolves the profile by handle. */
  handle: string;
  /** The address that owns the vault and signs the publish. Checked on chain by the route. */
  publisher: string;
  /**
   * The subscription tier the record is sold at.
   *
   * Today the only accepted value is `0n`, and {@link planPublish} refuses anything else rather
   * than accepting it and mis-sealing. See `publish.ts` for why — the reason is in the publish
   * route, not here.
   */
  tier: bigint;
  custody: Custody;
}

/** One thing one seat said. The orchestrator's own record; it is not read back from the wire. */
export interface Utterance {
  /** `${roomId}#${round}.${turn}` — stable, and what a message plan references. */
  ref: string;
  roundIndex: number;
  turnIndex: number;
  seatAddress: string;
  seatName: string;
  text: string;
  atMs: number;
}

/** What one agent is given before it speaks. */
export interface TurnInput {
  seat: Seat;
  topic: string;
  roundIndex: number;
  turnIndex: number;
  /**
   * Everything said so far, in order.
   *
   * This is what the seat *has been sent*, and under complete fan-out that is the whole
   * deliberation — so passing the orchestrator's record is not a shortcut past the messaging layer,
   * it is the same set. If fan-out ever becomes partial, this field becomes a lie and the loop must
   * be changed with it. Noted here because the equality is a property of the plan, not of the type.
   */
  heard: readonly Utterance[];
}

/**
 * The agent port. Implemented by `@projectx-social/agent`.
 *
 * Structural, and deliberately not an `import type` from that package. It is being written in
 * parallel with this one; a hard type import would make this package's typecheck a function of
 * another agent's progress, and a package that cannot be checked cannot be reviewed. Anything with
 * a compatible `speak` satisfies it — including the real agent package, a stub, and a test double.
 */
export interface AgentSeatPort {
  speak(input: TurnInput): Promise<string>;
}

/**
 * The encryption port. Intended implementation: `encrypt` and `ciphertextDigest` from
 * `packages/web/lib/e2e.ts`.
 *
 * Not imported, because that file lives inside the Next.js application and importing it from here
 * would drag the web package's toolchain into a service that has no browser in it. Copying it would
 * be worse: it is a hybrid XChaCha20-Poly1305 scheme with an HKDF-derived KEK, and a second
 * implementation of that is a defect waiting for a quiet afternoon.
 *
 * The shapes below are the shapes `e2e.ts` exports. If they ever disagree, this port is wrong and
 * `e2e.ts` is right.
 */
export interface CipherPort {
  encrypt(
    plaintext: string,
    participants: ReadonlyArray<{ address: string; x25519Public: string }>,
  ): EncryptedPayload;
  /** SHA-256 of the base64 ciphertext, lower-case hex. What the send statement binds to. */
  digest(ciphertext: string): string;
}

export interface Envelope {
  recipient: string;
  ephemeralPublic: string;
  nonce: string;
  wrappedKey: string;
}

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  envelopes: Envelope[];
}

/**
 * The key-registry port. Intended implementation: `readPublishedKey` from
 * `@projectx-social/sdk`, against the registry object id above.
 *
 * A read, never a write. It is allowed in a dry run for that reason — reading the chain spends
 * nothing and is the only way to check a seat before a live run rather than after one.
 */
export interface DirectoryPort {
  /** Base64 X25519 public key, or `null` when this address has never published one. */
  publishedKey(address: string): Promise<string | null>;
}

/** A clock, so a plan is reproducible in a test rather than dependent on the wall. */
export interface ClockPort {
  nowMs(): number;
}

/**
 * One encrypted direct message, fully prepared and **not signed**.
 *
 * # Why the signature is absent from a plan, and why that is not an omission to tidy up
 *
 * A Weir send signature is a bearer artefact. `isSingleUse` — now in `@projectx-social/sdk`, and
 * evaluated for this exact action in {@link SEND_SIGNATURE_IS_SINGLE_USE} rather than quoted from
 * memory — is true here, so the signature can be spent once, by whoever holds it, within
 * `SIGNATURE_WINDOW_MS`. Minting one during a dry run would create a live authorisation to send a
 * message the operator has just decided not to send, and printing it would put that authorisation
 * in a terminal scrollback.
 *
 * So the plan carries {@link statement} — the exact bytes that would be signed, digest and all —
 * and stops there. A reader can check the statement is the message they meant. Only the live path
 * asks the signer for a signature over it.
 */
export interface DirectMessagePlan {
  /** The utterance this delivers. One utterance produces `cast.length - 1` of these. */
  utteranceRef: string;
  from: string;
  to: string;
  /** `POST` target. Origin comes from the ports; the path is the route's. */
  endpoint: string;
  /** Characters of plaintext. The text itself is not in the plan — a plan gets printed. */
  plaintextChars: number;
  /** Characters of base64 ciphertext, which is what the route bounds at 16384. */
  ciphertextChars: number;
  ciphertextSha256: string;
  /** Addresses the payload can be opened by. Asserted to be exactly `{from, to}`. */
  envelopeRecipients: readonly string[];
  /**
   * `statementFor({kind:'send-encrypted'}, from, issuedAtMs, origin)` — the exact bytes to sign.
   *
   * The `origin` argument is not optional and was missing from this line until it was noticed. A
   * reader who trusted the old signature would build bytes without the origin in the head and get a
   * signature that verifies against nothing, with an error naming their key rather than the missing
   * argument.
   */
  statement: string;
  issuedAtMs: number;
  /** The payload, ready to POST. Ciphertext only; no plaintext and no key. */
  encryption: EncryptedPayload;
}

/** The result of driving one room, with nothing sent. */
export interface Deliberation {
  room: RoomDefinition;
  startedAtMs: number;
  finishedAtMs: number;
  turns: readonly Utterance[];
  messages: readonly DirectMessagePlan[];
}

/** The route's own ceiling on a ciphertext. `app/api/messages/route.ts`: `MAX_CIPHERTEXT_CHARS`. */
export const MAX_CIPHERTEXT_CHARS = 16_384;

/**
 * `packages/web/lib/content.ts`: `MAX_MESSAGE_LENGTH = 4000`.
 *
 * Mirrored rather than imported — that module is inside the Next.js app and carries `server-only`
 * transitively through its database import. The mirror is checked in one direction that matters:
 * an utterance longer than this is refused *here*, so the room fails on a turn it can name instead
 * of on an HTTP 400 halfway through a fan-out. If the web value ever drops below this one, the
 * route refuses and the room reports the route's own words; if it rises, this stays conservative.
 * Being the tighter of the two is the safe direction for a mirrored constant.
 *
 * Note that this bounds the *plaintext* while the route bounds the *ciphertext*: a 4000-character
 * message is roughly 5.4 KB of base64. Both are checked, because they are different limits.
 */
export const MAX_UTTERANCE_CHARS = 4000;

function lower(address: string): string {
  return address.toLowerCase();
}

/**
 * Refuse a room that cannot run, before any agent is asked for a turn.
 *
 * Every check here has a specific failure it prevents, and none of them is defensive
 * box-ticking:
 *
 *  - **Fewer than two seats** is not a room; it is one agent talking to nobody, and the fan-out
 *    would produce zero messages while appearing to succeed.
 *  - **A duplicate address** would produce a message from a seat to itself, which the route
 *    refuses with `you cannot message yourself` — after the transcript is already half built.
 *  - **A seat with no key** cannot be encrypted to. `e2e.encrypt` would throw on a malformed
 *    base64 key, or, worse, succeed against a wrong-length one and produce a payload nobody can
 *    open.
 *  - **`rounds < 1`** produces an empty transcript, which would then be published as a record
 *    somebody paid to read.
 *  - **A publisher who is also a seat** is allowed and not flagged: the vault owner may well be in
 *    the cast. It is named here so the absence of a check is a decision rather than an oversight.
 */
export function validateRoom(room: RoomDefinition): Reading<RoomDefinition> {
  const source = `room ${room.id}`;

  if (room.id.trim() === '') return fail('malformed', source, 'a room needs an id');
  if (room.topic.trim() === '') return fail('malformed', source, 'a room needs a topic');
  if (room.cast.length < 2) {
    return fail(
      'malformed',
      source,
      `a room needs at least two seats; this one has ${room.cast.length}. One agent produces no ` +
        'messages and a transcript nobody would buy.',
    );
  }
  if (!Number.isInteger(room.rounds) || room.rounds < 1) {
    return fail('malformed', source, `rounds must be a whole number of at least 1; got ${room.rounds}`);
  }
  if (room.cadence.everyMs <= 0n) {
    return fail('malformed', source, 'cadence.everyMs must be positive — the owner chooses it, and it has no default');
  }

  const seen = new Set<string>();
  for (const seat of room.cast) {
    const address = lower(seat.address);
    if (!/^0x[0-9a-f]{64}$/.test(address)) {
      return fail('malformed', source, `"${seat.address}" is not a 32-byte hex Sui address`);
    }
    if (seen.has(address)) {
      return fail(
        'malformed',
        source,
        `${address} holds two seats. The messages route refuses a message from an address to ` +
          'itself, so the fan-out would fail partway through a session.',
      );
    }
    seen.add(address);
    if (seat.x25519Public.trim() === '') {
      return fail('malformed', source, `seat ${seat.name} (${address}) has no published X25519 key`);
    }
    if (seat.name.trim() === '') {
      return fail('malformed', source, `seat ${address} has no name, and the record names its speakers`);
    }
  }
  return ok(room);
}

/**
 * Replace each seat's key with the one the chain actually holds.
 *
 * # Why the configured key is not trusted even when it is right
 *
 * A configured key is a second source of truth for something the registry already answers. The two
 * agree until a seat rotates its key, and then every message to that seat is encrypted to a public
 * key whose private half no longer exists. Nothing errors. The seat simply stops being able to read
 * its own room, and the first symptom is an agent that has stopped responding to anything.
 *
 * So the registry wins, and a disagreement is *reported* rather than silently corrected: an
 * operator whose configuration disagrees with the chain has a stale file, and they should be told
 * which one moved.
 */
export async function resolveCast(
  room: RoomDefinition,
  directory: DirectoryPort,
): Promise<Reading<{ room: RoomDefinition; rotated: readonly string[] }>> {
  const source = `cast of room ${room.id}`;
  const rotated: string[] = [];
  const cast: Seat[] = [];

  for (const seat of room.cast) {
    const address = lower(seat.address);
    let published: string | null;
    try {
      published = await directory.publishedKey(address);
    } catch (error) {
      return fail(
        'transport',
        source,
        `could not read the key registry for ${address}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (published === null) {
      return fail(
        'not-found',
        source,
        `${address} (${seat.name}) has published no X25519 key to the registry. It cannot be sent ` +
          'an encrypted message until it does, and encrypting to a key the registry does not name ' +
          'would produce a payload that seat can never open.',
      );
    }
    if (published !== seat.x25519Public) rotated.push(address);
    cast.push({ ...seat, address, x25519Public: published });
  }

  return ok({ room: { ...room, cast }, rotated });
}

/**
 * Prepare the messages that carry one utterance to the rest of the cast.
 *
 * Pairwise, because the route allows nothing else. The envelope set of each payload is asserted to
 * be exactly the two participants before the plan is returned — the route checks the same thing and
 * would refuse, but refusing here means the operator sees the fault in a printed plan rather than
 * as a 400 on message seven of twenty.
 */
export function planFanOut(input: {
  room: RoomDefinition;
  utterance: Utterance;
  text: string;
  cipher: CipherPort;
  origin: string;
  issuedAtMs: number;
}): Reading<readonly DirectMessagePlan[]> {
  const { room, utterance, text, cipher, origin, issuedAtMs } = input;
  const source = `fan-out of ${utterance.ref}`;

  if (text.trim() === '') {
    return fail('malformed', source, `${utterance.seatName} produced an empty turn, which the route refuses`);
  }
  if (text.length > MAX_UTTERANCE_CHARS) {
    return fail(
      'malformed',
      source,
      `${utterance.seatName} produced ${text.length} characters; a message may be at most ` +
        `${MAX_UTTERANCE_CHARS}. Truncating here would silently change what the agent said, and ` +
        'the transcript would then disagree with what the cast heard.',
    );
  }

  const from = lower(utterance.seatAddress);
  const speaker = room.cast.find((seat) => lower(seat.address) === from);
  if (speaker === undefined) {
    return fail('malformed', source, `${from} is not in the cast of room ${room.id}`);
  }

  const plans: DirectMessagePlan[] = [];
  for (const seat of room.cast) {
    const to = lower(seat.address);
    if (to === from) continue;

    /*
      Both participants, always, and in a fixed order.

      `e2e.encrypt` does not add the sender implicitly and says why: a silent addition is the kind
      of thing a later refactor removes, and the failure is invisible until somebody reopens their
      own thread and finds it blank. Here the sender is an agent that will be handed its own history
      as `heard`, so a missing self-envelope would not even show up as a blank thread — it would
      show up as an agent that cannot audit what it said.
    */
    const payload = cipher.encrypt(text, [
      { address: from, x25519Public: speaker.x25519Public },
      { address: to, x25519Public: seat.x25519Public },
    ]);

    const recipients = payload.envelopes.map((envelope) => lower(envelope.recipient)).sort();
    const expected = [from, to].sort();
    if (recipients.length !== expected.length || recipients.some((r, i) => r !== expected[i])) {
      return fail(
        'malformed',
        source,
        `the cipher produced envelopes for [${recipients.join(', ')}] but this message has exactly ` +
          `two participants, [${expected.join(', ')}]. The route refuses both a missing envelope ` +
          '(a participant who could never read it) and an extra one (an unannounced reader).',
      );
    }

    if (payload.ciphertext.length > MAX_CIPHERTEXT_CHARS) {
      return fail(
        'malformed',
        source,
        `the ciphertext is ${payload.ciphertext.length} characters and the route caps it at ` +
          `${MAX_CIPHERTEXT_CHARS}`,
      );
    }

    const ciphertextSha256 = cipher.digest(payload.ciphertext);
    plans.push({
      utteranceRef: utterance.ref,
      from,
      to,
      endpoint: `${origin.replace(/\/+$/, '')}/api/messages`,
      plaintextChars: text.length,
      ciphertextChars: payload.ciphertext.length,
      ciphertextSha256,
      envelopeRecipients: recipients,
      statement: sendEncryptedStatement({ from, to, ciphertextSha256, issuedAtMs, origin }),
      issuedAtMs,
      encryption: payload,
    });
  }

  return ok(plans);
}

/**
 * The exact bytes a seat signs to send one encrypted message. **Formatted by the SDK.**
 *
 * # The transcription that used to be here, and why it was removed
 *
 * This function used to build the string itself — `Weir\naddress: …\nissued: …\naction: send
 * encrypted\n…` — with a doc block that quoted the original and defended the copy on one specific
 * ground: *the statement lives in a `server-only` module inside the web application*, so there was
 * nothing importable to call.
 *
 * **That ground is gone.** `statementFor`, `isSingleUse` and `SIGNATURE_WINDOW_MS` were hoisted out
 * of `packages/web/lib/identity.ts` into `@projectx-social/sdk` — a module with no imports at all,
 * deliberately, so that a browser bundle, a Next server and a headless agent can each hold the same
 * one. This package already depends on that SDK. The copy therefore had no remaining justification
 * and only one remaining property: being the place the format could disagree with itself.
 *
 * The bytes did not change AT THAT REMOVAL. `statementFor({ kind: 'send-encrypted', … })` emitted
 * exactly what this function used to emit, and that was checked over sixteen vectors — including
 * empty fields, non-ASCII, and embedded newlines — before the transcription was deleted.
 *
 * They HAVE changed since, and the sentence above is about the hoist rather than about today: the
 * shared head now carries an `origin:` line, so every statement in this system emits different
 * bytes than it did before that. The claim is left standing because it is true of the event it
 * describes; this note is here because it reads as present tense and is not.
 *
 * # The old mitigation was real, and it is still the backstop
 *
 * The argument for tolerating the copy was that **a wrong statement cannot forge anything**: the
 * server rebuilds the statement from the request it received and verifies the signature against
 * *its* version, so a divergence is a 401 (`the signature does not prove control of …`) on the
 * first message of the first run, loudly, rather than a message that says something the sender did
 * not sign. That is still true and it is why this was a latent defect rather than a live one. It
 * was never an argument for keeping a second copy once a first one became reachable.
 */
export function sendEncryptedStatement(input: {
  from: string;
  to: string;
  ciphertextSha256: string;
  issuedAtMs: number;
  /** The deployment these bytes are for. Part of the signed statement; see `statementFor`. */
  origin: string;
}): string {
  return statementFor(
    { kind: 'send-encrypted', to: input.to, ciphertextSha256: input.ciphertextSha256 },
    input.from,
    input.issuedAtMs,
    input.origin,
  );
}

/**
 * Whether a `send-encrypted` signature is spent by being used — **computed, not asserted.**
 *
 * {@link DirectMessagePlan} explains at length that a plan carries the statement and never a
 * signature, because a Weir write signature is a bearer artefact that can be spent once by whoever
 * holds it. That paragraph used to state the rule from memory ("`isSingleUse` in
 * `packages/web/lib/identity.ts` returns true for every action but `read`"), which is a transcribed
 * fact in prose rather than in code — the same defect as a transcribed byte layout, wearing a
 * different hat, and one that no compiler and no test would ever catch drifting.
 *
 * So the claim is now derived from the function that decides it. If a future change ever made
 * `send-encrypted` re-usable, this constant would become `false` and the reasoning above it would
 * be visibly wrong instead of quietly wrong.
 */
export const SEND_SIGNATURE_IS_SINGLE_USE: boolean = isSingleUse({
  kind: 'send-encrypted',
  to: '',
  ciphertextSha256: '',
});

/**
 * Drive one session: every seat speaks, `rounds` times, in cast order.
 *
 * # Nothing here sends anything
 *
 * The loop calls agents, encrypts, and returns plans. There is no courier port in this function's
 * signature and there is no place to put one. That is the first of the two things that make a dry
 * run the default: the code path that decides is a different function from the code path that acts,
 * and this one has no way to act. See `index.ts` for the second.
 *
 * # Turn order is fixed and sequential, and that is a decision
 *
 * Round-robin in cast order, one turn at a time, each seat seeing everything said before it. The
 * alternatives — simultaneous turns, or a moderator choosing who speaks — are interesting and are
 * *product* decisions about what the room feels like to read. This is the mechanism; the README
 * lists the choice.
 *
 * # A failing agent stops the session rather than being skipped
 *
 * A skipped seat produces a transcript with a silent hole in it, sold to someone who cannot tell
 * the difference between an agent that declined and an agent that crashed. The session fails with
 * the seat named, and no record is published from a partial deliberation.
 */
export async function deliberate(input: {
  room: RoomDefinition;
  agent: AgentSeatPort;
  cipher: CipherPort;
  clock: ClockPort;
  origin: string;
}): Promise<Reading<Deliberation>> {
  const { room, agent, cipher, clock, origin } = input;
  const source = `room ${room.id}`;

  const valid = validateRoom(room);
  if (!valid.ok) return valid;

  const startedAtMs = clock.nowMs();
  const turns: Utterance[] = [];
  const messages: DirectMessagePlan[] = [];

  for (let roundIndex = 0; roundIndex < room.rounds; roundIndex += 1) {
    for (let turnIndex = 0; turnIndex < room.cast.length; turnIndex += 1) {
      const seat = room.cast[turnIndex];
      if (seat === undefined) continue;

      let text: string;
      try {
        text = await agent.speak({
          seat,
          topic: room.topic,
          roundIndex,
          turnIndex,
          heard: [...turns],
        });
      } catch (error) {
        return fail(
          'transport',
          source,
          `seat ${seat.name} (${lower(seat.address)}) failed on round ${roundIndex}: ${
            error instanceof Error ? error.message : String(error)
          }. The session stops here — a skipped seat is a hole in a transcript somebody paid for.`,
        );
      }

      const atMs = clock.nowMs();
      const utterance: Utterance = {
        ref: `${room.id}#${roundIndex}.${turnIndex}`,
        roundIndex,
        turnIndex,
        seatAddress: lower(seat.address),
        seatName: seat.name,
        text,
        atMs,
      };

      const fanOut = planFanOut({
        room,
        utterance,
        text,
        cipher,
        origin,
        issuedAtMs: atMs,
      });
      if (!fanOut.ok) return fanOut;

      turns.push(utterance);
      messages.push(...fanOut.value);
    }
  }

  return ok({
    room,
    startedAtMs,
    finishedAtMs: clock.nowMs(),
    turns,
    messages,
  });
}

/**
 * What a session costs in messages, before it runs.
 *
 * `rounds × N × (N-1)`. Printed by the dry run because the quadratic term is the one thing about
 * this design that surprises people, and a number in a plan is cheaper than a number in a bill.
 */
export function messageCount(room: RoomDefinition): number {
  const n = room.cast.length;
  return room.rounds * n * (n - 1);
}
