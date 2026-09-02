// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  A receipt names the post it opened — the post under THIS vault, not whichever row shares the key.

  Mutation predicted: match titles on the key alone → "two creators, one key, two titles" red.
*/
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { normaliseAddress } = await import('../lib/db');
const { addPost, titlesForContentKeys, titleKey } = await import('../lib/content');

const VAULT_A = `0x${'a1'.repeat(32)}`;
const VAULT_B = `0x${'b2'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

beforeEach(async () => {
  await resetDatabase();
  for (const [handle, vault] of [['alice', VAULT_A], ['bob', VAULT_B]] as const) {
    await testDb().query(
      `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type) VALUES ($1, $2, $3, $4, 'writes', $5)`,
      [handle, normaliseAddress(vault), `0x${handle.charCodeAt(0).toString(16).repeat(32)}`, handle, COIN],
    );
    await addPost({
      id: `p-${handle}`, vaultId: normaliseAddress(vault), authorHandle: handle, createdAtMs: 1_756_700_000_000,
      title: `${handle}'s intro`, preview: 'a taste', body: '', access: { kind: 'paid', price: '250000', contentKey: 'intro' },
    });
  }
});
afterAll(closeDatabase);

describe('titlesForContentKeys', () => {
  it('two creators, one key, two titles — each under its own vault', async () => {
    const titles = await titlesForContentKeys([
      { vaultId: VAULT_A, contentKey: 'intro' },
      { vaultId: VAULT_B, contentKey: 'intro' },
    ]);
    expect(titles.get(titleKey(VAULT_A, 'intro'))).toBe("alice's intro");
    expect(titles.get(titleKey(VAULT_B, 'intro'))).toBe("bob's intro");
  });

  it('a key this vault never priced has no title, even when another vault priced it', async () => {
    const titles = await titlesForContentKeys([{ vaultId: `0x${'c3'.repeat(32)}`, contentKey: 'intro' }]);
    expect(titles.size).toBe(0);
  });
});
