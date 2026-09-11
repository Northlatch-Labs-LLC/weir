// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
/**
 * What a creator promises the people who tip them.
 *
 * The one thing on this site the contract does not enforce. `creator::tip` mints nothing, so there
 * is no object to gate on and no Move function that could hold anybody to this — it is a creator's
 * word, recorded here and displayed with that stated plainly. See `db/017_creator_perks.sql`.
 *
 * Thresholds are lifetime totals in the smallest unit of that creator's own vault coin, because
 * that is the unit `PaymentSettled` reports and the unit the contract settles in.
 */
import { db } from './db';

/*
  The limits live in `perks-limits.ts` — a module the browser can import, because the editor must
  hold the same numbers this validator does. Re-exported here so a server caller has one import.
*/
export { MAX_DETAIL, MAX_PERKS, MAX_TITLE } from './perks-limits';
import { MAX_DETAIL, MAX_PERKS, MAX_TITLE } from './perks-limits';

export interface Perk {
  /** Lifetime tips required, in the smallest unit of the creator's vault coin. */
  thresholdUnits: bigint;
  title: string;
  detail: string;
}

interface PerkRow {
  threshold_units: string;
  title: string;
  detail: string;
}

/** One creator's perks, in the order they set. */
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

/**
 * What a caller may store, and why each rejection exists.
 *
 * Returns the cleaned list, or a sentence naming what is wrong. The database has the same limits as
 * constraints; this is the layer that can explain them to the person typing.
 */
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
    /*
      The threshold arrives as a decimal string of the smallest unit. Parsed by `BigInt` rather than
      `Number`, which loses precision above 2^53 — a 9-decimal coin reaches that at 9 million SUI,
      and silently rounding a threshold is how a supporter is refused a perk they paid for.
    */
    const units = item['thresholdUnits'];
    if (typeof units !== 'string' || !/^\d+$/.test(units)) {
      return { ok: false, why: 'a threshold must be a whole number of the smallest unit' };
    }
    perks.push({ thresholdUnits: BigInt(units), title, detail });
  }
  return { ok: true, perks };
}

/**
 * Replace a creator's perks with exactly this list.
 *
 * In one transaction, because the delete and the insert are one edit: a failure between them would
 * leave a creator's page promising nothing at all, which is not a state they asked for.
 */
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

/** Whether this creator says they answer supporters first. */
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
