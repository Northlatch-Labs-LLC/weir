// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The sold record: turning a private deliberation into one artefact a seat-holder can read.
 *
 * # This is the second artefact, and it is a copy, not a window
 *
 * The room in `room.ts` happens over end-to-end encrypted direct messages that Weir cannot read.
 * Nothing in this file reaches into those messages. It renders the orchestrator's own record of the
 * turns into a post body, and that post is sealed to `period_identity` by the publish route.
 *
 * The distinction is the product. If the sold record were a view onto the private thread, the
 * thread would have to be readable by whoever sells it, and the privacy claim would collapse into
 * an access-control setting. Instead there are two artefacts with two different key holders, and
 * the back room stays shut whatever happens to the front one.
 *
 * # THE PREVIEW IS PUBLIC. THIS FILE IS WHERE THAT GOES WRONG IF IT GOES WRONG.
 *
 * `app/api/posts/route.ts` stores `preview` in a plaintext Postgres column for every post,
 * including a gated one — deliberately, because a reader has to see *something* before deciding to
 * subscribe, and `db/005_search.sql` indexes the title and preview. Only the body is sealed.
 *
 * So a preview built by slicing the body is a paywall with a hole in it, and it is the specific
 * hole nobody notices, because it looks like a feature: the first two hundred words of the argument
 * are the part worth paying for. {@link buildRecord} therefore never receives the turn text on the
 * preview path — the preview is composed from the topic, the cast and the shape of the session, and
 * {@link previewLeak} re-checks the finished string against the turns afterwards.
 *
 * The second check is defence in depth and is labelled as such rather than left to look like the
 * guarantee. The guarantee is that the preview builder is not given the words.
 */

import { createHash } from 'node:crypto';
import { type Reading, fail, ok } from '@projectx-social/sdk';
import type { Deliberation, Utterance } from './room.js';

/**
 * Ceilings mirrored from `packages/web/lib/content.ts` and `packages/web/lib/body-storage.ts`.
 *
 * Mirrored because both live behind `server-only` inside the Next.js application. Each is checked
 * here so an over-long record fails on the machine that built it, naming the field, rather than as
 * an HTTP 400 after a whole session's worth of agent turns has been paid for in tokens.
 *
 * They are different units on purpose and both are enforced:
 *
 *  - `MAX_POST_TITLE_LENGTH` / `MAX_POST_PREVIEW_LENGTH` / `MAX_POST_BODY_LENGTH` count **UTF-16
 *    characters**, because that is what `.length` counts in the route.
 *  - `MAX_SEALED_BODY_BYTES` counts **UTF-8 bytes**, because `storeBody` measures
 *    `new TextEncoder().encode(body).length` before it encrypts, and a transcript full of
 *    non-ASCII passes the character check and fails the byte one.
 *
 * A record that satisfies the character limit and not the byte limit is exactly the kind of thing
 * that ships fine in English and breaks the first time a room argues in Japanese.
 */
export const MAX_TITLE_CHARS = 200;
export const MAX_PREVIEW_CHARS = 1000;
export const MAX_BODY_CHARS = 100_000;
export const MAX_SEALED_BODY_BYTES = 512 * 1024;

/** What is included, and what the reader is told. The owner's decisions; no defaults invented. */
export interface RecordPolicy {
  /**
   * The record's title. A function of the room and the session, so a weekly room does not publish
   * twelve posts called the same thing — and so the title is reproducible from the deliberation
   * rather than typed by whoever ran it.
   */
  title(input: { deliberation: Deliberation }): string;
  /**
   * The public teaser.
   *
   * Receives the room and the session's *shape* — never the turns. That is not a suggestion the
   * implementer may work around: `buildRecord` passes exactly these fields, and a policy that wants
   * the words has nowhere to get them from.
   */
  preview(input: {
    topic: string;
    castNames: readonly string[];
    turnCount: number;
    rounds: number;
    startedAtMs: number;
    finishedAtMs: number;
  }): string;
}

export interface Record {
  title: string;
  /** Public, plaintext, searchable. */
  preview: string;
  /** Sealed to `period_identity` by the publish route. Never stored in the clear. */
  body: string;
  /**
   * `sha256(`${preview.length}:${preview}${body.length}:${body}`)`, hex.
   *
   * Mirrored from `contentDigest` in `app/api/posts/route.ts`, including the length prefixes. The
   * prefixes are load-bearing and the route says why: concatenating the two fields directly would
   * let a different split of the same characters produce the same digest, so a signer could move
   * text out of the withheld body and into the public preview after signing. Dropping them here
   * would produce a digest the route disagrees with, and every publish would 401.
   */
  contentSha256: string;
  bodyChars: number;
  bodyBytes: number;
  previewChars: number;
  turnCount: number;
}

/** UTF-8 length, which is what the sealing path measures. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Render the turns into one body, deterministically.
 *
 * # Determinism is a requirement, not a nicety
 *
 * The publish statement binds `content-sha256`. If rendering the same turns twice produced two
 * bodies — a timestamp formatted in the local zone, a `Set` iterated, a duration recomputed from
 * the clock — then a retried publish would carry a signature over a digest that no longer matches
 * what is being sent, and the route would refuse it with a signature error that points at
 * cryptography instead of at formatting.
 *
 * So: no locale formatting, no clock reads, no map iteration. Every value comes from the
 * deliberation, and timestamps are printed as the integers they are.
 */
