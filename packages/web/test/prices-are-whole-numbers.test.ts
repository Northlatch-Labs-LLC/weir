// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';
import { paidAccess, paidMessageAccess, type MessageRow, type PostRow } from '../lib/content';

useTestDatabase();
afterAll(closeDatabase);

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
    expect(rows.length, 'db/032 has not been applied to the test database').toBe(1);
    expect(rows[0].def).toContain("'^[0-9]+$'");
  });

  for (const bad of ['', '1.5', '1,000', '-1', '1e9', ' 1', 'abc', '0x10']) {
    it(`rejects ${JSON.stringify(bad)}`, async () => {
      const { rows } = await testDb().query(`SELECT ($1 ~ '^[0-9]+$') AS ok`, [bad]);
      expect(rows[0].ok).toBe(false);
    });
  }

  it('still permits NULL, which is how a free post is stored', async () => {
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

describe('reading a paid MESSAGE that cannot say what it costs', () => {
  const row = (over: Partial<MessageRow>) =>
    ({
      id: 'm1',
      access_kind: 'paid',
      price: '250000',
      content_key: 'k',
      vault_id: `0x${'ab'.repeat(32)}`,
      ...over,
    }) as unknown as MessageRow;

  it('refuses a missing price rather than calling it free', () => {
    expect(() => paidMessageAccess(row({ price: null }))).toThrow(/no price/);
  });

  it('refuses a missing content key rather than handing back an empty one', () => {
    expect(() => paidMessageAccess(row({ content_key: null }))).toThrow(/no content key/);
  });

  it('refuses a missing vault rather than pointing the payment at nowhere', () => {
    expect(() => paidMessageAccess(row({ vault_id: null }))).toThrow(/no vault/);
  });

  it('names the row, so the message leads somewhere', () => {
    expect(() => paidMessageAccess(row({ price: null }))).toThrow(/m1/);
  });

  it('returns all three when the row has them', () => {
    expect(paidMessageAccess(row({}))).toEqual({
      kind: 'paid',
      price: '250000',
      contentKey: 'k',
      vaultId: `0x${'ab'.repeat(32)}`,
    });
  });
});
