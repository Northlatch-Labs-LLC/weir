// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { db } from './db';

export { MAX_DETAIL, MAX_PERKS, MAX_TITLE } from './perks-limits';
import { MAX_DETAIL, MAX_PERKS, MAX_TITLE } from './perks-limits';

export interface Perk {
  thresholdUnits: bigint;
  title: string;
  detail: string;
}

interface PerkRow {
  threshold_units: string;
  title: string;
  detail: string;
}

export async function listPerks(handle: string): Promise<Perk[]> {
  const { rows } = await db().query<PerkRow>(
    `SELECT threshold_units, title, detail FROM creator_perks
     WHERE handle = $1 ORDER BY position`,
    [handle],
  );
  return rows.map((row) => ({
    thresholdUnits: BigInt(row.threshold_units),
    title: row.title,
    detail: row.detail,
  }));
}

export function validatePerks(input: unknown): { ok: true; perks: Perk[] } | { ok: false; why: string } {
  if (!Array.isArray(input)) return { ok: false, why: 'perks must be a list' };
  if (input.length > MAX_PERKS) return { ok: false, why: `at most ${MAX_PERKS} perks` };
  const perks: Perk[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, why: 'each perk must be an object' };
    const item = raw as Record<string, unknown>;
    const title = typeof item['title'] === 'string' ? item['title'].trim() : '';
    if (title === '') return { ok: false, why: 'every perk needs a title' };
    if (title.length > MAX_TITLE) return { ok: false, why: `a title is at most ${MAX_TITLE} characters` };
    const detail = typeof item['detail'] === 'string' ? item['detail'].trim() : '';
    if (detail.length > MAX_DETAIL) return { ok: false, why: `a detail is at most ${MAX_DETAIL} characters` };
    const units = item['thresholdUnits'];
    if (typeof units !== 'string' || !/^\d+$/.test(units)) {
      return { ok: false, why: 'a threshold must be a whole number of the smallest unit' };
    }
    perks.push({ thresholdUnits: BigInt(units), title, detail });
  }
  return { ok: true, perks };
}

export async function setPerks(handle: string, perks: readonly Perk[]): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM creator_perks WHERE handle = $1', [handle]);
    for (const [position, perk] of perks.entries()) {
      await client.query(
        `INSERT INTO creator_perks (handle, position, threshold_units, title, detail)
         VALUES ($1, $2, $3, $4, $5)`,
        [handle, position, perk.thresholdUnits.toString(), perk.title, perk.detail],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setSupportersFirst(handle: string, value: boolean): Promise<void> {
  await db().query('UPDATE profiles SET supporters_first = $2 WHERE handle = $1', [handle, value]);
}

export async function readSupportersFirst(handle: string): Promise<boolean> {
  const { rows } = await db().query<{ supporters_first: boolean }>(
    'SELECT supporters_first FROM profiles WHERE handle = $1',
    [handle],
  );
  return rows[0]?.supporters_first ?? false;
}
