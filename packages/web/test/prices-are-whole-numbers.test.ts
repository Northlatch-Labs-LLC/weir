// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * A price is a whole number of the smallest unit — in the column, and in the reader.
 *
 * # The two defects this pins
 *
 * `agent_sponsorships.gas_budget_mist` has carried `CHECK (~ '^[0-9]+$')` since it was created.
 * `posts.price` and `messages.price` are the same kind of value and had no such check, while every
 * consumer parses them with `BigInt()` — which throws on `''`, `'1.5'` and `'1,000'` alike. The
 * last two are what a locale-formatted number from a client looks like. A stored row is read on
 * every render of the thread it belongs to, so one bad value is a permanent failure of that page
 * rather than a bad request somebody retries.
 *
 * Separately, `toPost` read a paid row with a NULL price as one costing `'0'` — a gated post
 * presenting as free, on the money path. The column constraint cannot close that: `price IS NULL`
 * is permitted by design, and it was the READER that invented a number.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';
import { paidAccess, type PostRow } from '../lib/content';

useTestDatabase();
afterAll(closeDatabase);

/** The smallest row that satisfies every other constraint, so only the price is under test. */
function postRow(price: string | null) {
  return {
    id: `t${Math.floor(Number(process.hrtime.bigint() % 1000000000n))}`,
    price,
  };
}

describe('the posts price column', () => {
  it('accepts a whole number', async () => {
    const { rows } = await testDb().query(`SELECT '10000' ~ '^[0-9]+$' AS ok`);
    expect(rows[0].ok).toBe(true);
  });

  it('carries the constraint at all', async () => {
    const { rows } = await testDb().query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'posts'::regclass AND conname = 'post_price_is_a_whole_number'`,
    );
    // Absent means db/032 was never applied to this database, which makes every rejection below
    // meaningless rather than reassuring.
    expect(rows.length, 'db/032 has not been applied to the test database').toBe(1);
    expect(rows[0].def).toContain("'^[0-9]+$'");
  });

  for (const bad of ['', '1.5', '1,000', '-1', '1e9', ' 1', 'abc', '0x10']) {
    it(`rejects ${JSON.stringify(bad)}`, async () => {
      // Asserted against the real predicate rather than an insert, so this states what the column
      // does without depending on every other NOT NULL in the table.
      const { rows } = await testDb().query(`SELECT ($1 ~ '^[0-9]+$') AS ok`, [bad]);
      expect(rows[0].ok).toBe(false);
    });
  }

  it('still permits NULL, which is how a free post is stored', async () => {
    // `content.ts` inserts `paid?.price ?? null`, so an unpriced post is NULL and never ''. A
    // constraint that rejected NULL would refuse every free post in the table.
    const { rows } = await testDb().query(
      `SELECT (NULL::text IS NULL OR NULL::text ~ '^[0-9]+$') AS ok`,
    );
    expect(rows[0].ok).toBe(true);
  });
});

describe('the messages price column', () => {
  it('carries the same constraint', async () => {
    const { rows } = await testDb().query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'messages'::regclass AND conname = 'message_price_is_a_whole_number'`,
    );
    expect(rows.length, 'db/032 has not been applied to the test database').toBe(1);
    expect(rows[0].def).toContain("'^[0-9]+$'");
  });
});

describe('reading a paid post that cannot say what it costs', () => {
  it('refuses rather than calling it free', () => {
    /*
      The old behaviour returned `{ price: '0' }` here. That is the failure this whole finding is
      about: not an error, not an empty page, but a gated post rendering as costing nothing.
    */
    expect(() => paidAccess({ ...postRow(null), content_key: 'k' } as unknown as PostRow)).toThrow(
      /no price/,
    );
  });

  it('refuses a paid post with no content key either', () => {
    expect(() =>
      paidAccess({ ...postRow('10000'), content_key: null } as unknown as PostRow),
    ).toThrow(/no content key/);
  });

  it('names the row, so the message leads somewhere', () => {
    const row = { ...postRow(null), content_key: 'k' } as unknown as PostRow;
    expect(() => paidAccess(row)).toThrow(new RegExp(row.id));
  });

  it('returns the real price when the row has one', () => {
    const access = paidAccess({ ...postRow('250000'), content_key: 'k' } as unknown as PostRow);
    expect(access).toEqual({ kind: 'paid', price: '250000', contentKey: 'k' });
  });
});
