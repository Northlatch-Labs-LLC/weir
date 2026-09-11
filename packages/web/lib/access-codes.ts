// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Access codes: the way through the front door while it is closed.
 *
 * # Two tables, one rule
 *
 * # This is a front door, not a lock
 *
 * Same posture as `lib/site-mode.ts`: a pass decides whether the server serves the product or the
 * waiting list. It is never consulted for entitlement — that is decided by objects on chain — and
 * nothing here must ever be wired into a paywall. It fails *closed*: an unreadable table sends the
 * visitor to the waiting list, which is the safe direction and the one they can recover from.
 *
 * # The code alphabet
 *
 * Thirty-two characters, no 0/O or 1/I. Twelve of them is 60 bits, which makes guessing one
 * through the rate-limited redeem route a non-starter, and the dash grouping is so a person can
 * read it over the phone. `normaliseCode` accepts it however it was typed — lower case, spaces,
 * missing dashes — and re-shapes it, so "the code did not work" is never a formatting problem.
 */

import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { cookieFromHeader } from './read-session';

export const ACCESS_PASS_COOKIE = 'weir_pass';
/** How long a redeemed pass lasts, at most. A code's own expiry shortens it. */
export const ACCESS_PASS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHAPE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export interface AccessCode {
  code: string;
  label: string;
  maxUses: number;
  uses: number;
  expiresAtMs: number | null;
  createdBy: string;
  createdAtMs: number;
  revokedAtMs: number | null;
}

export type CodeStatus = 'live' | 'exhausted' | 'expired' | 'revoked';

export function statusOf(c: AccessCode, now = Date.now()): CodeStatus {
  if (c.revokedAtMs !== null) return 'revoked';
  if (c.expiresAtMs !== null && c.expiresAtMs <= now) return 'expired';
  if (c.uses >= c.maxUses) return 'exhausted';
  return 'live';
}

/** A fresh code from the CSPRNG. 32 symbols, so one byte masked to five bits is unbiased. */
export function generateCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]!);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/** The code as stored, from however it was typed; `null` if it cannot be one. */
export function normaliseCode(raw: string): string | null {
  const flat = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (flat.length !== 12) return null;
  const shaped = `${flat.slice(0, 4)}-${flat.slice(4, 8)}-${flat.slice(8, 12)}`;
  return SHAPE.test(shaped) ? shaped : null;
}

interface CodeRow {
  code: string;
  label: string;
  max_uses: number;
  uses: number;
  expires_at_ms: string | null;
  created_by: string;
  created_at_ms: string;
  revoked_at_ms: string | null;
}

function toCode(r: CodeRow): AccessCode {
  return {
    code: r.code,
    label: r.label,
    maxUses: r.max_uses,
    uses: r.uses,
    expiresAtMs: r.expires_at_ms === null ? null : Number(r.expires_at_ms),
    createdBy: r.created_by,
    createdAtMs: Number(r.created_at_ms),
    revokedAtMs: r.revoked_at_ms === null ? null : Number(r.revoked_at_ms),
  };
}

const COLUMNS = 'code, label, max_uses, uses, expires_at_ms, created_by, created_at_ms, revoked_at_ms';

/**
 * Mint one. Authority is **not** checked here, exactly as in `setSiteMode`: the route checks the
 * caller holds the `Publisher` against chain before calling, and keeping the check out of this
 * function means it cannot be satisfied by whatever the caller has in scope.
 */
