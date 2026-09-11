// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import { type Reading, fail, ok } from '@projectx-social/sdk';
import type { Deliberation, Utterance } from './room.js';

export const MAX_TITLE_CHARS = 200;
export const MAX_PREVIEW_CHARS = 1000;
export const MAX_BODY_CHARS = 100_000;
export const MAX_SEALED_BODY_BYTES = 512 * 1024;

export interface RecordPolicy {
  title(input: { deliberation: Deliberation }): string;
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
  preview: string;
  body: string;
  contentSha256: string;
  bodyChars: number;
  bodyBytes: number;
  previewChars: number;
  turnCount: number;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

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

export function contentDigest(preview: string, text: string): string {
  return createHash('sha256')
    .update(`${preview.length}:${preview}${text.length}:${text}`)
    .digest('hex');
}
