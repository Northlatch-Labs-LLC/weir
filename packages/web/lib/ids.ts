// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { randomBytes } from 'node:crypto';

/**
 * A row identifier that cannot collide and cannot be guessed.
 *
 * # What it replaces
 *
 * `` `p${Date.now().toString(36)}` `` — the clock, in base 36, and nothing else. Two writes in the
 * same millisecond produced the same id, and the only thing that noticed was the primary key: the
 * second insert raised, the route did not catch it, and the caller got a 500. `db/011` records the
 * same fact from the other side, noting that "only a same-millisecond collision was stopped, and
 * that by the primary key rather than by design".
 *
 * A millisecond is a long time on a server. Two people commenting on the same post, one client
 * retrying, or two instances serving concurrent requests are all ordinary ways to land inside one.
 *
 * # And why the randomness matters as much as the collision
 *
 * A time-only id is enumerable. Anybody holding one can walk backwards and forwards through
 * plausible neighbours, and `GET /api/comments?postId=` and `/api/media/[postId]/[assetId]` both
 * take an id from the caller. Guessing an id is not authorisation — entitlement is decided
 * elsewhere and a guessed id opens nothing that was not already public — but an identifier that
 * enumerates the platform's contents is a disclosure of its shape, and there is no reason to have
 * one.
 *
 * # The time prefix stays
 *
 * Not for uniqueness, which the suffix now provides, but because these ids sort. `listPosts` orders
 * by `(created_at_ms DESC, id DESC)` and the id is the tiebreak that makes a keyset cursor total,
 * so an id whose lexical order has nothing to do with time would make page boundaries arbitrary
 * rather than wrong — harder to reason about for no gain.
 *
 * Nine random bytes, base64url, is 12 characters and 72 bits. Two ids in the same millisecond
 * collide with probability around 2^-72; the clock alone collided at "two requests at once".
 */
export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(9).toString('base64url')}`;
}
