// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { cookieFromHeader } from './read-session';

export const ACCESS_PASS_COOKIE = 'weir_pass';
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

export function generateCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]!);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

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

export async function redeemAccessCode(raw: string, now = Date.now()): Promise<Redemption> {
  const code = normaliseCode(raw);
  if (code === null) return { ok: false, reason: 'malformed' };

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
      await client.query('ROLLBACK');
    }
  } catch (error) {
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

  await db().query(
    `DELETE FROM access_passes
     WHERE digest IN (SELECT digest FROM access_passes WHERE expires_at_ms <= $1 LIMIT 500)`,
    [now],
  );

  if (token === undefined) throw new Error('a redemption committed without minting a pass');

  return { ok: true, token, expiresAtMs };
}

export function passTokenFrom(cookieHeader: string | null): string | null {
  return cookieFromHeader(cookieHeader, ACCESS_PASS_COOKIE);
}

const CACHE_MS = 5_000;
const KEY = Symbol.for('projectx.social.access-pass');
interface Holder {
  [KEY]?: Map<string, { at: number; value: boolean }>;
}

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
