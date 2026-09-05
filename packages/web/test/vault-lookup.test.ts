// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The lookup that could not use its own index, and the writer that was the real defect.
//
// `findProfileByVault` asked `WHERE lower(vault_id) = lower($1)`. `profiles_vault_id_key` is a
// plain unique index on the bare column, so a function applied to that column made the predicate
// non-sargable and the index unusable — every call sequentially scanned `profiles`, on the paths
// that take money.
//
// The obvious fix was to drop the `lower()`, on the reasoning that addresses are normalised on
// write. They were not: `upsertProfile` normalised `owner` and passed `vaultId` through raw. So
// dropping it would have silently stopped finding rows written with different casing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => `0x${BigInt(a).toString(16).padStart(64, '0')}`,
}));

const sql = (): string => String(query.mock.calls.at(-1)?.[0] ?? '').replace(/\s+/g, ' ').trim();
const params = (): unknown[] => (query.mock.calls.at(-1)?.[1] as unknown[]) ?? [];

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => vi.resetModules());

describe('the lookup can use the index', () => {
  it('compares the bare column, with no function applied to it', async () => {
    const { findProfileByVault } = await import('../lib/content');

    await findProfileByVault(`0x${'AB'.repeat(32)}`);

    // The defect in one assertion: a function on the indexed column makes the index unusable.
    expect(sql()).toMatch(/WHERE vault_id = \$1/i);
    expect(sql()).not.toMatch(/lower\(vault_id\)/i);
  });

  it('normalises the argument instead, so mixed case still matches', async () => {
    /*
      This is what the `lower()` was buying, and it is bought here now. Removing the function without
      moving the work would have been faster and wrong.
    */
    const { findProfileByVault } = await import('../lib/content');

    await findProfileByVault(`0x${'AB'.repeat(32)}`);

    expect(params()[0]).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('zero-pads a short id, which lower() never did', async () => {
    // A gain rather than parity: `lower('0x1')` matched nothing, because stored ids are padded.
    const { findProfileByVault } = await import('../lib/content');

    await findProfileByVault('0x1');

    expect(params()[0]).toBe(`0x${'0'.repeat(63)}1`);
  });

  it('answers null for something that is not an id, rather than throwing', async () => {
    /*
      "No profile owns that" is the honest answer to a vault id that cannot exist. Throwing would
      turn a bad query parameter into a 500 on a money path.
    */
    const { findProfileByVault } = await import('../lib/content');

    await expect(findProfileByVault('not-an-id')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('the writer normalises what the lookup compares', () => {
  it('normalises vault_id, not only owner', async () => {
    /*
      The actual defect. `owner` was normalised and `vault_id` was not, so the column the lookup
      compares was whatever the caller sent — and a row written with different casing was a row its
      own lookup could not find.
    */
    const { upsertProfile } = await import('../lib/content');

    await upsertProfile({
      handle: 'atlas',
      vaultId: `0x${'AB'.repeat(32)}`,
      owner: `0x${'CD'.repeat(32)}`,
      displayName: 'Atlas',
      bio: '',
      coinType: null,
    });

    expect(params()).toContain(`0x${'ab'.repeat(32)}`);
  });

  it('leaves a vault-less profile null rather than normalising nothing', async () => {
    // 006 made `vault_id` nullable for a registered account that has not opened a vault, and 007's
    // index is partial for the same reason. NULL is a state, not a missing value.
    const { upsertProfile } = await import('../lib/content');

    await upsertProfile({
      handle: 'atlas',
      vaultId: null,
      owner: `0x${'CD'.repeat(32)}`,
      displayName: 'Atlas',
      bio: '',
      coinType: null,
    });

    expect(params()).toContain(null);
  });
});

describe('the database enforces the shape the query assumes', () => {
  const migration = (() => {
    try {
      return readFileSync(join(process.cwd(), 'db/031_vault_ids_are_normalised.sql'), 'utf8')
        .split('\n')
        .map((l) => l.replace(/--.*$/, ''))
        .join('\n');
    } catch {
      return '';
    }
  })();

  it('constrains vault_id to a normalised address', () => {
    // The writer is application code and a future caller can forget. A CHECK is the guard that
    // still holds when they do.
    expect(migration).toMatch(/CHECK \(vault_id IS NULL OR vault_id ~ '\^0x\[0-9a-f\]\{64\}\$'\)/);
  });

  it('adds it NOT VALID and validates separately', () => {
    /*
      `ADD CONSTRAINT ... CHECK` without `NOT VALID` takes ACCESS EXCLUSIVE and scans every row
      before releasing it. On one row that is instant; the next person to copy this file will not be
      copying it onto one row.
    */
    expect(migration).toMatch(/NOT VALID/);
    expect(migration).toMatch(/VALIDATE CONSTRAINT vault_id_is_normalised/);
  });

  it('still allows a vault-less profile', () => {
    expect(migration).toMatch(/vault_id IS NULL OR/);
  });
});