export async function mintAccessCode(
  input: { label: string; maxUses: number; expiresAtMs: number | null },
  by: string,
): Promise<AccessCode> {
  const now = Date.now();
  const { rows } = await db().query<CodeRow>(
    `INSERT INTO access_codes (code, label, max_uses, expires_at_ms, created_by, created_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [generateCode(), input.label.trim(), input.maxUses, input.expiresAtMs, by.toLowerCase(), now],
  );
  return toCode(rows[0]!);
}

export async function listAccessCodes(): Promise<AccessCode[]> {
  const { rows } = await db().query<CodeRow>(
    `SELECT ${COLUMNS} FROM access_codes ORDER BY created_at_ms DESC LIMIT 200`,
  );
  return rows.map(toCode);
}

/** Revoke. Idempotent: a second revoke keeps the first timestamp. `null` if no such code. */
export async function revokeAccessCode(code: string): Promise<AccessCode | null> {
  const { rows } = await db().query<CodeRow>(
    `UPDATE access_codes SET revoked_at_ms = COALESCE(revoked_at_ms, $2)
     WHERE code = $1 RETURNING ${COLUMNS}`,
    [code, Date.now()],
  );
  return rows[0] === undefined ? null : toCode(rows[0]);
}

export type Redemption =
  | { ok: true; token: string; expiresAtMs: number }
  | { ok: false; reason: 'malformed' | 'unknown' | 'revoked' | 'expired' | 'exhausted' };

function digestOf(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Redeem a code: spend one use and issue a pass.
 *
 * The use is spent by a single conditional UPDATE, so two people redeeming the last use at the
 * same instant cannot both succeed — the row's own `uses < max_uses` is the arbiter, not a read
 * followed by a write. When the UPDATE matches nothing, a second read says *why*, because "that
 * code did not work" sends the person back to whoever gave it to them with nothing to say.
 */
export async function redeemAccessCode(raw: string, now = Date.now()): Promise<Redemption> {
  const code = normaliseCode(raw);
  if (code === null) return { ok: false, reason: 'malformed' };

  /*
    The spend and the pass are ONE edit, and they were two statements.

    The `UPDATE` is correct on its own: `AND uses < max_uses` in the `WHERE` makes the spend atomic,
    so two callers racing for the last use cannot both take it. What was wrong is what happened
    after it. The update committed, and the pass was inserted by a separate statement — so an
    instance frozen or killed between them left a use permanently consumed from a code with a hard
    ceiling, and no pass to show for it. There is no compensating delete and nothing reconciles it.

    On a single-use code handed to one person, that is that person locked out for good, by a failure
    that had nothing to do with them.

    One transaction, following `setPerks`, which is the only other place in this application that
    needed two writes to be one edit. The sweep below stays outside it: housekeeping that fails is
    not a redemption that fails.
  */
  const client = await db().connect();
  let row: { expires_at_ms: string | null } | undefined;
  let token: string | undefined;
  let expiresAtMs = 0;

  try {
    await client.query('BEGIN');

    const spent = await client.query<{ expires_at_ms: string | null }>(
      `UPDATE access_codes SET uses = uses + 1
       WHERE code = $1
         AND revoked_at_ms IS NULL
         AND (expires_at_ms IS NULL OR expires_at_ms > $2)
         AND uses < max_uses
       RETURNING expires_at_ms`,
      [code, now],
    );
    row = spent.rows[0];

    if (row !== undefined) {
      token = randomBytes(32).toString('base64url');
      const codeExpiry = row.expires_at_ms === null ? Infinity : Number(row.expires_at_ms);
      expiresAtMs = Math.min(now + ACCESS_PASS_TTL_MS, codeExpiry);

      await client.query(
        `INSERT INTO access_passes (digest, code, created_at_ms, expires_at_ms) VALUES ($1, $2, $3, $4)`,
        [digestOf(token), code, now, expiresAtMs],
      );
      await client.query('COMMIT');
    } else {
      // Nothing was spent, so there is nothing to commit. Rolling back rather than committing an
      // empty transaction keeps the two outcomes visibly different.
      await client.query('ROLLBACK');
    }
  } catch (error) {
    /*
      The spend is undone with it. That is the point: a redemption that could not issue a pass must
      not have cost the caller a use, and before this it did.
    */
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (row === undefined) {
    const why = await db().query<Pick<CodeRow, 'revoked_at_ms' | 'expires_at_ms' | 'uses' | 'max_uses'>>(
      `SELECT revoked_at_ms, expires_at_ms, uses, max_uses FROM access_codes WHERE code = $1`,
      [code],
    );
    const c = why.rows[0];
    if (c === undefined) return { ok: false, reason: 'unknown' };
    if (c.revoked_at_ms !== null) return { ok: false, reason: 'revoked' };
    if (c.expires_at_ms !== null && Number(c.expires_at_ms) <= now) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'exhausted' };
  }

  // Opportunistic, bounded sweep — this application has no cron. See `mintReadSession`. Outside the
  // transaction on purpose: housekeeping that fails is not a redemption that fails.
  await db().query(
    `DELETE FROM access_passes
     WHERE digest IN (SELECT digest FROM access_passes WHERE expires_at_ms <= $1 LIMIT 500)`,
    [now],
  );

  /*
    `token` is set exactly when `row` is, inside the transaction above, and the branch that leaves
    `row` undefined has already returned. The compiler cannot see that, so it is asserted here
    rather than defaulted — a default would invent a pass token, which is the one value in this
    function that must never be invented.
  */
  if (token === undefined) throw new Error('a redemption committed without minting a pass');

  return { ok: true, token, expiresAtMs };
}

/** The pass token out of a request's cookie header, or `null`. */
export function passTokenFrom(cookieHeader: string | null): string | null {
  return cookieFromHeader(cookieHeader, ACCESS_PASS_COOKIE);
}

/*
  A short cache, keyed by digest, for the proxy: it runs on every navigation, and a visitor clicking
  through five pages should cost one query, not five. Five seconds is also how long a revoke takes
  to bite, which matches `site_mode`'s own cache and is short enough that "I revoked it and they are
  still in" is not something anybody will observe.
*/
const CACHE_MS = 5_000;
const KEY = Symbol.for('projectx.social.access-pass');
interface Holder {
  [KEY]?: Map<string, { at: number; value: boolean }>;
}

/**
 * Whether a pass is good right now: exists, unexpired, and its code not revoked.
 *
 * `false` on any error. The gate must never open because a database was unreachable; a visitor
 * wrongly sent to the waiting list retries, and that is the whole cost.
 */
export async function passIsValid(token: string | null, now = Date.now()): Promise<boolean> {
  if (token === null || token === '') return false;
  const digest = digestOf(token);
  const key = digest.toString('hex');
  const holder = globalThis as unknown as Holder;
  const cache = (holder[KEY] ??= new Map());
  const held = cache.get(key);
  if (held !== undefined && now - held.at < CACHE_MS) return held.value;

  let value = false;
  try {
    const { rows } = await db().query(
      `SELECT 1 FROM access_passes p
       JOIN access_codes c ON c.code = p.code
       WHERE p.digest = $1 AND p.expires_at_ms > $2 AND c.revoked_at_ms IS NULL`,
      [digest, now],
    );
    value = rows.length > 0;
  } catch {
    value = false;
  }
  cache.set(key, { at: now, value });
  return value;
}

/** The header that sets a pass. Same attributes as the read-session cookie, for the same reasons. */
export function accessPassCookie(input: { token: string; expiresAtMs: number; secure: boolean }): string {
  const maxAgeSeconds = Math.max(0, Math.floor((input.expiresAtMs - Date.now()) / 1000));
  return [
    `${ACCESS_PASS_COOKIE}=${input.token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(input.secure ? ['Secure'] : []),
  ].join('; ');
}
