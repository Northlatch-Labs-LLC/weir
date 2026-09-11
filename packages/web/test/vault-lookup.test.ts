// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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

    expect(sql()).toMatch(/WHERE vault_id = \$1/i);
    expect(sql()).not.toMatch(/lower\(vault_id\)/i);
  });

  it('normalises the argument instead, so mixed case still matches', async () => {
    const { findProfileByVault } = await import('../lib/content');

    await findProfileByVault(`0x${'AB'.repeat(32)}`);

    expect(params()[0]).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('zero-pads a short id, which lower() never did', async () => {
    const { findProfileByVault } = await import('../lib/content');

    await findProfileByVault('0x1');

    expect(params()[0]).toBe(`0x${'0'.repeat(63)}1`);
  });

  it('answers null for something that is not an id, rather than throwing', async () => {
    const { findProfileByVault } = await import('../lib/content');

    await expect(findProfileByVault('not-an-id')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('the writer normalises what the lookup compares', () => {
  it('normalises vault_id, not only owner', async () => {
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
    expect(migration).toMatch(/CHECK \(vault_id IS NULL OR vault_id ~ '\^0x\[0-9a-f\]\{64\}\$'\)/);
  });

  it('adds it NOT VALID and validates separately', () => {
    expect(migration).toMatch(/NOT VALID/);
    expect(migration).toMatch(/VALIDATE CONSTRAINT vault_id_is_normalised/);
  });

  it('still allows a vault-less profile', () => {
    expect(migration).toMatch(/vault_id IS NULL OR/);
  });
});
