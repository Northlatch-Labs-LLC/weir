// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { randomBytes } from 'node:crypto';
import { db } from './db';
import {
  canonicalEmail,
  type WaitlistRole,
  type WaitlistSource,
  type WaitlistStanding,
} from './waitlist';

export type SignupResult = 'created' | 'already';

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.replace('U', '');
const CODE_LENGTH = 8;

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

export function canonicalCode(value: string): string {
  return value.trim().toUpperCase();
}

async function resolveReferrer(code: string): Promise<string | null> {
  const { rows } = await db().query<{ email: string }>(
    `SELECT email FROM waitlist_signups WHERE ref_code = $1`,
    [canonicalCode(code)],
  );
  return rows[0]?.email ?? null;
}

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
    return { position: 0, total: 0, refCode, referred: 0 };
  }

  return {
    position: Number(row.position),
    total: Number(row.total),
    refCode,
    referred: Number(row.referred),
  };
}

export async function recordSignup(input: {
  email: string;
  source: WaitlistSource;
  role: WaitlistRole;
  handle: string | null;
  refCode?: string | null;
}): Promise<{ result: SignupResult; standing: WaitlistStanding | null }> {
  const email = canonicalEmail(input.email);

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
        Already on the list, and that is all this says.

        It used to answer with the entry's standing — position, referral code, referral count —
        on the reasoning that the write was the only place standing was told, so no lookup had to
        exist. But the write IS a lookup for anyone who can type an address: an external scan of
        weir.social (2026-11-25) read a stranger's referral code this way. The code is the one part
        worth keeping back — it is what lets somebody else attribute signups to that entry — and
        the position tells a stranger more than "this address is on the list" already did.

        The person who signed up was told their standing when they signed up. A panel that gets
        `already` and no standing says "You are on the list", which is true and is enough.
      */
      return { result: 'already', standing: null };
    } catch (error) {
      const pg = error as { code?: unknown; constraint?: unknown };
      const codeCollision = pg.code === '23505' && pg.constraint === 'waitlist_signups_ref_code_idx';
      if (codeCollision && attempt < MAX_ATTEMPTS - 1) continue;
      throw error;
    }
  }

  throw new Error('waitlist: exhausted referral code attempts');
}

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
