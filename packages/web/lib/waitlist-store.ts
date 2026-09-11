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

export async function recordSignup(input: {
  email: string;
  source: WaitlistSource;
  role: WaitlistRole;
  handle: string | null;
  refCode?: string | null;
}): Promise<{ result: SignupResult; standing: WaitlistStanding }> {
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

      const existing = await ensureCode(email);
      return { result: 'already', standing: await readStanding(email, existing) };
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
