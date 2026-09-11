// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { type Reading, fail, isSingleUse, ok, statementFor } from '@projectx-social/sdk';

export interface Seat {
  address: string;
  name: string;
  x25519Public: string;
  persona: unknown;
}

export type Custody = 'single-operator' | 'independent';

export interface Cadence {
  everyMs: bigint;
}

export interface RoomDefinition {
  id: string;
  topic: string;
  cast: readonly Seat[];
  cadence: Cadence;
  rounds: number;
  vaultId: string;
  handle: string;
  publisher: string;
  tier: bigint;
  custody: Custody;
}

export interface Utterance {
  ref: string;
  roundIndex: number;
  turnIndex: number;
  seatAddress: string;
  seatName: string;
  text: string;
  atMs: number;
}

export interface TurnInput {
  seat: Seat;
  topic: string;
  roundIndex: number;
  turnIndex: number;
  heard: readonly Utterance[];
}

export interface AgentSeatPort {
  speak(input: TurnInput): Promise<string>;
}

export interface CipherPort {
  encrypt(
    plaintext: string,
    participants: ReadonlyArray<{ address: string; x25519Public: string }>,
  ): EncryptedPayload;
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

export interface DirectoryPort {
  publishedKey(address: string): Promise<string | null>;
}

export interface ClockPort {
  nowMs(): number;
}

export interface DirectMessagePlan {
  utteranceRef: string;
  from: string;
  to: string;
  endpoint: string;
  plaintextChars: number;
  ciphertextChars: number;
  ciphertextSha256: string;
  envelopeRecipients: readonly string[];
  statement: string;
  issuedAtMs: number;
  encryption: EncryptedPayload;
}

export interface Deliberation {
  room: RoomDefinition;
  startedAtMs: number;
  finishedAtMs: number;
  turns: readonly Utterance[];
  messages: readonly DirectMessagePlan[];
}

export const MAX_CIPHERTEXT_CHARS = 16_384;

export const MAX_UTTERANCE_CHARS = 4000;

function lower(address: string): string {
  return address.toLowerCase();
}

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

export function sendEncryptedStatement(input: {
  from: string;
  to: string;
  ciphertextSha256: string;
  issuedAtMs: number;
  origin: string;
}): string {
  return statementFor(
    { kind: 'send-encrypted', to: input.to, ciphertextSha256: input.ciphertextSha256 },
    input.from,
    input.issuedAtMs,
    input.origin,
  );
}

export const SEND_SIGNATURE_IS_SINGLE_USE: boolean = isSingleUse({
  kind: 'send-encrypted',
  to: '',
  ciphertextSha256: '',
});

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

export function messageCount(room: RoomDefinition): number {
  const n = room.cast.length;
  return room.rounds * n * (n - 1);
}
