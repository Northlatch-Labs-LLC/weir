// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The seat, and the publish that fills it.
 *
 * # A seat is a subscription, and the contract already decided what that means
 *
 * `sui-contracts/sources/entitlement.move` gates a period's key with `seal_approve_subscription`,
 * and that function **takes no `Clock`**. The contract explains why in its own words, and the
 * reasoning is the product:
 *
 *   *A Seal key, once derived, is permanent. Requiring the subscription to be currently active
 *   would therefore control nothing — a subscriber could fetch every key the day before lapsing and
 *   keep them — while punishing the one who simply did not open the app in time.*
 *
 * So a seat-holder keeps every room from every period they paid for, **for ever**, and can never
 * reach into a period they did not pay for. Not "until they cancel". Not "while their card works".
 * That is not a promise this service keeps; it is a property of a key that is a deterministic
 * function of `period_identity(vault, tier, period)` and of an approval that has no clock to
 * consult.
 *
 * The check the contract does make is the honest one: the period's *start* must fall inside the
 * paid window. Judged at the start rather than by overlap, because overlap would let one day's
 * payment buy two periods at the boundaries. The deliberate cost is that a subscriber joining
 * mid-period gets the next period, not the running one — up to 29 days of wait in the worst case,
 * measured and recorded in `UPDATE.md` on 2026-08-31 against a real mainnet subscription.
 *
 * # The period is thirty days and this package will not argue with it
 *
 * `PERIOD_MS = 30 * 24 * 60 * 60 * 1000`, and the Move source says it "cannot be changed later
 * without re-partitioning every identity ever issued and stranding keys on both sides of the
 * change". The estate additionally raised `MIN_PERIOD_MS` to thirty days so tier lengths are whole
 * multiples of `seal_period_ms()` — after the two had drifted apart and tiers could be sold by the
 * day while access was granted by the month.
 *
 * A room whose cadence is faster than the period therefore sells several records per seat-period,
 * and one slower sells periods with nothing in them. {@link describeCadence} computes that number
 * and the dry run prints it, because it is the single most consequential thing about a cadence and
 * it is not visible from the cadence alone.
 *
 * # Nothing in this file seals anything
 *
 * `app/api/posts/route.ts` already seals a `subscribers` body to
 * `period_identity(vault, 0, periodOf(publishedAtMs))` and hands the key to Seal. This file builds
 * the request that route answers. The identity it computes is a **prediction, printed so the
 * operator can check it** — derived by calling `@projectx-social/sdk`, which is the one TypeScript
 * implementation held byte-for-byte against `entitlement.move` by tests in both languages. It is
 * not a second encoder, and it must never become one.
 */

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

/**
 * The width of the race described in {@link planPublish}, re-exported from the SDK.
 *
 * It used to be a local `10 * 60 * 1000` with a comment saying it was mirrored from
 * `packages/web/lib/identity.ts`. That mirror is gone: `SIGNATURE_WINDOW_MS` was hoisted into
 * `@projectx-social/sdk`, which this package already depends on, so the number the guard is derived
 * from is now the same object the verifier uses rather than a copy that agreed with it on the day
 * it was typed.
 *
 * Re-exported rather than merely imported because {@link planPublish}'s refusal quotes it, and a
 * caller reading that message should be able to reach the value it names from the package that
 * produced it.
 */
export { SIGNATURE_WINDOW_MS };

/** What the sold record will be gated by, spelled out for the operator to check. */
export interface SealPrediction {
  vaultId: string;
  tier: bigint;
  period: bigint;
  /** `period_identity(vault, tier, period)` as unprefixed lower-case hex, the form Seal uses. */
  identityHex: string;
  periodStartMs: bigint;
  periodEndMs: bigint;
  /** Milliseconds left in this period at the moment the plan was built. */
  remainingMs: bigint;
}

/** Everything the live path would POST, and nothing it would not. */
export interface PublishPlan {
  endpoint: string;
  /** `subscribers`. See {@link planPublish} for why `paid` is not offered here. */
  access: 'subscribers';
  handle: string;
  author: string;
  title: string;
  preview: string;
  /** Present so the live path can send it. A printer must not print it — see `index.ts`. */
  body: string;
  contentSha256: string;
  issuedAtMs: number;
  /** The exact bytes the publisher would sign. Not signed here. */
  statement: string;
  seal: SealPrediction;
  bodyChars: number;
  bodyBytes: number;
}

