// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import {
  SEAL_PERIOD_MS,
  SIGNATURE_WINDOW_MS,
  type Reading,
  fail,
  ok,
  periodIdentity,
  periodOf,
  sealId,
  statementFor,
} from '@projectx-social/sdk';
import type { RoomDefinition } from './room.js';
import type { Record as SoldRecord } from './transcript.js';

export { SIGNATURE_WINDOW_MS };

export interface SealPrediction {
  vaultId: string;
  tier: bigint;
  period: bigint;
  identityHex: string;
  periodStartMs: bigint;
  periodEndMs: bigint;
  remainingMs: bigint;
}

export interface PublishPlan {
  endpoint: string;
  access: 'subscribers';
  handle: string;
  author: string;
  title: string;
  preview: string;
  body: string;
  contentSha256: string;
  issuedAtMs: number;
  statement: string;
  seal: SealPrediction;
  bodyChars: number;
  bodyBytes: number;
}

export function publishStatement(input: {
  author: string;
  handle: string;
  access: string;
  title: string;
  contentSha256: string;
  issuedAtMs: number;
  origin: string;
}): string {
  return statementFor(
    {
      kind: 'publish',
      handle: input.handle,
      title: input.title,
      access: input.access,
      contentSha256: input.contentSha256,
      contentKey: '',
      price: '',
    },
    input.author,
    input.issuedAtMs,
    input.origin,
  );
}

export interface CadenceShape {
  everyMs: bigint;
  periodMs: bigint;
  recordsPerPeriod: bigint;
  remainderMs: bigint;
}

export function describeCadence(room: RoomDefinition): CadenceShape {
  const everyMs = room.cadence.everyMs;
  return {
    everyMs,
    periodMs: SEAL_PERIOD_MS,
    recordsPerPeriod: SEAL_PERIOD_MS / everyMs,
    remainderMs: SEAL_PERIOD_MS % everyMs,
  };
}

export function planPublish(input: {
  room: RoomDefinition;
  record: SoldRecord;
  origin: string;
  issuedAtMs: number;
}): Reading<PublishPlan> {
  const { room, record, origin, issuedAtMs } = input;
  const source = `publish for room ${room.id}`;

  if (room.tier !== 0n) {
    return fail(
      'malformed',
      source,
      `this room is configured at tier ${room.tier}, and the publish route seals every ` +
        '`subscribers` post at tier 0 — `app/api/posts/route.ts` writes `tier: 0n` and has no ' +
        'field to override it. Publishing would seal a premium room to the tier every subscriber ' +
        'can open. Set tier to 0, or change the route first.',
    );
  }

  if (issuedAtMs < 0 || !Number.isFinite(issuedAtMs)) {
    return fail('malformed', source, `the publish timestamp is not a usable instant: ${issuedAtMs}`);
  }

  const at = BigInt(Math.trunc(issuedAtMs));
  const period = periodOf(at);
  const periodStartMs = period * SEAL_PERIOD_MS;
  const periodEndMs = periodStartMs + SEAL_PERIOD_MS;
  const remainingMs = periodEndMs - at;

  if (remainingMs <= BigInt(SIGNATURE_WINDOW_MS)) {
    return fail(
      'malformed',
      source,
      `this seal period ends in ${remainingMs} ms, which is inside the ${SIGNATURE_WINDOW_MS} ms ` +
        'signature window. The publish route stamps the period from its own clock when it handles ' +
        'the request, so a boundary crossed in flight would seal this record to the next period — ' +
        'readable by subscribers who did not pay for the room and shut to the ones who did. ' +
        `Wait ${remainingMs} ms and run again.`,
    );
  }

  let identityHex: string;
  try {
    identityHex = sealId(periodIdentity(room.vaultId, room.tier, period));
  } catch (error) {
    return fail(
      'malformed',
      source,
      `could not derive the seal identity: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return ok({
    endpoint: `${origin.replace(/\/+$/, '')}/api/posts`,
    access: 'subscribers',
    handle: room.handle,
    author: room.publisher.toLowerCase(),
    title: record.title,
    preview: record.preview,
    body: record.body,
    contentSha256: record.contentSha256,
    issuedAtMs,
    statement: publishStatement({
      author: room.publisher.toLowerCase(),
      origin,
      handle: room.handle,
      access: 'subscribers',
      title: record.title,
      contentSha256: record.contentSha256,
      issuedAtMs,
    }),
    seal: {
      vaultId: room.vaultId,
      tier: room.tier,
      period,
      identityHex,
      periodStartMs,
      periodEndMs,
      remainingMs,
    },
    bodyChars: record.bodyChars,
    bodyBytes: record.bodyBytes,
  });
}

export function publishRequestBody(plan: PublishPlan): Record<string, unknown> {
  return {
    handle: plan.handle,
    author: plan.author,
    title: plan.title,
    preview: plan.preview,
    text: plan.body,
    access: plan.access,
  };
}
