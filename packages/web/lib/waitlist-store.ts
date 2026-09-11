// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Writing one address to the launch list, and reading back what that address can be told.
 *
 * Split from `waitlist.ts` because that module is imported by a client component and this one
 * imports the Postgres pool. `server-only` makes the mistake a build error rather than a bundle
 * that ships a database driver to the browser.
 *
 * # Why standing is returned by the write and by nothing else
 *
 * A person's position on the list and their referral code are returned by `recordSignup`, in the
 * same response as the signup. There is deliberately no `getStanding(email)` and no route that
 * takes an email and answers a question about it.
 *
 * `014_waitlist.sql` names what this table is: "a list of email addresses belonging to people
 * interested in a platform about money, which is a phishing list". A lookup keyed on an email is an
 * oracle for membership — anybody could test an address and be told whether its owner is here. The
 * only caller entitled to an answer is somebody who has just demonstrated they hold the address, and
 * that moment is the write itself.
 *
 * The consequence is deliberate and worth stating: a referral link cannot be recovered by asking for
 * it later, only by submitting the address again, which returns `already` along with the same code.
 */

import { randomBytes } from 'node:crypto';
import { db } from './db';
import {
  canonicalEmail,
  type WaitlistRole,
  type WaitlistSource,
  type WaitlistStanding,
} from './waitlist';

/**
 * What happened to the address.
 *
 * `already` is not an error and is not a silent success either — it is its own outcome, because the
 * person on the other side asked a question ("am I on the list?") whose answer is yes, and telling
 * them "you're in" a second time would be indistinguishable from the first signup having failed.
 */
export type SignupResult = 'created' | 'already';

/**
 * The alphabet a code is drawn from.
 *
 * Crockford-style: no `O`, `I`, `L` or `U`. The first three are unreadable next to `0` and `1` in
 * most typefaces and this code gets read aloud, typed from a screenshot and pasted out of chat
 * clients; the fourth is dropped so a random draw cannot spell something obscene. 31 symbols over 8
 * positions is about 39 bits, which is not a secret and is not meant to be one — it only has to be
 * unguessable enough that nobody harvests other people's codes by trying.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.replace('U', '');
const CODE_LENGTH = 8;

/**
 * One candidate code.
 *
 * `randomBytes`, not `Math.random`. The rejection step matters: taking `byte % 31` would make the
 * first symbols of the alphabet fractionally likelier than the last, and while that bias is far too
 * small to matter here, writing the unbiased version costs one line and removes the need for anybody
 * to reason about whether it matters.
 */
function mintCode(): string {
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (out.length === CODE_LENGTH) break;
      const limit = 256 - (256 % CODE_ALPHABET.length);
      if (byte >= limit) continue;
      out.push(CODE_ALPHABET[byte % CODE_ALPHABET.length] as string);
    }
  }
  return out.join('');
}

/** A referral code as it is stored and compared: upper case, no surrounding space. */
export function canonicalCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Whose code is this?
 *
 * Returns the referrer's email, or `null` for a code that matches nobody. An unknown code is
 * deliberately not an error: somebody mistyping a link they were sent must still end up on the list.
 * Losing the attribution is the correct cost — refusing the signup would punish the wrong person.
 */
async function resolveReferrer(code: string): Promise<string | null> {
  const { rows } = await db().query<{ email: string }>(
    `SELECT email FROM waitlist_signups WHERE ref_code = $1`,
    [canonicalCode(code)],
  );
  return rows[0]?.email ?? null;
}

/**
 * Position, total and referral count for one row that is known to exist.
 *
 * Three counts in one round trip. `position` counts strictly-earlier rows, so the first address on
 * the list is 1. Ties on the same millisecond would both report the same position, which is honest —
 * they did arrive together, and inventing a tiebreak would be inventing an order.
 */
async function readStanding(email: string, refCode: string): Promise<WaitlistStanding> {
  const { rows } = await db().query<{ position: string; total: string; referred: string }>(
    `SELECT
       (SELECT count(*) FROM waitlist_signups w2
         WHERE w2.created_at_ms < w1.created_at_ms) + 1        AS position,
       (SELECT count(*) FROM waitlist_signups)                 AS total,
       (SELECT count(*) FROM waitlist_signups w3
         WHERE w3.referred_by = w1.email)                      AS referred
     FROM waitlist_signups w1
     WHERE w1.email = $1`,
    [email],
  );

  const row = rows[0];
  if (row === undefined) {
    // The row was deleted between the write and this read. Rare, and not worth an exception: the
    // signup itself succeeded, which is what the caller is reporting.
    return { position: 0, total: 0, refCode, referred: 0 };
  }

  return {
    position: Number(row.position),
    total: Number(row.total),
    refCode,
    referred: Number(row.referred),
  };
}

/**
 * The code on an existing row, minting one if the row predates `016`.
 *
 * Rows written before that migration have `ref_code IS NULL`. Backfilling every one of them at
 * migration time would mint codes for people who never asked; instead the code appears the first
 * time that person has cause to be shown one, which is exactly here.
 *
 * `WHERE ref_code IS NULL` in the update, so a concurrent call cannot replace a code that another
 * request has already handed to somebody.
 */