/**
 * The publish statement. **Formatted by the SDK; this function chooses the fields and nothing else.**
 *
 * # What was here before, and why it is gone
 *
 * This used to hand-transcribe the `publish` arm of `statementFor` — the literal `${head}\naction:
 * publish\ncreator: …` template, copied into this file with a doc block quoting the original. The
 * justification given for the copy was that the statement lived in a `server-only` module inside
 * the web application and could not be imported from here.
 *
 * **That justification expired.** `statementFor`, `isSingleUse` and `SIGNATURE_WINDOW_MS` were
 * hoisted into `@projectx-social/sdk`, a pure module with no imports at all, which this package
 * already depends on. `packages/web/lib/identity.ts` now re-exports them rather than owning them.
 * So the one thing that made a transcription defensible — that there was nothing to import — is no
 * longer true, and a second copy of a byte layout with no reason to exist is just a second place
 * for it to be wrong.
 *
 * The bytes were unchanged BY THAT REMOVAL. `statementFor({ kind: 'publish', … })` with
 * `contentKey: ''` and `price: ''` emitted exactly the string this function used to build by hand,
 * character for character, and that was checked over sixteen vectors before it was made.
 *
 * They have changed since. The shared head now carries an `origin:` line, so these bytes differ
 * from the ones this paragraph was written about. The claim stands as a statement about the
 * removal; it is not a statement about what this function emits today.
 *
 * # Why `key` and `price` are empty strings rather than omitted
 *
 * That is what the route binds. `app/api/posts/route.ts` signs `body.contentKey ?? ''` and
 * `body.price ?? ''` **as sent**, before the paid branch reads them, and says why: normalising on
 * one side of a signature and not the other produces a signature that fails for a reason no error
 * message can explain. A record published by this package is `subscribers`-gated and carries
 * neither, so both are empty here — and they must be empty *strings*, not absent fields, because
 * the statement interpolates whatever it is given.
 *
 * # The failure mode, unchanged by the move
 *
 * A wrong statement cannot forge anything. The server rebuilds the statement from the request it
 * received and verifies the signature against *its* version, so a mismatch is a 401 on the first
 * publish — never a post that says something the publisher did not sign.
 */
export function publishStatement(input: {
  author: string;
  handle: string;
  access: string;
  title: string;
  contentSha256: string;
  issuedAtMs: number;
  /** The deployment these bytes are for. Part of the signed statement; see `statementFor`. */
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

/** How a cadence lands against a thirty-day seal period. */
export interface CadenceShape {
  everyMs: bigint;
  periodMs: bigint;
  /** Records a seat-holder gets for one period, floored. Zero is a real and bad answer. */
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

/**
 * Build the publish request, or refuse.
 *
 * # Why only `subscribers`
 *
 * The brief is a seat, and a seat is a subscription. The route's other gate, `paid`, seals to
 * `unlock_identity(vault, contentKey)` and has a precondition this service cannot satisfy on its
 * own: the content key must already be priced on the vault with `set_content_price`, or
 * `creator::unlock` aborts with `EContentNotForSale` and the reader gets a buy button that always
 * fails. That is a transaction, this package sends none, and offering a gate whose happy path
 * requires a spend it refuses to make would be a lie in the type. Selling a single room as a
 * one-off `Unlock` is a real product option and it is on the owner's list in the README.
 *
 * # Why a non-zero tier is refused rather than accepted
 *
 * `app/api/posts/route.ts` stamps `gate = { kind: 'period', tier: 0n, period: ... }` for every
 * `subscribers` post. The tier is not read from the request and there is no field to put one in.
 *
 * So a room configured at tier 2 would have its record sealed at tier 0 — and
 * `seal_approve_subscription` asserts `subscription.tier >= tier`, so tier 0 is the tier **every**
 * subscriber can open. A premium room would be published, look correct in every log, and be
 * readable by the cheapest seat on the vault. That is a paywall bypass produced by a configuration
 * field with no effect, which is the worst shape a bug can have: it is invisible until someone
 * checks what a cheap subscriber can see.
 *
 * Refused, naming the file. Accepting it with a warning would put the warning in a scrollback and
 * the bypass in production.
 *
 * # The period race, and why the guard is exactly one signature window
 *
 * This plan predicts `periodOf(issuedAtMs)`. The route seals with `periodOf(Date.now())` read when
 * the request is *handled*. Those are the same number almost always and different across a period
 * boundary — and thirty-day boundaries arrive at an arbitrary hour, because a period is an integer
 * division of Unix milliseconds, not a calendar month.
 *
 * If the boundary falls between building and handling, the record is sealed to the *next* period.
 * Nothing errors. The post publishes, and it opens for subscribers who paid for a period the room
 * did not run in and stays shut to the ones who paid for the period it did. The identity printed by
 * the dry run would also be wrong, which is the part that makes it hard to catch afterwards.
 *
 * The guard is `remainingMs > SIGNATURE_WINDOW_MS`, and that bound is derived rather than chosen:
 * the signature over this statement is valid for exactly that window, so if the period cannot end
 * within it, the prediction cannot go stale while the request is still sendable. The cost is a
 * refusal in the last ten minutes of every thirty days, and the fix is to wait — which the message
 * says.
 */
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
    // `periodIdentity` refuses a short vault id rather than padding it, and it is right to: a
    // padded id is an identity nobody chose, the encryption under it succeeds, and the failure
    // surfaces later as a reader who cannot open what they paid for.
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

/**
 * The request body, built once so the live path and the printed plan cannot describe two different
 * requests.
 *
 * `signature` and `timestampMs` are the caller's to add; everything else is fixed by the plan. A
 * dry run calls this and prints the keys with the body's *size* rather than its text — the words
 * are the thing being sold, and a terminal is not where they belong.
 */
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