export function renderBody(deliberation: Deliberation): string {
  const lines: string[] = [];
  lines.push(`# ${deliberation.room.topic}`);
  lines.push('');
  lines.push(`Room: ${deliberation.room.id}`);
  lines.push(`Seats: ${deliberation.room.cast.map((seat) => seat.name).join(', ')}`);
  lines.push(`Started: ${deliberation.startedAtMs}`);
  lines.push(`Finished: ${deliberation.finishedAtMs}`);
  lines.push('');

  let round = -1;
  for (const turn of deliberation.turns) {
    if (turn.roundIndex !== round) {
      round = turn.roundIndex;
      lines.push(`## Round ${round + 1}`);
      lines.push('');
    }
    lines.push(`**${turn.seatName}** · ${turn.atMs} · \`${turn.ref}\``);
    lines.push('');
    lines.push(turn.text);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Does the finished preview contain any of the words that were meant to stay behind the gate?
 *
 * Returns the first offending utterance reference, or `null`.
 *
 * # Why this exists when the preview builder is already denied the text
 *
 * Because the denial is a convention enforced by one function signature, and signatures get
 * widened. Somebody adding "just the opening line" to the teaser would change `RecordPolicy` and
 * nothing would object. This check objects.
 *
 * # Why the window is 24 characters
 *
 * Short enough to catch a lifted phrase; long enough that ordinary overlap does not trip it. A
 * preview naturally repeats the topic, the seat names and common words, and a check that fires on
 * those would be turned off within a week — which is worse than not having it. Twenty-four
 * characters of verbatim agreement is not coincidence, it is a copy.
 *
 * Whitespace is normalised on both sides first, so re-wrapping a quote does not evade it.
 */
export function previewLeak(preview: string, turns: readonly Utterance[]): string | null {
  const WINDOW = 24;
  const flat = preview.replace(/\s+/g, ' ').toLowerCase();
  if (flat.length < WINDOW) return null;

  for (const turn of turns) {
    const text = turn.text.replace(/\s+/g, ' ').toLowerCase();
    for (let i = 0; i + WINDOW <= text.length; i += 1) {
      if (flat.includes(text.slice(i, i + WINDOW))) return turn.ref;
    }
  }
  return null;
}

/**
 * Assemble the record, or refuse.
 *
 * Every refusal below is a failure the publish route or the sealing path would produce anyway,
 * moved earlier so it names the field instead of arriving as a status code. The one refusal that is
 * *not* a mirror is the preview leak, which nothing downstream checks — the route would store a
 * leaking preview happily, because it has no way to know what was supposed to be behind the gate.
 */
export function buildRecord(
  deliberation: Deliberation,
  policy: RecordPolicy,
): Reading<Record> {
  const source = `record of room ${deliberation.room.id}`;

  if (deliberation.turns.length === 0) {
    return fail(
      'malformed',
      source,
      'the deliberation produced no turns, and an empty record is not something to sell a seat to',
    );
  }

  const title = policy.title({ deliberation });
  if (title.trim() === '') return fail('malformed', source, 'the record has no title');
  if (title.length > MAX_TITLE_CHARS) {
    return fail('malformed', source, `the title is ${title.length} characters; the limit is ${MAX_TITLE_CHARS}`);
  }

  const preview = policy.preview({
    topic: deliberation.room.topic,
    castNames: deliberation.room.cast.map((seat) => seat.name),
    turnCount: deliberation.turns.length,
    rounds: deliberation.room.rounds,
    startedAtMs: deliberation.startedAtMs,
    finishedAtMs: deliberation.finishedAtMs,
  });
  if (preview.trim() === '') {
    return fail(
      'malformed',
      source,
      'the record has no preview. The preview is the only thing a reader sees before deciding to ' +
        'pay for a seat, and an empty one sells nothing.',
    );
  }
  if (preview.length > MAX_PREVIEW_CHARS) {
    return fail('malformed', source, `the preview is ${preview.length} characters; the limit is ${MAX_PREVIEW_CHARS}`);
  }

  const leaked = previewLeak(preview, deliberation.turns);
  if (leaked !== null) {
    return fail(
      'malformed',
      source,
      `the preview repeats at least 24 characters verbatim from ${leaked}. The preview is stored ` +
        'in a plaintext column and indexed for search, so anything in it is outside the paywall. ' +
        'Publishing this would sell a seat to words the record has already given away.',
    );
  }

  const body = renderBody(deliberation);
  const bodyChars = body.length;
  const bodyBytes = utf8Bytes(body);
  if (bodyChars > MAX_BODY_CHARS) {
    return fail('malformed', source, `the body is ${bodyChars} characters; the route caps it at ${MAX_BODY_CHARS}`);
  }
  if (bodyBytes > MAX_SEALED_BODY_BYTES) {
    return fail(
      'malformed',
      source,
      `the body is ${bodyBytes} UTF-8 bytes; the sealing path caps it at ${MAX_SEALED_BODY_BYTES}. ` +
        'This is a different limit from the character one and a non-ASCII transcript can pass that ' +
        'and fail this.',
    );
  }

  return ok({
    title,
    preview,
    body,
    contentSha256: contentDigest(preview, body),
    bodyChars,
    bodyBytes,
    previewChars: preview.length,
    turnCount: deliberation.turns.length,
  });
}

/**
 * The digest the publish signature binds to.
 *
 * Mirrored from `app/api/posts/route.ts`. See {@link Record.contentSha256} for why the length
 * prefixes cannot be dropped. Unlike the Seal identities in `packages/sdk/src/seal.ts`, a mistake
 * here cannot forge anything: the route computes its own digest from the request it received and
 * refuses the signature if the two disagree, so the failure mode of this mirror is "nothing
 * publishes", not "the wrong thing publishes".
 */
export function contentDigest(preview: string, text: string): string {
  return createHash('sha256')
    .update(`${preview.length}:${preview}${text.length}:${text}`)
    .digest('hex');
}