async function ensureCode(email: string): Promise<string> {
  const { rows } = await db().query<{ ref_code: string | null }>(
    `SELECT ref_code FROM waitlist_signups WHERE email = $1`,
    [email],
  );
  const current = rows[0]?.ref_code ?? null;
  if (current !== null) return current;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = mintCode();
    try {
      const { rows: updated } = await db().query<{ ref_code: string }>(
        `UPDATE waitlist_signups SET ref_code = $2
         WHERE email = $1 AND ref_code IS NULL
         RETURNING ref_code`,
        [email, code],
      );
      const minted = updated[0];
      if (minted !== undefined) return minted.ref_code;

      // Somebody else minted one first. Read theirs rather than minting a second.
      const { rows: raced } = await db().query<{ ref_code: string | null }>(
        `SELECT ref_code FROM waitlist_signups WHERE email = $1`,
        [email],
      );
      const theirs = raced[0]?.ref_code ?? null;
      if (theirs !== null) return theirs;
    } catch (error) {
      const pg = error as { code?: unknown; constraint?: unknown };
      if (pg.code === '23505' && pg.constraint === 'waitlist_signups_ref_code_idx') continue;
      throw error;
    }
  }

  throw new Error('waitlist: could not mint a referral code');
}

/**
 * Insert, or discover the address is already there.
 *
 * `ON CONFLICT DO NOTHING RETURNING ref_code` rather than catching SQLSTATE 23505: the conflict is
 * an expected outcome, not an exception, and catching the error code would also swallow a conflict
 * on some *future* constraint and report it as "already on the list". Zero returned rows means the
 * primary key already held this address and nothing else can produce that.
 *
 * Errors are deliberately not caught here. A pool that cannot reach Postgres is a real failure and
 * the route turns it into a 502 that says so; swallowing it would tell somebody they had joined a
 * list that never received them, which is the one outcome this whole module exists to avoid.
 *
 * # The code is minted before the insert, and collisions are retried
 *
 * A unique index guards `ref_code`. Two simultaneous signups drawing the same 39-bit code is
 * vanishingly unlikely and entirely possible, so the insert is retried with a fresh code rather than
 * surfacing a constraint violation that the caller would report as "the list is broken".
 *
 * The retry is bounded. An unbounded loop against a database rejecting writes for some other reason
 * would spin until the request times out, which turns one failure into a hung connection.
 */
export async function recordSignup(input: {
  email: string;
  source: WaitlistSource;
  role: WaitlistRole;
  /** Absent for most signups; an intention, never a reservation. */
  handle: string | null;
  /** The code from a shared link, if they followed one. Unknown codes are ignored, not refused. */
  refCode?: string | null;
}): Promise<{ result: SignupResult; standing: WaitlistStanding }> {
  const email = canonicalEmail(input.email);

  /*
    Who sent them, resolved before the insert so the value written is an email that exists.

    Self-referral is dropped rather than rejected. Somebody arriving on their own link is the
    ordinary result of sharing it and then re-submitting their own address, and it is not an attack —
    it is also not a referral, so it records as none.
  */
  let referredBy: string | null = null;
  if (typeof input.refCode === 'string' && input.refCode.trim() !== '') {
    const resolved = await resolveReferrer(input.refCode);
    referredBy = resolved === email ? null : resolved;
  }

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = mintCode();
    try {
      const { rows } = await db().query<{ ref_code: string }>(
        `INSERT INTO waitlist_signups (email, source, role, handle, created_at_ms, ref_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO NOTHING
         RETURNING ref_code`,
        [email, input.source, input.role, input.handle, Date.now(), code, referredBy],
      );

      if (rows.length === 1) {
        return { result: 'created', standing: await readStanding(email, code) };
      }

      /*
        Already on the list. Their code is returned so a second submission is how somebody recovers
        a link they lost — the only way to recover it, by the design stated at the top of this file.

        `referred_by` is deliberately not updated here. Whoever brought them first brought them, and
        letting a later link overwrite it would make attribution a question of who got them to submit
        the form most recently.
      */
      const existing = await ensureCode(email);
      return { result: 'already', standing: await readStanding(email, existing) };
    } catch (error) {
      const pg = error as { code?: unknown; constraint?: unknown };
      const codeCollision = pg.code === '23505' && pg.constraint === 'waitlist_signups_ref_code_idx';
      if (codeCollision && attempt < MAX_ATTEMPTS - 1) continue;
      throw error;
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function has no implicit path
  // that returns undefined if the bound above is ever edited.
  throw new Error('waitlist: exhausted referral code attempts');
}

/**
 * How many addresses are on the list.
 *
 * Public, and the only number here that is. It says how many people asked to be told when something
 * ships, which is a fact about us rather than about any of them — no row is identified, and the
 * count leaks nothing an individual could be picked out of.
 *
 * Returns `null` rather than zero when the list cannot be read. Zero is a real and meaningful
 * answer — a deployment whose list is genuinely empty — and rendering an unreachable database as
 * "0 people" would be the interface stating a measurement it never took.
 */
export async function waitlistTotal(): Promise<number | null> {
  try {
    const { rows } = await db().query<{ total: string }>(
      `SELECT count(*) AS total FROM waitlist_signups`,
    );
    const total = rows[0]?.total;
    return total === undefined ? null : Number(total);
  } catch {
    return null;
  }
}
